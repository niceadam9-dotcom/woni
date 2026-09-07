'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ClipboardList, Clock3, FileUp, ArrowRight, CheckSquare, User, PencilLine } from 'lucide-react'
import type { DueReport9Row, MissingCertRow } from '@/lib/doc-status'
import type { InputTodoRow } from '@/lib/customer-list'

/** 대시보드 '문서 할 일' 위젯 (소방계획서_5 R0-9·4-0-10) —
 *  "오늘 내가 처리할 게 있나?"에 답하는 모니터링 1층. 기한 임박 별지 9호 + 배치신고 미완료.
 *  각 행은 처리 화면으로 보내고, 판정은 lib/doc-status 1곳을 공유한다.
 *  ⚠ 2026-09-07 — 행 안 [업로드]를 걷어냈다. 대표가 협회에 직접 신고하므로 받을 파일이 없고,
 *  완료 표시는 작업대 ②에 있다. 여기서 파일을 받으면 두 개의 완료 경로가 생겨 다시 갈라진다. */

const cardShadow = 'shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px,rgba(18,43,165,0.08)_0px_6px_6px_-3px,rgba(18,43,165,0.08)_0px_12px_12px_-6px]'

export function DocTodoWidget({ dueSoon, missingCerts: initialMissing, inputTodo = [], myId, defaultMine }: {
  dueSoon: DueReport9Row[]
  missingCerts: MissingCertRow[]
  inputTodo?: InputTodoRow[]   // 입력 미완료 고객 큐 (§4-D H-26) — 담당 무관(고객 단위)이라 '내 담당만'에 영향 없음
  myId: string
  defaultMine: boolean
}) {
  const [missingCerts] = useState(initialMissing)
  const [mine, setMine] = useState(defaultMine)   // P-4: '내 담당만' — 직원 기본 ON

  const visibleDue = mine ? dueSoon.filter(r => r.assigneeId === myId) : dueSoon
  const visibleCerts = mine ? missingCerts.filter(r => r.assigneeId === myId) : missingCerts
  const total = visibleDue.length + visibleCerts.length + inputTodo.length

  return (
    <div className={`bg-surface rounded-xl border border-line ${cardShadow}`}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-line">
        <div className="flex items-center gap-2">
          <ClipboardList className="size-4 text-brand" />
          <h2 className="text-sm font-semibold text-ink">문서 할 일</h2>
          {total > 0 && (
            <span className="text-form-2xs font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600">{total}건</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* P-4: '내 담당만' 개인화 필터 — 직원 기본 ON */}
          <button onClick={() => setMine(v => !v)} title="내가 배정된 점검 건만 봅니다"
            className={`inline-flex items-center gap-1 h-6 px-2 rounded-lg border text-form-xs font-medium ${
              mine ? 'border-brand bg-brand-tint text-brand' : 'border-brand-line text-ink-sub hover:border-brand'}`}>
            <User className="size-3" /> 내 담당만
          </button>
          {/* 소방계획서_8 Phase B: 보고서 센터 소멸 — 제출 현황 위젯으로 연결 */}
          <Link href="#submissions" className="text-xs text-brand hover:underline flex items-center gap-1">
            제출 현황 <ArrowRight className="size-3" />
          </Link>
        </div>
      </div>

      {total === 0 ? (
        <div className="px-5 py-8 flex flex-col items-center gap-2">
          <div className="size-12 rounded-full bg-green-50 flex items-center justify-center">
            <CheckSquare className="size-6 text-green-500" />
          </div>
          <p className="text-sm font-medium text-green-700">처리할 문서가 없습니다</p>
          <p className="text-xs text-ink-sub">제출 기한·배치신고·입력 모두 정상입니다</p>
        </div>
      ) : (
        <div className="divide-y divide-paper">
          {/* 제출 기한 임박 별지 9호 (D-7 이내·초과) */}
          {visibleDue.map(r => (
            <div key={`due-${r.inspectionId}`} className="flex items-center gap-2 px-5 py-3 text-xs flex-wrap">
              <Clock3 className="size-3.5 text-red-500 shrink-0" />
              <span className="font-medium text-ink">{r.customerName}</span>
              <span className="text-ink-sub">{r.year}년 {r.sequenceNum}차 · 별지 9호 제출</span>
              <span className={`font-semibold ${r.dday < 0 ? 'text-red-600' : 'text-amber-700'}`}>
                {r.dday < 0 ? `기한 초과 ${-r.dday}일` : `D-${r.dday}`}
              </span>
              <Link href={`/inspections/${r.inspectionId}`} className="ml-auto text-form-xs text-brand hover:underline shrink-0">
                타임라인에서 →
              </Link>
            </div>
          ))}
          {/* 배치신고 미완료 — 완료 표시는 작업대 ②에서 한다(2026-09-07 업로드 폐지).
              종전에는 이 자리에서 파일을 올리게 했는데, 대표가 협회에 직접 신고하는 지금은
              여기서 받을 파일이 없다. 할 일 목록의 역할은 '어디로 가야 하는지'까지다. */}
          {visibleCerts.map(r => (
            <div key={`cert-${r.inspectionId}`} className="flex items-center gap-2 px-5 py-3 text-xs flex-wrap">
              <FileUp className="size-3.5 text-amber-600 shrink-0" />
              <span className="font-medium text-ink">{r.customerName}</span>
              <span className="text-ink-sub">{r.year}년 {r.sequenceNum}차 · 배치신고 미완료</span>
              {r.daysSince !== null && <span className="text-amber-700">완료 후 {r.daysSince}일 경과</span>}
              {/* 딥링크는 **숫자** 축이다(`?step=N`, workbench:83) — 'cert' 같은 키를 넣으면 조용히 무시된다 */}
              <Link href={`/inspections/${r.inspectionId}?step=2`} data-testid="cert-todo-link"
                className="ml-auto text-form-xs text-brand hover:underline shrink-0">
                신고 표시하러 →
              </Link>
            </div>
          ))}
          {/* 입력 미완료 (§4-D H-26) — 빈칸 있는 고객 → 소방계획서 탭 딥링크로 바로 보완 */}
          {inputTodo.map(r => (
            <div key={`input-${r.id}`} className="flex items-center gap-2 px-5 py-3 text-xs flex-wrap">
              <PencilLine className="size-3.5 text-brand shrink-0" />
              <span className="font-medium text-ink">{r.name}</span>
              <span className="text-ink-sub">입력 미완료 · {r.areas.join('·')}</span>
              <Link href={`/customers/${r.id}?tab=plan`} className="ml-auto text-form-xs text-brand hover:underline shrink-0">
                입력하러 →
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
