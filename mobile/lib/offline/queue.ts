import AsyncStorage from '@react-native-async-storage/async-storage'
import type { SheetSaveConflict } from '@/lib/api'

/** 오프라인 큐 저장소 (C1 Phase D) — AsyncStorage 영속.
 *  수용 기준 「오프라인 입력 뒤 복귀 동기화 손실 0」의 저장 축:
 *  - 적재는 **동기화 성공 확인 후에만 제거**된다(at-least-once).
 *  - 서버 upsert가 (inspection_id, item_code, month) 유니크 위라 재전송은 무해(멱등).
 *  - 같은 (inspectionId, month)의 pending은 항목 단위로 머지한다(마지막 터치 승) —
 *    재생 횟수와 충돌 창을 줄인다. */

export type QueuedRow = {
  item_code: string
  result: 'O' | 'X' | 'N'
  memo: string | null
  base_updated_at: string | null
  /** 로컬에서 마지막으로 만진 시각 — 머지(마지막 터치 승)의 축 */
  editedAt: number
}

export type SheetSaveOp = {
  opId: string
  kind: 'sheet-save'
  createdAt: number
  tries: number
  lastError?: string
  payload: {
    inspectionId: string
    month: number
    rows: QueuedRow[]
    clearCodes: string[]
  }
}

/** 충돌 보관함 — flush 응답의 conflicts를 큐에서 분리 보관한다.
 *  큐에 남기면 같은 충돌로 영원히 재시도하고, 버리면 현장 입력이 사라진다(손실 0 위반). */
export type ConflictItem = {
  id: string
  inspectionId: string
  month: number
  item_code: string
  mine: { result: 'O' | 'X' | 'N' | null; memo: string | null }
  server: SheetSaveConflict['server']
  queuedAt: number
}

const QUEUE_KEY = 'offline:queue:v1'
const CONFLICTS_KEY = 'offline:conflicts:v1'
const LAST_SYNC_KEY = 'offline:lastSync:v1'

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try { await AsyncStorage.setItem(key, JSON.stringify(value)) } catch { /* 저장 실패 시 다음 쓰기가 복구 */ }
}

export async function readQueue(): Promise<SheetSaveOp[]> {
  return readJson<SheetSaveOp[]>(QUEUE_KEY, [])
}

export async function queueCount(): Promise<number> {
  return (await readQueue()).length
}

/** 점검표 저장 op 적재 — 같은 (inspectionId, month) pending과 항목 단위 머지(마지막 터치 승) */
export async function enqueueSheetSave(payload: {
  inspectionId: string
  month: number
  rows: QueuedRow[]
  clearCodes: string[]
}): Promise<void> {
  const queue = await readQueue()
  const existing = queue.find(op =>
    op.kind === 'sheet-save'
    && op.payload.inspectionId === payload.inspectionId
    && op.payload.month === payload.month)

  if (!existing) {
    queue.push({ opId: newId(), kind: 'sheet-save', createdAt: Date.now(), tries: 0, payload })
  } else {
    const byCode = new Map(existing.payload.rows.map(r => [r.item_code, r]))
    for (const r of payload.rows) {
      const prev = byCode.get(r.item_code)
      if (!prev || r.editedAt >= prev.editedAt) byCode.set(r.item_code, r)
    }
    const clears = new Set(existing.payload.clearCodes)
    for (const c of payload.clearCodes) clears.add(c)
    // 새로 값이 들어온 코드는 해제 목록에서 뺀다 / 새로 해제된 코드는 행에서 뺀다 — 서로소 유지
    for (const r of payload.rows) clears.delete(r.item_code)
    for (const c of payload.clearCodes) byCode.delete(c)
    existing.payload.rows = [...byCode.values()]
    existing.payload.clearCodes = [...clears]
    existing.tries = 0   // 내용이 바뀌었으니 재시도 카운터 초기화
    delete existing.lastError
  }
  await writeJson(QUEUE_KEY, queue)
}

export async function updateOp(op: SheetSaveOp): Promise<void> {
  const queue = await readQueue()
  const i = queue.findIndex(o => o.opId === op.opId)
  if (i >= 0) { queue[i] = op; await writeJson(QUEUE_KEY, queue) }
}

export async function removeOp(opId: string): Promise<void> {
  const queue = await readQueue()
  await writeJson(QUEUE_KEY, queue.filter(o => o.opId !== opId))
}

export async function readConflicts(): Promise<ConflictItem[]> {
  return readJson<ConflictItem[]>(CONFLICTS_KEY, [])
}

export async function addConflicts(
  op: SheetSaveOp,
  conflicts: SheetSaveConflict[],
): Promise<void> {
  const list = await readConflicts()
  const mineByCode = new Map(op.payload.rows.map(r => [r.item_code, r]))
  for (const c of conflicts) {
    const mine = mineByCode.get(c.item_code)
    list.push({
      id: newId(),
      inspectionId: op.payload.inspectionId,
      month: op.payload.month,
      item_code: c.item_code,
      mine: { result: mine?.result ?? null, memo: mine?.memo ?? null },
      server: c.server,
      queuedAt: op.createdAt,
    })
  }
  await writeJson(CONFLICTS_KEY, list)
}

export async function removeConflict(id: string): Promise<void> {
  const list = await readConflicts()
  await writeJson(CONFLICTS_KEY, list.filter(c => c.id !== id))
}

export async function setLastSyncAt(ts: number): Promise<void> {
  await writeJson(LAST_SYNC_KEY, ts)
}

export async function getLastSyncAt(): Promise<number | null> {
  return readJson<number | null>(LAST_SYNC_KEY, null)
}
