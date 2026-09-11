'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Camera, Check, Loader2 } from 'lucide-react'
import {
  updateDefectActionAction, uploadDefectPhotoAction,
  getActionPeriodAction, setDefectCompletionAction, applyActionPeriodToPlansAction,
  completeAllDefectsAction,
} from '@/app/(dashboard)/inspections/defect-actions'
// ⚠ 타입은 **원천에서** 가져온다 — `'use server'` 파일로 재수출하면 런타임에 값으로 방출된다
//   (defect-actions.ts의 🚨 주석 참조: 화면 500까지 갔고 tsc는 0이었다)
import type { ActionPeriod } from '@/lib/annex-total-period'
import { DateInput } from '@/components/ui/date-input'
import { dateRangeError, isEndBeforeStart } from '@/lib/date-range'

/** 불량 표 편집 (소방계획서_21 R6-7) — 불량마다 폼을 펼치지 않고 한 표에서 고친다.
 *  행 = 불량 1건, 칸 = 계획 내용 · 계획 기간 · 완료 내용 · 완료 · 전/후 사진.
 *  칸을 떠날 때(blur) 저장한다 — 타이핑 중 저장하면 부분 문장이 문서에 실리므로 디바운스가 아니라 blur다.
 *  원본 액션은 불량 카드(inspection-defects-client)와 같은 것을 쓴다 — 저장 경로는 하나다.
 *
 *  📌 **날짜는 총 이행기간에서 파생된다**(2026-09-10 사용자 결정). ⑥의 완료일은 손으로 치지 않고
 *     체크 한 번으로 기간 종료일이 들어가며, ⑤의 계획 기간은 [빈 칸에 일괄 적용]이 채운다.
 *     ⚠ 파생 규칙 자체는 **서버에 있다**(defect-actions `loadActionPeriod`) — 여기서 날짜를 만들면
 *     ④에서 기간을 고친 직후 낡은 값이 제출 문서에 인쇄된다(아래 F-21 주석과 같은 계열의 함정). */

export type GridDefect = {
  id: string
  defect_name: string
  defect_detail?: string | null
  severity: string
  photo_url: string | null
  after_photo_url: string | null
  action_plan?: string | null
  action_start?: string | null
  action_end?: string | null
  action_taken: string | null
  action_completed_at: string | null
}

export type Row = {
  actionPlan: string; actionStart: string; actionEnd: string
  actionTaken: string; actionCompletedAt: string
}
/** 표의 편집분. **부모가 들고 있어야 한다** — 이유는 DefectGrid의 `edits` 주석 참조(F-21). */
export type DefectEdits = Record<string, Partial<Row>>

const toRow = (d: GridDefect): Row => ({
  actionPlan: d.action_plan ?? '', actionStart: d.action_start ?? '', actionEnd: d.action_end ?? '',
  actionTaken: d.action_taken ?? '', actionCompletedAt: d.action_completed_at ?? '',
})

const SEV_CLS: Record<string, string> = {
  경미: 'bg-yellow-100 text-yellow-700', 보통: 'bg-orange-100 text-orange-700', 중대: 'bg-red-100 text-red-700',
}

/** 칸 제목·스텝바가 쓰는 집계 (소방계획서_36 S3-5).
 *  서버가 `[id]/page.tsx`에서 계산하는 것과 **같은 규칙**이어야 한다:
 *    planned = action_plan 또는 action_start가 있는 건 · done = action_completed_at이 있는 건 */
export type DefectTally = { planned: number; done: number; total: number }

export function DefectGrid({ defects, inspectionId, canEdit, mode, onSaved, onPhotoDone, onServerChanged, edits: editsProp, onEditsChange }: {
  defects: GridDefect[]
  inspectionId: string
  canEdit: boolean
  /** plan = ⑤ 이행계획(계획·기간·전 사진) / complete = ⑥ 이행완료(완료 내용·완료일·후 사진) */
  mode: 'plan' | 'complete'
  /** 저장 직후 **로컬로 다시 센 집계**를 올린다 — 부모가 이 값으로 칸 제목을 즉시 고친다(S3-5).
   *  종전에는 인자가 없어 부모가 router.refresh()로 상세 전체를 다시 그려야 숫자가 맞았다
   *  (실측: 셀 하나에 6.6초, 두 번째 셀은 21.9초). */
  onSaved?: (tally: DefectTally) => void
  /** 사진 업로드 완료 — **집계와 다른 축**이라 따로 뺐다(S3-8).
   *  사진은 planned/done을 바꾸지 않고 photoPairs(서버 계산)만 바꾼다. 희소 경로라
   *  (실측 업로드 8.4초·연 몇 회) 여기서는 서버 갱신을 그대로 두는 편이 옳다. */
  onPhotoDone?: () => void
  /** 서버가 **여러 행을 한꺼번에** 바꿨다(⑤ 기간 일괄 적용). 이때는 로컬 미러로 따라갈 수 없다 —
   *  어느 행이 채워졌는지 화면은 모르고, 편집분·기준선도 그 값을 본 적이 없다. 부모가 서버에서
   *  다시 읽어야 한다.
   *  ⚠ 주지 않으면 `onPhotoDone`으로 떨어진다 — 그쪽도 '서버가 바꿨으니 다시 읽어라'와 같은 뜻의
   *    희소 경로라 동작은 옳다. 다만 이름이 사실을 말하도록 자리를 따로 냈다(호출부는 점진 전환). */
  onServerChanged?: () => void
  /** 🔴 F-21 — 편집분을 **부모가** 들고 있게 한다(제어 컴포넌트).
   *
   *  왜: ⑤·⑥ pane은 `sel === …` 조건부 렌더라 단계를 바꾸면 이 컴포넌트가 **언마운트**된다.
   *  edits가 여기 있으면 그 순간 사라지고, 화면에는 서버 prop `defects`만 남는다.
   *  그런데 S3-7이 셀 저장마다 돌던 `router.refresh()`를 걷어낸 뒤로 그 prop은 **세션 내내
   *  갱신되지 않는다**(revalidatePath는 캐시를 무효화할 뿐, 이미 마운트된 클라이언트 트리에
   *  새 props를 밀어 넣지 않는다). 결과: **방금 저장한 조치계획이 단계를 바꾸면 사라진다.**
   *  ⚠ F-21은 이 위험을 예고하면서 "지금은 alsoChanged:true라 산다"고 적었는데 **그 진단은
   *  틀렸다** — 대조군 검사(test-workbench-defect-pane-switch.mts)를 현행 코드에 돌리니
   *  이미 붉었다. 즉 예고된 사고가 아니라 **이미 난 사고**였다.
   *  주지 않으면 지역 state로 동작한다(다른 호출부가 생겨도 깨지지 않게). */
  edits?: DefectEdits
  onEditsChange?: (next: DefectEdits) => void
}) {
  /** 편집분만 들고 있고 나머지는 서버 값을 그대로 읽는다 — 사본을 만들면 refresh와 어긋난다 */
  const [ownEdits, setOwnEdits] = useState<DefectEdits>({})
  const edits = editsProp ?? ownEdits
  const setEdits = (fn: (prev: DefectEdits) => DefectEdits) => {
    if (editsProp && onEditsChange) onEditsChange(fn(editsProp))
    else setOwnEdits(fn)
  }
  const [saving, setSaving] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState<Record<string, boolean>>({})
  const [err, setErr] = useState('')

  /** 머리글에 띄우는 총 이행기간. **표시 전용**이다 — 저장 값은 서버가 쓰기 시점에 다시 읽는다.
   *
   *  ⚠ 부모에게서 prop으로 받지 않는다. 작업대의 서버 prop은 세션 내내 갱신되지 않아(F-21)
   *    ④에서 기간을 고쳐도 여기가 낡은 채 남는다. ⑤·⑥ pane은 조건부 렌더라 단계를 옮길 때마다
   *    이 컴포넌트가 다시 마운트되므로, 여기서 직접 읽으면 그 왕래가 곧 갱신이 된다. */
  const [period, setPeriod] = useState<ActionPeriod | null>(null)
  const [bulk, setBulk] = useState(false)
  const [bulkMsg, setBulkMsg] = useState('')
  /** 🔴 왕복 중인 체크 — **낙관적 반영**이다(라이브 프로브가 잡았다).
   *
   *  체크박스는 `action_completed_at`이 있는가로 그려지는데 그 값은 서버가 정한다(날짜를 화면이
   *  모른다). 그래서 낙관 반영이 없으면 **누른 직후 체크가 그대로 풀린다** — 왕복이 끝날 때까지
   *  화면상 아무 일도 안 일어난 것과 같고, 사용자는 안 눌렸다고 여겨 다시 누른다.
   *  실패하면 이 값을 지워 원래 상태로 되돌린다(서버가 참이라는 규약은 그대로다). */
  const [pendingDone, setPendingDone] = useState<Record<string, boolean>>({})
  useEffect(() => {
    let alive = true
    // ⚠ 이 조회만 catch를 단다 — 저장 경로와 달리 **모든 사용자에게 무조건** 도는 자리라
    //   실패하면 콘솔이 unhandled rejection으로 덮인다. 실패는 곧 '기간 없음' 안내로 떨어진다.
    void getActionPeriodAction(inspectionId)
      .then(p => { if (alive) setPeriod(p) })
      .catch(() => { if (alive) setPeriod(null) })
    return () => { alive = false }
  }, [inspectionId])

  const rowOf = (d: GridDefect): Row => ({ ...toRow(d), ...edits[d.id] })
  const set = (id: string, patch: Partial<Row>) =>
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  /** 여러 행을 **한 번에** 얹는다(⑥ 전건 완료). `set`을 루프로 부르면 안 된다 —
   *  제어 모드의 `setEdits`는 함수형이 아니라 렌더가 잡은 `editsProp`에 얹으므로(:103-106)
   *  N번 부르면 **마지막 한 행만 남는다**. 갱신을 한 번으로 모아 그 함정을 구조로 없앤다.
   *  (직접 변이로 확인했다: 루프로 바꾸면 A=false·C=true로 마지막 행만 살아남는다.) */
  const setMany = (patches: Record<string, Partial<Row>>) =>
    setEdits(prev => {
      const next = { ...prev }
      for (const [id, patch] of Object.entries(patches)) next[id] = { ...next[id], ...patch }
      return next
    })

  /** ⚠ 집계는 **최신 edits**로 세야 한다. commit의 .then은 네트워크 왕복 뒤에 도는데
   *  그 클로저가 잡은 edits는 그 사이 다른 칸이 바뀌었으면 낡는다 — ref로 최신을 본다. */
  const editsRef = useRef(edits)
  editsRef.current = edits

  /** 서버가 **거절한** 행 — 집계에서 그 행은 편집분이 아니라 서버 값으로 센다.
   *  (기간 뒤집힘은 아래 tallyWith가 값만 보고 스스로 판정하므로 여기 담지 않는다 —
   *   그쪽은 pane 전환으로 이 컴포넌트가 언마운트돼도 살아남아야 한다.) */
  const rejectedRef = useRef<Set<string>>(new Set())

  /** F-28 — 행별 '서버가 갖고 있다고 아는 값'. 델타 기준선이다(commit 주석 참조).
   *  서버 prop이 그 행을 바꾸면 그 값으로 맞춘다 — 안 그러면 남이 고친 값을 기준으로 못 잡는다. */
  const knownRef = useRef<Record<string, Row>>({})
  const lastServerRef = useRef<Record<string, string>>({})
  for (const d of defects) {
    const sig = JSON.stringify(toRow(d))
    if (lastServerRef.current[d.id] !== sig) {
      lastServerRef.current[d.id] = sig
      knownRef.current[d.id] = toRow(d)
    }
  }

  /** 방금 저장한 행은 `edits`에 아직 안 실렸을 수 있다(setDate는 set 직후 commit을 부른다).
   *  그래서 그 행만 확정된 값으로 덮어써서 센다 — 안 그러면 1건씩 늦게 반영된다.
   *
   *  ⚠ **저장되지 않은 편집은 세지 않는다**(독립 판정 지적). `edits`에는 서버에 실리지 못한
   *  값도 남는다 — 기간 뒤집힘 선차단(commit :return)과 서버 오류(.then :return) 두 갈래다.
   *  그걸 그대로 세면 나중에 **다른 행**이 성공 저장될 때 그 미저장 값이 집계에 섞여
   *  화면이 서버보다 앞선다. 그리고 서버 집계 문자열은 안 바뀌므로 부모의 폐기 effect도
   *  돌지 않아 **새로고침 때까지 어긋난 채 남는다** — 아래 trim 규칙과 같은 계열의 함정이다. */
  const tallyWithMany = (overrides: Record<string, Row>): DefectTally => {
    let planned = 0, done = 0
    for (const d of defects) {
      const server = toRow(d)
      const edited = { ...server, ...editsRef.current[d.id] }
      // 값만 보고 판정한다 — 서버가 받아 줄 수 없는 조합이면 그 행은 서버 값이 진실이다
      const usable = !rejectedRef.current.has(d.id)
        && !dateRangeError(edited.actionStart, edited.actionEnd, '이행 기간')
      /** ⚠ **override 행도 `usable`을 건너뛰면 안 된다**(5차 판정 실측).
       *
       *  F-27 이전에는 commit이 **다섯 칸 전부**를 보냈으므로 "row = 실제로 보낸 값"이 참이었고,
       *  그래서 override는 검사 없이 그대로 세도 옳았다. F-27이 **바뀐 칸만** 보내도록 좁히면서
       *  그 전제가 깨졌다 — 호출부가 넘기는 row에는 **보낸 적 없는 칸**(차단된 기간·계획)이
       *  섞여 있어, ⑥에서 조치 내용을 저장하면 ⑤ 칸 제목이 DB보다 크게 떴다(판정자 P-2 실측:
       *  제목 2/2 vs 서버 planned=1). 서버 집계 문자열이 안 바뀌니 폐기 effect도 안 돌아
       *  **새로고침 때까지 남는다** — 아래 trim 규칙과 정확히 같은 계열의 함정이다.
       *  호출부가 이제 `base + 보낸 칸`만 넘기지만, 여기서도 값으로 한 번 더 판정한다. */
      const ov = overrides[d.id]
      const r = ov
        ? (!dateRangeError(ov.actionStart, ov.actionEnd, '이행 기간') ? ov : server)
        : (usable ? edited : server)
      // ⚠ trim은 서버와 맞추기 위한 것이다(독립 판정 지적). 서버는 `actionPlan?.trim() || null`로
      // 저장하므로(defect-actions.ts) 공백만 친 칸은 서버에서 null이 된다. 여기서 트림 없이 세면
      // 로컬 planned가 1 더 커지고, **서버 집계 문자열이 안 바뀌니 로컬을 버리는 effect도 안 돈다**
      // → 오차가 새로고침 때까지 남는다. 규칙이 갈리면 미러가 아니라 거짓말이 된다.
      if (r.actionPlan.trim() || r.actionStart.trim()) planned++
      if (r.actionCompletedAt.trim()) done++
    }
    return { planned, done, total: defects.length }
  }
  /** 한 행짜리 얇은 껍데기 — 저장 한 건이 확정될 때마다 부르는 자리(commit·toggleDone)는 그대로 둔다 */
  const tallyWith = (overrideId: string, overrideRow: Row): DefectTally =>
    tallyWithMany({ [overrideId]: overrideRow })

  /** ⑥ 완료 체크 — 날짜는 **서버가 정한다**(총 이행기간 종료일 → 그 행의 계획 종료일 → 거절).
   *
   *  ⚠ commit()을 타지 않는다. commit은 '화면이 들고 있는 값'을 보내는 경로이고, 여기서 보낼 값은
   *    화면에 없다(서버가 만든다). 대신 저장이 끝나면 **서버가 돌려준 날짜로** 편집분·기준선·집계를
   *    맞춘다 — F-28이 말하는 '서버가 갖고 있다고 아는 값'을 갱신하지 않으면 다음 델타가 어긋난다. */
  function toggleDone(d: GridDefect, checked: boolean) {
    setPendingDone(prev => ({ ...prev, [d.id]: checked }))
    setSaving(d.id)
    setErr('')
    void setDefectCompletionAction({ defectId: d.id, inspectionId, done: checked }).then(res => {
      setSaving(null)
      // 낙관 반영을 걷는다 — 성공이면 아래 set()이 같은 값을 실어 화면이 안 흔들리고,
      // 실패면 서버 값(원래 상태)으로 되돌아간다. 같은 .then 안이라 한 번에 그려진다.
      setPendingDone(prev => { const next = { ...prev }; delete next[d.id]; return next })
      if (res.error) { setErr(res.error); return }
      const next = res.completedAt ?? ''
      set(d.id, { actionCompletedAt: next })
      const savedRow: Row = { ...(knownRef.current[d.id] ?? toRow(d)), actionCompletedAt: next }
      knownRef.current[d.id] = savedRow
      setJustSaved(prev => ({ ...prev, [d.id]: true }))
      setTimeout(() => setJustSaved(prev => ({ ...prev, [d.id]: false })), 4000)
      onSaved?.(tallyWith(d.id, savedRow))
    }).catch(() => {
      /* 🚨 액션이 **거절이 아니라 예외로** 끝나는 갈래(서버 모듈 평가 실패·네트워크 단절).
         .then만 있으면 여기서 `saving`이 영영 안 풀려 **체크박스가 잠긴 채 남는다** —
         실제로 그렇게 됐다(모듈 평가 ReferenceError로 500, 화면은 눌러도 반응 없음). */
      setSaving(null)
      setPendingDone(prev => { const next = { ...prev }; delete next[d.id]; return next })
      setErr('조치 완료 저장에 실패했습니다 — 잠시 후 다시 시도해 주세요.')
    })
  }

  /** ⑤ 계획 기간 일괄 적용 — **빈 칸만** 채운다(서버가 판정한다).
   *  건너뛴 건수를 그대로 말한다: 「전건 적용됨」으로 읽히면 손으로 정한 일정이 덮인 줄 모른다. */
  function applyPeriod() {
    setBulk(true)
    setErr('')
    setBulkMsg('')
    void applyActionPeriodToPlansAction({ inspectionId }).then(res => {
      setBulk(false)
      if (res.error) { setErr(res.error); return }
      if (res.period) setPeriod(res.period)
      const filled = res.filled ?? 0
      const skipped = res.skipped ?? 0
      setBulkMsg(filled === 0
        ? `채울 빈 칸이 없습니다 — ${skipped}건은 이미 기간이 있어 그대로 두었습니다.`
        : `${filled}건에 기간을 채웠습니다${skipped > 0 ? ` · ${skipped}건은 이미 값이 있어 건너뛰었습니다` : ''}.`)
      // 서버가 여러 행을 바꿨다 — 편집분·기준선을 믿을 수 없으니 부모가 서버에서 다시 읽게 한다
      ;(onServerChanged ?? onPhotoDone)?.()
    }).catch(() => {
      // 위 toggleDone과 같은 갈래 — 예외면 버튼이 영영 '적용 중'으로 잠긴다
      setBulk(false)
      setErr('이행기간 일괄 적용에 실패했습니다 — 잠시 후 다시 시도해 주세요.')
    })
  }

  /** ⑥ 불량 조치 **전건 완료** — 체크를 불량 수만큼 누르던 자리를 한 번으로 (2026-09-11 사용자 결정).
   *
   *  날짜는 단건 체크와 **똑같이 서버가 정한다**(toggleDone 주석 참조) — 화면이 만들면 ④에서 기간을
   *  고친 직후 낡은 값이 별지 11호에 인쇄된다. 그래서 돌려받은 **행별 날짜로** 편집분·기준선·집계를
   *  맞춘다(F-28: '서버가 갖고 있다고 아는 값'을 갱신하지 않으면 다음 델타가 어긋난다).
   *  ⚠ 스텝바 ⑤⑥ 배지는 서버 prop이라 로컬 미러로 못 따라간다 — 부모의 재조회가 받는다. */
  function completeAll() {
    setBulk(true)
    setErr('')
    setBulkMsg('')
    void completeAllDefectsAction({ inspectionId }).then(res => {
      setBulk(false)
      if (res.error) { setErr(res.error); return }
      const filled = res.done ?? []
      const already = res.already ?? 0
      const blocked = res.blocked ?? 0
      if (filled.length > 0) {
        const byId = new Map(defects.map(d => [d.id, d]))
        const patches: Record<string, Partial<Row>> = {}
        const overrides: Record<string, Row> = {}
        for (const { id, completedAt } of filled) {
          const d = byId.get(id)
          if (!d) continue   // 화면에 없는 행(다른 세션이 그 사이 추가) — 부모 재조회가 받는다
          patches[id] = { actionCompletedAt: completedAt }
          const row: Row = { ...(knownRef.current[id] ?? toRow(d)), actionCompletedAt: completedAt }
          knownRef.current[id] = row
          overrides[id] = row
        }
        setMany(patches)   // ⚠ set을 루프로 부르면 마지막 한 행만 남는다(setMany 주석)
        onSaved?.(tallyWithMany(overrides))
      }
      // 건수를 그대로 말한다 — 「전건 완료」라 적어 놓고 넘긴 건수를 삼키면 화면이 거짓말을 한다
      setBulkMsg(filled.length === 0
        ? `새로 완료할 불량이 없습니다 — ${already}건은 이미 완료 상태입니다.`
        : `${filled.length}건을 완료 처리했습니다`
          + (already > 0 ? ` · ${already}건은 이미 완료라 그대로 두었습니다` : '')
          + (blocked > 0 ? ` · ${blocked}건은 기간이 없어 넘겼습니다` : '') + '.')
      ;(onServerChanged ?? onPhotoDone)?.()
    }).catch(() => {
      // 위 toggleDone·applyPeriod와 같은 갈래 — 예외면 버튼이 영영 '완료 중'으로 잠긴다
      setBulk(false)
      setErr('전건 완료에 실패했습니다 — 잠시 후 다시 시도해 주세요.')
    })
  }

  /** 날짜는 값 자체가 완결이라 고르는 즉시 저장한다 — 달력 팝업으로 고르면 blur가 오지 않는다.
   *  서술 칸은 반대로 blur까지 기다린다(타이핑 중간 문장이 문서에 실리면 안 된다). */
  function setDate(d: GridDefect, patch: Partial<Row>) {
    set(d.id, patch)
    const v = Object.values(patch)[0] ?? ''
    if (v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v)) commit(d, patch)
  }

  /** F-27 — 이 표가 **소유한 칸**. ⑤는 계획·기간, ⑥은 조치내용·완료일만 그린다(:212-236).
   *
   *  ⚠ 종전엔 commit이 **다섯 칸 전부**를 조립해 보냈다. F-21이 `edits`를 부모로 올려
   *  ⑤·⑥이 **공유**하게 된 뒤로, ⑤에서 친 뒤집힌 이행 기간이 편집분에 남아
   *  **⑥의 저장을 통째로 막았다** — ⑥엔 그 칸이 없는데 그 칸의 오류가 떴다(독립 판정 실측:
   *  완료일·조치내용이 `null`로 남고 화면엔 '이행 기간' 오류). 안 그리는 칸은 안 보낸다. */
  const OWNED: Record<'plan' | 'complete', Array<keyof Row>> = {
    plan: ['actionPlan', 'actionStart', 'actionEnd'],
    complete: ['actionTaken', 'actionCompletedAt'],
  }
  const FIELD_KEY: Record<keyof Row, 'actionPlan' | 'actionStart' | 'actionEnd' | 'actionTaken' | 'actionCompletedAt'> = {
    actionPlan: 'actionPlan', actionStart: 'actionStart', actionEnd: 'actionEnd',
    actionTaken: 'actionTaken', actionCompletedAt: 'actionCompletedAt',
  }

  function commit(d: GridDefect, patch?: Partial<Row>) {
    const serverRow = toRow(d)
    /** F-28 — 델타의 기준은 **서버가 갖고 있다고 우리가 아는 값**이지 prop이 아니다.
     *
     *  prop은 갱신이 오기 전까지 낡아 있다. 그걸 기준으로 삼으면 **값을 원래대로 되돌리는
     *  수정이 '안 바뀜'으로 판정돼 전송되지 않고**, DB에 중간값이 남는다 — 종료일을 넣었다
     *  지우면 화면은 비었는데 DB는 그대로였다(내 9-3 단언이 잡았다).
     *  그래서 저장에 성공할 때마다 '아는 값'을 갱신하고, 서버가 그 행을 바꾸면 거기에 맞춘다
     *  (① 카드의 `syncedRef`와 같은 규약 — 두 표면이 같은 규칙을 쓰게 한다). */
    const known = knownRef.current[d.id] ?? serverRow
    const base = known
    const row: Row = { ...serverRow, ...edits[d.id], ...patch }
    // 내가 소유한 칸 중 **아는 값과 실제로 달라진 것만** 보낸다(부분 업데이트)
    const changed = OWNED[mode].filter(k => row[k] !== base[k])
    if (changed.length === 0) return
    // 기간 뒤집힘은 보내지 않는다(2026-08-19). 이 표는 날짜를 고르는 즉시 저장하므로
    // 서버 거절만 믿으면 왕복 뒤에야 알게 된다 — 서버 검사는 그대로 남아 최종 방어선이다.
    // ⚠ 기간은 ⑤의 칸이다 — ⑥에서는 검사하지 않는다(안 보내므로 판정할 것도 없다).
    if (mode === 'plan') {
      const rangeErr = dateRangeError(row.actionStart, row.actionEnd, '이행 기간')
      if (rangeErr) { setErr(rangeErr); return }
    }
    rejectedRef.current.delete(d.id)
    setSaving(d.id)
    setErr('')
    const payload: Record<string, string | null> = {}
    /** 저장 뒤 집계에 쓸 행 — **서버가 갖게 될 값**이다.
     *  ⚠ `row`가 아니다. `row`에는 이번에 **보내지 않는 칸**(다른 mode의 칸, 차단돼 남은 편집분)이
     *  섞여 있어 그대로 세면 화면이 DB보다 커진다(5차 판정 P-2 실측). base에 보낸 칸만 얹는다. */
    const savedRow: Row = { ...base }
    for (const k of changed) {
      payload[FIELD_KEY[k]] = row[k] || null
      savedRow[k] = row[k]
    }
    void updateDefectActionAction({
      defectId: d.id, inspectionId, ...payload,
    }).then(res => {
      setSaving(null)
      // 서버가 거절했다 — 이 행의 편집분은 집계에서 빠진다(다음 성공 저장 때 되돌아온다)
      if (res.error) { setErr(res.error); rejectedRef.current.add(d.id); return }
      // F-28 — 방금 보낸 값이 이제 '서버가 갖고 있다고 아는 값'이다(다음 델타의 기준선)
      knownRef.current[d.id] = savedRow
      setJustSaved(prev => ({ ...prev, [d.id]: true }))
      setTimeout(() => setJustSaved(prev => ({ ...prev, [d.id]: false })), 4000)
      // S3-5 — 서버 왕복을 기다리지 않고 **방금 확정된 값으로 다시 센 집계**를 올린다.
      // ⚠ 정정(5차 판정): 한때 "row는 저장에 실제로 보낸 값"이라 적었는데 **F-27로 거짓이 됐다** —
      //    이제 보내는 것은 `changed` 칸뿐이다. 그래서 base에 보낸 칸만 얹은 savedRow를 넘긴다.
      onSaved?.(tallyWith(d.id, savedRow))
    })
  }

  if (defects.length === 0) {
    // S7-1 — 빈 상태 설명은 '왜 비었는지'를 알려주는 정보다(해당 없음 vs 미입력의 구분)
    return <p className="px-1 py-2 text-form-xs text-ink-meta">불량이 없습니다 — 이 단계는 해당 없음입니다.</p>
  }

  // min-w-0 — input[type=date]는 UA 고유 최소폭이 있어 w-full이어도 좁은 칸에서 밖으로 삐져나온다.
  // 이게 작업대 3칸 폭 재배분의 남은 병목이었다(실측 2026-08-18: 계획 기간 칸에서 +27px).
  const cell = 'w-full min-w-0 rounded border border-brand-line-soft px-1.5 py-1 text-form-xs focus:outline-none focus:border-brand disabled:bg-paper'

  return (
    <div className="space-y-1">
      {err && <p className="px-1 text-form-xs text-red-600">❌ {err}</p>}
      {/* 총 이행기간 — ⑤ 계획 기간도 ⑥ 완료일도 **여기서 파생된다**. 원천은 ④ 소방서 제출의
          「총 이행기간」이라 여기서는 보여만 준다(두 자리에서 고치면 어느 쪽이 참인지 사라진다). */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-form-2xs" data-testid="defect-grid-period">
        {period
          ? <span className="text-ink-sub">총 이행기간 <b className="text-ink">{period.startISO} ~ {period.endISO}</b></span>
          /* ⚠ 기간이 없으면 완료 체크도 일괄 적용도 쓸 수 없다 — 무엇을 먼저 해야 하는지 말한다.
             「—」로 적으면 기간이 정해진 것처럼 읽히므로 문장으로 쓴다. */
          : <span className="text-amber-700">총 이행기간이 아직 없습니다 — ④ 소방서 제출에서 먼저 정해 주세요.</span>}
        {mode === 'plan' && canEdit && period && (
          <button type="button" onClick={applyPeriod} disabled={bulk} data-testid="apply-period-bulk"
            title="계획 기간이 비어 있는 불량에만 총 이행기간을 채웁니다 — 이미 값이 있는 행은 건드리지 않습니다"
            className="inline-flex items-center gap-1 h-6 px-2 rounded border border-brand-line text-form-2xs text-ink-sub hover:bg-brand-tint disabled:opacity-50">
            {bulk && <Loader2 className="size-2.5 animate-spin text-brand" />} 빈 칸에 일괄 적용
          </button>
        )}
        {/* ⑥의 **형제 자리** — ⑤가 계획을 한 번에 채우듯 ⑥은 완료를 한 번에 찍는다(2026-09-11).
            기간이 없으면 그리지 않는다: 그때는 서버가 어차피 거절하고, 왼쪽 안내가 무엇을 먼저
            해야 하는지 이미 말한다(버튼이 있는데 늘 실패하면 그게 더 나쁘다). */}
        {mode === 'complete' && canEdit && period && (
          <button type="button" onClick={completeAll} disabled={bulk} data-testid="complete-all-defects"
            title="아직 완료되지 않은 불량을 총 이행기간 종료일로 한 번에 완료 처리합니다 — 이미 완료된 행은 건드리지 않습니다"
            className="inline-flex items-center gap-1 h-6 px-2 rounded border border-brand-line text-form-2xs text-ink-sub hover:bg-brand-tint disabled:opacity-50">
            {bulk && <Loader2 className="size-2.5 animate-spin text-brand" />} 전건 완료
          </button>
        )}
      </div>
      {/* ⑤·⑥이 같은 칸을 쓰지만 **뜻이 다르다** — 이름이 한쪽만 말하면 다음 사람이 축을 혼동한다 */}
      {bulkMsg && <p className="px-1 text-form-2xs text-green-600"
        data-testid={mode === 'plan' ? 'apply-period-result' : 'complete-all-result'}>{bulkMsg}</p>}
      <table className="w-full table-fixed border-collapse text-form-xs" data-testid="defect-grid">
        <thead>
          <tr className="text-left text-form-2xs text-ink-soft">
            {/* 날짜 열은 'YYYY-MM-DD'(약 78px) + 달력 버튼(28px)이 들어가야 글자가 안 잘린다.
                종전 26%로는 칸이 좁아지면 날짜가 잘렸다 — 작업대 3칸 폭 재배분의 병목(실측 2026-08-18).
                불량명은 잘려도 줄바꿈으로 읽히므로 여기서 폭을 내준다. */}
            <th className="w-[26%] px-1 pb-1 font-medium">불량</th>
            {mode === 'plan' ? (<>
              <th className="w-[32%] px-1 pb-1 font-medium">조치 계획</th>
              <th className="w-[32%] px-1 pb-1 font-medium">계획 기간</th>
            </>) : (<>
              <th className="w-[32%] px-1 pb-1 font-medium">조치 내용</th>
              {/* '완료일'이 아니라 '완료' — 날짜는 체크하면 기간 종료일이 들어간다(2026-09-10) */}
              <th className="w-[32%] px-1 pb-1 font-medium">완료</th>
            </>)}
            <th className="w-[10%] px-1 pb-1 font-medium">사진 전·후</th>
          </tr>
        </thead>
        <tbody>
          {defects.map(d => {
            const r = rowOf(d)
            return (
              <tr key={d.id} className="align-top border-t border-brand-line-soft" data-defect-row={d.id}>
                <td className="px-1 py-1">
                  <span className={`mr-1 inline-block rounded px-1 py-px text-form-3xs ${SEV_CLS[d.severity] ?? 'bg-paper text-ink-sub'}`}>{d.severity}</span>
                  <span className="text-ink">{d.defect_name}</span>
                  {/* S7-1 4차 — 불량 상세는 '무엇을 고쳐야 하는지'다. 같은 파일에서 두 곳을 올리며
                      이것만 빠뜨렸던 자리(독립 판정이 '이웃 누락'으로 지적) */}
                  {d.defect_detail && <span className="block truncate text-form-2xs text-ink-meta">{d.defect_detail}</span>}
                  <span className="inline-flex h-3 items-center gap-1">
                    {saving === d.id && <Loader2 className="size-2.5 animate-spin text-brand" />}
                    {justSaved[d.id] && saving !== d.id && <span className="text-form-3xs text-green-600 inline-flex items-center gap-0.5"><Check className="size-2.5" /> 저장됨</span>}
                  </span>
                </td>
                {mode === 'plan' ? (<>
                  <td className="px-1 py-1">
                    <textarea rows={2} disabled={!canEdit} value={r.actionPlan} aria-label={`${d.defect_name} 조치 계획`}
                      onChange={e => set(d.id, { actionPlan: e.target.value })} onBlur={() => commit(d)}
                      className={`${cell} resize-y`} />
                  </td>
                  <td className="px-1 py-1 space-y-1">
                    <DateInput value={r.actionStart} disabled={!canEdit} aria-label={`${d.defect_name} 계획 시작일`}
                      onChange={e => setDate(d, { actionStart: e.target.value })} onBlur={() => commit(d)} className={cell} />
                    <DateInput value={r.actionEnd} disabled={!canEdit} aria-label={`${d.defect_name} 계획 종료일`}
                      onChange={e => setDate(d, { actionEnd: e.target.value })} onBlur={() => commit(d)}
                      aria-invalid={isEndBeforeStart(r.actionStart, r.actionEnd)}
                      className={`${cell}${isEndBeforeStart(r.actionStart, r.actionEnd) ? ' !border-red-400' : ''}`} />
                  </td>
                </>) : (<>
                  <td className="px-1 py-1">
                    <textarea rows={2} disabled={!canEdit} value={r.actionTaken} aria-label={`${d.defect_name} 조치 내용`}
                      onChange={e => set(d.id, { actionTaken: e.target.value })} onBlur={() => commit(d)}
                      className={`${cell} resize-y`} />
                  </td>
                  <td className="px-1 py-1">
                    {/* 체크 하나가 곧 완료다 — 날짜는 서버가 총 이행기간에서 파생한다(2026-09-10 사용자 결정).
                        ⚠ checked는 '체크한 적 있는가'가 아니라 **값이 있는가**로 판정한다. 손으로 적힌
                          과거 완료일도 그대로 체크로 보여야 한다(두 표면이 같은 규칙을 쓰게 한다). */}
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" disabled={!canEdit || saving === d.id}
                        checked={pendingDone[d.id] ?? !!r.actionCompletedAt.trim()}
                        aria-label={`${d.defect_name} 조치 완료`}
                        onChange={e => toggleDone(d, e.target.checked)}
                        className="size-3.5 shrink-0 accent-brand disabled:opacity-50" />
                      {/* 날짜는 서버가 정하므로 왕복 중에는 아직 없다 — 그 사이를 '미완료'라 적으면
                          체크는 켜졌는데 글씨는 미완료인 화면이 된다(서로 다른 말을 한다) */}
                      {r.actionCompletedAt.trim()
                        ? <span className="text-form-xs text-ink">{r.actionCompletedAt.slice(0, 10)}</span>
                        : pendingDone[d.id]
                          ? <span className="text-form-xs text-ink-meta">저장 중…</span>
                          : <span className="text-form-xs text-ink-meta">미완료</span>}
                    </label>
                    {/* 예외 창구 — 실제 조치일이 기간 종료일과 다를 때만 편다.
                        평소에 접어 두는 이유: 펴 두면 '쳐야 하는 칸'으로 읽혀 없앤 일이 되돌아온다. */}
                    {r.actionCompletedAt.trim() && canEdit && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-form-3xs text-ink-meta hover:text-brand">날짜 수정</summary>
                        <DateInput value={r.actionCompletedAt} aria-label={`${d.defect_name} 완료일`}
                          onChange={e => setDate(d, { actionCompletedAt: e.target.value })} onBlur={() => commit(d)}
                          className={`${cell} mt-1`} />
                      </details>
                    )}
                  </td>
                </>)}
                {/* 전·후를 한 행에 나란히 — 쌍이 맞는지는 나란히 놓아야 보인다(별지 11호 증빙) */}
                <td className="flex gap-1 px-1 py-1">
                  <PhotoCell defectId={d.id} inspectionId={inspectionId} canEdit={canEdit}
                    field="before" url={d.photo_url} onDone={onPhotoDone} />
                  <PhotoCell defectId={d.id} inspectionId={inspectionId} canEdit={canEdit}
                    field="after" url={d.after_photo_url} onDone={onPhotoDone} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {/* S7-1 — 저장 규약을 알려주는 사용 안내. 이걸 못 읽으면 저장된 줄 모른다 */}
      <p className="px-1 text-form-2xs text-ink-meta">칸을 벗어나면 저장됩니다 — 사진은 탭하면 카메라가 열립니다.</p>
    </div>
  )
}

function PhotoCell({ defectId, inspectionId, canEdit, field, url, onDone }: {
  defectId: string; inspectionId: string; canEdit: boolean
  field: 'before' | 'after'; url: string | null; onDone?: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  // 업로드 직후 서버 URL이 올 때까지만 쓰는 로컬 미리보기 — 서버 값을 사본으로 들고 있지 않는다
  const [local, setLocal] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const preview = local ?? url

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setLocal(URL.createObjectURL(file))
    startTransition(async () => {
      const fd = new FormData()
      fd.append('defectId', defectId); fd.append('inspectionId', inspectionId)
      fd.append('file', file); fd.append('field', field)
      const res = await uploadDefectPhotoAction(fd)
      if (res.error) setLocal(null)
      else onDone?.()
    })
  }

  return (
    <>
      <button type="button" disabled={!canEdit || pending} onClick={() => ref.current?.click()}
        aria-label={field === 'before' ? '전(불량) 사진' : '후 사진 추가'}
        title={field === 'before' ? '전(불량) 사진' : '후(조치) 사진'}
        className={`flex size-12 items-center justify-center overflow-hidden rounded border border-dashed disabled:opacity-50
          ${field === 'after' ? 'border-amber-300 hover:border-amber-500' : 'border-brand-line hover:border-brand'}`}>
        {pending ? <Loader2 className="size-3.5 animate-spin text-brand" />
          /* eslint-disable-next-line @next/next/no-img-element */
          : preview ? <img src={preview} alt="" className="size-full object-cover" />
            : <Camera className="size-3.5 text-ink-faint" />}
      </button>
      {/* 현장은 폰이다 — 슬롯을 탭하면 카메라가 바로 열린다(R6-10과 같은 경로) */}
      <input ref={ref} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />
    </>
  )
}
