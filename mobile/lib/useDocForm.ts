import { useState } from 'react'
import { Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { supabase } from './supabase'

type DocType = 'fire_plan' | 'work_record' | 'self_inspection' | 'training_record' | 'fire_incident'

export function useDocForm(docType: DocType) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  async function saveDoc(params: {
    title: string
    docDate: string
    customerId?: string | null
    content: Record<string, unknown>
  }) {
    if (!params.title.trim()) {
      Alert.alert('입력 오류', '제목을 입력해주세요.')
      return false
    }
    if (!params.docDate) {
      Alert.alert('입력 오류', '날짜를 입력해주세요.')
      return false
    }

    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return false }

    const { error } = await supabase.from('mobile_documents').insert({
      employee_id: user.id,
      customer_id: params.customerId ?? null,
      doc_type:    docType,
      doc_date:    params.docDate,
      title:       params.title.trim(),
      content:     params.content,
      status:      'draft',
    })

    setSaving(false)

    if (error) {
      Alert.alert('저장 오류', '저장에 실패했습니다.')
      return false
    }

    Alert.alert('저장 완료', '서류가 저장되었습니다.', [
      { text: '확인', onPress: () => router.back() },
    ])
    return true
  }

  return { saving, saveDoc }
}
