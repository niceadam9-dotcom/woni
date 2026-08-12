// 판정 프로브: 별지9호 원문(hwpx)에서 '설치장소' 줄이 2줄인 블록 집합을 추출한다.
// 사전: hwpx를 %TEMP%/j19hwpx 에 풀어둘 것. 결과는 %TEMP%/a44form.txt (UTF-8).
import fs from 'node:fs';
import path from 'node:path';

const sec = path.join(process.env.TEMP, 'j19hwpx', 'Contents', 'section0.xml');
const xml = fs.readFileSync(sec, 'utf8');

const paras = [];
const pRe = /<hp:p\b[\s\S]*?<\/hp:p>|<hp:p\b[^>]*\/>/g;
let m;
while ((m = pRe.exec(xml))) {
  const chunk = m[0];
  let text = '';
  const tRe = /<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g;
  let t;
  while ((t = tRe.exec(chunk))) text += t[1];
  text = text
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  paras.push(text);
}

const out = [];
out.push(`문단 총 ${paras.length}`);

// '설치장소' 문단마다 (a) 직전 최근 설비 라벨, (b) 다음 문단이 이음줄(2줄째)인지 판정
const isCont = (s) => {
  if (!s) return false;
  if (s.includes('설치장소')) return false;
  // 이음줄: 앞이 공백으로 들여쓰기 + 동명( 또는 ( ) 반복 구조
  return /^[\s ]{4,}/.test(s) && (s.includes('동명') || s.includes('( )') || /\(\s*\)/.test(s));
};

const labelOf = (i) => {
  for (let j = i - 1; j >= 0; j--) {
    const s = paras[j].trim();
    if (!s) continue;
    if (s.includes('설치장소')) continue;
    if (s.startsWith('※') || s.startsWith('◦') || s.startsWith('○')) continue;
    return `${j}:${s.slice(0, 60)}`;
  }
  return '?';
};

let two = 0, one = 0;
paras.forEach((p, i) => {
  if (!p.includes('설치장소')) return;
  const cont = isCont(paras[i + 1]);
  if (cont) two++; else one++;
  out.push('');
  out.push(`[${cont ? '2줄' : '1줄'}] idx=${i}`);
  out.push(`  label  ${labelOf(i)}`);
  out.push(`  line1  ${p.trim()}`);
  if (cont) out.push(`  line2  ${paras[i + 1].trim()}`);
});

out.push('');
out.push(`요약: 설치장소 문단 ${two + one}개 = 2줄 ${two} / 1줄 ${one}`);
fs.writeFileSync(path.join(process.env.TEMP, 'a44form.txt'), out.join('\n'), 'utf8');
console.log(`2LINE=${two} ONELINE=${one}`);
