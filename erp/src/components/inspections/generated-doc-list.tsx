'use client'

import { useState } from 'react'
import { FileText, FileType2, Eye, Download, ChevronDown, ChevronRight } from 'lucide-react'
import { GENERATED_DOC_KINDS } from '@/lib/doc-requirements'

/** 생성물 목록 — 문서 단위 1행 그룹핑 (소방계획서_5 ⑩ R11, §3-6 공용 컴포넌트)
 *  같은 생성 타임스탬프의 hwp/pdf/html을 "문서명 · 시각 [최신] [HWP][PDF][미리보기]" 1행으로.
 *  파일명은 화면에서 제거, html은 [미리보기] 버튼으로만. 최신 1건 기본 + "이전 생성 n건" 접기.
 *  다운로드 저장명 = 고객명_문서명_YYYY-MM-DD.확장자 (R11-d — onOpen의 saveName). */

export type GeneratedDocFile = { name: string; path: string; createdAt: string | null }

type DocGroup = {
  key: string            // kind_stamp
  kind: string           // report9 | report10 | report11 | exterior | …
  label: string
  full: string           // 풀네임 툴팁
  createdAt: string | null
  hwp?: GeneratedDocFile
  pdf?: GeneratedDocFile
  html?: GeneratedDocFile
  others: GeneratedDocFile[]
}

function groupFiles(files: GeneratedDocFile[]): DocGroup[] {
  const map = new Map<string, DocGroup>()
  for (const f of files) {
    const m = f.name.match(/^([a-z0-9_]+?)_(\d+)\.(hwpx?|pdf|html?)$/i)
    if (!m) {
      // 규칙 밖 파일 — 자체 그룹으로 (업로드 슬롯 등은 호출부에서 이미 제외)
      const g: DocGroup = { key: f.name, kind: '', label: f.name, full: f.name, createdAt: f.createdAt, others: [f] }
      map.set(f.name, g)
      continue
    }
    const [, kind, stamp, extRaw] = m
    const ext = extRaw.toLowerCase().startsWith('htm') ? 'html' : extRaw.toLowerCase().startsWith('hwp') ? 'hwp' : 'pdf'
    const key = `${kind}_${stamp}`
    const known = GENERATED_DOC_KINDS[kind]
    let g = map.get(key)
    if (!g) {
      g = { key, kind, label: known?.label ?? kind, full: known?.full ?? kind, createdAt: f.createdAt, others: [] }
      map.set(key, g)
    }
    if (f.createdAt && (!g.createdAt || f.createdAt > g.createdAt)) g.createdAt = f.createdAt
    if (ext === 'hwp') g.hwp = f
    else if (ext === 'pdf') g.pdf = f
    else g.html = f
  }
  // 최신 우선 정렬 (stamp 내림차순 → createdAt 보조)
  return [...map.values()].sort((a, b) => (b.key > a.key ? 1 : b.key < a.key ? -1 : 0))
}

const fmtTime = (iso: string | null) => (iso ? iso.slice(0, 16).replace('T', ' ') : '')
const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10) : new Date().toISOString().slice(0, 10))

export function GeneratedDocList({ files, onOpen, customerName, disabled }: {
  files: GeneratedDocFile[]
  /** saveName 지정 시 저장명(content-disposition) 부여 다운로드, 미지정 시 새 탭 열람 */
  onOpen: (path: string, saveName?: string) => void
  customerName?: string
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
  const saveName = (g: DocGroup, ext: string) =>
    `${customerName ? `${customerName}_` : ''}${g.label.replace(/\s*\(.*\)$/, '')}_${fmtDate(g.createdAt)}.${ext}`

  // R11-b: HWP=파란 아이콘(편집 원본) / PDF=빨간 아이콘(열람·인쇄) — 전 화면 동일 스타일
  const hwpBtn = 'inline-flex items-center gap-1 h-6 px-2 rounded border border-blue-200 text-[11px] text-blue-600 hover:bg-blue-50 disabled:opacity-50'
  const pdfBtn = 'inline-flex items-center gap-1 h-6 px-2 rounded border border-red-200 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50'
  const subBtn = 'inline-flex items-center gap-1 h-6 px-2 rounded border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff] disabled:opacity-50'

  const row = (g: DocGroup, isLatest: boolean) => (
    <div key={g.key} className="flex items-center gap-2 text-xs py-1">
      <span className="text-[#090c1d] font-medium truncate" title={g.full}>{g.label}</span>
      {g.createdAt && <span className="text-[11px] text-[#b0acd6] shrink-0">{fmtTime(g.createdAt)}</span>}
      {isLatest && g.kind && (
        <span className="px-1 py-0.5 rounded bg-[#f5f4ff] text-[#7b68ee] text-[10px] font-medium shrink-0">최신</span>
      )}
      <span className="ml-auto flex items-center gap-1 shrink-0">
        {isLatest ? (<>
          {g.hwp && (
            <button onClick={() => onOpen(g.hwp!.path, saveName(g, 'hwp'))} disabled={disabled}
              title="한글 편집용 원본 내려받기" className={hwpBtn}>
              <FileText className="size-3" /> HWP
            </button>
          )}
          {g.pdf && (
            <button onClick={() => onOpen(g.pdf!.path)} disabled={disabled}
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
            <button onClick={() => onOpen(g.hwp!.path, saveName(g, 'hwp'))} disabled={disabled}
              title="한글 편집용 원본 내려받기" className={hwpBtn}>
              <Download className="size-3" /> 다시 받기 (HWP)
            </button>
          )}
          {g.pdf && (
            <button onClick={() => onOpen(g.pdf!.path)} disabled={disabled} title="바로 보기·인쇄" className={pdfBtn}>
              <Download className="size-3" /> PDF
            </button>
          )}
        </>)}
      </span>
    </div>
  )

  return (
    <div className="space-y-0.5">
      {latest.map(g => row(g, true))}
      {old.length > 0 && (
        <div>
          <button onClick={() => setShowOld(v => !v)}
            className="inline-flex items-center gap-1 text-[11px] text-[#b0acd6] hover:text-[#7b68ee] py-0.5">
            {showOld ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            이전 생성 {old.length}건
          </button>
          {showOld && <div className="pl-4 border-l border-[#eceafd]">{old.map(g => row(g, false))}</div>}
        </div>
      )}
    </div>
  )
}
