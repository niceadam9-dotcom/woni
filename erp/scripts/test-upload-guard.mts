// 업로드 가드 단위 테스트 (A2 2026-10-02) — lib/upload-guard가 확장자·크기·머리 바이트를 제대로 가르는가.
// 실행: npx tsx scripts/test-upload-guard.mts   (test-all.mts 등재)
import { checkImageUpload, sniffImageFormat, IMAGE_MAX_BYTES } from '../src/lib/upload-guard'

let fails = 0
function ok(cond: boolean, label: string) {
  console.log(`${cond ? '✅' : '❌'} ${label}`)
  if (!cond) fails++
}
function mkFile(name: string, bytes: number[] | Uint8Array, pad = 64): File {
  const head = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes)
  const body = new Uint8Array(Math.max(pad, head.length))
  body.set(head, 0)
  return new File([body], name)
}
const JPEG = [0xff, 0xd8, 0xff, 0xe0]
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const WEBP = [...'RIFF'].map(c => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBP'].map(c => c.charCodeAt(0)))
const GIF = [...'GIF89a'].map(c => c.charCodeAt(0))
const HEIC = [0, 0, 0, 0x18].concat([...'ftypheic'].map(c => c.charCodeAt(0)))
const EXE = [0x4d, 0x5a, 0x90, 0x00] // 'MZ'

// 1) 머리 바이트 판별
ok(sniffImageFormat(Uint8Array.from(JPEG)) === 'jpeg', 'sniff: JPEG')
ok(sniffImageFormat(Uint8Array.from(PNG)) === 'png', 'sniff: PNG')
ok(sniffImageFormat(Uint8Array.from(WEBP)) === 'webp', 'sniff: WebP')
ok(sniffImageFormat(Uint8Array.from(GIF)) === 'gif', 'sniff: GIF')
ok(sniffImageFormat(Uint8Array.from(HEIC)) === 'heif', 'sniff: HEIC')
ok(sniffImageFormat(Uint8Array.from(EXE)) === null, 'sniff: EXE → null')
ok(sniffImageFormat(new Uint8Array(0)) === null, 'sniff: 빈 버퍼 → null')

// 2) 통과 — 확장자와 내용이 맞는 파일
for (const [name, bytes, kind] of [
  ['a.jpg', JPEG, 'document'], ['a.JPEG', JPEG, 'document'], ['a.png', PNG, 'document'], ['a.webp', WEBP, 'document'],
  ['site.heic', HEIC, 'photo'], ['anim.gif', GIF, 'photo'],
] as const) {
  const r = await checkImageUpload(mkFile(name, bytes), kind)
  ok(r.ok, `통과: ${name} (${kind})`)
  if (r.ok) ok(r.contentType.startsWith('image/'), `  Content-Type 서버 결정: ${r.contentType}`)
}

// 3) 거절 — 위장·범위 밖·크기
const exeAsJpg = await checkImageUpload(mkFile('virus.jpg', EXE), 'photo')
ok(!exeAsJpg.ok && /내용/.test(exeAsJpg.ok ? '' : exeAsJpg.error), '거절: .exe를 .jpg로 위장 (머리 바이트)')
const pngAsJpg = await checkImageUpload(mkFile('x.jpg', PNG), 'document')
ok(!pngAsJpg.ok, '거절: PNG 내용인데 .jpg 확장자')
const heicDoc = await checkImageUpload(mkFile('a.heic', HEIC), 'document')
ok(!heicDoc.ok, '거절: document 종류에 HEIC')
const svg = await checkImageUpload(mkFile('a.svg', [...'<svg'].map(c => c.charCodeAt(0))), 'photo')
ok(!svg.ok, '거절: svg (허용목록 밖)')
const noExt = await checkImageUpload(mkFile('photo', JPEG), 'photo')
ok(!noExt.ok, '거절: 확장자 없음')
const empty = await checkImageUpload(new File([], 'a.jpg'), 'photo')
ok(!empty.ok, '거절: 0바이트')
const big = await checkImageUpload(mkFile('big.jpg', JPEG, IMAGE_MAX_BYTES + 1), 'photo')
ok(!big.ok && /MB/.test(big.ok ? '' : big.error), '거절: 10MB 초과')
const customCap = await checkImageUpload(mkFile('a.jpg', JPEG, 2048), 'document', 1024)
ok(!customCap.ok, '거절: 호출부 상한(1KB) 적용')

console.log(fails === 0 ? '\n✅ 업로드 가드 전건 통과' : `\n❌ 실패 ${fails}건`)
process.exit(fails === 0 ? 0 : 1)
