/** 직인 육안 확인 — 갑지 「공문」 시트만 남긴 xlsx에 직인(합성)을 앉히고 문구를 치환해 내보낸다. 실행: npx tsx --conditions=react-server scripts/_probe-seal-visual.mts <outDir> */
import { readFileSync, writeFileSync } from 'fs'
import JSZip from 'jszip'
import sharp from 'sharp'
import { normalizeSeal } from '../src/lib/company-seal-normalize'
import { embedFirePlanImages } from '../src/lib/fire-plan-xlsx-images'
import { personalizeWorkbook } from '../src/lib/xlsx-personalize'
import { removeSheets } from '../src/lib/xlsx-sheet-surgery'
import { reportWorkbookRules, sealPlacement, officialSignLine, OFFICIAL_SIGN_CELL } from '../src/lib/company-literals'
const out = process.argv[2]
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#fff"/>
  <rect x="140" y="140" width="520" height="520" rx="30" fill="none" stroke="#c81414" stroke-width="40"/>
  <text x="400" y="470" font-size="230" text-anchor="middle" fill="#c81414" font-family="Malgun Gothic">印</text></svg>`
const seal = await normalizeSeal(new Uint8Array(await sharp(Buffer.from(svg)).jpeg().toBuffer()))
const p = { company_name: '승진소방ENG', official_sender_name: '주식회사 승진소방ENG', representative: '김흥준', business_number: '586-86-00740', phone: '031-772-3019', fax: '031-772-2419', address: '경기도 양평군 양평읍 잿말길10번길 50-1', address_jibun: '경기도 양평군 양평읍 덕평리 98-1', management_reg_no: '경기양평 제2020-01호', official_rep_title: '대표이사' }
let b = new Uint8Array(readFileSync('templates/report-workbook-full.xlsx'))
const zip = await JSZip.loadAsync(b)
const names = [...(await zip.file('xl/workbook.xml')!.async('string')).matchAll(/<sheet [^>]*name="([^"]+)"/g)].map(m => m[1])
b = (await embedFirePlanImages(b, [{ sheet: OFFICIAL_SIGN_CELL.sheet, cell: OFFICIAL_SIGN_CELL.cell, data: seal.png, descr: '직인', place: sealPlacement(officialSignLine(p, true)) }])).bytes
b = (await personalizeWorkbook(b, reportWorkbookRules(p, { seal: true }))).bytes
// (removeSheets 결과는 LibreOffice가 못 연다 — 전체 통째로 내보낸다)
writeFileSync(`${out}/gongmun-full.xlsx`, b)
console.log('written', names.length, 'sheets → 공문 only')
