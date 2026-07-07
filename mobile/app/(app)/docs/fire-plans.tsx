import { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native'
import { Stack } from 'expo-router'
import { useDocForm } from '@/lib/useDocForm'

export default function FirePlansScreen() {
  const today = new Date().toISOString().slice(0, 10)
  const [docDate,        setDocDate]        = useState(today)
  const [buildingName,   setBuildingName]   = useState('')
  const [address,        setAddress]        = useState('')
  const [floorCount,     setFloorCount]     = useState('')
  const [area,           setArea]           = useState('')
  const [fireManager,    setFireManager]    = useState('')
  const [evacuationRoute,setEvacuationRoute]= useState('')
  const [fireEquipment,  setFireEquipment]  = useState('')
  const [specialNotes,   setSpecialNotes]   = useState('')
  const { saving, saveDoc } = useDocForm('fire_plan')

  async function handleSave() {
    await saveDoc({
      title:   `소방계획서 — ${buildingName || '미기입'} (${docDate})`,
      docDate,
      content: {
        buildingName, address, floorCount, area,
        fireManager, evacuationRoute, fireEquipment, specialNotes,
      },
    })
  }

  return (
    <>
      <Stack.Screen options={{ title: '소방계획서 작성' }} />
      <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
        <Section title="기본 정보">
          <Field label="작성일">
            <TextInput style={styles.input} value={docDate} onChangeText={setDocDate} placeholder="YYYY-MM-DD" />
          </Field>
          <Field label="건물명">
            <TextInput style={styles.input} value={buildingName} onChangeText={setBuildingName} placeholder="건물명 입력" />
          </Field>
          <Field label="주소">
            <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholder="건물 주소" />
          </Field>
          <Field label="층수">
            <TextInput style={styles.input} value={floorCount} onChangeText={setFloorCount} placeholder="예: 지상 5층 / 지하 1층" keyboardType="default" />
          </Field>
          <Field label="연면적(㎡)">
            <TextInput style={styles.input} value={area} onChangeText={setArea} placeholder="예: 3,500" keyboardType="numeric" />
          </Field>
        </Section>

        <Section title="소방 정보">
          <Field label="소방안전관리자">
            <TextInput style={styles.input} value={fireManager} onChangeText={setFireManager} placeholder="성명" />
          </Field>
          <Field label="피난 경로">
            <TextInput
              style={[styles.input, styles.multiline]} value={evacuationRoute}
              onChangeText={setEvacuationRoute} placeholder="피난 경로 및 비상구 위치 기술" multiline numberOfLines={3} textAlignVertical="top"
            />
          </Field>
          <Field label="소방시설 현황">
            <TextInput
              style={[styles.input, styles.multiline]} value={fireEquipment}
              onChangeText={setFireEquipment} placeholder="소화기·스프링클러·감지기 등 설치 현황" multiline numberOfLines={3} textAlignVertical="top"
            />
          </Field>
          <Field label="특이사항">
            <TextInput
              style={[styles.input, styles.multiline]} value={specialNotes}
              onChangeText={setSpecialNotes} placeholder="기타 특이사항 기재" multiline numberOfLines={2} textAlignVertical="top"
            />
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
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#f0eefc', padding: 16 },
  section:      { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#7b68ee', marginBottom: 12 },
  field:        { marginBottom: 12 },
  label:        { fontSize: 12, color: '#6b7280', marginBottom: 4, fontWeight: '500' },
  input:        { borderWidth: 1.5, borderColor: '#e8e6f8', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: '#090c1d', backgroundColor: '#fafafe' },
  multiline:    { height: 80, paddingTop: 9 },
  saveBtn:      { backgroundColor: '#7b68ee', borderRadius: 12, height: 50, justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  saveBtnText:  { color: '#fff', fontSize: 16, fontWeight: '700' },
})
