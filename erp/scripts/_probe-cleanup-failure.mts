// 소방계획서_18 X-1 — 삭제 **실패** 경로 검증 (Storage 실패를 경계에서 주입)
// 실행: npx tsx --conditions=react-server scripts/_probe-cleanup-failure.mts   (스테이징 DB)
//
// 고정하는 불변식: **파일을 다 지우지 못했으면 DB 행을 지우지 않는다.**
// 행을 먼저 지우면 fire_plan_attachments가 FK CASCADE(086)로 함께 사라져 파일이 영구 고아가 되고,
// 행이 없으면 다음 정리 대상에도 안 잡혀 재실행으로도 수렴하지 않는다.
//
// 실패를 만드는 법: Storage는 없는 키를 지워도 에러를 내지 않아(확인: _spike-storage-remove.mts)
// 데이터만으로는 실패를 만들 수 없다. 그래서 admin 클라이언트를 프록시로 감싸
// 지정한 경로에서만 remove가 에러를 반환하게 한다. DB 조작은 전부 진짜다 — 행이 실제로 남는지 본다.
// @ts-expect-error mjs 헬퍼 (시드 필수 컬럼·계정 생성 규약을 그대로 재사용)
import { raw, mkUser, delUser, mkCustomer, cleanupCustomer } from './_e2e-helpers.mjs'

const BUCKET = 'fire-plans'
const { runArchiveCleanup, listCleanupTargets } = await import('../src/lib/archive-cleanup.ts')

let pass = 0, fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** 특정 경로의 remove만 실패시키는 래퍼 — 나머지 동작은 그대로 진짜 클라이언트에 위임한다 */
function withFailingRemove(client: typeof raw, failPath: string) {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== 'storage') return Reflect.get(target, prop, receiver)
      const storage = target.storage
      return new Proxy(storage, {
        get(sTarget, sProp, sReceiver) {
          if (sProp !== 'from') return Reflect.get(sTarget, sProp, sReceiver)
          return (bucket: string) => {
            const api = sTarget.from(bucket)
            return new Proxy(api, {
              get(aTarget, aProp, aReceiver) {
                if (aProp !== 'remove') return Reflect.get(aTarget, aProp, aReceiver)
                return async (paths: string[]) => {
                  if (paths.includes(failPath)) {
                    return { data: null, error: { name: 'StorageApiError', message: '주입된 삭제 실패(프로브)' } }
                  }
                  return aTarget.remove(paths)
                }
              },
            })
          }
        },
      })
    },
  })
}

const TINY = Buffer.from('%PDF-1.4\n%probe\n%%EOF\n')
let customerId = ''
let userId = ''
const uploaded: string[] = []
const put = async (path: string) => {
  const { error } = await raw.storage.from(BUCKET).upload(path, TINY, { contentType: 'application/pdf', upsert: true })
  if (error) throw new Error(`업로드 실패 ${path}: ${error.message}`)
  uploaded.push(path)
}
const planIds = async () => {
  const { data } = await raw.from('fire_plans').select('id').eq('customer_id', customerId)
  return (data ?? []).map((r: { id: string }) => r.id)
}

try {
  // ── 시드: 최신본(보존) + 과거본(부속자료 보유) ──
  userId = await mkUser({ email: 'cleanup-fail-probe@erp-test.com', name: '실패프로브', employeeId: 'PB-FAIL' })
  customerId = await mkCustomer({ customer_name: '정리실패프로브고객', created_by: userId })

  const newPdf = `${customerId}/2026/keep.pdf`
  const oldPdf = `${customerId}/2025/old.pdf`
  const oldAtt = `${customerId}/att/old/map.png`
  await put(newPdf); await put(oldPdf); await put(oldAtt)

  const mk = async (year: number, title: string, pdf: string) => {
    const { data, error } = await raw.from('fire_plans').insert({
      customer_id: customerId, year, title, pdf_name: `${year}.pdf`, pdf_path: pdf, uploaded_by: userId,
    } as Record<string, unknown>).select('id').single()
    if (error) throw new Error(`계획서 시드 실패: ${error.message}`)
    return (data as { id: string }).id
  }
  await mk(2026, '최신본유지', newPdf)
  const oldId = await mk(2025, '과거본', oldPdf)
  await raw.from('fire_plan_attachments').insert({
    fire_plan_id: oldId, kind: '지도', file_name: 'map.png', file_path: oldAtt, uploaded_by: userId,
  } as Record<string, unknown>)

  // ── [1] 부속자료 삭제가 실패하면 행을 남겨야 한다 ──
  const pre = await listCleanupTargets(raw, customerId)
  const failing = withFailingRemove(raw, oldAtt)
  const res1 = await runArchiveCleanup(failing, customerId, userId, { printed: true, signature: pre.signature })

  check('실패 주입 — 액션 자체는 성공 반환(부분 실패 보고)', !!res1.data, res1.error ?? '')
  check('실패 주입 — 건너뜀으로 보고', (res1.data?.skipped ?? []).some(s => s.path.startsWith('fire_plans/')),
    JSON.stringify(res1.data?.skipped))
  check('실패 주입 — 계획서 행이 남는다(고아 방지 핵심)', (await planIds()).includes(oldId))
  const { data: attRows } = await raw.from('fire_plan_attachments').select('id').eq('fire_plan_id', oldId)
  check('실패 주입 — 부속자료 참조도 보존(CASCADE 미발동)', (attRows ?? []).length === 1)
  check('실패 주입 — 삭제된 것은 0건으로 집계', res1.data?.plansDeleted === 0, `plansDeleted=${res1.data?.plansDeleted}`)

  // ── [2] 원인이 사라지면 재실행으로 수렴해야 한다 ──
  const pre2 = await listCleanupTargets(raw, customerId)
  const res2 = await runArchiveCleanup(raw, customerId, userId, { printed: true, signature: pre2.signature })
  check('수렴 — 재실행 시 과거본 정리 완료', res2.data?.plansDeleted === 1, JSON.stringify(res2.data))
  check('수렴 — 과거본 행 삭제됨', !(await planIds()).includes(oldId))
  const { data: keepList } = await raw.storage.from(BUCKET).list(`${customerId}/2026`)
  check('수렴 — 최신본은 끝까지 보존', (keepList ?? []).some((f: { name: string }) => f.name === 'keep.pdf'))

  // ── [3] 게이트 — 확인값이 없으면 아무것도 지우지 않는다 ──
  const noPrint = await runArchiveCleanup(raw, customerId, userId, { signature: 'x' })
  check('게이트 — 인쇄 확인 없으면 거부', !!noPrint.error && !noPrint.data, noPrint.error ?? '')
  const noSig = await runArchiveCleanup(raw, customerId, userId, { printed: true })
  check('게이트 — 대상 지문 없으면 거부', !!noSig.error && !noSig.data, noSig.error ?? '')
} finally {
  const quiet = async (fn: () => Promise<unknown>) => { try { await fn() } catch { /* 무시 */ } }
  if (uploaded.length > 0) await quiet(() => raw.storage.from(BUCKET).remove(uploaded))
  if (customerId) {
    await quiet(() => raw.from('fire_plans').delete().eq('customer_id', customerId))
    await quiet(() => cleanupCustomer(customerId))
  }
  if (userId) await quiet(() => delUser(userId))
}

console.log(`\n${fail === 0 ? '✅' : '❌'} 정리 실패 경로 프로브 ${pass}/${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
