import type { DocumentApprover } from '@/types'

type ApproverWithProfile = DocumentApprover & {
  profile: { name: string; email: string; position: string | null }
}

interface ApprovalFlowProps {
  approvers: ApproverWithProfile[]
}

const STATUS = {
  approved: { label: '승인', className: 'bg-green-50 text-green-700', dotColor: 'bg-green-400' },
  rejected: { label: '반려', className: 'bg-red-50 text-red-600', dotColor: 'bg-red-400' },
  pending: { label: '대기', className: 'bg-gray-50 text-gray-400', dotColor: 'bg-gray-200' },
}

export function ApprovalFlow({ approvers }: ApprovalFlowProps) {
  return (
    <div className="space-y-1">
      {approvers.map((a, i) => {
        const isActive =
          a.status === 'pending' &&
          approvers.slice(0, i).every(p => p.status === 'approved')

        const statusInfo = isActive
          ? { label: '결재중', className: 'bg-[#f5f4ff] text-[#7b68ee]', dotColor: 'bg-[#7b68ee]' }
          : STATUS[a.status] ?? STATUS.pending

        return (
          <div key={a.id} className="flex items-start gap-3">
            <div className="flex flex-col items-center pt-1">
              <div
                className={`size-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                  a.status === 'approved'
                    ? 'bg-green-100 text-green-700'
                    : a.status === 'rejected'
                    ? 'bg-red-100 text-red-600'
                    : isActive
                    ? 'bg-[#7b68ee] text-white'
                    : 'bg-[#f0eeff] text-[#b0acd6]'
                }`}
              >
                {a.order_num}
              </div>
              {i < approvers.length - 1 && (
                <div
                  className={`w-px h-5 mt-1 ${
                    a.status === 'approved' ? 'bg-green-200' : 'bg-[#ece9ff]'
                  }`}
                />
              )}
            </div>

            <div className="flex-1 min-w-0 pb-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#090c1d] truncate">{a.profile.name}</p>
                  <p className="text-xs text-[#514b81]">{a.profile.position ?? a.profile.email}</p>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${statusInfo.className}`}>
                  {statusInfo.label}
                </span>
              </div>

              {a.comment && (
                <div className="mt-1.5 px-3 py-2 rounded-lg bg-red-50 text-xs text-red-700">
                  반려 사유: {a.comment}
                </div>
              )}

              {a.processed_at && (
                <p className="text-[11px] text-[#b0acd6] mt-1">
                  {new Date(a.processed_at).toLocaleString('ko-KR', {
                    month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
