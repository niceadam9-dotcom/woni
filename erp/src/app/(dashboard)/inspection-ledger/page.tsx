import { redirect } from 'next/navigation'

/** 구 경로 — 점검 대장은 고객 관리 탭으로 흡수됐다 (소방계획서_21 R8-3).
 *  customers를 통째로 읽는 뷰라 고객 관리와 원천이 같아 /customers/ledger로 옮겼다.
 *  북마크·기존 E2E(test-perms·test-report-s5b·_smoke-ledger)가 이 경로를 쓰므로 리다이렉트로 남긴다. */
export default async function InspectionLedgerRedirectPage() {
  redirect('/customers/ledger')
}
