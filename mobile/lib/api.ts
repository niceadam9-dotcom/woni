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

// 점검표 응답 저장 — 서버 /api/mobile/sheet-save (웹 저장과 같은 코어를 탄다).
// 충돌(conflicts)이 오면 그 항목은 저장되지 않은 것 — 화면이 서버값/내값을 보여 고르게 한다.
export interface SheetSaveRow {
  item_code: string
  result: 'O' | 'X' | 'N'
  memo?: string | null
  /** 클라이언트가 마지막으로 본 서버 updated_at — 신규 입력은 null. 충돌 판정의 기준점. */
  base_updated_at?: string | null
}

export interface SheetSaveConflict {
  item_code: string
  server: { result: string; memo: string | null; updated_at: string; updated_by: string | null }
}

export async function saveSheetResponses(params: {
  inspectionId: string
  rows: SheetSaveRow[]
  month?: number
  clearCodes?: string[]
  force?: boolean
}): Promise<{ saved?: number; conflicts?: SheetSaveConflict[]; stepsChanged?: boolean; error?: string; offline?: boolean }> {
  try {
    const headers = await getAuthHeaders()
    const res = await fetch(`${ERP_URL}/api/mobile/sheet-save`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { error: (json as { error?: string }).error ?? '서버 오류가 발생했습니다.' }
    return json as { saved: number; conflicts: SheetSaveConflict[]; stepsChanged: boolean }
  } catch {
    // 네트워크 실패 — 오프라인 큐(Phase D)가 이 신호를 받아 적재한다
    return { error: '네트워크 오류가 발생했습니다.', offline: true }
  }
}

// 불량 등록(+사진) — 서버 /api/mobile/defect-add (웹 등록과 같은 코어 · clientKey 멱등).
// offline=true면 네트워크 실패(큐 보관), retryable=true면 서버 일시 오류(큐 보관·재시도).
// 그 밖의 error는 다시 보내도 같다(입력 오류) — 큐에 두면 영원히 재시도하므로 호출부가 알린다.
export interface DefectAddResult {
  defectId?: string
  existed?: boolean
  photoAttached?: boolean
  photoRejected?: string
  error?: string
  offline?: boolean
  retryable?: boolean
}

export async function addDefectMobile(params: {
  inspectionId: string
  clientKey: string
  defectName: string
  defectDetail?: string | null
  severity: '경미' | '보통' | '중대'
  photoUri?: string | null
}): Promise<DefectAddResult> {
  try {
    const headers = await getAuthHeaders() as Record<string, string>
    const fd = new FormData()
    fd.append('inspectionId', params.inspectionId)
    fd.append('clientKey', params.clientKey)
    fd.append('defectName', params.defectName)
    if (params.defectDetail) fd.append('defectDetail', params.defectDetail)
    fd.append('severity', params.severity)
    if (params.photoUri) {
      const ext = (params.photoUri.split('.').pop() ?? 'jpg').toLowerCase()
      const type = ext === 'png' ? 'image/png' : ext === 'heic' ? 'image/heic' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
      // React Native FormData 파일 규약 — { uri, name, type }
      fd.append('photo', { uri: params.photoUri, name: `photo.${ext}`, type } as unknown as Blob)
    }
    const res = await fetch(`${ERP_URL}/api/mobile/defect-add`, {
      method: 'POST',
      // Content-Type은 넣지 않는다 — fetch가 multipart 경계(boundary)를 붙여 직접 정한다
      headers: headers.Authorization ? { Authorization: headers.Authorization } : {},
      body: fd,
    })
    const json = await res.json().catch(() => ({})) as DefectAddResult & { photoPending?: boolean }
    if (res.ok) return json
    return {
      error: json.error ?? '서버 오류가 발생했습니다.',
      retryable: res.status >= 500 || json.photoPending === true,
      defectId: json.defectId,
    }
  } catch {
    return { error: '네트워크 오류가 발생했습니다.', offline: true }
  }
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
