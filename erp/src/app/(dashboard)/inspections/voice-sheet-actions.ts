'use server'

import Anthropic from '@anthropic-ai/sdk'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'
import { saveSheetResponsesAction, createDefectsFromXAction } from './sheet-actions'

/** V-1 음성 점검표 입력 (소방계획서_4.md §9-4) — Plaud 전사 텍스트 → Claude 구조화 → 점검자 확인 후 저장.
 *  저장 타깃 = 기존 inspection_sheet_responses (점검표·별지 9호 3쪽·불량 등록 자동 연동).
 *  무검수 자동확정 금지 — AI 결과는 제안일 뿐, 점검자가 확인·확정해야 저장된다. */

const SYSTEM_PROMPT = `당신은 소방 점검 전문가입니다. 현장 점검자의 음성 전사 텍스트를 점검표 항목 응답으로 변환합니다.
발화 규칙: "층수 + 시설명 + 상태(+사유)" — 예: "3층 유도등 불량, 램프 파손 / 소화기 전부 양호 / 스프링클러 해당없음"

매핑 규칙:
- "OO 전부(모두) 양호/정상" → 해당 설비 시트의 모든 항목을 O로
- 특정 불량 발화 → 가장 근접한 항목 1개를 X로, memo에 위치·사유 기록 (예: "3층 램프 파손")
- "해당없음/미설치" 발화 → 해당 시트 모든 항목을 N으로
- 발화와 매칭되는 항목이 불확실하면 제외한다 (추측 금지)
- 전사에 언급되지 않은 설비는 건드리지 않는다

출력 (JSON만, 다른 텍스트 금지):
{"entries":[{"item_code":"1-A-001","result":"O","memo":""}]}
result는 O(양호)/X(불량)/N(해당없음)만.`

export type VoiceSheetEntry = {
  item_code: string
  result: 'O' | 'X' | 'N'
  memo: string
  sheet_name: string
  item_name: string
  /** 기존 응답과 다른 값 제안 — 확인 강조용 */
  conflict: boolean
}

export async function parseVoiceSheetAction(
  inspectionId: string,
  transcript: string,
): Promise<{ error?: string; entries?: VoiceSheetEntry[]; missingSheets?: string[] }> {
  await requirePermission('inspection_register')
  const text = transcript?.trim()
  if (!text) return { error: '전사 텍스트가 비어 있습니다.' }
  if (!process.env.ANTHROPIC_API_KEY) return { error: 'AI 구조화가 구성되지 않았습니다 (ANTHROPIC_API_KEY).' }
  const admin = createAdminClient()

  const [{ data: insp }, { data: sheetsRaw }] = await Promise.all([
    admin.from('inspections').select('customer_id').eq('id', inspectionId).single(),
    admin.from('inspection_sheets').select('id, sheet_name').eq('version', 'v2025').eq('is_active', true).order('sheet_code'),
  ])
  if (!insp) return { error: '점검을 찾을 수 없습니다.' }
  const sheets = (sheetsRaw ?? []) as Array<{ id: string; sheet_name: string }>
  const sheetNameById = new Map(sheets.map(s => [s.id, s.sheet_name]))

  // 항목 카탈로그 (페이지 순회 — 1,000행 한도)
  const items: Array<{ item_code: string; item_name: string; sheet_id: string }> = []
  for (let from = 0; ; from += 1000) {
    const { data: page } = await admin.from('inspection_sheet_items')
      .select('item_code, item_name, sheet_id').order('item_code').range(from, from + 999)
    const rows = (page ?? []) as typeof items
    items.push(...rows)
    if (rows.length < 1000) break
  }
  const itemMap = new Map(items.map(i => [i.item_code, i]))

  // Claude 컨텍스트 — 시트별 항목 목록(코드:이름)
  const catalog = sheets.map(s => {
    const list = items.filter(i => i.sheet_id === s.id).map(i => `${i.item_code}:${i.item_name}`).join(', ')
    return `[${s.sheet_name}] ${list}`
  }).join('\n')

  let entriesRaw: Array<{ item_code: string; result: string; memo?: string }> = []
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const res = await client.messages.create({
      model: 'claude-opus-4-8', max_tokens: 8192,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `점검표 항목 목록:\n${catalog}\n\n현장 음성 전사:\n${text}` }],
    })
    const block = res.content.find(b => b.type === 'text')
    if (!block || block.type !== 'text') return { entries: [], missingSheets: [] }
    const m = block.text.match(/\{[\s\S]*\}/)
    if (!m) return { entries: [], missingSheets: [] }
    const parsed = JSON.parse(m[0]) as { entries?: Array<{ item_code: string; result: string; memo?: string }> }
    entriesRaw = Array.isArray(parsed.entries) ? parsed.entries : []
  } catch (e) {
    return { error: `AI 구조화 실패: ${(e as Error).message}` }
  }

  // 검증: 실재 item_code + result 값 확인, 표시용 시트·항목명·기존값 충돌 부착
  const { data: existingRaw } = await admin.from('inspection_sheet_responses')
    .select('item_code, result').eq('inspection_id', inspectionId)
  const existing = new Map(((existingRaw ?? []) as Array<{ item_code: string; result: string }>).map(r => [r.item_code, r.result]))

  const entries: VoiceSheetEntry[] = []
  for (const e of entriesRaw) {
    const it = itemMap.get(e.item_code)
    if (!it || !['O', 'X', 'N'].includes(e.result)) continue
    entries.push({
      item_code: e.item_code,
      result: e.result as 'O' | 'X' | 'N',
      memo: (e.memo ?? '').slice(0, 200),
      sheet_name: sheetNameById.get(it.sheet_id) ?? '',
      item_name: it.item_name,
      conflict: existing.has(e.item_code) && existing.get(e.item_code) !== e.result,
    })
  }

  // 누락 감지 — 설치 시설(fire_facilities) 기준 관련 시트 중 제안·기존 응답이 모두 없는 시트 (§9-4)
  const { data: blds } = await admin.from('buildings').select('id')
    .eq('customer_id', (insp as { customer_id: string }).customer_id).eq('is_active', true)
  const bldIds = ((blds ?? []) as Array<{ id: string }>).map(b => b.id)
  let missingSheets: string[] = []
  if (bldIds.length > 0) {
    const { data: facs } = await admin.from('fire_facilities')
      .select('facility_code').in('building_id', bldIds).eq('installed', true)
    const codes = ((facs ?? []) as Array<{ facility_code: string }>).map(f => f.facility_code.replace(/ /g, ''))
    const respondedSheetIds = new Set([...existing.keys(), ...entries.map(e => e.item_code)]
      .map(c => itemMap.get(c)?.sheet_id).filter(Boolean))
    missingSheets = sheets
      .filter(s => !respondedSheetIds.has(s.id))
      .filter(s => {
        const sn = s.sheet_name.replace(/ /g, '')
        return codes.some(c => c.includes(sn) || sn.includes(c))
      })
      .map(s => s.sheet_name)
  }

  return { entries, missingSheets }
}

/** 점검자 확정 → 저장 (upsert) + 전사 원문 로그(감사·정정용) + X→불량 자동 등록 연동 */
export async function applyVoiceSheetAction(
  inspectionId: string,
  rows: Array<{ item_code: string; result: 'O' | 'X' | 'N'; memo?: string | null }>,
  transcript: string,
): Promise<{ error?: string; saved?: number; defectsAdded?: number }> {
  const profile = await requirePermission('inspection_register')
  if (rows.length === 0) return { error: '확정할 항목이 없습니다.' }

  const res = await saveSheetResponsesAction(inspectionId, rows)
  if (res.error) return { error: res.error }

  const admin = createAdminClient()
  await admin.from('activity_logs').insert({
    actor_id: profile.id,
    action: 'voice_sheet_import',
    entity_type: 'inspection',
    entity_id: inspectionId,
    metadata: { count: rows.length, transcript: transcript.trim().slice(0, 4000) },
  } as Record<string, unknown>)

  const defects = await createDefectsFromXAction(inspectionId)
  revalidatePath(`/inspections/${inspectionId}`)
  return { saved: rows.length, defectsAdded: defects.added ?? 0 }
}
