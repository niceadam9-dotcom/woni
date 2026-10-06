import { useState, useRef } from 'react'
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, ActivityIndicator,
  Image, Platform,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync } from 'expo-audio'
import { classifyVoiceDefects, addDefectMobile } from '@/lib/api'
import { enqueueDefectAdd, newClientKey } from '@/lib/offline/queue'
import { persistPhoto } from '@/lib/offline/photos'
import type { DefectSeverity, ClassifiedDefect } from '@/lib/types'

const SEVERITIES: DefectSeverity[] = ['경미', '보통', '중대']

const SEVERITY_STYLE: Record<DefectSeverity, { bg: string; text: string; activeBg: string }> = {
  '경미': { bg: '#fefce8', text: '#a16207', activeBg: '#fde047' },
  '보통': { bg: '#fff7ed', text: '#c2410c', activeBg: '#fb923c' },
  '중대': { bg: '#fef2f2', text: '#b91c1c', activeBg: '#f87171' },
}

interface Props {
  visible: boolean
  inspectionId: string
  onClose: () => void
  onSaved: () => void
}

export function DefectFormModal({ visible, inspectionId, onClose, onSaved }: Props) {
  const [defectName, setDefectName] = useState('')
  const [defectDetail, setDefectDetail] = useState('')
  const [severity, setSeverity] = useState<DefectSeverity>('보통')
  const [photoUri, setPhotoUri] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // 음성 입력 상태
  const [isRecording, setIsRecording] = useState(false)
  const [processingVoice, setProcessingVoice] = useState(false)
  const [suggestedDefects, setSuggestedDefects] = useState<ClassifiedDefect[]>([])
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)

  function reset() {
    setDefectName('')
    setDefectDetail('')
    setSeverity('보통')
    setPhotoUri(null)
    setSuggestedDefects([])
    setIsRecording(false)
    setProcessingVoice(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  function showPhotoOptions() {
    if (Platform.OS === 'web') {
      // 웹에서는 카메라가 없으므로 파일 선택창 바로 오픈
      pickPhoto(false)
      return
    }
    Alert.alert('사진 등록', '방법을 선택하세요', [
      { text: '카메라 촬영', onPress: () => pickPhoto(true) },
      { text: '갤러리에서 선택', onPress: () => pickPhoto(false) },
      { text: '취소', style: 'cancel' },
    ])
  }

  // MB-03: 카메라/갤러리로 사진 등록
  async function pickPhoto(fromCamera: boolean) {
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()

    if (!permission.granted) {
      Alert.alert('권한 필요', fromCamera ? '카메라 접근 권한이 필요합니다.' : '사진 라이브러리 권한이 필요합니다.')
      return
    }

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true })

    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri)
    }
  }

  // MB-02: 음성 녹음 시작/종료
  async function toggleRecording() {
    if (isRecording) {
      await audioRecorder.stop()
      setIsRecording(false)
      const uri = audioRecorder.uri
      if (uri) {
        await processVoiceAudio(uri)
      }
    } else {
      const { granted } = await requestRecordingPermissionsAsync()
      if (!granted) {
        Alert.alert('권한 필요', '마이크 접근 권한이 필요합니다.')
        return
      }
      await audioRecorder.prepareToRecordAsync()
      audioRecorder.record()
      setIsRecording(true)
    }
  }

  // MB-02: 음성 녹음 완료 후 텍스트 입력 안내
  async function processVoiceAudio(_audioUri: string) {
    Alert.alert(
      '녹음 완료',
      '말씀하신 불량내역을 아래 입력란에 입력 후 "AI 분류" 버튼을 눌러 자동 인식하세요.',
      [{ text: '확인' }]
    )
  }

  // MB-02: 텍스트 입력으로 AI 분류
  async function classifyText() {
    if (!defectName.trim()) {
      Alert.alert('입력 필요', '불량내역을 먼저 입력해주세요.')
      return
    }
    setProcessingVoice(true)
    const result = await classifyVoiceDefects(defectName)
    if (result.defects && result.defects.length > 0) {
      setSuggestedDefects(result.defects)
    }
    setProcessingVoice(false)
  }

  function applySuggestion(item: ClassifiedDefect) {
    setDefectName(item.defect_name)
    setDefectDetail(item.defect_detail ?? '')
    // 서버가 이미 세 값으로 맞추지만(classify-defects), 옛 서버·다른 경로에서 온 값이면 버튼이 하나도 안 켜진다 — 「보통」으로
    setSeverity((['경미', '보통', '중대'] as const).includes(item.severity) ? item.severity : '보통')
    setSuggestedDefects([])
  }

  // 불량 저장 (사진 포함)
  async function handleSave() {
    if (!defectName.trim()) {
      Alert.alert('입력 오류', '불량항목명을 입력해주세요.')
      return
    }
    setSaving(true)

    // 불량+사진을 한 번에 — 서버 /api/mobile/defect-add(웹 등록과 같은 코어: 단계 동기화·사진 경로 저장).
    // 종전 Edge add-defect는 단계 동기화가 없었고, 사진은 비공개 버킷의 공개 URL을 저장했다.
    const clientKey = newClientKey()
    const payload = {
      inspectionId, clientKey,
      defectName: defectName.trim(),
      defectDetail: defectDetail.trim() || null,
      severity,
    }
    const res = await addDefectMobile({ ...payload, photoUri })

    if (res.offline || (res.error && res.retryable)) {
      // 오프라인·서버 일시 오류 — 같은 키로 큐에 보관(손실 0). 사진은 OS가 못 지우는 곳으로 복사해 둔다.
      const photoPath = photoUri ? await persistPhoto(photoUri, clientKey) : null
      await enqueueDefectAdd({ ...payload, photoPath })
      setSaving(false)
      Alert.alert('오프라인 보관', '불량을 기기에 보관했습니다.\n네트워크가 연결되면 자동으로 전송됩니다.')
      reset()
      onSaved()
      return
    }
    if (res.error) {
      Alert.alert('저장 오류', res.error)
      setSaving(false)
      return
    }
    if (res.photoRejected) Alert.alert('사진 미첨부', `불량은 저장했지만 사진은 올리지 못했습니다.\n${res.photoRejected}`)

    setSaving(false)
    reset()
    onSaved()
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={styles.container}>
        {/* 헤더 */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>취소</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>불량 등록</Text>
          <TouchableOpacity onPress={handleSave} style={styles.saveBtn} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveBtnText}>저장</Text>}
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
          {/* MB-02: 음성 입력 (네이티브 전용) */}
          <View style={styles.voiceSection}>
            <Text style={styles.label}>
              {Platform.OS === 'web' ? 'AI 불량 분류' : '음성으로 불량 입력 (AI 분석)'}
            </Text>
            {Platform.OS !== 'web' && (
              <View style={styles.voiceRow}>
                <TouchableOpacity
                  style={[styles.voiceBtn, isRecording && styles.voiceBtnActive]}
                  onPress={toggleRecording}
                  disabled={processingVoice}
                >
                  <Text style={styles.voiceBtnIcon}>{isRecording ? '⏹' : '🎙'}</Text>
                  <Text style={[styles.voiceBtnText, isRecording && styles.voiceBtnTextActive]}>
                    {isRecording ? '녹음 중지' : '녹음 시작'}
                  </Text>
                </TouchableOpacity>

                {processingVoice && (
                  <View style={styles.processingRow}>
                    <ActivityIndicator size="small" color="#7b68ee" />
                    <Text style={styles.processingText}>AI 분석 중...</Text>
                  </View>
                )}
              </View>
            )}

            {/* AI 분석 제안 목록 */}
            {suggestedDefects.length > 0 && (
              <View style={styles.suggestions}>
                <Text style={styles.suggestionsTitle}>AI 인식 결과 — 탭하면 적용됩니다</Text>
                {suggestedDefects.map((item, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={styles.suggestionItem}
                    onPress={() => applySuggestion(item)}
                  >
                    <Text style={styles.suggestionName}>{item.defect_name}</Text>
                    <Text style={styles.suggestionSeverity}>{item.severity}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* 불량항목명 */}
          <View style={styles.field}>
            <Text style={styles.label}>불량항목명 *</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.input, styles.inputFlex]}
                placeholder="예: 감지기 불량, 스프링클러 헤드 막힘"
                placeholderTextColor="#aaa"
                value={defectName}
                onChangeText={setDefectName}
              />
              <TouchableOpacity style={styles.aiBtn} onPress={classifyText} disabled={processingVoice}>
                <Text style={styles.aiBtnText}>AI 분류</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 불량상세 */}
          <View style={styles.field}>
            <Text style={styles.label}>불량 상세 내용</Text>
            <TextInput
              style={[styles.input, styles.inputMulti]}
              placeholder="불량 상세 내용을 입력하세요"
              placeholderTextColor="#aaa"
              value={defectDetail}
              onChangeText={setDefectDetail}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          {/* 심각도 */}
          <View style={styles.field}>
            <Text style={styles.label}>심각도</Text>
            <View style={styles.severityRow}>
              {SEVERITIES.map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[
                    styles.severityBtn,
                    { backgroundColor: SEVERITY_STYLE[s].bg },
                    severity === s && { borderColor: SEVERITY_STYLE[s].activeBg, borderWidth: 2 },
                  ]}
                  onPress={() => setSeverity(s)}
                >
                  <Text style={[styles.severityBtnText, { color: SEVERITY_STYLE[s].text }]}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* MB-03: 사진 등록 */}
          <View style={styles.field}>
            <Text style={styles.label}>불량 사진</Text>
            {photoUri ? (
              <View style={styles.photoPreview}>
                <Image source={{ uri: photoUri }} style={styles.photoImg} resizeMode="cover" />
                <TouchableOpacity style={styles.photoRemove} onPress={() => setPhotoUri(null)}>
                  <Text style={styles.photoRemoveText}>사진 제거</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.photoBtn} onPress={showPhotoOptions}>
                <Text style={styles.photoBtnIcon}>📷</Text>
                <Text style={styles.photoBtnText}>사진 촬영 또는 선택</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0eefc' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e8e6f8',
  },
  closeBtn: { padding: 4 },
  closeBtnText: { fontSize: 16, color: '#6b7280' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#090c1d' },
  saveBtn: {
    backgroundColor: '#7b68ee',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 60,
    alignItems: 'center',
  },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  body: { flex: 1, padding: 16 },
  voiceSection: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  voiceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#f5f4ff',
    borderWidth: 1.5,
    borderColor: '#e8e6f8',
  },
  voiceBtnActive: {
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
  },
  voiceBtnIcon: { fontSize: 20 },
  voiceBtnText: { fontSize: 14, fontWeight: '600', color: '#7b68ee' },
  voiceBtnTextActive: { color: '#dc2626' },
  processingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  processingText: { fontSize: 13, color: '#7b68ee' },
  suggestions: {
    marginTop: 12,
    borderRadius: 10,
    backgroundColor: '#f5f4ff',
    padding: 12,
  },
  suggestionsTitle: { fontSize: 12, color: '#514b81', marginBottom: 8, fontWeight: '600' },
  suggestionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e8e6f8',
  },
  suggestionName: { fontSize: 14, color: '#090c1d', flex: 1 },
  suggestionSeverity: { fontSize: 12, color: '#7b68ee', fontWeight: '600' },
  field: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
  },
  label: { fontSize: 13, fontWeight: '600', color: '#514b81', marginBottom: 8 },
  input: {
    borderWidth: 1.5,
    borderColor: '#e8e6f8',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#090c1d',
    backgroundColor: '#fafafe',
  },
  inputFlex: { flex: 1 },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  inputMulti: { height: 80, paddingTop: 10 },
  aiBtn: {
    backgroundColor: '#7b68ee',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  aiBtnText: { fontSize: 12, color: '#fff', fontWeight: '600' },
  severityRow: { flexDirection: 'row', gap: 10 },
  severityBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  severityBtnText: { fontSize: 14, fontWeight: '700' },
  photoBtn: {
    borderWidth: 1.5,
    borderColor: '#e8e6f8',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  photoBtnIcon: { fontSize: 32 },
  photoBtnText: { fontSize: 14, color: '#7b68ee', fontWeight: '500' },
  photoPreview: { borderRadius: 12, overflow: 'hidden' },
  photoImg: { width: '100%', height: 200, borderRadius: 12 },
  photoRemove: {
    marginTop: 8,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: '#fef2f2',
    borderRadius: 8,
  },
  photoRemoveText: { fontSize: 13, color: '#dc2626' },
})
