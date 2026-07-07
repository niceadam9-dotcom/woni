import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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

export async function POST(req: NextRequest) {
  try {
    const { transcript } = await req.json()
    if (!transcript || typeof transcript !== 'string') {
      return NextResponse.json({ error: '음성 텍스트가 필요합니다.' }, { status: 400 })
    }

    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `현장 음성 보고:\n${transcript}` }],
    })

    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ defects: [] })
    }

    const raw = textBlock.text.trim()
    const jsonMatch = raw.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      return NextResponse.json({ defects: [] })
    }

    const defects = JSON.parse(jsonMatch[0])
    return NextResponse.json({ defects })
  } catch (err) {
    console.error('[classify-defects]', err)
    return NextResponse.json({ error: '분류 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
