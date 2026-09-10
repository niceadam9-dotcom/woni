'use client'

import { useState } from 'react'
import { FileText, FileType2, Eye, Download, ChevronDown, ChevronRight } from 'lucide-react'
import { openAnnexHwp, openAnnexPdf } from '@/lib/annex-filename'
import { groupFiles, type DocGroup, type GeneratedDocFile } from '@/lib/generated-docs'

/** 생성물 목록 — 문서 단위 1행 그룹핑 (소방계획서_5 ⑩ R11, §3-6 공용 컴포넌트)
 *  같은 생성 타임스탬프의 hwp/pdf/html을 "문서명 · 시각 [최신] [HWP][PDF][미리보기]" 1행으로.
 *  파일명은 화면에서 제거, html은 [미리보기] 버튼으로만. 최신 1건 기본 + "이전 생성 n건" 접기.
 *
 *  HWP·PDF는 `/inspections/{id}/doc` 라우트로 연다 — 저장명 규약(별지 4·9호 제출용 이름)이
 *  점검 유형에 걸려 있어 서버에서 붙인다(lib/annex-filename 단일 출처). 화면은 이름을 만들지 않는다.
 *  html 미리보기와 규약 밖 파일만 종전 onOpen(서명 URL)을 탄다. */

/** 그룹핑·정렬은 lib/generated-docs (순수 로직, 프로브가 고정). 여기서는 그리기만 한다. */
export type { GeneratedDocFile } from '@/lib/generated-docs'

const fmtTime = (iso: string | null) => (iso ? iso.slice(0, 16).replace('T', ' ') : '')

export function GeneratedDocList({ files, onOpen, inspectionId, disabled }: {
  files: GeneratedDocFile[]
  /** html 미리보기·규약 밖 파일용 — 새 탭 열람 (별지 산출물은 doc 라우트로 나간다) */
  onOpen: (path: string, saveName?: string) => void
  inspectionId: string
  disabled?: boolean
}) {
  const [showOld, setShowOld] = useState(false)
  if (files.length === 0) return null
  const groups = groupFiles(files)
  // 문서 종류별 최신 1건만 기본 표시 (R11-c) — 나머지는 "이전 생성 n건" 접기
  const latestKeys = new Set<string>()
  const latest: DocGroup[] = []
  const old: DocGroup[] = []
  for (const g of groups) {
    if (g.kind && !latestKeys.has(g.kind)) { latestKeys.add(g.kind); latest.push(g) }
    else if (!g.kind) latest.push(g)
    else old.push(g)
  }
  const openHwp = (f: GeneratedDocFile) => openAnnexHwp(inspectionId, f.name)
  const openPdf = (f: GeneratedDocFile) => openAnnexPdf(inspectionId, f.name)

  // R11-b: HWP=파란 아이콘(편집 원본) / PDF=빨간 아이콘(열람·인쇄) — 전 화면 동일 스타일
  const hwpBtn = 'inline-flex items-center gap-1 h-6 px-2 rounded border border-blue-200 text-form-xs text-blue-600 hover:bg-blue-50 disabled:opacity-50'
  const pdfBtn = 'inline-flex items-center gap-1 h-6 px-2 rounded border border-red-200 text-form-xs text-red-600 hover:bg-red-50 disabled:opacity-50'
  const subBtn = 'inline-flex items-center gap-1 h-6 px-2 rounded border border-brand-line text-form-xs text-brand hover:bg-brand-tint disabled:opacity-50'

  /** 두 줄인 이유 — 한 줄로는 **폭이 물리적으로 모자란다**(2026-09-10 실측).
   *  작업대 3단 레이아웃의 이 칸은 278px인데 한 줄에 든 것이 314px를 요구했다
   *  (날짜 118 + [최신] 29 + 버튼 143 + 간격). 날짜·배지·버튼이 전부 `shrink-0`이라
   *  줄어들 수 있는 건 문서명뿐이어서, 이름이 **0px까지 눌려** 7행이 전부
   *  「제 · 위 · 보 · 실 · 소 · 이 · 이」로 보였다. `flex-1`만으로는 못 고친다 —
   *  남는 폭이 없으면 flex-1의 몫도 0이다. 그래서 이름에게 **제 줄**을 준다. */
  const row = (g: DocGroup, isLatest: boolean) => (
    <div key={g.key} className="text-xs py-1">
      <div className="flex items-center gap-1.5">
        {/* data-testid — 이 이름이 **실제로 폭을 갖는지**는 렌더해 봐야 안다(정적 검사는 0px을
            초록으로 통과시켰다). test-exterior-ui가 실측 폭을 단언한다. */}
        <span data-testid="doc-row-name" className="min-w-0 flex-1 truncate text-ink font-medium"
          title={g.full}>{g.label}</span>
        {isLatest && g.kind && (
          <span className="px-1 py-0.5 rounded bg-brand-tint text-brand text-form-2xs font-medium shrink-0">최신</span>
        )}
      </div>
      <div className="mt-0.5 flex items-center gap-1">
        {g.createdAt && <span className="text-form-xs text-ink-meta shrink-0">{fmtTime(g.createdAt)}</span>}
        <span className="ml-auto flex items-center gap-1 shrink-0">
        {isLatest ? (<>
          {g.hwp && (
            <button onClick={() => openHwp(g.hwp!)} disabled={disabled}
              title="한글 편집용 원본 내려받기" className={hwpBtn}>
              <FileText className="size-3" /> HWP
            </button>
          )}
          {g.pdf && (
            <button onClick={() => openPdf(g.pdf!)} disabled={disabled}
              title="바로 보기·인쇄" className={pdfBtn}>
              <FileType2 className="size-3" /> PDF
            </button>
          )}
          {g.html && (
            <button onClick={() => onOpen(g.html!.path)} disabled={disabled}
              title="웹 미리보기" className={subBtn}>
              <Eye className="size-3" /> 미리보기
            </button>
          )}
          {!g.hwp && !g.pdf && !g.html && g.others.map(o => (
            <button key={o.path} onClick={() => onOpen(o.path)} disabled={disabled} className={subBtn}>
              <Download className="size-3" /> 받기
            </button>
          ))}
        </>) : (<>
          {g.hwp && (
            <button onClick={() => openHwp(g.hwp!)} disabled={disabled}
              title="한글 편집용 원본 내려받기" className={hwpBtn}>
              <Download className="size-3" /> 다시 받기 (HWP)
            </button>
          )}
          {g.pdf && (
            <button onClick={() => openPdf(g.pdf!)} disabled={disabled} title="바로 보기·인쇄" className={pdfBtn}>
              <Download className="size-3" /> PDF
            </button>
          )}
        </>)}
        </span>
      </div>
    </div>
  )

  return (
    <div className="space-y-0.5">
      {latest.map(g => row(g, true))}
      {old.length > 0 && (
        <div>
          <button onClick={() => setShowOld(v => !v)}
            className="inline-flex items-center gap-1 text-form-xs text-ink-meta hover:text-brand py-0.5">
            {showOld ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            이전 생성 {old.length}건
          </button>
          {showOld && <div className="pl-4 border-l border-brand-tint">{old.map(g => row(g, false))}</div>}
        </div>
      )}
    </div>
  )
}
