'use client'

import { useState } from 'react'
import { FileSpreadsheet, Loader2 } from 'lucide-react'
import { DocNoticeToast } from '@/components/ui/doc-notice-toast'

/**
 * 이 문서가 화면에 뜨는 **유일한 이름**(2026-09-21 사용자 지시).
 *
 * 종전에는 같은 산출물이 표면마다 다른 글씨였다 — 회차 카드는 「엑셀」, 보고서 탭·작업대는
 * 「엑셀로 받기」, 점검 목록은 「엑셀」. 옆자리 [소방계획서 엑셀]만 이름이 붙어 있어서,
 * 정작 **무엇의 엑셀인지 갈라야 하는 쪽이 이름 없이** 떠 있었다(회차 탭엔 둘이 나란히 뜬다).
 *
 * 「보고서」로 정한 것은 그게 **탭 이름과 같아** 사용자가 이미 아는 말이기 때문이다.
 * 「결과보고서」는 정확하지만 칩 자리에 길고, 「별지」는 갑지까지 든 문서라 오히려 좁다.
 *
 * ⚠ 회차 카드 칩은 이 컴포넌트를 **쓰지 않는다** — 발행 가드(미입력이면 점검표로 보낸다)가
 *   붙어 손으로 짜여 있다. 그래서 그쪽은 이 상수를 import해서 쓴다. 글씨를 거기 또 적지 말 것:
 *   두 벌이 되는 순간 한쪽만 고쳐져 «같은 문서, 화면마다 다른 이름»이라는 종전 상태로 돌아간다.
 *   `test-workbook-label`이 그 분기를 문다.
 */
export const WORKBOOK_LABEL = '보고서 엑셀'

/** 갑지 통합 워크북(엑셀) 받기 — 생성물 목록의 **머리 자리** 창구.
 *
 *  배경(2026-09-10 사용자 요청): 이 버튼은 원래 [번들 생성] 패널 안에 있었다(bundle-generate-panel).
 *  그런데 그 패널은 기본이 접힘이고, 펼쳐도 네 번째 버튼이라 **사실상 숨어 있었다**. 문서를 받는
 *  자리는 생성물 목록이므로 목록 머리로 꺼낸다. 패널 쪽은 그대로 둔다 — 거기서 찾던 사람이 있다.
 *
 *  ⚠ **`window.open`·`<a href>`로 받으면 안 된다.** 라우트가 `X-Workbook-Missing` 헤더로 보내는
 *    고지(점검표 착지 집계·무응답 체크·사진 실패·불량 접힘 등)가 새 탭으로 열면 그대로 사라진다.
 *    종전 패널 버튼이 `<a href>`라 이 고지는 **한 번도 사용자에게 닿은 적이 없다**.
 *    그래서 `fetch`+`Blob`으로 받아 고지를 화면에 띄운다 — 소방계획서 엑셀 버튼
 *    (`customers/fire-plan-xlsx-button`)이 같은 이유로 먼저 밟은 길이고, 규약을 맞춘다.
 *
 *  ⚠ 저장하지 않는다(D-5) — 받아서 고치는 순간 서버 사본이 낡는다. 그래서 이 산출물은
 *    생성물 목록에 **행으로 쌓이지 않는다**. 목록 안이 아니라 목록 **머리**에 있는 이유다.
 *
 *  `variant='compact'`은 **점검 업무 목록 행**의 바로가기용이다(2026-09-16 사용자 요청). 종전에는
 *  점검 상세 작업대까지 들어가야 이 문서를 받을 수 있었다. 아이콘만 그렸다가 구분이 안 된다는
 *  지시로 **글씨 「엑셀」**로 바꿨다(고객 목록 쪽과 같은 축). 고지를 버튼 아래에 그리면 행 높이가
 *  튀므로 고지는 body 포털 토스트로 뺀다.
 *  **받는 방식(fetch+Blob)은 갈라지지 않는다** — 표면만 다르고 로직은 이 한 벌뿐이다. */
export function WorkbookXlsxButton({ inspectionId, disabled, variant = 'default' }: {
  inspectionId: string
  disabled?: boolean
  variant?: 'default' | 'compact'
}) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  async function download() {
    setError(''); setNotice(''); setBusy(true)
    try {
      const res = await fetch(`/inspections/${inspectionId}/workbook`)
      if (!res.ok) {
        // 라우트는 앵커 불일치·미착지를 500으로 끊는다 — 조용한 오적용 대신 사유를 보여 준다
        const body = await res.json().catch(() => null) as { error?: string } | null
        setError(body?.error ?? `엑셀 생성 실패 (HTTP ${res.status})`)
        return
      }
      const raw = res.headers.get('X-Workbook-Missing') ?? ''
      if (raw) { try { setNotice(decodeURIComponent(raw)) } catch { setNotice(raw) } }

      const blob = await res.blob()
      // 파일명은 Content-Disposition의 RFC 5987 filename*에서 — 규약(고객명_종류_연도)이 서버에 있다
      const cd = res.headers.get('Content-Disposition') ?? ''
      const star = /filename\*=UTF-8''([^;]+)/i.exec(cd)
      const name = star ? decodeURIComponent(star[1]) : `결과보고서_${inspectionId.slice(0, 8)}.xlsx`

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = name
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (variant === 'compact') {
    return (
      <>
        <button onClick={download} disabled={busy || disabled} data-testid="workbook-xlsx"
          title="결과보고서 엑셀 받기 — 갑지 서식 통합 워크북. 받은 뒤 고쳐 쓰실 수 있습니다 (저장되지 않습니다)"
          /* ⚠ 고정 폭 `w-[2.6rem]`을 **버렸다**(2026-09-21) — 「엑셀」 두 글자에 맞춘 폭이라
             `WORKBOOK_LABEL`이 들어가면 잘린다. 목록 행 정렬은 그래도 안 흔들린다: 라벨이 한 벌이라
             **모든 행이 같은 글씨 = 같은 폭**이다(고정 폭이 하던 일을 이제 라벨의 단일성이 한다). */
          className="inline-flex h-6 items-center justify-center gap-1 px-2 rounded border border-emerald-200 text-form-2xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-50">
          {busy ? <Loader2 className="size-3 animate-spin" /> : <><FileSpreadsheet className="size-3" /> {WORKBOOK_LABEL}</>}
        </button>
        <DocNoticeToast notice={notice} error={error}
          onClose={() => { setNotice(''); setError('') }} />
      </>
    )
  }

  return (
    <>
      <button onClick={download} disabled={busy || disabled} data-testid="workbook-xlsx"
        title="결과보고서 엑셀 받기 — 갑지 서식 통합 워크북. 받은 뒤 고쳐 쓰실 수 있습니다 (저장되지 않습니다)"
        className="inline-flex items-center gap-1 h-6 px-2 rounded border border-emerald-200 text-form-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
        {busy ? <Loader2 className="size-3 animate-spin" /> : <FileSpreadsheet className="size-3" />} {WORKBOOK_LABEL}
      </button>
      {error && (
        <p className="mt-1 w-full rounded-lg bg-red-50 px-2 py-1.5 text-form-xs text-red-600">{error}</p>
      )}
      {notice && (
        <p className="mt-1 w-full whitespace-pre-wrap break-words rounded-lg bg-amber-50 px-2 py-1.5 text-form-2xs text-amber-700">
          엑셀 고지: {notice}
        </p>
      )}
    </>
  )
}
