'use client'

import { useRef, useState, useTransition } from 'react'
import { Camera, Check, Loader2 } from 'lucide-react'
import { updateDefectActionAction, uploadDefectPhotoAction } from '@/app/(dashboard)/inspections/defect-actions'
import { DateInput } from '@/components/ui/date-input'
import { dateRangeError, isEndBeforeStart } from '@/lib/date-range'

/** 불량 표 편집 (소방계획서_21 R6-7) — 불량마다 폼을 펼치지 않고 한 표에서 고친다.
 *  행 = 불량 1건, 칸 = 계획 내용 · 계획 기간 · 완료 내용 · 완료일 · 전/후 사진.
 *  칸을 떠날 때(blur) 저장한다 — 타이핑 중 저장하면 부분 문장이 문서에 실리므로 디바운스가 아니라 blur다.
 *  원본 액션은 불량 카드(inspection-defects-client)와 같은 것을 쓴다 — 저장 경로는 하나다. */

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

export function DefectGrid({ defects, inspectionId, canEdit, mode, onSaved, onPhotoDone, edits: editsProp, onEditsChange }: {
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

  const rowOf = (d: GridDefect): Row => ({ ...toRow(d), ...edits[d.id] })
  const set = (id: string, patch: Partial<Row>) =>
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))

  /** ⚠ 집계는 **최신 edits**로 세야 한다. commit의 .then은 네트워크 왕복 뒤에 도는데
   *  그 클로저가 잡은 edits는 그 사이 다른 칸이 바뀌었으면 낡는다 — ref로 최신을 본다. */
  const editsRef = useRef(edits)
  editsRef.current = edits

  /** 방금 저장한 행은 `edits`에 아직 안 실렸을 수 있다(setDate는 set 직후 commit을 부른다).
   *  그래서 그 행만 확정된 값으로 덮어써서 센다 — 안 그러면 1건씩 늦게 반영된다. */
  const tallyWith = (overrideId: string, overrideRow: Row): DefectTally => {
    let planned = 0, done = 0
    for (const d of defects) {
      const r = d.id === overrideId ? overrideRow : { ...toRow(d), ...editsRef.current[d.id] }
      // ⚠ trim은 서버와 맞추기 위한 것이다(독립 판정 지적). 서버는 `actionPlan?.trim() || null`로
      // 저장하므로(defect-actions.ts) 공백만 친 칸은 서버에서 null이 된다. 여기서 트림 없이 세면
      // 로컬 planned가 1 더 커지고, **서버 집계 문자열이 안 바뀌니 로컬을 버리는 effect도 안 돈다**
      // → 오차가 새로고침 때까지 남는다. 규칙이 갈리면 미러가 아니라 거짓말이 된다.
      if (r.actionPlan.trim() || r.actionStart.trim()) planned++
      if (r.actionCompletedAt.trim()) done++
    }
    return { planned, done, total: defects.length }
  }

  /** 날짜는 값 자체가 완결이라 고르는 즉시 저장한다 — 달력 팝업으로 고르면 blur가 오지 않는다.
   *  서술 칸은 반대로 blur까지 기다린다(타이핑 중간 문장이 문서에 실리면 안 된다). */
  function setDate(d: GridDefect, patch: Partial<Row>) {
    set(d.id, patch)
    const v = Object.values(patch)[0] ?? ''
    if (v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v)) commit(d, patch)
  }

  function commit(d: GridDefect, patch?: Partial<Row>) {
    const base = toRow(d)
    const row: Row = { ...base, ...edits[d.id], ...patch }
    if ((Object.keys(base) as Array<keyof Row>).every(k => row[k] === base[k])) return
    // 기간 뒤집힘은 보내지 않는다(2026-08-19). 이 표는 날짜를 고르는 즉시 저장하므로
    // 서버 거절만 믿으면 왕복 뒤에야 알게 된다 — 서버 검사는 그대로 남아 최종 방어선이다.
    const rangeErr = dateRangeError(row.actionStart, row.actionEnd, '이행 기간')
    if (rangeErr) { setErr(rangeErr); return }
    setSaving(d.id)
    setErr('')
    void updateDefectActionAction({
      defectId: d.id, inspectionId,
      actionPlan: row.actionPlan || null,
      actionStart: row.actionStart || null,
      actionEnd: row.actionEnd || null,
      actionTaken: row.actionTaken || null,
      actionCompletedAt: row.actionCompletedAt || null,
    }).then(res => {
      setSaving(null)
      if (res.error) { setErr(res.error); return }
      setJustSaved(prev => ({ ...prev, [d.id]: true }))
      setTimeout(() => setJustSaved(prev => ({ ...prev, [d.id]: false })), 4000)
      // S3-5 — 서버 왕복을 기다리지 않고 **방금 확정된 값으로 다시 센 집계**를 올린다.
      // row는 저장에 실제로 보낸 값이라 낙관적 추정이 아니라 '확정된 값의 선반영'이다.
      onSaved?.(tallyWith(d.id, row))
    })
  }

  if (defects.length === 0) {
    // S7-1 — 빈 상태 설명은 '왜 비었는지'를 알려주는 정보다(해당 없음 vs 미입력의 구분)
    return <p className="px-1 py-2 text-[11px] text-ink-meta">불량이 없습니다 — 이 단계는 해당 없음입니다.</p>
  }

  // min-w-0 — input[type=date]는 UA 고유 최소폭이 있어 w-full이어도 좁은 칸에서 밖으로 삐져나온다.
  // 이게 작업대 3칸 폭 재배분의 남은 병목이었다(실측 2026-08-18: 계획 기간 칸에서 +27px).
  const cell = 'w-full min-w-0 rounded border border-brand-line-soft px-1.5 py-1 text-[11px] focus:outline-none focus:border-brand disabled:bg-paper'

  return (
    <div className="space-y-1">
      {err && <p className="px-1 text-[11px] text-red-600">❌ {err}</p>}
      <table className="w-full table-fixed border-collapse text-[11px]" data-testid="defect-grid">
        <thead>
          <tr className="text-left text-[10px] text-ink-soft">
            {/* 날짜 열은 'YYYY-MM-DD'(약 78px) + 달력 버튼(28px)이 들어가야 글자가 안 잘린다.
                종전 26%로는 칸이 좁아지면 날짜가 잘렸다 — 작업대 3칸 폭 재배분의 병목(실측 2026-08-18).
                불량명은 잘려도 줄바꿈으로 읽히므로 여기서 폭을 내준다. */}
            <th className="w-[26%] px-1 pb-1 font-medium">불량</th>
            {mode === 'plan' ? (<>
              <th className="w-[32%] px-1 pb-1 font-medium">조치 계획</th>
              <th className="w-[32%] px-1 pb-1 font-medium">계획 기간</th>
            </>) : (<>
              <th className="w-[32%] px-1 pb-1 font-medium">조치 내용</th>
              <th className="w-[32%] px-1 pb-1 font-medium">완료일</th>
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
                  <span className={`mr-1 inline-block rounded px-1 py-px text-[9px] ${SEV_CLS[d.severity] ?? 'bg-paper text-ink-sub'}`}>{d.severity}</span>
                  <span className="text-ink">{d.defect_name}</span>
                  {/* S7-1 4차 — 불량 상세는 '무엇을 고쳐야 하는지'다. 같은 파일에서 두 곳을 올리며
                      이것만 빠뜨렸던 자리(독립 판정이 '이웃 누락'으로 지적) */}
                  {d.defect_detail && <span className="block truncate text-[10px] text-ink-meta">{d.defect_detail}</span>}
                  <span className="inline-flex h-3 items-center gap-1">
                    {saving === d.id && <Loader2 className="size-2.5 animate-spin text-brand" />}
                    {justSaved[d.id] && saving !== d.id && <span className="text-[9px] text-green-600 inline-flex items-center gap-0.5"><Check className="size-2.5" /> 저장됨</span>}
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
                    <DateInput value={r.actionCompletedAt} disabled={!canEdit} aria-label={`${d.defect_name} 완료일`}
                      onChange={e => setDate(d, { actionCompletedAt: e.target.value })} onBlur={() => commit(d)} className={cell} />
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
      <p className="px-1 text-[10px] text-ink-meta">칸을 벗어나면 저장됩니다 — 사진은 탭하면 카메라가 열립니다.</p>
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
