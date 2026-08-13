'use client'

import { useState, useTransition } from 'react'
import { PenLine, Loader2, X, AlertTriangle } from 'lucide-react'
import { getMessageTemplateAction, saveMessageTemplateAction } from '@/app/(dashboard)/settings/message-template-actions'
// 타입은 lib에서 가져온다 — 'use server' 파일에서 타입을 내보내면 모듈 평가가 깨진다(소방계획서_18 교훈).
// server-only 모듈이지만 `import type`은 컴파일 시 지워지므로 클라이언트 번들에 들어가지 않는다.
import type { TemplateKey, TemplateEditData } from '@/lib/message-template'

/** 발송 문구 편집 모달 (소방계획서_21 R7-3·R7-6)
 *  전용 페이지 대신 **보내는 자리**에 둔다. 실제 값이 채워진 미리보기를 나란히 보여줘
 *  `{고객 명}` 같은 변수 오타가 그대로 고객에게 나가는 일을 저장 전에 막는다. */
export function MessageTemplateModal({ templateKey, label, sampleVars, buttonClass }: {
  templateKey: TemplateKey
  label: string
  /** 미리보기에 쓸 예시 값 (예: 지금 보고 있는 고객명) */
  sampleVars?: Record<string, string>
  buttonClass?: string
}) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<TemplateEditData | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [attach, setAttach] = useState('')
  const [msg, setMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  /** 여는 순간 로드한다 — effect에서 setState하면 연쇄 렌더가 되고(react-hooks/set-state-in-effect),
   *  sampleVars가 매 렌더 새 객체라 의존성 관리도 지저분해진다. 이벤트 핸들러가 맞다. */
  function load() {
    startTransition(async () => {
      const res = await getMessageTemplateAction(templateKey, sampleVars ?? {})
      if (res.error || !res.data) { setMsg(`❌ ${res.error ?? '불러오지 못했습니다.'}`); return }
      setData(res.data)
      setSubject(res.data.template.subject ?? '')
      setBody(res.data.template.body)
      setAttach(res.data.template.attachmentName ?? '')
    })
  }

  function openModal() {
    setMsg('')
    setOpen(true)
    load()
  }

  function save() {
    setMsg('')
    startTransition(async () => {
      const res = await saveMessageTemplateAction(templateKey, {
        subject: data?.template.subject === null ? null : subject,
        body,
        attachmentName: data?.template.attachmentName === null ? null : attach,
      })
      if (res.error) { setMsg(`❌ ${res.error}`); return }
      setMsg('✅ 저장했습니다. 다음 발송부터 적용됩니다.')
      const re = await getMessageTemplateAction(templateKey, sampleVars ?? {})
      if (re.data) setData(re.data)
    })
  }

  return (
    <>
      <button onClick={openModal}
        title="이 메일의 제목·본문 문구를 고칩니다 (매니저 이상)"
        className={buttonClass ?? 'inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-[#d0ccf5] text-[11px] text-[#7b68ee] hover:bg-[#f5f4ff]'}>
        <PenLine className="size-3" /> 문구 편집
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-lg w-full max-w-4xl max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 py-3 border-b border-[#e0ddf5] sticky top-0 bg-white">
              <PenLine className="size-4 text-[#7b68ee]" />
              <h2 className="text-sm font-semibold text-[#090c1d]">{label} 문구</h2>
              <button onClick={() => setOpen(false)} className="ml-auto text-[#b0acd6] hover:text-[#090c1d]"><X className="size-4" /></button>
            </div>

            <div className="p-5 space-y-3">
              {isPending && !data && <p className="text-xs text-[#514b81] flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> 불러오는 중…</p>}

              {data && !data.storageReady && (
                <p className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                  <AlertTriangle className="size-3.5 shrink-0 mt-px" />
                  문구 저장소가 아직 준비되지 않았습니다 (마이그레이션 130 미적용) — 지금은 <b>코드 기본 문구</b>로 발송되며 편집 내용은 저장되지 않습니다.
                </p>
              )}
              {data && !data.canEdit && (
                <p className="text-[11px] text-[#514b81] bg-[#f8f9fa] border border-[#e0ddf5] rounded-lg px-2.5 py-2">
                  보기 전용입니다 — 문구 수정은 매니저 이상만 할 수 있습니다.
                </p>
              )}

              {data && (
                <>
                  <p className="text-[11px] text-[#b0acd6]">
                    쓸 수 있는 변수: {data.vars.map(v => <code key={v} className="mx-0.5 px-1 rounded bg-[#f5f4ff] text-[#7b68ee]">{`{${v}}`}</code>)}
                  </p>

                  <div className="grid grid-cols-2 gap-4">
                    {/* 편집 */}
                    <div className="space-y-2">
                      {data.template.subject !== null && (
                        <label className="block">
                          <span className="text-[11px] text-[#514b81]">제목</span>
                          <input value={subject} onChange={e => setSubject(e.target.value)} disabled={!data.canEdit}
                            className="mt-0.5 w-full h-8 rounded-lg border border-[#d0ccf5] px-2 text-xs outline-none focus:border-[#7b68ee] disabled:bg-[#f8f9fa]" />
                        </label>
                      )}
                      <label className="block">
                        <span className="text-[11px] text-[#514b81]">본문</span>
                        <textarea value={body} onChange={e => setBody(e.target.value)} disabled={!data.canEdit} rows={12}
                          className="mt-0.5 w-full rounded-lg border border-[#d0ccf5] px-2 py-1.5 text-xs outline-none focus:border-[#7b68ee] disabled:bg-[#f8f9fa] font-mono" />
                      </label>
                      {data.template.attachmentName !== null && (
                        <label className="block">
                          <span className="text-[11px] text-[#514b81]">첨부 파일명 (확장자 제외)</span>
                          <input value={attach} onChange={e => setAttach(e.target.value)} disabled={!data.canEdit}
                            className="mt-0.5 w-full h-8 rounded-lg border border-[#d0ccf5] px-2 text-xs outline-none focus:border-[#7b68ee] disabled:bg-[#f8f9fa]" />
                        </label>
                      )}
                    </div>

                    {/* 미리보기 — 실제 값이 채워진 결과 */}
                    <div className="space-y-2">
                      <span className="text-[11px] text-[#514b81]">미리보기 (실제 값 적용)</span>
                      {data.preview.unresolved.length > 0 && (
                        <p className="flex items-start gap-1.5 text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2">
                          <AlertTriangle className="size-3.5 shrink-0 mt-px" />
                          치환되지 않은 변수: {data.preview.unresolved.map(v => `{${v}}`).join(', ')} — 이대로 고객에게 나갑니다.
                        </p>
                      )}
                      <div className="rounded-lg border border-[#e0ddf5] bg-[#fafafa] p-3 space-y-2">
                        {data.template.subject !== null && (
                          <p className="text-xs font-semibold text-[#090c1d] break-words">{data.preview.subject || <span className="text-[#b0acd6]">(제목 없음)</span>}</p>
                        )}
                        <pre className="text-[11px] text-[#292d34] whitespace-pre-wrap break-words font-sans">{data.preview.body}</pre>
                        {data.template.attachmentName !== null && (
                          <p className="text-[10px] text-[#b0acd6]">첨부: {data.preview.attachmentName}.pdf</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {msg && <p className="text-xs text-[#514b81]">{msg}</p>}

                  <div className="flex justify-end gap-2 pt-1">
                    <button onClick={() => setOpen(false)}
                      className="h-8 px-3 rounded-lg border border-[#d0ccf5] text-xs text-[#514b81] hover:bg-[#f8f9fa]">닫기</button>
                    {data.canEdit && (
                      <button onClick={save} disabled={isPending || !data.storageReady}
                        className="inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium disabled:opacity-50">
                        {isPending ? <Loader2 className="size-3 animate-spin" /> : null} 저장
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
