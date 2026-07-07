'use client'

import { useRef, useState } from 'react'
import { FileText, Upload, Download, Trash2, Loader2, CheckCircle2 } from 'lucide-react'
import {
  uploadReportAction,
  deleteReportAction,
  getReportDownloadUrl,
} from '@/app/(dashboard)/inspections/report-actions'
import {
  STEP_REPORT_LABELS,
  STEP_REPORT_TYPES,
  type ReportType,
  type StepReportType,
} from '@/app/(dashboard)/inspections/report-constants'

type ReportRow = {
  id: string
  report_type: ReportType
  file_name: string
  file_size: number | null
  submitted_at: string | null
  submitted_by_name: string | null
}

interface Props {
  inspectionId: string
  reports: ReportRow[]
  canEdit: boolean
  canDelete: boolean
}

function formatBytes(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function InspectionReportsClient({ inspectionId, reports, canEdit, canDelete }: Props) {
  const [uploading, setUploading] = useState<StepReportType | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [success, setSuccess] = useState<StepReportType | null>(null)
  const fileRefs = useRef<Record<StepReportType, HTMLInputElement | null>>({
    step1: null, step2: null, step3: null, step4: null, step5: null, step6: null,
  })

  function clearError(key: string) {
    setErrors(prev => { const n = { ...prev }; delete n[key]; return n })
  }

  async function handleUpload(type: StepReportType, file: File) {
    setUploading(type)
    clearError(type)
    setSuccess(null)

    const formData = new FormData()
    formData.append('file', file)

    const result = await uploadReportAction(inspectionId, type, formData)
    setUploading(null)

    if (result.error) {
      setErrors(prev => ({ ...prev, [type]: result.error! }))
    } else {
      setSuccess(type)
      setTimeout(() => setSuccess(null), 3000)
      const ref = fileRefs.current[type]
      if (ref) ref.value = ''
    }
  }

  async function handleDelete(report: ReportRow) {
    setDeleting(report.id)
    clearError(report.report_type)

    const result = await deleteReportAction(report.id, inspectionId)
    setDeleting(null)

    if (result.error) {
      setErrors(prev => ({ ...prev, [report.report_type]: result.error! }))
    }
  }

  async function handleDownload(report: ReportRow) {
    setDownloading(report.id)
    const result = await getReportDownloadUrl(report.id)
    setDownloading(null)

    if (result.error) {
      setErrors(prev => ({ ...prev, [report.id]: result.error! }))
    } else if (result.url) {
      const a = document.createElement('a')
      a.href = result.url
      a.download = result.fileName ?? report.file_name
      a.target = '_blank'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
  }

  const submittedCount = STEP_REPORT_TYPES.filter(t => reports.some(r => r.report_type === t)).length

  return (
    <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] overflow-hidden">
      <div className="px-5 py-4 border-b border-[#e0ddf5] flex items-center gap-2">
        <FileText className="size-4 text-[#7b68ee]" />
        <h2 className="text-sm font-semibold text-[#090c1d]">단계별 보고서</h2>
        <span className="text-xs text-[#b0acd6] ml-auto">{submittedCount}/6 제출</span>
      </div>

      <div className="divide-y divide-[#e0ddf5]">
        {STEP_REPORT_TYPES.map((type, idx) => {
          const existing = reports.find(r => r.report_type === type)
          const isUploading = uploading === type
          const isDeleting = existing && deleting === existing.id
          const isDownloading = existing && downloading === existing.id
          const isSuccess = success === type
          const errMsg = errors[type] || (existing && errors[existing.id])

          return (
            <div key={type} className="px-5 py-4">
              <div className="flex items-start gap-3">
                {/* 단계 번호 */}
                <div className={`size-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${existing ? 'bg-green-100' : 'bg-[#f5f4ff]'}`}>
                  {existing
                    ? <CheckCircle2 className="size-4 text-green-600" />
                    : <span className="text-xs font-bold text-[#7b68ee]">{idx + 1}</span>}
                </div>

                {/* 내용 */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#090c1d]">{STEP_REPORT_LABELS[type]}</p>

                  {existing ? (
                    <div className="mt-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-[#514b81] truncate max-w-[180px]">{existing.file_name}</span>
                        {existing.file_size && (
                          <span className="text-xs text-[#b0acd6]">({formatBytes(existing.file_size)})</span>
                        )}
                      </div>
                      {existing.submitted_at && (
                        <p className="text-xs text-[#b0acd6] mt-0.5">
                          제출: {existing.submitted_at.split('T')[0]}
                          {existing.submitted_by_name && ` · ${existing.submitted_by_name}`}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-[#b0acd6] mt-0.5">아직 제출된 보고서가 없습니다</p>
                  )}

                  {errMsg && <p className="text-xs text-red-500 mt-1">{errMsg}</p>}
                  {isSuccess && <p className="text-xs text-green-600 mt-1">업로드 완료!</p>}
                </div>

                {/* 버튼 영역 */}
                <div className="flex items-center gap-2 shrink-0">
                  {existing ? (
                    <>
                      <button
                        onClick={() => handleDownload(existing)}
                        disabled={!!isDownloading}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#7b68ee] bg-[#f5f4ff] hover:bg-[#ede9ff] border border-[#c3bdf5] rounded-lg disabled:opacity-50 transition-colors"
                      >
                        {isDownloading
                          ? <Loader2 className="size-3 animate-spin" />
                          : <Download className="size-3" />}
                        다운로드
                      </button>

                      {canEdit && (
                        <button
                          onClick={() => fileRefs.current[type]?.click()}
                          disabled={isUploading || !!isDeleting}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#514b81] bg-white hover:bg-[#f8f9fa] border border-[#c8c4d0] rounded-lg disabled:opacity-50 transition-colors"
                        >
                          {isUploading
                            ? <Loader2 className="size-3 animate-spin" />
                            : <Upload className="size-3" />}
                          교체
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(existing)}
                          disabled={!!isDeleting}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-red-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 rounded-lg disabled:opacity-50 transition-colors"
                        >
                          {isDeleting
                            ? <Loader2 className="size-3 animate-spin" />
                            : <Trash2 className="size-3" />}
                        </button>
                      )}
                    </>
                  ) : (
                    canEdit && (
                      <button
                        onClick={() => fileRefs.current[type]?.click()}
                        disabled={isUploading}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#7b68ee] hover:bg-[#6a58d6] rounded-lg disabled:opacity-50 transition-colors"
                      >
                        {isUploading
                          ? <Loader2 className="size-3 animate-spin" />
                          : <Upload className="size-3" />}
                        업로드
                      </button>
                    )
                  )}
                </div>
              </div>

              {canEdit && (
                <input
                  ref={el => { fileRefs.current[type] = el }}
                  type="file"
                  className="sr-only"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp,.zip"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) handleUpload(type, file)
                  }}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
