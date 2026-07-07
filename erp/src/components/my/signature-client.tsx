'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { PenLine, Trash2, Upload, Save, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const BUCKET = 'signatures'

export function SignatureClient({ userId, userName }: { userId: string; userName: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasStrokes, setHasStrokes] = useState(false)
  const [savedUrl, setSavedUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [tab, setTab] = useState<'draw' | 'upload'>('draw')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadPreview, setUploadPreview] = useState<string | null>(null)
  const lastPos = useRef<{ x: number; y: number } | null>(null)

  const supabase = createClient()

  // 기존 서명 이미지 로드
  const loadExisting = useCallback(async () => {
    const path = `${userId}/signature.png`
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
    // 존재 여부 확인
    const res = await fetch(data.publicUrl, { method: 'HEAD' }).catch(() => null)
    if (res?.ok) {
      setSavedUrl(data.publicUrl + `?t=${Date.now()}`)
    }
  }, [userId, supabase.storage])

  useEffect(() => {
    loadExisting()
  }, [loadExisting])

  // 캔버스 초기화
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = '#1a1a2e'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [tab])

  function getPos(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    if ('touches' in e) {
      const touch = e.touches[0]
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      }
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  function startDraw(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault()
    const pos = getPos(e)
    setIsDrawing(true)
    lastPos.current = pos
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) {
      ctx.beginPath()
      ctx.moveTo(pos.x, pos.y)
    }
  }

  function draw(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault()
    if (!isDrawing || !lastPos.current) return
    const pos = getPos(e)
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) {
      ctx.lineTo(pos.x, pos.y)
      ctx.stroke()
      setHasStrokes(true)
    }
    lastPos.current = pos
  }

  function endDraw(e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    e.preventDefault()
    setIsDrawing(false)
    lastPos.current = null
  }

  function clearCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    setHasStrokes(false)
    setStatus(null)
  }

  function handleUploadChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadFile(file)
    const reader = new FileReader()
    reader.onload = ev => setUploadPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  async function saveSignature() {
    setSaving(true)
    setStatus(null)
    try {
      let blob: Blob
      if (tab === 'draw') {
        const canvas = canvasRef.current
        if (!canvas || !hasStrokes) { setStatus({ type: 'error', msg: '서명을 먼저 작성해 주세요.' }); return }
        blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(b => b ? resolve(b) : reject(new Error('변환 실패')), 'image/png')
        )
      } else {
        if (!uploadFile) { setStatus({ type: 'error', msg: '이미지 파일을 선택해 주세요.' }); return }
        blob = uploadFile
      }

      const path = `${userId}/signature.png`
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
        upsert: true,
        contentType: 'image/png',
      })
      if (error) throw error

      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
      setSavedUrl(data.publicUrl + `?t=${Date.now()}`)
      setStatus({ type: 'success', msg: '서명이 저장되었습니다.' })
      if (tab === 'draw') clearCanvas()
      setUploadFile(null)
      setUploadPreview(null)
    } catch (e) {
      setStatus({ type: 'error', msg: e instanceof Error ? e.message : '저장 실패' })
    } finally {
      setSaving(false)
    }
  }

  async function deleteSignature() {
    if (!confirm('등록된 서명을 삭제하시겠습니까?')) return
    const path = `${userId}/signature.png`
    await supabase.storage.from(BUCKET).remove([path])
    setSavedUrl(null)
    setStatus({ type: 'success', msg: '서명이 삭제되었습니다.' })
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-[#090c1d]">나의결재 서명 등록</h1>
        <p className="text-sm text-[#514b81] mt-1">{userName}님의 전자결재 서명을 등록합니다.</p>
      </div>

      {/* 현재 등록된 서명 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[#090c1d]">현재 등록된 서명</h2>
          {savedUrl && (
            <div className="flex items-center gap-2">
              <button
                onClick={loadExisting}
                className="flex items-center gap-1 text-xs text-[#514b81] hover:text-[#7b68ee]"
              >
                <RefreshCw size={12} /> 새로고침
              </button>
              <button
                onClick={deleteSignature}
                className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700"
              >
                <Trash2 size={12} /> 삭제
              </button>
            </div>
          )}
        </div>
        {savedUrl ? (
          <div className="border border-[#c8c4d0] rounded-lg p-3 bg-[#fafafa] flex items-center justify-center" style={{ minHeight: 100 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={savedUrl}
              alt="등록된 서명"
              className="max-h-24 object-contain"
              onError={() => setSavedUrl(null)}
            />
          </div>
        ) : (
          <div className="border border-dashed border-[#c8c4d0] rounded-lg p-6 text-center text-sm text-[#b0acd6]">
            등록된 서명이 없습니다
          </div>
        )}
      </div>

      {/* 서명 등록 탭 */}
      <div className="bg-white rounded-xl border border-[#c8c4d0] shadow-sm overflow-hidden">
        <div className="flex border-b border-[#c8c4d0]">
          {(['draw', 'upload'] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setStatus(null) }}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                tab === t
                  ? 'text-[#7b68ee] border-b-2 border-[#7b68ee] bg-white'
                  : 'text-[#514b81] hover:bg-[#f8f9fa]'
              }`}
            >
              {t === 'draw' ? (
                <span className="flex items-center justify-center gap-1.5"><PenLine size={14} /> 직접 그리기</span>
              ) : (
                <span className="flex items-center justify-center gap-1.5"><Upload size={14} /> 이미지 업로드</span>
              )}
            </button>
          ))}
        </div>

        <div className="p-5">
          {tab === 'draw' ? (
            <div className="space-y-3">
              <p className="text-xs text-[#514b81]">아래 영역에 마우스(또는 터치)로 서명을 작성하세요.</p>
              <div className="relative border border-[#c8c4d0] rounded-lg overflow-hidden bg-white" style={{ touchAction: 'none' }}>
                <canvas
                  ref={canvasRef}
                  width={560}
                  height={200}
                  className="w-full cursor-crosshair"
                  onMouseDown={startDraw}
                  onMouseMove={draw}
                  onMouseUp={endDraw}
                  onMouseLeave={endDraw}
                  onTouchStart={startDraw}
                  onTouchMove={draw}
                  onTouchEnd={endDraw}
                />
                {!hasStrokes && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span className="text-sm text-[#d0cce8] select-none">여기에 서명하세요</span>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={clearCanvas}
                  className="flex items-center gap-1.5 h-9 px-4 border border-[#c8c4d0] rounded-lg text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors"
                >
                  <Trash2 size={14} /> 지우기
                </button>
                <button
                  onClick={saveSignature}
                  disabled={!hasStrokes || saving}
                  className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#7b68ee] hover:bg-[#6a58d6] text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Save size={14} /> {saving ? '저장 중…' : '서명 저장'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-[#514b81]">서명 이미지 파일(PNG, JPG)을 업로드하세요.</p>
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-[#c8c4d0] rounded-lg p-8 cursor-pointer hover:border-[#7b68ee] transition-colors bg-[#fafafa]">
                {uploadPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={uploadPreview} alt="미리보기" className="max-h-32 object-contain" />
                ) : (
                  <>
                    <Upload size={28} className="text-[#b0acd6] mb-2" />
                    <span className="text-sm text-[#514b81]">파일 선택 또는 드래그</span>
                    <span className="text-xs text-[#b0acd6] mt-1">PNG, JPG (최대 2MB)</span>
                  </>
                )}
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={handleUploadChange}
                />
              </label>
              <div className="flex gap-2">
                {uploadPreview && (
                  <button
                    onClick={() => { setUploadFile(null); setUploadPreview(null) }}
                    className="flex items-center gap-1.5 h-9 px-4 border border-[#c8c4d0] rounded-lg text-sm text-[#514b81] hover:bg-[#f8f9fa] transition-colors"
                  >
                    <Trash2 size={14} /> 취소
                  </button>
                )}
                <button
                  onClick={saveSignature}
                  disabled={!uploadFile || saving}
                  className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#7b68ee] hover:bg-[#6a58d6] text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Save size={14} /> {saving ? '저장 중…' : '서명 저장'}
                </button>
              </div>
            </div>
          )}

          {status && (
            <div className={`mt-3 flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
              status.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
            }`}>
              {status.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
              {status.msg}
            </div>
          )}
        </div>
      </div>

      <div className="text-xs text-[#b0acd6] space-y-1">
        <p>• 등록된 서명은 전자결재 문서 결재 시 자동으로 사용됩니다.</p>
        <p>• 서명 이미지는 Supabase Storage에 안전하게 저장됩니다.</p>
        <p>• 서명 변경 시 기존 서명을 덮어쓰기합니다.</p>
      </div>
    </div>
  )
}
