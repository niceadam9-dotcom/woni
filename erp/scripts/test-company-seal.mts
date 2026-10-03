// 직인(174) 단위 테스트 (통합 실행계획 C5 마무리, 2026-10-03) — 서버·DB 불필요
// 실행: npx tsx --conditions=react-server scripts/test-company-seal.mts   (test-all 등재 — sharp·server-only 모듈)
//
// 고정하는 것:
//  [1] 정규화 — 흰 바탕 JPEG가 바탕 투명 PNG로(글자를 가리는 흰 사각형 방지)·여백 제거·장변 600 이하·빈 그림 거절
//  [2] PDF 공문 — 직인 있으면 이름 끝에 <img>·「(직인생략)」 없음 / 없으면 종전 문구 / 대표자 없으면 직인도 없음
//  [3] 갑지 엑셀 「공문」 — A34 명의 둘레에 투명 PNG 그림 1장, drawing 파트·rels·Content_Types(png)·태그 순서
//  [4] pngSize — 헤더에서 크기, PNG 아니면 null
import { readFileSync } from 'fs'
import JSZip from 'jszip'
import sharp from 'sharp'
import { normalizeSeal } from '../src/lib/company-seal-normalize'
import { pngSize, sealDataUri } from '../src/lib/company-seal'
import { renderOfficial, type OfficialData } from '../src/lib/doc-templates/official'
import { embedFirePlanImages } from '../src/lib/fire-plan-xlsx-images'
import { sealPlacement, OFFICIAL_SIGN_CELL } from '../src/lib/company-literals'

let pass = 0, fail = 0
const ok = (c: boolean, m: string, d = '') => { console.log(`  ${c ? '✅' : '❌'} ${m}${!c && d ? ` — ${d}` : ''}`); c ? pass++ : fail++ }

// 흰 종이(1200×900)에 붉은 원 직인을 찍은 JPEG — 촬영본 흉내
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="#fbfbfb"/>
  <circle cx="600" cy="450" r="200" fill="none" stroke="#d01010" stroke-width="28"/><rect x="520" y="380" width="160" height="140" fill="#d01010"/></svg>`
const jpeg = new Uint8Array(await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer())

console.log('── [1] 정규화 ──')
const seal = await normalizeSeal(jpeg)
const meta = await sharp(seal.png).metadata()
ok(meta.format === 'png' && meta.hasAlpha === true, '[1] PNG + 알파 채널', `${meta.format} alpha=${meta.hasAlpha}`)
ok(Math.max(seal.width, seal.height) <= 600, '[1] 장변 600 이하', `${seal.width}×${seal.height}`)
ok(seal.width < 1200 * 0.5 && Math.abs(seal.width - seal.height) <= 4, '[1] 바탕 여백 제거(원만 남아 정사각에 가깝다)', `${seal.width}×${seal.height}`)
{
  const { data, info } = await sharp(seal.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const at = (x: number, y: number) => data[(y * info.width + x) * 4 + 3]
  ok(at(0, 0) === 0 && at(info.width - 1, info.height - 1) === 0, '[1] 모서리(바탕) 투명')
  const mid = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4
  ok(data[mid + 3] === 255 && data[mid] > 150 && data[mid + 1] < 80, '[1] 가운데(인영) 붉고 불투명', `rgba=${[...data.slice(mid, mid + 4)]}`)
}
let blankErr = ''
try { await normalizeSeal(new Uint8Array(await sharp({ create: { width: 50, height: 50, channels: 3, background: '#ffffff' } }).png().toBuffer())) }
catch (e) { blankErr = (e as Error).message }
ok(blankErr.includes('보이는 부분이 없습니다'), '[1] 전부 흰 그림은 거절', blankErr)

console.log('\n── [4] pngSize ──')
ok(JSON.stringify(pngSize(seal.png)) === JSON.stringify({ width: seal.width, height: seal.height }), '[4] 헤더 크기 = 정규화 결과')
ok(pngSize(jpeg) === null, '[4] JPEG → null')

console.log('\n── [2] PDF 공문 ──')
const base: OfficialData = {
  company: { name: '㈜한빛방재', address: '서울', phone: '02-1', fax: '' }, docNo: '한빛 2610-1', sendDate: '2026년 10월',
  recipient: '건물', reference: '관계인', sender: '㈜한빛방재', year: 2026, typeLabel: '작동점검',
  senderSign: { name: '주식회사 한빛방재', title: '대표이사', rep: '이도윤' },
}
const withSeal = renderOfficial({ ...base, senderSign: { ...base.senderSign, seal: sealDataUri(seal) } })
ok(withSeal.includes('class="of-seal"') && withSeal.includes('data:image/png;base64,'), '[2] 직인 <img> 실림')
ok(!withSeal.includes('직인생략') && withSeal.includes('대표이사 이도윤<img'), '[2] 「(직인생략)」 없음·이름 바로 뒤 직인')
const noSeal = renderOfficial(base)
ok(noSeal.includes('대표이사 이도윤(직인생략)') && !noSeal.includes('of-seal"'), '[2] 직인 없음 → 종전 문구')
const noRep = renderOfficial({ ...base, senderSign: { ...base.senderSign, rep: '', seal: sealDataUri(seal) } })
ok(!noRep.includes('<img class="of-seal"') && !noRep.includes('직인생략'), '[2] 대표자 없음 → 상호 한 줄, 직인 없음')

console.log('\n── [3] 갑지 엑셀 「공문」 ──')
const tpl = new Uint8Array(readFileSync('templates/report-workbook-full.xlsx'))
const r = await embedFirePlanImages(tpl, [{ sheet: OFFICIAL_SIGN_CELL.sheet, cell: OFFICIAL_SIGN_CELL.cell, data: seal.png, descr: '직인', place: sealPlacement('대표이사 김흥준') }])
ok(r.placed === 1 && r.notes.length === 0, '[3] 1장 앉음', `${r.placed} ${r.notes.join(' / ')}`)
const zip = await JSZip.loadAsync(r.bytes)
const sheet = await zip.file('xl/worksheets/sheet13.xml')!.async('string')
const rid = /<drawing r:id="(rId\d+)"\/>/.exec(sheet)?.[1]
ok(!!rid, '[3] 공문 시트에 <drawing> 태그')
ok(sheet.indexOf('<drawing ') > sheet.indexOf('</sheetData>') && sheet.indexOf('<drawing ') < sheet.indexOf('</worksheet>'), '[3] 태그가 sheetData 뒤·worksheet 끝 앞')
const rels = await zip.file('xl/worksheets/_rels/sheet13.xml.rels')?.async('string') ?? ''
const target = new RegExp(`Id="${rid}"[^>]*Target="\\.\\./drawings/([^"]+)"`).exec(rels)?.[1]
ok(!!target, '[3] 시트 rels → drawing', rels.slice(0, 200))
const drawing = target ? await zip.file(`xl/drawings/${target}`)!.async('string') : ''
const media = /Target="\.\.\/media\/([^"]+\.png)"/.exec(await zip.file(`xl/drawings/_rels/${target}.rels`)?.async('string') ?? '')?.[1]
ok(!!media && zip.file(`xl/media/${media}`) !== null, '[3] 그림 파트는 .png(투명 유지)', media ?? '')
ok(media ? Buffer.from(await zip.file(`xl/media/${media}`)!.async('uint8array')).equals(Buffer.from(seal.png)) : false, '[3] 재인코딩 없이 원본 PNG 그대로')
const ct = await zip.file('[Content_Types].xml')!.async('string')
ok(/<Default Extension="png" ContentType="image\/png"\/>/.test(ct) && ct.includes(`PartName="/xl/drawings/${target}"`), '[3] Content_Types — png Default·drawing Override')
const from = /<xdr:from><xdr:col>(\d+)<\/xdr:col><xdr:colOff>(\d+)<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row><xdr:rowOff>(\d+)<\/xdr:rowOff><\/xdr:from><xdr:ext cx="(\d+)" cy="(\d+)"/.exec(drawing)
ok(!!from && Number(from[5]) === 60 * 9525 && Number(from[6]) === 60 * 9525, '[3] 크기 60px', from?.slice(1).join(','))
// A34(0-based row 33)는 22.35pt≈30px — 60px 직인을 행 가운데에 걸치면 위 행(32)에서 시작한다
ok(!!from && Number(from[3]) === 32, '[3] 행 가운데 걸침 — 위 행(33행)에서 시작', from?.[3])
// 글자 오른쪽 끝 근처 — A34:I34 가운데보다 오른쪽 열(E~G, 0-based 4~6)에서 시작
ok(!!from && Number(from[1]) >= 4 && Number(from[1]) <= 6, '[3] 이름 끝 쪽 열(E~G)에서 시작', from?.[1])

console.log(fail === 0 ? `\n✅ 직인 전건 통과 (${pass})` : `\n❌ 실패 ${fail}건 / 통과 ${pass}`)
process.exit(fail ? 1 : 0)
