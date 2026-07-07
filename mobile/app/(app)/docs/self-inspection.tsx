import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native'
import { Stack } from 'expo-router'
import { useDocForm } from '@/lib/useDocForm'

const ITEMS = [
  '소화기 위치 및 상태',
  '비상구 개폐 상태',
  '피난 유도등 작동',
  '자동화재탐지기 정상 작동',
  '스프링클러 헤드 손상 여부',
  '비상방송 설비 정상 작동',
  '소화전 호스 및 밸브 상태',
  '방화문 자동 폐쇄 여부',
]

type CheckResult = '양호' | '불량' | '해당없음'

export default function SelfInspectionScreen() {
  const today = new Date().toISOString().slice(0, 10)
  const [docDate,      setDocDate]      = useState(today)
  const [buildingName, setBuildingName] = useState('')
  const [unitNumber,   setUnitNumber]   = useState('')
  const [inspector,    setInspector]    = useState('')
  const [results, setResults] = useState<Record<string, CheckResult>>(
    Object.fromEntries(ITEMS.map(i => [i, '양호']))
  )
  const [notes, setNotes] = useState('')
  const { saving, saveDoc } = useDocForm('self_inspection')

  function toggleResult(item: string) {
    setResults(prev => {
      const cur = prev[item]
      const next: CheckResult = cur === '양호' ? '불량' : cur === '불량' ? '해당없음' : '양호'
      return { ...prev, [item]: next }
    })
  }

  const resultColor: Record<CheckResult, string> = {
    양호: '#10b981', 불량: '#ef4444', 해당없음: '#9ca3af',
  }

  async function handleSave() {
    await saveDoc({
      title:   `자체점검기록부 — ${buildingName}${unitNumber ? ' ' + unitNumber : ''} (${docDate})`,
      docDate,
      content: { buildingName, unitNumber, inspector, results, notes },
    })
  }

  return (
    <>
      <Stack.Screen options={{ title: '자체점검기록부 작성' }} />
      <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>기본 정보</Text>
          <View style={styles.field}><Text style={styles.label}>점검일</Text><TextInput style={styles.input} value={docDate} onChangeText={setDocDate} placeholder="YYYY-MM-DD" /></View>
          <View style={styles.field}><Text style={styles.label}>건물명</Text><TextInput style={styles.input} value={buildingName} onChangeText={setBuildingName} placeholder="건물명 입력" /></View>
          <View style={styles.field}><Text style={styles.label}>세대(호수)</Text><TextInput style={styles.input} value={unitNumber} onChangeText={setUnitNumber} placeholder="예: 101호" /></View>
          <View style={styles.field}><Text style={styles.label}>점검자</Text><TextInput style={styles.input} value={inspector} onChangeText={setInspector} placeholder="점검자 성명" /></View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>점검 항목 — 탭하여 상태 변경</Text>
          {ITEMS.map(item => (
            <TouchableOpacity key={item} style={styles.checkRow} onPress={() => toggleResult(item)}>
              <Text style={styles.checkLabel}>{item}</Text>
              <View style={[styles.checkBadge, { backgroundColor: resultColor[results[item]] + '22' }]}>
                <Text style={[styles.checkBadgeText, { color: resultColor[results[item]] }]}>
                  {results[item]}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>특이사항</Text>
          <TextInput
            style={[styles.input, styles.multiline]} value={notes} onChangeText={setNotes}
            placeholder="불량 항목 상세, 기타 특이사항 기재" multiline numberOfLines={3} textAlignVertical="top"
          />
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>저장</Text>}
        </TouchableOpacity>
        <View style={{ height: 40 }} />
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#f0eefc', padding: 16 },
  section:        { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 12 },
  sectionTitle:   { fontSize: 13, fontWeight: '700', color: '#7b68ee', marginBottom: 12 },
  field:          { marginBottom: 12 },
  label:          { fontSize: 12, color: '#6b7280', marginBottom: 4, fontWeight: '500' },
  input:          { borderWidth: 1.5, borderColor: '#e8e6f8', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: '#090c1d', backgroundColor: '#fafafe' },
  multiline:      { height: 80, paddingTop: 9 },
  checkRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  checkLabel:     { fontSize: 13, color: '#374151', flex: 1 },
  checkBadge:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  checkBadgeText: { fontSize: 12, fontWeight: '600' },
  saveBtn:        { backgroundColor: '#7b68ee', borderRadius: 12, height: 50, justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  saveBtnText:    { color: '#fff', fontSize: 16, fontWeight: '700' },
})
