// C5 프로브 — companyIssuer()가 종전 공문 인라인 규칙과 같은 값을 내는가 (스테이징 회사정보 + 경계 사례)
// 실행: npx tsx --conditions=react-server scripts/_probe-c5-issuer.mts
// .env.local → process.env (공개 저장소라 키는 파일에서만) — 그 뒤에 모듈을 불러야 admin 클라이언트가 URL을 본다
import { readFileSync } from 'fs'
for (const l of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=')
  if (i > 0 && !l.startsWith('#')) process.env[l.slice(0, i).trim()] ??= l.slice(i + 1).trim()
}
const { getCompanyProfile, companyIssuer } = await import('../src/lib/company-profile')

type P = Parameters<typeof companyIssuer>[0]
const old = (c: P) => ({
  name: (c?.official_sender_name ?? '').trim() || (c?.company_name ?? ''),
  title: (c?.official_rep_title ?? '').trim() || '대표이사',
  rep: c?.representative ?? '',
})
let fail = 0
const cmp = (label: string, c: P) => {
  const a = old(c), b = companyIssuer(c)
  // 공문 signBlock은 name·rep을 trim해서 쓰므로 trim 뒤 같으면 인쇄가 같다
  const same = a.name.trim() === b.name && a.title === b.title && a.rep.trim() === b.rep
  console.log(`${same ? '✅' : '❌'} ${label}`)
  if (!same) { fail++; console.log('   old', a, 'new', b) }
}
const real = await getCompanyProfile()
cmp('스테이징 실제 회사정보', real)
cmp('null(미등록)', null)
cmp('발신 명의 비움 → 회사명', { company_name: '테스트소방', official_sender_name: '', official_rep_title: null, representative: '홍길동' })
cmp('직함 공백 → 대표이사', { company_name: 'A', official_sender_name: '주식회사 A', official_rep_title: '  ', representative: null })
cmp('앞뒤 공백', { company_name: ' B ', official_sender_name: null, official_rep_title: '사장', representative: ' 김 ' })
const r = companyIssuer(real)
console.log('스테이징 증명서 하단(가림):', r.name ? `${r.name.slice(0, 3)}… / ${r.title} ${r.rep ? r.rep.slice(0, 1) + '**' : '(대표자 없음)'}` : '(미등록)')
process.exit(fail ? 1 : 0)
