import { AppState, type AppStateStatus } from 'react-native'
import * as Network from 'expo-network'
import { saveSheetResponses, addDefectMobile } from '@/lib/api'
import {
  readQueue, updateOp, removeOp, addConflicts, queueCount,
  readConflicts, setLastSyncAt, type DefectAddOp,
} from './queue'
import { removePhoto } from './photos'

/** 오프라인 큐 flush (C1 Phase D).
 *  트리거: 앱 시작 · 네트워크 연결 이벤트 · 포그라운드 복귀 · 수동(프로필 탭).
 *  원칙:
 *  - FIFO 순차, **서버가 성공을 돌려준 op만 제거**(at-least-once + 서버 멱등 = 손실 0).
 *  - 연결 이벤트는 힌트일 뿐이다 — 진실은 flush의 성공 여부(기내모드 해제 직후 오탐 대비).
 *  - 네트워크 실패면 그 자리에서 중단(뒤 op도 실패할 것) — 큐는 그대로 남는다.
 *  - conflicts는 보관함으로 분리(사용자 확인 대기) — 큐에 남기면 무한 재시도, 버리면 손실. */

let flushing = false
const listeners = new Set<() => void>()

/** 큐·충돌 수가 바뀔 때 화면 갱신용 — 프로필 탭·점검표 화면이 구독한다 */
export function onSyncChanged(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
function emit() { for (const cb of listeners) cb() }

export type FlushResult = { sent: number; conflicted: number; remaining: number; offline: boolean }

export async function flushQueue(): Promise<FlushResult> {
  if (flushing) return { sent: 0, conflicted: 0, remaining: await queueCount(), offline: false }
  flushing = true
  let sent = 0
  let conflicted = 0
  let offline = false
  try {
    const ops = await readQueue()
    for (const op of ops) {
      if (op.kind === 'defect-add') {
        const r = await sendDefect(op)
        if (r === 'offline') { offline = true; break }
        if (r === 'retry') break
        sent += 1
        continue
      }
      const res = await saveSheetResponses({
        inspectionId: op.payload.inspectionId,
        month: op.payload.month,
        rows: op.payload.rows.map(r => ({
          item_code: r.item_code, result: r.result, memo: r.memo, base_updated_at: r.base_updated_at,
        })),
        clearCodes: op.payload.clearCodes,
      })
      if (res.offline) {
        // 아직 오프라인 — 큐 보존, 다음 트리거가 재시도한다
        offline = true
        await updateOp({ ...op, tries: op.tries + 1, lastError: '네트워크 없음' })
        break
      }
      if (res.error) {
        // 서버 오류 — 보존하고 중단(연속 실패 폭주 방지). 다음 트리거가 재시도.
        await updateOp({ ...op, tries: op.tries + 1, lastError: res.error })
        break
      }
      // 성공 — 충돌분은 보관함으로 분리한 뒤 op 제거(여기서만 제거한다)
      if (res.conflicts && res.conflicts.length > 0) {
        await addConflicts(op, res.conflicts)
        conflicted += res.conflicts.length
      }
      await removeOp(op.opId)
      sent += 1
    }
    if (sent > 0) await setLastSyncAt(Date.now())
  } finally {
    flushing = false
    emit()
  }
  return { sent, conflicted, remaining: await queueCount(), offline }
}

/** 불량 op 하나 전송. 'done' = 큐에서 뺐다 · 'offline'/'retry' = 보존하고 중단.
 *  같은 clientKey 재전송은 서버가 기존 행을 돌려준다 — 끊겼다 다시 보내도 중복 0.
 *  입력 오류(400류)는 다시 보내도 같아 큐에서 뺀다 — 이름·등급 필수는 등록 화면이 먼저 거른다. */
async function sendDefect(op: DefectAddOp): Promise<'done' | 'offline' | 'retry'> {
  const p = op.payload
  const res = await addDefectMobile({
    inspectionId: p.inspectionId, clientKey: p.clientKey, defectName: p.defectName,
    defectDetail: p.defectDetail, severity: p.severity, photoUri: p.photoPath,
  })
  if (res.offline) {
    await updateOp({ ...op, tries: op.tries + 1, lastError: '네트워크 없음' })
    return 'offline'
  }
  if (res.error && res.retryable) {
    await updateOp({ ...op, tries: op.tries + 1, lastError: res.error })
    return 'retry'
  }
  // 성공(새로 들어갔거나 이미 있었거나) 또는 영구 거절 — 큐에서 빼고 보관 사진을 지운다
  await removeOp(op.opId)
  await removePhoto(p.photoPath)
  return 'done'
}

/** 동기화 트리거 설치 — (app)/_layout이 마운트 시 한 번 부른다 */
export function startSyncTriggers(): () => void {
  flushQueue()   // 앱 시작

  const appSub = AppState.addEventListener('change', (s: AppStateStatus) => {
    if (s === 'active') flushQueue()
  })
  const netSub = Network.addNetworkStateListener(state => {
    if (state.isConnected) flushQueue()
  })
  return () => {
    appSub.remove()
    netSub.remove()
  }
}

/** 현재 온라인 추정 — 배너 표시용 힌트(진실은 flush 성공 여부) */
export async function isOnline(): Promise<boolean> {
  try {
    const s = await Network.getNetworkStateAsync()
    return s.isConnected === true
  } catch { return true }   // 판정 불가면 온라인으로 가정 — 저장 시도가 진실을 알려준다
}

export { queueCount, readConflicts }
