'use server'

import Anthropic from '@anthropic-ai/sdk'
import { requirePermission } from '@/lib/auth'
import type { DefectSeverity } from './defect-actions'

const SYSTEM_PROMPT = `당신은 소방 점검 전문가입니다. 현장 점검자가 말로 보고한 불량사항을 분석하여 구조화된 불량항목 목록으로 변환합니다.

출력 형식 (JSON 배열):
[
  {
    "defect_name": "불량항목명 (20자 이내)",
    "defect_detail": "상세 설명 (불량 위치, 상태, 규격 등)",
    "severity": "경미" | "보통" | "중대"
  }
]

severity 기준:
- 경미: 즉시 위험 없음, 정기 점검 시 조치
- 보통: 조속한 조치 필요, 잠재적 위험
- 중대: 즉각 조치 필요, 화재 시 인명피해 위험

불량항목이 없으면 빈 배열 []을 반환합니다.
반드시 유효한 JSON만 반환하고, 다른 텍스트는 포함하지 마세요.`

export type VoiceDefectCandidate = { defect_name: string; defect_detail: string; severity: DefectSeverity }

/** 작동점검 음성 문서화 (VN-1) — STT 받아쓰기 텍스트 → AI 구조화 → 불량 후보 */
export async function classifyDefectsFromTranscriptAction(
  transcript: string
): Promise<{ error?: string; candidates?: VoiceDefectCandidate[] }> {
  await requirePermission('inspection_register')
  if (!transcript?.trim()) return { error: '받아쓰기 내용이 비어 있습니다.' }
  if (!process.env.ANTHROPIC_API_KEY) return { error: 'AI 분류가 구성되지 않았습니다 (ANTHROPIC_API_KEY).' }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const res = await client.messages.create({
      model: 'claude-opus-4-8', max_tokens: 2048,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `현장 음성 보고:\n${transcript.trim()}` }],
    })
    const block = res.content.find(b => b.type === 'text')
    if (!block || block.type !== 'text') return { candidates: [] }
    const m = block.text.match(/\[[\s\S]*\]/)
    if (!m) return { candidates: [] }
    const arr = JSON.parse(m[0]) as VoiceDefectCandidate[]
    const candidates = (Array.isArray(arr) ? arr : []).filter(c => c && c.defect_name)
      .map(c => ({
        defect_name: String(c.defect_name).slice(0, 60),
        defect_detail: c.defect_detail ? String(c.defect_detail) : '',
        severity: (['경미', '보통', '중대'] as const).includes(c.severity) ? c.severity : '보통',
      }))
    return { candidates }
  } catch (e) {
    return { error: `AI 분류 실패: ${(e as Error).message}` }
  }
}
