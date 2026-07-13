'use client'

import { useState, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Mic, MicOff, Sparkles, Plus, Loader2, Check } from 'lucide-react'
import { classifyDefectsFromTranscriptAction, type VoiceDefectCandidate } from '@/app/(dashboard)/inspections/voice-defect-actions'
import { addDefectAction } from '@/app/(dashboard)/inspections/defect-actions'

/* eslint-disable @typescript-eslint/no-explicit-any */
type SR = any

/** 작동점검 음성 문서화 (VN-1) — 녹음(Web Speech STT)→받아쓰기→AI 구조화→불량 후보→확정 */
export function InspectionVoiceDefectClient({ inspectionId, canManage }: {
  inspectionId: string; canManage: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [candidates, setCandidates] = useState<VoiceDefectCandidate[]>([])
  const [added, setAdded] = useState<Set<number>>(new Set())
  const [err, setErr] = useState('')
  const recRef = useRef<SR>(null)

  function toggleMic() {
    setErr('')
    if (listening) { recRef.current?.stop(); return }
    const SRClass = (typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) as SR
    if (!SRClass) { setErr('이 브라우저는 음성 인식을 지원하지 않습니다. 텍스트로 입력하세요. (Chrome/Edge 권장)'); return }
    const rec: SR = new SRClass()
    rec.lang = 'ko-KR'; rec.continuous = true; rec.interimResults = true
    let finalText = transcript
    rec.onresult = (e: any) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) finalText += t + ' '
        else interim += t
      }
      setTranscript(finalText + interim)
    }
    rec.onerror = (e: any) => { setErr(`음성 인식 오류: ${e.error ?? ''}`); setListening(false) }
    rec.onend = () => setListening(false)
    recRef.current = rec
    rec.start()
    setListening(true)
  }

  function analyze() {
    setErr(''); setCandidates([]); setAdded(new Set())
    startTransition(async () => {
      const res = await classifyDefectsFromTranscriptAction(transcript)
      if (res.error) { setErr(res.error); return }
      setCandidates(res.candidates ?? [])
    })
  }

  function addOne(c: VoiceDefectCandidate, i: number) {
    startTransition(async () => {
      const res = await addDefectAction({
        inspectionId, defectName: c.defect_name, defectDetail: c.defect_detail || null, severity: c.severity,
      })
      if (res.error) { setErr(res.error); return }
      setAdded(prev => new Set(prev).add(i))
      router.refresh()
    })
  }

  const SEV: Record<string, string> = { 경미: 'bg-yellow-100 text-yellow-700', 보통: 'bg-orange-100 text-orange-700', 중대: 'bg-red-100 text-red-700' }

  if (!canManage) return null
  return (
    <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-[rgba(18,43,165,0.08)_0px_1px_1px_-0.5px,rgba(18,43,165,0.08)_0px_3px_3px_-1.5px] p-5">
      <div className="flex items-center gap-2 mb-3">
        <Mic className="size-4 text-[#7b68ee]" />
        <h2 className="text-sm font-semibold text-[#090c1d]">음성 불량 기록 <span className="text-xs font-normal text-[#b0acd6]">말로 보고 → AI 정리</span></h2>
      </div>

      <div className="flex items-start gap-2">
        <button onClick={toggleMic} type="button"
          className={`shrink-0 size-12 rounded-full flex items-center justify-center transition-colors ${listening ? 'bg-red-500 text-white animate-pulse' : 'bg-[#f5f4ff] text-[#7b68ee] hover:bg-[#ebe9ff]'}`}>
          {listening ? <MicOff className="size-5" /> : <Mic className="size-5" />}
        </button>
        <textarea value={transcript} onChange={e => setTranscript(e.target.value)} rows={3}
          placeholder="마이크를 눌러 말하거나, 직접 입력하세요. (예: 3층 복도 소화기 압력 부족, 자탐 수신기 예비전원 불량)"
          className="flex-1 border rounded-lg px-3 py-2 text-sm outline-none focus:border-[#7b68ee] resize-none" />
      </div>

      <div className="flex items-center gap-2 mt-2">
        <button onClick={analyze} disabled={isPending || !transcript.trim()}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#7b68ee] hover:bg-[#6647f0] text-white text-xs font-medium disabled:opacity-50">
          {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} AI 불량 분석
        </button>
        {transcript && <button onClick={() => { setTranscript(''); setCandidates([]); setAdded(new Set()) }} className="text-xs text-[#b0acd6] hover:text-[#514b81]">지우기</button>}
        {listening && <span className="text-xs text-red-500">● 녹음 중…</span>}
      </div>
      {err && <p className="text-xs text-red-600 mt-2">{err}</p>}

      {candidates.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="text-[11px] text-[#b0acd6]">후보 {candidates.length}건 — 확인 후 추가하세요.</p>
          {candidates.map((c, i) => (
            <div key={i} className="flex items-start gap-2 border rounded-lg px-3 py-2">
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${SEV[c.severity] ?? SEV['보통']}`}>{c.severity}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#090c1d]">{c.defect_name}</p>
                {c.defect_detail && <p className="text-xs text-gray-500 mt-0.5">{c.defect_detail}</p>}
              </div>
              {added.has(i) ? (
                <span className="shrink-0 inline-flex items-center gap-1 text-xs text-green-600"><Check className="size-3.5" /> 추가됨</span>
              ) : (
                <button onClick={() => addOne(c, i)} disabled={isPending}
                  className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-[#7b68ee] text-white text-xs disabled:opacity-50">
                  <Plus className="size-3" /> 추가
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
