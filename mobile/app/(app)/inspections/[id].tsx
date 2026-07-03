import React, { useEffect, useState, useCallback } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, Platform,
} from 'react-native'
import { useLocalSearchParams, useRouter, Stack } from 'expo-router'
import { supabase } from '@/lib/supabase'
import type { PlanItem, Inspection, InspectionStep, InspectionDefect } from '@/lib/types'
import { DefectFormModal } from '@/components/DefectFormModal'

const SEVERITY_COLORS = {
  '경미': { bg: '#fef9c3', text: '#ca8a04' },
  '보통': { bg: '#fee2e2', text: '#dc2626' },
  '중대': { bg: '#450a0a', text: '#fca5a5' },
}

function showAlert(title: string, message: string) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n${message}`)
  } else {
    Alert.alert(title, message)
  }
}

function DatePickerInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputRef = React.useRef<any>(null)
  const onChangeRef = React.useRef(onChange)
  React.useEffect(() => { onChangeRef.current = onChange })

  // 마운트 시 달력 자동 오픈 + 이벤트 리스너 등록
  React.useEffect(() => {
    const el = inputRef.current
    if (!el) return

    // 버튼 클릭 직후 렌더링되므로 user gesture 컨텍스트 안에 있음
    setTimeout(() => {
      try { el.showPicker?.() } catch { el.click?.() }
    }, 50)

    const handler = (e: Event) => {
      const val = (e.target as HTMLInputElement).value
      if (val) onChangeRef.current(val)
    }
    el.addEventListener('change', handler)
    el.addEventListener('input', handler)
    return () => {
      el.removeEventListener('change', handler)
      el.removeEventListener('input', handler)
    }
  }, [])

  if (Platform.OS !== 'web') return null

  return React.createElement('input', {
    ref: inputRef,
    type: 'date',
    defaultValue: value,
    style: {
      fontSize: 13,
      color: '#090c1d',
      border: '1.5px solid #7b68ee',
      borderRadius: 8,
      padding: '5px 10px',
      marginRight: 6,
      outline: 'none',
      fontFamily: 'inherit',
      cursor: 'pointer',
      minWidth: 140,
    },
  })
}

export default function InspectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()

  const [planItem, setPlanItem] = useState<PlanItem | null>(null)
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [steps, setSteps] = useState<InspectionStep[]>([])
  const [defects, setDefects] = useState<InspectionDefect[]>([])
  const [loading, setLoading] = useState(true)
  const [startingInspection, setStartingInspection] = useState(false)
  const [showDefectModal, setShowDefectModal] = useState(false)
  const [editingDate, setEditingDate] = useState(false)
  const [dateInput, setDateInput] = useState('')
  const [savingDate, setSavingDate] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data: planData } = await supabase
      .from('inspection_plan_items')
      .select(`
        id, plan_id, customer_id, inspection_type, sequence_num,
        scheduled_date, assigned_employee_id, status, inspection_id, notes,
        customers!inner(customer_name, customer_code, address)
      `)
      .eq('id', id)
      .single()

    if (!planData) { router.back(); return }

    const customer = (planData as Record<string, unknown>).customers as { customer_name: string; customer_code: string; address: string | null } | null
    const item: PlanItem = {
      id: planData.id as string,
      plan_id: planData.plan_id as string,
      customer_id: planData.customer_id as string,
      inspection_type: planData.inspection_type as PlanItem['inspection_type'],
      sequence_num: planData.sequence_num as 1 | 2,
      scheduled_date: planData.scheduled_date as string | null,
      assigned_employee_id: planData.assigned_employee_id as string | null,
      status: planData.status as PlanItem['status'],
      inspection_id: planData.inspection_id as string | null,
      notes: planData.notes as string | null,
      customer_name: customer?.customer_name ?? '',
      customer_code: customer?.customer_code ?? '',
      customer_address: customer?.address ?? null,
    }
    setPlanItem(item)

    if (item.inspection_id) {
      const [inspRes, stepsRes, defectsRes] = await Promise.all([
        supabase.from('inspections').select('*').eq('id', item.inspection_id).single(),
        supabase.from('inspection_steps').select('*').eq('inspection_id', item.inspection_id).order('step_num'),
        supabase.from('inspection_defects').select('*').eq('inspection_id', item.inspection_id).order('created_at'),
      ])
      if (inspRes.data) setInspection(inspRes.data as unknown as Inspection)
      setSteps((stepsRes.data ?? []) as unknown as InspectionStep[])
      setDefects((defectsRes.data ?? []) as unknown as InspectionDefect[])
    }

    setLoading(false)
  }, [id, router])

  useEffect(() => { load() }, [load])

  async function saveScheduledDate(date: string) {
    if (!planItem) return
    setSavingDate(true)
    setErrorMsg(null)
    const { error } = await supabase
      .from('inspection_plan_items')
      .update({ scheduled_date: date })
      .eq('id', planItem.id)
    if (error) {
      setErrorMsg(`저장 실패: ${error.message}`)
      setSavingDate(false)
      return
    }
    setEditingDate(false)
    setSavingDate(false)
    await load()
  }

  async function startInspection() {
    if (!planItem) return
    setStartingInspection(true)
    setErrorMsg(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      showAlert('오류', '로그인이 필요합니다.')
      setStartingInspection(false)
      return
    }

    const today = new Date().toISOString().split('T')[0]

    // 기존 점검 중복 체크
    const { data: existing } = await supabase
      .from('inspections')
      .select('id')
      .eq('customer_id', planItem.customer_id)
      .eq('year', new Date().getFullYear())
      .eq('sequence_num', planItem.sequence_num)
      .maybeSingle()

    if (existing) {
      const { error: linkError } = await supabase
        .from('inspection_plan_items')
        .update({ inspection_id: (existing as { id: string }).id, status: 'confirmed' })
        .eq('id', planItem.id)
      if (linkError) {
        setErrorMsg('점검 연결에 실패했습니다.')
        setStartingInspection(false)
        return
      }
      await load()
      setStartingInspection(false)
      return
    }

    // 새 점검 생성 (year는 GENERATED 컬럼 — 자동 계산, DB 트리거가 6단계 자동 생성)
    const { data: newInspection, error: inspError } = await supabase
      .from('inspections')
      .insert({
        customer_id: planItem.customer_id,
        assigned_employee_id: user.id,
        inspection_type: planItem.inspection_type,
        inspection_start_date: today,
        sequence_num: planItem.sequence_num,
        status: 'scheduled',
        created_by: user.id,
      })
      .select('id')
      .single()

    if (inspError || !newInspection) {
      setErrorMsg(`점검 생성에 실패했습니다. (${inspError?.message ?? '알 수 없는 오류'})`)
      setStartingInspection(false)
      return
    }

    // 계획 항목 연결
    await supabase
      .from('inspection_plan_items')
      .update({ inspection_id: newInspection.id, status: 'confirmed' })
      .eq('id', planItem.id)

    await load()
    setStartingInspection(false)
  }

  async function completeStep(stepId: string) {
    if (!inspection) return
    const now = new Date().toISOString()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { error } = await supabase
      .from('inspection_steps')
      .update({ status: 'completed', completed_at: now, completed_by: user.id })
      .eq('id', stepId)

    if (error) { showAlert('오류', '단계 완료 처리에 실패했습니다.'); return }

    const updatedSteps = steps.map(s => s.id === stepId ? { ...s, status: 'completed' as const, completed_at: now } : s)
    const allDone = updatedSteps.every(s => s.status === 'completed')
    if (allDone) {
      await supabase.from('inspections').update({ status: 'completed' }).eq('id', inspection.id)
    } else if (inspection.status === 'scheduled') {
      await supabase.from('inspections').update({ status: 'in_progress' }).eq('id', inspection.id)
    }

    await load()
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#7b68ee" /></View>
  }

  if (!planItem) return null

  return (
    <>
      <Stack.Screen
        options={{
          title: planItem.customer_name,
          headerShown: true,
          headerStyle: { backgroundColor: '#7b68ee' },
          headerTintColor: '#fff',
        }}
      />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* 기본 정보 */}
        <View style={styles.section}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>고객코드</Text>
            <Text style={styles.infoValue}>{planItem.customer_code}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>점검유형</Text>
            <Text style={styles.infoValue}>{planItem.inspection_type} {planItem.sequence_num}차</Text>
          </View>
          {planItem.customer_address && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>주소</Text>
              <Text style={styles.infoValue}>{planItem.customer_address}</Text>
            </View>
          )}
          {/* 점검 예정일 — 달력 선택 */}
          <View style={[styles.infoRow, { alignItems: 'center', paddingVertical: 8 }]}>
            <Text style={styles.infoLabel}>점검 예정일</Text>
            {editingDate ? (
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {savingDate
                    ? <ActivityIndicator size="small" color="#7b68ee" style={{ marginRight: 8 }} />
                    : <DatePickerInput
                        value={dateInput}
                        onChange={(date) => { setDateInput(date); saveScheduledDate(date) }}
                      />
                  }
                  <TouchableOpacity onPress={() => { setEditingDate(false); setErrorMsg(null) }} style={styles.dateCancelBtn}>
                    <Text style={styles.dateCancelBtnText}>✕</Text>
                  </TouchableOpacity>
                </View>
                {errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <Text style={[styles.infoValue, { flex: 1 }]}>
                  {planItem.scheduled_date ?? '미정'}
                </Text>
                <TouchableOpacity
                  onPress={() => { setDateInput(planItem.scheduled_date ?? ''); setEditingDate(true) }}
                  style={styles.editDateBtn}
                >
                  <Text style={styles.editDateBtnText}>📅 날짜 선택</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        {/* 오류 메시지 */}
        {errorMsg && !editingDate && (
          <View style={styles.errorBox}>
            <Text style={styles.errorBoxText}>{errorMsg}</Text>
          </View>
        )}

        {/* 점검 시작 버튼 */}
        {!inspection && (
          <TouchableOpacity
            style={[styles.startButton, startingInspection && styles.startButtonDisabled]}
            onPress={startInspection}
            disabled={startingInspection}
          >
            {startingInspection
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.startButtonText}>점검 시작</Text>
            }
          </TouchableOpacity>
        )}

        {inspection && (
          <>
            {/* 7단계 진행 현황 */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>점검 단계</Text>
              <Text style={styles.stepCount}>
                {steps.filter(s => s.status === 'completed').length}/{steps.length}
              </Text>
            </View>
            <View style={styles.section}>
              {steps.map((step) => (
                <View key={step.id} style={styles.stepRow}>
                  <View style={[styles.stepDot, step.status === 'completed' && styles.stepDotDone]} />
                  <View style={styles.stepInfo}>
                    <Text style={[styles.stepName, step.status === 'completed' && styles.stepNameDone]}>
                      {step.step_num}. {step.name_ko}
                    </Text>
                    {step.due_date && (
                      <Text style={styles.stepDue}>마감: {step.due_date}</Text>
                    )}
                  </View>
                  {step.status !== 'completed' && (
                    <TouchableOpacity
                      style={styles.completeBtn}
                      onPress={() => completeStep(step.id)}
                    >
                      <Text style={styles.completeBtnText}>완료</Text>
                    </TouchableOpacity>
                  )}
                  {step.status === 'completed' && (
                    <Text style={styles.stepDoneIcon}>✓</Text>
                  )}
                </View>
              ))}
            </View>

            {/* 불량내역 */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>불량내역 ({defects.length}건)</Text>
              <TouchableOpacity
                style={styles.addDefectBtn}
                onPress={() => setShowDefectModal(true)}
              >
                <Text style={styles.addDefectBtnText}>+ 불량 등록</Text>
              </TouchableOpacity>
            </View>

            {defects.length === 0 ? (
              <View style={styles.emptyDefects}>
                <Text style={styles.emptyDefectsText}>등록된 불량내역이 없습니다.</Text>
              </View>
            ) : (
              <View style={styles.section}>
                {defects.map((defect) => (
                  <View key={defect.id} style={styles.defectCard}>
                    <View style={styles.defectHeader}>
                      <Text style={styles.defectName}>{defect.defect_name}</Text>
                      <View style={[
                        styles.severityBadge,
                        { backgroundColor: SEVERITY_COLORS[defect.severity].bg }
                      ]}>
                        <Text style={[
                          styles.severityText,
                          { color: SEVERITY_COLORS[defect.severity].text }
                        ]}>
                          {defect.severity}
                        </Text>
                      </View>
                    </View>
                    {defect.defect_detail && (
                      <Text style={styles.defectDetail}>{defect.defect_detail}</Text>
                    )}
                    {defect.photo_url && (
                      <Text style={styles.defectPhoto}>📷 사진 첨부됨</Text>
                    )}
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {inspection && (
        <DefectFormModal
          visible={showDefectModal}
          inspectionId={inspection.id}
          onClose={() => setShowDefectModal(false)}
          onSaved={() => { setShowDefectModal(false); load() }}
        />
      )}
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0eefc' },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  section: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#7b68ee',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    marginTop: 4,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#090c1d' },
  stepCount: { fontSize: 13, color: '#7b68ee', fontWeight: '600' },
  infoRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  infoLabel: { width: 90, fontSize: 13, color: '#9ca3af' },
  infoValue: { flex: 1, fontSize: 13, color: '#090c1d', fontWeight: '500' },
  dateSaveBtn: {
    backgroundColor: '#7b68ee',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    marginRight: 4,
    minWidth: 44,
    alignItems: 'center',
  },
  dateSaveBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  dateCancelBtn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  dateCancelBtnText: { color: '#9ca3af', fontSize: 12 },
  editDateBtn: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#7b68ee',
  },
  editDateBtnText: { fontSize: 11, color: '#7b68ee', fontWeight: '600' },
  errorText: { fontSize: 11, color: '#dc2626', marginTop: 4 },
  errorBox: {
    backgroundColor: '#fee2e2',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  errorBoxText: { fontSize: 13, color: '#dc2626' },
  startButton: {
    backgroundColor: '#7b68ee',
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  startButtonDisabled: { opacity: 0.6 },
  startButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f9f8ff',
  },
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#e8e6f8',
    marginRight: 12,
  },
  stepDotDone: { backgroundColor: '#7b68ee' },
  stepInfo: { flex: 1 },
  stepName: { fontSize: 14, color: '#374151' },
  stepNameDone: { color: '#9ca3af', textDecorationLine: 'line-through' },
  stepDue: { fontSize: 11, color: '#d1d5db', marginTop: 2 },
  completeBtn: {
    backgroundColor: '#f5f4ff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  completeBtnText: { fontSize: 12, color: '#7b68ee', fontWeight: '600' },
  stepDoneIcon: { fontSize: 16, color: '#7b68ee' },
  addDefectBtn: {
    backgroundColor: '#7b68ee',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addDefectBtnText: { fontSize: 13, color: '#fff', fontWeight: '600' },
  emptyDefects: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyDefectsText: { fontSize: 14, color: '#9ca3af' },
  defectCard: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  defectHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  defectName: { fontSize: 14, fontWeight: '600', color: '#090c1d', flex: 1, marginRight: 8 },
  defectDetail: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  defectPhoto: { fontSize: 11, color: '#7b68ee', marginTop: 4 },
  severityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  severityText: { fontSize: 11, fontWeight: '600' },
})
