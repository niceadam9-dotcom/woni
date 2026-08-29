'use client'

import { useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { Trash2, Loader2, Archive, AlertTriangle, X } from 'lucide-react'
import {
  deleteCustomerAction, checkCustomerDeleteAction, hardDeleteCustomerAction,
  type CustomerDeleteCheck,
} from '@/app/(dashboard)/customers/actions'

/** 고객 삭제 — 조건부 hard delete (소방계획서_30 S3, D-2)
 *
 *  업무 실이력이 **0건이면 물리 삭제**(관계인·건물 등 기본정보 연쇄, DB 함수 한 트랜잭션),
 *  이력이 있으면 차단하고 **비활성화(soft delete)로 유도**한다. 종전 '삭제' 버튼은 이름과 달리
 *  비활성화만 했는데, 잘못 등록한 고객(오타 등)이 영구히 남는 문제가 있었다.
 *
 *  모달은 body 포털 — 이 버튼은 ClickableRow(행 전체 클릭) 안에 있어서, 행 안에 그리면
 *  배경 클릭이 행까지 올라가 닫자마자 상세로 튕긴다(address-map-modal과 같은 이유). */
export function DeleteCustomerClient({ customerId, customerName }: {
  customerId: string
  customerName: string
}) {
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [check, setCheck] = useState<CustomerDeleteCheck | null>(null)

  function openModal() {
    setOpen(true)
    setCheck(null)
    startTransition(async () => {
      setCheck(await checkCustomerDeleteAction(customerId))
    })
  }

  function runHardDelete() {
    startTransition(async () => {
      const res = await hardDeleteCustomerAction(customerId)
      // warning은 실패가 아니다 — 고객은 지워졌고 파일 정리만 남았다(소방계획서_32 DEF-2)
      if (res.error) alert(res.error)
      else if (res.warning) alert(res.warning)
      setOpen(false)
    })
  }

  function runDeactivate() {
    startTransition(async () => {
      const res = await deleteCustomerAction(customerId)
      if (res.error) alert(res.error)
      setOpen(false)
    })
  }

  return (
    <>
      <button
        onClick={openModal}
        disabled={isPending}
        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded text-ink-faint hover:text-red-500 hover:bg-red-50 transition-colors"
        title={`${customerName} 삭제`}
      >
        <Trash2 className="size-3" />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[10000] bg-black/40 dark:bg-black/60 flex items-center justify-center p-4"
          onClick={() => !isPending && setOpen(false)}>
          <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md" data-testid="delete-customer-modal"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-brand-line-soft">
              <Trash2 className="size-4 text-red-500 shrink-0" />
              <h2 className="text-sm font-semibold text-ink truncate">{customerName} 삭제</h2>
              <button onClick={() => setOpen(false)} disabled={isPending}
                className="ml-auto p-1 rounded hover:bg-brand-tint text-ink-soft shrink-0">
                <X className="size-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-3 text-sm">
              {!check ? (
                <p className="flex items-center gap-2 text-ink-sub">
                  <Loader2 className="size-4 animate-spin" /> 업무 이력을 확인하는 중…
                </p>
              ) : check.error ? (
                <p className="text-red-600 text-xs">{check.error}</p>
              ) : check.deletable ? (
                <>
                  <p className="text-ink">
                    업무 이력이 없어 <b className="text-red-600">완전 삭제</b>할 수 있습니다.
                  </p>
                  {/* 무엇이 함께 사라지는지 빠짐없이 적는다 — 종전 문구는 '기본정보'까지만 적어
                      건물 CASCADE로 딸려가는 것들이 고지 밖이었다(소방계획서_32 DEF-3). */}
                  <p className="text-xs text-ink-sub">
                    <b>관계인 · 건물 · 자동 생성된 점검계획 · 업로드한 사진/약도 파일</b>이 함께 삭제되며,{' '}
                    <b>되돌릴 수 없습니다.</b>{' '}
                    나중에 다시 거래할 수 있는 고객이라면 [비활성화]를 사용하세요(목록에서 숨고 복원 가능).
                  </p>
                  <p className="text-[11px] text-ink-faint">
                    소방계획서·설비 대장·자위소방대·세부현황·청구 설정 등 직접 입력한 값이 하나라도 있으면
                    이 버튼은 나타나지 않습니다.
                  </p>
                </>
              ) : (
                <>
                  <p className="flex items-start gap-1.5 text-ink">
                    <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
                    <span>업무 이력이 있어 완전 삭제할 수 없습니다 — <b>비활성화</b>로 목록에서 숨길 수 있습니다.</span>
                  </p>
                  <ul className="text-xs text-ink-sub bg-paper rounded-lg px-3 py-2 space-y-0.5" data-testid="delete-history-list">
                    {check.history.map(h => (
                      <li key={h.label}>{h.label} <b className="text-ink">{h.count}건</b></li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-ink-faint">
                    비활성화하면 조회 화면에서 빠지고, 미완료 계획은 자동 취소됩니다(재활성화 시 복원).
                    이력은 점검업무·점검확정의 [취소] 필터에서 볼 수 있습니다.
                  </p>
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-brand-line-soft">
              <button onClick={() => setOpen(false)} disabled={isPending}
                className="h-8 px-3 rounded-lg border border-brand-line text-xs text-ink-sub hover:bg-paper transition-colors">
                취소
              </button>
              {check && !check.error && (
                <button onClick={runDeactivate} disabled={isPending} data-testid="deactivate-btn"
                  className="inline-flex items-center gap-1 h-8 px-3 rounded-lg border border-brand-line text-xs text-ink hover:bg-brand-tint transition-colors">
                  {isPending ? <Loader2 className="size-3 animate-spin" /> : <Archive className="size-3" />} 비활성화
                </button>
              )}
              {check && !check.error && check.deletable && (
                <button onClick={runHardDelete} disabled={isPending} data-testid="hard-delete-btn"
                  className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium transition-colors">
                  {isPending ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />} 완전 삭제
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
