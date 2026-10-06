/** 소방계획서 한글파일(HWPX) 서식 빌드 — 사용자 제공 양식에서 이전 작성분 흔적을 지운 깨끗한 서식을 만든다.
 *
 *  원천: `erp_goal/_Data/소방계획서-양식-2025.hwpx`(git 제외 — 표지 「리젠시빌」, 회사 담당자·병원·소방서
 *  전화 등 흔적이 있다). 빈 조립값(`buildFirePlanValues({ year })`)으로 **전 서식**을 한 번 채우면
 *  앵커 칸·흔적 칸이 모두 빈 서식 모양으로 덮인다(엑셀 서식 빌드와 같은 정리 기록 — manifest).
 *  산출: `templates/fire-plan-form.hwpx`(커밋 대상 — 도커 빌드에 실린다).
 *
 *  ⚠ 흔적 니들(manifest scrubNeedles + 표지 「리젠시빌」 + 표본 개정일)이 하나라도 남으면 실패한다.
 *  실행: npx tsx --conditions=react-server scripts/build-fire-plan-hwpx-template.mts */
import { readFileSync, writeFileSync } from 'node:fs'
import JSZip from 'jszip'
import { buildFirePlanValues } from '../src/lib/fire-plan-xlsx-values.ts'
import { fillFirePlanHwpx } from '../src/lib/fire-plan-hwpx.ts'
import { FIRE_PLAN_MANIFEST } from '../src/lib/fire-plan-xlsx-manifest.ts'
import type { FirePlanGenData } from '../src/lib/fire-plan-template.ts'

const SRC = new URL('../../erp_goal/_Data/소방계획서-양식-2025.hwpx', import.meta.url)
const OUT = new URL('../templates/fire-plan-form.hwpx', import.meta.url)
const NEEDLES = [...FIRE_PLAN_MANIFEST.scrubNeedles, '리젠시빌', '25.1.14']

const values = buildFirePlanValues({ year: 2026 } as unknown as FirePlanGenData)
const { bytes, stats } = await fillFirePlanHwpx(new Uint8Array(readFileSync(SRC)), values,
  FIRE_PLAN_MANIFEST.sheets.map(s => s.name))
if (stats.missingCell.length || stats.skippedNested.length) {
  console.error('칸 없음/중첩:', [...stats.missingCell, ...stats.skippedNested].join(' | ')); process.exit(1)
}
const zip = await JSZip.loadAsync(bytes)
const left: string[] = []
for (const name of ['Contents/section0.xml', 'Preview/PrvText.txt']) {
  const t = await zip.file(name)!.async('string')
  for (const n of NEEDLES) if (t.includes(n)) left.push(`${name}: ${n}`)
}
if (left.length) { console.error('🚨 흔적 남음:', left.join(' | ')); process.exit(1) }
writeFileSync(OUT, bytes)
console.log(`서식 ${decodeURIComponent(OUT.pathname)} — 쓴 칸 ${stats.written}·흔적 니들 ${NEEDLES.length}종 0건`)
