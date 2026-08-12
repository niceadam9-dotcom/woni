// 보조 프로브: 구현자가 근거로 삼은 _별지4호_현행판_추출.txt에서 설치장소 2줄 블록을 센다.
import fs from 'node:fs';
import path from 'node:path';

const p = 'F:/AI/ERP/erp_goal/_form/_별지4호_현행판_추출.txt';
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
const out = [];
let two = 0, one = 0;
const isCont = (s) => !!s && !s.includes('설치장소') && /^[\s:·]{1,}/.test(s) && s.includes('동명');
const labelOf = (i) => {
  for (let j = i - 1; j >= 0; j--) {
    const s = lines[j].trim();
    if (!s || s.includes('설치장소')) continue;
    return `${j}:${s.slice(0, 50)}`;
  }
  return '?';
};
lines.forEach((l, i) => {
  if (!l.includes('설치장소')) return;
  const cont = isCont(lines[i + 1]);
  if (cont) two++; else one++;
  if (cont) {
    out.push(`[2줄] ${i} label=${labelOf(i)}`);
    out.push(`   L1 ${l.trim().slice(0, 90)}`);
    out.push(`   L2 ${lines[i + 1].trim().slice(0, 90)}`);
  }
});
out.push('');
out.push(`설치장소 라인 ${two + one} = 2줄 ${two} / 1줄 ${one}`);
out.push(`'화재알림' 등장 ${lines.filter(l => l.includes('화재알림')).length}회`);
out.push(`'자동화재탐지' 등장 ${lines.filter(l => l.includes('자동화재탐지')).length}회`);
out.push(`'접속단자' 라인: ${lines.filter(l => l.includes('접속단자')).map(l => l.trim()).join(' || ')}`);
fs.writeFileSync(path.join(process.env.TEMP, 'a44hwp.txt'), out.join('\n'), 'utf8');
console.log('2LINE=' + two, 'ONE=' + one);
