import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native'
import { Stack } from 'expo-router'
import { useDocForm } from '@/lib/useDocForm'

export default function WorkRecordsScreen() {
  const today = new Date().toISOString().slice(0, 10)
  const [docDate,       setDocDate]       = useState(today)
  const [workerName,    setWorkerName]    = useState('')
  const [customerName,  setCustomerName]  = useState('')
  const [workType,      setWorkType]      = useState('')
  const [startTime,     setStartTime]     = useState('')
  const [endTime,       setEndTime]       = useState('')
  const [workContent,   setWorkContent]   = useState('')
  const [resultSummary, setResultSummary] = useState('')
  const [nextAction,    setNextAction]    = useState('')
  const { saving, saveDoc } = useDocForm('work_record')

  async function handleSave() {
    await saveDoc({
      title:   `업무수행기록표 — ${customerName || '미기입'} (${docDate})`,
      docDate,
      content: { workerName, customerName, workType, startTime, endTime, workContent, resultSummary, nextAction },
    })
  }

  return (
    <>
      <Stack.Screen options={{ title: '업무수행기록표 작성' }} />
      <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
        <Section title="기본 정보">
          <Field label="작성일"><TextInput style={styles.input} value={docDate} onChangeText={setDocDate} placeholder="YYYY-MM-DD" /></Field>
          <Field label="작성자"><TextInput style={styles.input} value={workerName} onChangeText={setWorkerName} placeholder="성명" /></Field>
          <Field label="고객명(건물)"><TextInput style={styles.input} value={customerName} onChangeText={setCustomerName} placeholder="방문한 고객명 또는 건물명" /></Field>
          <Field label="업무 유형"><TextInput style={styles.input} value={workType} onChangeText={setWorkType} placeholder="예: 종합점검, 작동기능점검, 유지보수" /></Field>
        </Section>

        <Section title="업무 내용">
          <View style={styles.timeRow}>
            <View style={styles.timeField}>
              <Text style={styles.label}>시작 시간</Text>
              <TextInput style={styles.input} value={startTime} onChangeText={setStartTime} placeholder="09:00" />
            </View>
            <View style={styles.timeField}>
              <Text style={styles.label}>종료 시간</Text>
              <TextInput style={styles.input} value={endTime} onChangeText={setEndTime} placeholder="17:00" />
            </View>
          </View>
          <Field label="업무 내용">
            <TextInput style={[styles.input, styles.multiline]} value={workContent} onChangeText={setWorkContent}
              placeholder="수행한 업무를 상세히 기재하세요" multiline numberOfLines={4} textAlignVertical="top" />
          </Field>
          <Field label="결과 요약">
            <TextInput style={[styles.input, styles.multiline]} value={resultSummary} onChangeText={setResultSummary}
              placeholder="점검/작업 결과 요약" multiline numberOfLines={3} textAlignVertical="top" />
          </Field>
          <Field label="후속 조치">
            <TextInput style={[styles.input, styles.multiline]} value={nextAction} onChangeText={setNextAction}
              placeholder="후속 조치 필요 사항" multiline numberOfLines={2} textAlignVertical="top" />
          </Field>
        </Section>

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>저장</Text>}
        </TouchableOpacity>
        <View style={{ height: 40 }} />
      </ScrollView>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text>{children}</View>
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#f0eefc', padding: 16 },
  section:      { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#7b68ee', marginBottom: 12 },
  field:        { marginBottom: 12 },
  label:        { fontSize: 12, color: '#6b7280', marginBottom: 4, fontWeight: '500' },
  input:        { borderWidth: 1.5, borderColor: '#e8e6f8', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: '#090c1d', backgroundColor: '#fafafe' },
  multiline:    { height: 90, paddingTop: 9 },
  timeRow:      { flexDirection: 'row', gap: 12, marginBottom: 12 },
  timeField:    { flex: 1 },
  saveBtn:      { backgroundColor: '#7b68ee', borderRadius: 12, height: 50, justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  saveBtnText:  { color: '#fff', fontSize: 16, fontWeight: '700' },
})
