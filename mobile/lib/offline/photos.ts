import * as FileSystem from 'expo-file-system/legacy'
import { Platform } from 'react-native'

/** 오프라인 큐용 사진 보관 (C1 Phase E).
 *  카메라·앨범이 주는 URI는 캐시 폴더라 OS가 언제든 지울 수 있다 — 큐가 지하에서 며칠 기다리는
 *  사이 사진이 사라지면 그게 손실이다. 문서 폴더로 복사해 두고, 서버 전송이 끝나면 지운다. */

const DIR = `${FileSystem.documentDirectory ?? ''}defect-photos/`

export async function persistPhoto(uri: string, clientKey: string): Promise<string> {
  // 웹(개발 확인용)은 파일 시스템이 없다 — 원래 URI를 그대로 쓴다
  if (Platform.OS === 'web' || !FileSystem.documentDirectory) return uri
  const info = await FileSystem.getInfoAsync(DIR)
  if (!info.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true })
  const ext = (uri.split('?')[0].split('.').pop() ?? 'jpg').toLowerCase()
  const dest = `${DIR}${clientKey}.${ext}`
  await FileSystem.copyAsync({ from: uri, to: dest })
  return dest
}

export async function removePhoto(path: string | null): Promise<void> {
  if (!path || Platform.OS === 'web' || !path.startsWith(DIR)) return   // 보관 폴더 밖은 건드리지 않는다
  try { await FileSystem.deleteAsync(path, { idempotent: true }) } catch { /* 남아도 손실은 아니다 */ }
}
