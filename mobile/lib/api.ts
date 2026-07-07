import Constants from 'expo-constants'
import { supabase } from './supabase'
import type { ClassifiedDefect, PlanItem } from './types'

const ERP_URL: string = Constants.expoConfig?.extra?.erpUrl ?? 'http://localhost:3000'

async function getAuthHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

// 나의 점검계획 목록 조회
export async function fetchMyPlanItems(): Promise<PlanItem[]> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('inspection_plan_items')
    .select(`
      id, plan_id, customer_id, inspection_type, sequence_num,
      scheduled_date, assigned_employee_id, status, inspection_id, notes,
      customers!inner(customer_name, customer_code, address)
    `)
    .eq('assigned_employee_id', user.id)
    .in('status', ['planned', 'confirmed'])
    .order('scheduled_date', { ascending: true })

  if (error || !data) return []

  return (data as Record<string, unknown>[]).map((row) => {
    const customer = row.customers as { customer_name: string; customer_code: string; address: string | null } | null
    return {
      id: row.id as string,
      plan_id: row.plan_id as string,
      customer_id: row.customer_id as string,
      inspection_type: row.inspection_type as PlanItem['inspection_type'],
      sequence_num: row.sequence_num as 1 | 2,
      scheduled_date: row.scheduled_date as string | null,
      assigned_employee_id: row.assigned_employee_id as string | null,
      status: row.status as PlanItem['status'],
      inspection_id: row.inspection_id as string | null,
      notes: row.notes as string | null,
      customer_name: customer?.customer_name ?? '',
      customer_code: customer?.customer_code ?? '',
      customer_address: customer?.address ?? null,
    }
  })
}

// 음성 텍스트로 불량항목 AI 분류
export async function classifyVoiceDefects(
  transcript: string
): Promise<{ defects?: ClassifiedDefect[]; error?: string }> {
  try {
    const headers = await getAuthHeaders()
    const res = await fetch(`${ERP_URL}/api/mobile/classify-defects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ transcript }),
    })
    if (!res.ok) return { error: '서버 오류가 발생했습니다.' }
    return await res.json()
  } catch {
    return { error: '네트워크 오류가 발생했습니다.' }
  }
}

// 음성 파일 업로드 후 불량항목 AI 분류
export async function classifyVoiceAudio(
  audioUri: string
): Promise<{ defects?: ClassifiedDefect[]; error?: string }> {
  try {
    const headers = await getAuthHeaders()
    const formData = new FormData()
    formData.append('audio', {
      uri: audioUri,
      name: 'recording.m4a',
      type: 'audio/m4a',
    } as unknown as Blob)

    const res = await fetch(`${ERP_URL}/api/mobile/classify-defects-audio`, {
      method: 'POST',
      headers: { Authorization: (headers as Record<string, string>).Authorization ?? '' },
      body: formData,
    })
    if (!res.ok) return { error: '서버 오류가 발생했습니다.' }
    return await res.json()
  } catch {
    return { error: '네트워크 오류가 발생했습니다.' }
  }
}
