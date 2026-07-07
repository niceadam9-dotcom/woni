'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Mic, MicOff, Square, Play, Pause, Trash2,
  FileAudio, AlertCircle, Loader2, RefreshCw,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const BUCKET = 'voice-memos'

type VoiceMemo = {
  id: string
  title: string
  transcript: string
  created_at: string
  duration: number
  audioPath: string
  audioUrl: string
}

type MemoMeta = {
  title: string
  transcript: string
  created_at: string
  duration: number
  audioPath: string
}

function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0')
  const s = Math.floor(sec % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function VoiceMemosClient({ userId }: { userId: string }) {
  const [memos, setMemos] = useState<VoiceMemo[]>([])
  const [loading, setLoading] = useState(true)
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const supabase = createClient()

  const loadMemos = useCallback(async () => {
    setLoading(true)
    try {
      const prefix = `${userId}/`
      const { data: files } = await supabase.storage.from(BUCKET).list(userId, { sortBy: { column: 'created_at', order: 'desc' } })
      if (!files) { setMemos([]); return }

      const jsonFiles = files.filter(f => f.name.endsWith('.json'))
      const results: VoiceMemo[] = []

      await Promise.all(jsonFiles.map(async (file) => {
        const metaPath = `${prefix}${file.name}`
        const { data: metaFile } = await supabase.storage.from(BUCKET).download(metaPath)
        if (!metaFile) return
        try {
          const text = await metaFile.text()
          const meta: MemoMeta = JSON.parse(text)
          const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(meta.audioPath)
          results.push({
            id: file.name.replace('.json', ''),
            title: meta.title,
            transcript: meta.transcript,
            created_at: meta.created_at,
            duration: meta.duration,
            audioPath: meta.audioPath,
            audioUrl: publicUrl,
          })
        } catch { /* skip invalid */ }
      }))

      results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      setMemos(results)
    } finally {
      setLoading(false)
    }
  }, [userId, supabase.storage])

  useEffect(() => { loadMemos() }, [loadMemos])

  function startSpeechRecognition() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any
    const SpeechRecognitionAPI = win.SpeechRecognition ?? win.webkitSpeechRecognition
    if (!SpeechRecognitionAPI) return

    const rec = new SpeechRecognitionAPI()
    rec.lang = 'ko-KR'
    rec.interimResults = true
    rec.continuous = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let final = ''
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) final += t
        else interim += t
      }
      if (final) setTranscript(prev => prev + final)
      setInterimTranscript(interim)
    }
    rec.onerror = () => { /* ignore */ }
    rec.start()
    recognitionRef.current = rec
  }

  async function startRecording() {
    setError(null)
    setTranscript('')
    setInterimTranscript('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      chunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.start(500)
      mediaRecorderRef.current = mr
      setRecording(true)
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed(p => p + 1), 1000)
      startSpeechRecognition()
    } catch {
      setError('마이크 접근 권한이 필요합니다.')
    }
  }

  async function stopRecording() {
    if (!mediaRecorderRef.current) return
    setRecording(false)
    if (timerRef.current) clearInterval(timerRef.current)
    if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null }

    const duration = elapsed
    mediaRecorderRef.current.stop()
    const stream = mediaRecorderRef.current.stream
    stream.getTracks().forEach(t => t.stop())

    await new Promise<void>(res => { if (mediaRecorderRef.current) mediaRecorderRef.current.onstop = () => res() })

    const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const title = `녹음 ${fmtDate(now)}`

    setSaving(true)
    try {
      const audioPath = `${userId}/${id}.webm`
      const metaPath = `${userId}/${id}.json`
      const finalTranscript = transcript.trim()

      const meta: MemoMeta = { title, transcript: finalTranscript, created_at: now, duration, audioPath }

      const [audioRes, metaRes] = await Promise.all([
        supabase.storage.from(BUCKET).upload(audioPath, blob, { contentType: 'audio/webm', upsert: true }),
        supabase.storage.from(BUCKET).upload(metaPath, new Blob([JSON.stringify(meta)], { type: 'application/json' }), { contentType: 'application/json', upsert: true }),
      ])

      if (audioRes.error || metaRes.error) throw new Error(audioRes.error?.message ?? metaRes.error?.message)
      await loadMemos()
      setTranscript('')
      setInterimTranscript('')
      setElapsed(0)
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  async function deleteMemo(memo: VoiceMemo) {
    if (!confirm(`"${memo.title}" 녹음을 삭제하시겠습니까?`)) return
    setDeletingId(memo.id)
    await supabase.storage.from(BUCKET).remove([memo.audioPath, `${userId}/${memo.id}.json`])
    setDeletingId(null)
    await loadMemos()
  }

  function playPause(memo: VoiceMemo) {
    if (playingId === memo.id) {
      audioRef.current?.pause()
      setPlayingId(null)
    } else {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = '' }
      const audio = new Audio(memo.audioUrl)
      audio.onended = () => setPlayingId(null)
      audio.play()
      audioRef.current = audio
      setPlayingId(memo.id)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-[#090c1d]">녹음메모장</h1>
        <p className="text-sm text-[#514b81] mt-1">현장 점검 음성 메모를 녹음하고 텍스트로 변환합니다.</p>
      </div>

      {/* 녹음 컨트롤 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#090c1d]">새 녹음</h2>
          {recording && (
            <div className="flex items-center gap-1.5 text-red-500">
              <span className="size-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm font-mono font-medium">{fmtDuration(elapsed)}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col items-center gap-4 py-4">
          {!recording ? (
            <button
              onClick={startRecording}
              disabled={saving}
              className="size-20 rounded-full bg-[#7b68ee] hover:bg-[#6a58d6] text-white flex items-center justify-center shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
            >
              <Mic size={32} />
            </button>
          ) : (
            <button
              onClick={stopRecording}
              className="size-20 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg hover:shadow-xl transition-all"
            >
              <Square size={32} />
            </button>
          )}
          <p className="text-xs text-[#514b81]">
            {saving ? '저장 중…' : recording ? '클릭하여 녹음 중지 및 저장' : '클릭하여 녹음 시작'}
          </p>
        </div>

        {/* 실시간 텍스트 변환 */}
        {(recording || transcript) && (
          <div className="border border-[#c8c4d0] rounded-lg p-3 bg-[#fafafa] min-h-[60px] text-sm text-[#090c1d]">
            <p className="text-[10px] text-[#b0acd6] mb-1 font-medium uppercase tracking-wide">
              <MicOff size={10} className="inline mr-1" />실시간 텍스트 변환
            </p>
            <span>{transcript}</span>
            <span className="text-[#b0acd6] italic">{interimTranscript}</span>
            {!transcript && !interimTranscript && recording && (
              <span className="text-[#b0acd6] italic">말씀해 주세요…</span>
            )}
          </div>
        )}

        {saving && (
          <div className="flex items-center gap-2 text-sm text-[#514b81]">
            <Loader2 size={14} className="animate-spin" /> 녹음 저장 중…
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            <AlertCircle size={14} /> {error}
          </div>
        )}
      </div>

      {/* 녹음 목록 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#c8c4d0]">
          <div className="flex items-center gap-2">
            <FileAudio size={16} className="text-[#7b68ee]" />
            <h2 className="text-sm font-semibold text-[#090c1d]">저장된 녹음</h2>
            {!loading && <span className="text-xs text-[#b0acd6]">총 {memos.length}건</span>}
          </div>
          <button onClick={loadMemos} className="text-xs text-[#514b81] hover:text-[#7b68ee] flex items-center gap-1">
            <RefreshCw size={12} /> 새로고침
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 size={20} className="animate-spin text-[#7b68ee]" />
          </div>
        ) : memos.length === 0 ? (
          <div className="py-12 text-center">
            <FileAudio size={32} className="mx-auto text-[#d0cce8] mb-2" />
            <p className="text-sm text-[#b0acd6]">저장된 녹음이 없습니다</p>
          </div>
        ) : (
          <div className="divide-y divide-[#e0ddf5]">
            {memos.map(memo => (
              <div key={memo.id} className="px-5 py-4 hover:bg-[#fafafa] transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => playPause(memo)}
                      className={`size-9 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                        playingId === memo.id
                          ? 'bg-[#7b68ee] text-white'
                          : 'bg-[#f5f4ff] text-[#7b68ee] hover:bg-[#ebe9ff]'
                      }`}
                    >
                      {playingId === memo.id ? <Pause size={16} /> : <Play size={16} />}
                    </button>
                    <div>
                      <p className="text-sm font-medium text-[#090c1d]">{memo.title}</p>
                      <p className="text-xs text-[#514b81] mt-0.5">
                        {fmtDate(memo.created_at)} · {fmtDuration(memo.duration)}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => deleteMemo(memo)}
                    disabled={deletingId === memo.id}
                    className="text-[#d0cce8] hover:text-red-500 transition-colors shrink-0 disabled:opacity-50"
                  >
                    {deletingId === memo.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                </div>
                {memo.transcript && (
                  <div className="mt-2 ml-12 p-2 bg-[#fafafa] rounded text-xs text-[#514b81] leading-relaxed border border-[#e0ddf5]">
                    {memo.transcript}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-[#b0acd6]">
        ※ 텍스트 변환은 Chrome/Edge 브라우저에서 지원됩니다. 다른 브라우저에서는 녹음만 가능합니다.
      </p>
    </div>
  )
}
