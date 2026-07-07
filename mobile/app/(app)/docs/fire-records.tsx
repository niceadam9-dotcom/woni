import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native'
import { Stack } from 'expo-router'
import { useDocForm } from '@/lib/useDocForm'

const INCIDENT_TYPES = ['화재', '비화재보', '오작동', '훈련']

export default function FireRecordsScreen() {
  const today = new Date().toISOString().slice(0, 10)
  const [docDate,       setDocDate]       = useState(today)
  const [incidentTime,  setIncidentTime]  = useState('')
  const [buildingName,  setBuildingName]  = useState('')
  const [location,      setLocation]      = useState('')
  const [incidentType,  setIncidentType]  = useState(INCIDENT_TYPES[0])
  const [cause,         setCause]         = useState('')
  const [damage,        setDamage]        = useState('')
  const [response,      setResponse]      = useState('')
  const [reporter,      setReporter]      = useState('')
  const [fireStation,   setFireStation]   = useState('')
  const [notes,         setNotes]         = useState('')
  const { saving, saveDoc } = useDocForm('fire_incident')

  async function handleSave() {
    await saveDoc({
      title:   `${incidentType} 기록 — ${buildingName || '미기입'} (${docDate})`,
      docDate,
      content: { incidentTime, buildingName, location, incidentType, cause, damage, response, reporter, fireStation, notes },
    })
  }

  return (
    <>
      <Stack.Screen options={{ title: '화재/비화재보 기록부' }} />
      <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>발생 정보</Text>
          <View style={styles.field}><Text style={styles.label}>발생일</Text><TextInput style={styles.input} value={docDate} onChangeText={setDocDate} placeholder="YYYY-MM-DD" /></View>
          <View style={styles.field}><Text style={styles.label}>발생 시각</Text><TextInput style={styles.input} value={incidentTime} onChangeText={setIncidentTime} placeholder="예: 14:30" /></View>
          <View style={styles.field}><Text style={styles.label}>건물명</Text><TextInput style={styles.input} value={buildingName} onChangeText={setBuildingName} placeholder="발생 건물명" /></View>
          <View style={styles.field}><Text style={styles.label}>발생 위치</Text><TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="예: 3층 기계실" /></View>
          <View style={styles.field}>
            <Text style={styles.label}>사고 유형</Text>
            <View style={styles.typeRow}>
              {INCIDENT_TYPES.map(t => (
                <TouchableOpacity
                  key={t}
                  style={[styles.typeBtn, incidentType === t && styles.typeBtnActive]}
                  onPress={() => setIncidentType(t)}
                >
                  <Text style={[styles.typeBtnText, incidentType === t && styles.typeBtnTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>사고 경위 및 조치</Text>
          <View style={styles.field}>
            <Text style={styles.label}>발생 원인</Text>
            <TextInput style={[styles.input, styles.multiline]} value={cause} onChangeText={setCause}
              placeholder="발생 원인을 기술하세요" multiline numberOfLines={3} textAlignVertical="top" />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>피해 현황</Text>
            <TextInput style={[styles.input, styles.multiline]} value={damage} onChangeText={setDamage}
              placeholder="인명·재산 피해 현황 (없을 경우 없음)" multiline numberOfLines={2} textAlignVertical="top" />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>조치 사항</Text>
            <TextInput style={[styles.input, styles.multiline]} value={response} onChangeText={setResponse}
              placeholder="현장 조치 및 후속 조치 기술" multiline numberOfLines={3} textAlignVertical="top" />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>신고 정보</Text>
          <View style={styles.field}><Text style={styles.label}>신고자</Text><TextInput style={styles.input} value={reporter} onChangeText={setReporter} placeholder="신고자 성명" /></View>
          <View style={styles.field}><Text style={styles.label}>관할 소방서</Text><TextInput style={styles.input} value={fireStation} onChangeText={setFireStation} placeholder="예: OO소방서" /></View>
          <View style={styles.field}>
            <Text style={styles.label}>비고</Text>
            <TextInput style={[styles.input, styles.multiline]} value={notes} onChangeText={setNotes}
              placeholder="기타 참고사항" multiline numberOfLines={2} textAlignVertical="top" />
          </View>
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
  container:        { flex: 1, backgroundColor: '#f0eefc', padding: 16 },
  section:          { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 12 },
  sectionTitle:     { fontSize: 13, fontWeight: '700', color: '#7b68ee', marginBottom: 12 },
  field:            { marginBottom: 12 },
  label:            { fontSize: 12, color: '#6b7280', marginBottom: 4, fontWeight: '500' },
  input:            { borderWidth: 1.5, borderColor: '#e8e6f8', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: '#090c1d', backgroundColor: '#fafafe' },
  multiline:        { height: 80, paddingTop: 9 },
  typeRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  typeBtn:          { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: '#e8e6f8' },
  typeBtnActive:    { backgroundColor: '#7b68ee', borderColor: '#7b68ee' },
  typeBtnText:      { fontSize: 12, color: '#6b7280', fontWeight: '500' },
  typeBtnTextActive:{ color: '#fff' },
  saveBtn:          { backgroundColor: '#7b68ee', borderRadius: 12, height: 50, justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  saveBtnText:      { color: '#fff', fontSize: 16, fontWeight: '700' },
})
