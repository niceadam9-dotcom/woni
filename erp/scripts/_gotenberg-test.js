// Gotenberg 연결·변환 검증 (앱 컨테이너 런타임에서 실행)
// docker cp 후: docker exec erp-staging-app node /tmp/gtest.js
const base = process.env.GOTENBERG_URL || 'http://gotenberg-staging:3000'
;(async () => {
  // 1) health
  try {
    const h = await fetch(base + '/health')
    console.log('HEALTH', h.status)
  } catch (e) { console.log('HEALTH ERR', e.message); return }

  // 2) CSV -> PDF (LibreOffice route, lib/pdf.ts와 동일 계약)
  const csv = 'name,val\n소화기,1\n자탐,2\n'
  const fd = new FormData()
  fd.append('files', new Blob([csv], { type: 'text/csv' }), 'test.csv')
  try {
    const r = await fetch(base + '/forms/libreoffice/convert', { method: 'POST', body: fd })
    const buf = Buffer.from(await r.arrayBuffer())
    console.log('CONVERT status', r.status, 'bytes', buf.length, 'magic', JSON.stringify(buf.slice(0, 5).toString('latin1')))
    console.log(r.status === 200 && buf.slice(0, 5).toString('latin1') === '%PDF-' ? 'PDF_OK' : 'PDF_FAIL')
  } catch (e) { console.log('CONVERT ERR', e.message) }
})()
