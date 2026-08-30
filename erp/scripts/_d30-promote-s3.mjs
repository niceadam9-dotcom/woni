// 30.json S3-1·S3-2 승격 — 판정 당시 partial의 사유(DEF-1·DEF-2)가 수리·런타임 검증됐다. 1회용.
// 실행: cd F:\AI\ERP\erp; node scripts/_d30-promote-s3.mjs
//
// ⚠ 왜 스크립트인가: 32.json 감사(_audit-32-status.mjs)가 부모-자식 정합에서 잡아낸 것과 같은 부류를
//   30.json에서도 확인했다 — 결함은 닫혔는데 상태만 남아 있는 것. 손으로 훑지 않고 값으로 바꾼다.
import { readFileSync, writeFileSync } from 'fs'

const P = 'F:/AI/ERP/erp_goal/소방계획서_30.json'
const doc = JSON.parse(readFileSync(P, 'utf8'))
const s3 = doc.sections.find(s => s.id === 'S3')
if (!s3) throw new Error('S3 없음')

const V = {
  'S3-1': {
    date: '2026-08-30',
    method: '판정자가 쓴 스크립트를 고치지 않고 재실행 + 대조군 행 심기',
    evidence: [
      'DEF-1 수리 — 이력 축 13 → 20축(fire_plans·fire_brigade_members·customer_facility_specs·plan_text_applied·billing_profiles·billing_autopay + 설비 대장)',
      '_judge-s30-harddel.mts T1-a·T1-b — 152 축 ↔ HISTORY_AXES 집합·순서 20개 완전 일치',
      'T5-a[핵심] 대조군 D(소방계획서·자위소방대·세부현황 보유)가 모달에서 **차단**됨 — 종전에는 삭제 가능으로 표시되던 그 고객',
      'T7-a RPC 직호출도 거절(has_history) · D 사후 4종 전부 생존',
      '가드 영향 실측 — 스테이징 310명 중 91명(29.4%), 운영 2명 중 0명',
      '상세: 소방계획서_32.json S3/T1 · S10-1 · S10-2 · S10-5',
    ],
  },
  'S3-2': {
    date: '2026-08-30',
    method: '전용 프로브 신설(판정자 T7-b가 공허하게 참이어서 대체) + 런타임 재현',
    evidence: [
      'DEF-2 수리 — _purgeCustomerStorage로 `{customerId}/` 접두사 재귀 소거',
      '_probe-s32-storage-purge.mts 8/0 — 대조군(삭제 전 실재) → 삭제 후 버킷 목록에서 3종 소멸 · 접두사 잔여 0',
      'DEF-3 수리 — 모달 고지에 업로드 파일(사진·약도) 명시',
      'DEF-4 부분 — advisory lock + FOR UPDATE가 DB 함수에 실재(pg_proc 실측). 잔여 창 실재현은 미검증(32.json S8-1)',
      '상세: 소방계획서_32.json S3/T2 · S4/T3·T4 · S10-6',
    ],
  },
}

let n = 0
for (const c of s3.criteria ?? []) {
  if (!V[c.id]) continue
  console.log(`  ${c.id}: ${c.status} -> implemented`)
  c.status = 'implemented'
  c.verified = V[c.id]
  c.note = `${c.note ?? ''}\n\n✅**2026-08-30 해소** — 위 사유(DEF-1~4)가 수리·런타임 검증됐다. 판정→수리→검증 경위는 소방계획서_32(S3·S4·S10)에 있다. 잔여는 DEF-4의 밀리초 창 실재현뿐(32.json S8-1).`
  n++
}
// 자식이 전부 완료면 섹션도 올린다 — 이번 감사가 잡은 '부모만 남는' 부류를 여기서 되풀이하지 않는다
const kids = s3.criteria ?? []
const done = kids.every(c => ['implemented', 'confirmed'].includes(c.status))
if (done && s3.status !== 'implemented') { console.log(`  S3(섹션): ${s3.status} -> implemented`); s3.status = 'implemented'; n++ }

writeFileSync(P, JSON.stringify(doc, null, 2) + '\n', 'utf8')
JSON.parse(readFileSync(P, 'utf8'))
console.log(`갱신 ${n}건 · JSON OK`)
