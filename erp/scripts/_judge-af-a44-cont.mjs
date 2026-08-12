// 보조 프로브: 원문에서 '이음줄'(들여쓴 동명 줄) 전수를 뽑아 직전 문단이 설치장소인지 확인.
import fs from 'node:fs';
import path from 'node:path';

const sec = path.join(process.env.TEMP, 'j19hwpx', 'Contents', 'section0.xml');
const xml = fs.readFileSync(sec, 'utf8');
const paras = [];
const pRe = /<hp:p\b[\s\S]*?<\/hp:p>|<hp:p\b[^>]*\/>/g;
let m;
while ((m = pRe.exec(xml))) {
  let text = '';
  const tRe = /<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g;
  let t;
  while ((t = tRe.exec(m[0]))) text += t[1];
  paras.push(text.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
}
const out = [];
paras.forEach((p, i) => {
  if (p.includes('설치장소')) return;
  if (!p.includes('동명')) return;
  out.push(`idx=${i} prevHasLoc=${paras[i - 1]?.includes('설치장소')} | ${p.trim().slice(0, 90)}`);
  out.push(`   prev(${i - 1}) ${paras[i - 1]?.trim().slice(0, 90)}`);
});
out.push(`총 ${out.length / 2}개의 '설치장소 없는 동명 줄'`);
fs.writeFileSync(path.join(process.env.TEMP, 'a44cont.txt'), out.join('\n'), 'utf8');
console.log('done', out.length / 2);
