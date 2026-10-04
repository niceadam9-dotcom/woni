// 상담 신청 — 1단계는 서버 없이 메일 작성 창으로 넘긴다. 앱 API(sjfire.co.kr/api/…) 접수는 2단계에서.
var INQUIRY_TO = 'support@sjfirekorea.co.kr'

function sendInquiry(form) {
  var d = new FormData(form)
  var get = function (k) { return (d.get(k) || '').toString().trim() }
  var subject = '[홈페이지 상담] ' + (get('kind') || '문의') + ' — ' + get('name')
  var body = [
    '이름/회사명: ' + get('name'),
    '연락처: ' + get('phone'),
    '상담 분야: ' + get('kind'),
    get('place') ? '건물 소재지: ' + get('place') : '',
    get('msg') ? '\n' + get('msg') : '',
  ].filter(Boolean).join('\n')
  location.href = 'mailto:' + INQUIRY_TO + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body)
  return false
}
