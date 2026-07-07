import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native'
import { Stack } from 'expo-router'
import { useDocForm } from '@/lib/useDocForm'

const TRAINING_TYPES = ['소화 훈련', '피난 훈련', '통보 연락 훈련', '응급처치 교육', '소방안전 교육', '기타']

export default function TrainingRecordsScreen() {
  const today = new Date().toISOString().slice(0, 10)
  const [docDate,       setDocDate]       = useState(today)
  const [buildingName,  setBuildingName]  = useState('')
  const [trainingType,  setTrainingType]  = useState(TRAINING_TYPES[0])
  const [instructor,    setInstructor]    = useState('')
  const [participants,  setParticipants]  = useState('')
  const [duration,      setDuration]      = useState('')
  const [trainingContent, setTrainingContent] = useState('')
  const [evaluation,    setEvaluation]    = useState('')
  const [brigadeMembers, setBrigadeMembers] = useState('')
  const { saving, saveDoc } = useDocForm('training_record')

  async function handleSave() {
    await saveDoc({
      title:   `자위소방대 교육훈련 — ${buildingName || '미기입'} (${docDate})`,
      docDate,
      content: { buildingName, trainingType, instructor, participants, duration, trainingContent, evaluation, brigadeMembers },
    })
  }

  return (
    <>
      <Stack.Screen options={{ title: '자위소방대·교육훈련기록부' }} />
      <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>기본 정보</Text>
          <View style={styles.field}><Text style={styles.label}>훈련일</Text><TextInput style={styles.input} value={docDate} onChangeText={setDocDate} placeholder="YYYY-MM-DD" /></View>
          <View style={styles.field}><Text style={styles.label}>건물명</Text><TextInput style={styles.input} value={buildingName} onChangeText={setBuildingName} placeholder="훈련 실시 건물명" /></View>
          <View style={styles.field}>
            <Text style={styles.label}>훈련 유형</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
              <View style={styles.typeRow}>
                {TRAINING_TYPES.map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.typeBtn, trainingType === t && styles.typeBtnActive]}
                    onPress={() => setTrainingType(t)}
                  >
                    <Text style={[styles.typeBtnText, trainingType === t && styles.typeBtnTextActive]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>훈련 세부 내용</Text>
          <View style={styles.field}><Text style={styles.label}>교육 강사</Text><TextInput style={styles.input} value={instructor} onChangeText={setInstructor} placeholder="강사 성명 및 소속" /></View>
          <View style={styles.field}><Text style={styles.label}>참가 인원</Text><TextInput style={styles.input} value={participants} onChangeText={setParticipants} placeholder="예: 15명" keyboardType="numeric" /></View>
          <View style={styles.field}><Text style={styles.label}>훈련 시간</Text><TextInput style={styles.input} value={duration} onChangeText={setDuration} placeholder="예: 2시간" /></View>
          <View style={styles.field}>
            <Text style={styles.label}>훈련 내용</Text>
            <TextInput style={[styles.input, styles.multiline]} value={trainingContent} onChangeText={setTrainingContent}
              placeholder="훈련 내용을 상세히 기재하세요" multiline numberOfLines={4} textAlignVertical="top" />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>평가 / 결과</Text>
            <TextInput style={[styles.input, styles.multiline]} value={evaluation} onChangeText={setEvaluation}
              placeholder="훈련 평가 및 결과 요약" multiline numberOfLines={3} textAlignVertical="top" />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>자위소방대 편성 현황</Text>
          <TextInput style={[styles.input, styles.multiline]} value={brigadeMembers} onChangeText={setBrigadeMembers}
            placeholder="대장, 부대장, 소화반, 피난유도반 등 편성 현황 기재" multiline numberOfLines={4} textAlignVertical="top" />
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
  multiline:        { height: 90, paddingTop: 9 },
  typeRow:          { flexDirection: 'row', gap: 8 },
  typeBtn:          { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: '#e8e6f8', backgroundColor: '#fff' },
  typeBtnActive:    { backgroundColor: '#7b68ee', borderColor: '#7b68ee' },
  typeBtnText:      { fontSize: 12, color: '#6b7280', fontWeight: '500' },
  typeBtnTextActive:{ color: '#fff' },
  saveBtn:          { backgroundColor: '#7b68ee', borderRadius: 12, height: 50, justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  saveBtnText:      { color: '#fff', fontSize: 16, fontWeight: '700' },
})
