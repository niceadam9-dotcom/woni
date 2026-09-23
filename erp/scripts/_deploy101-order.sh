#!/usr/bin/env bash
# 101회차 — 사이드바 메뉴 순서 마커(새 문자열이 없어 개수 마커 불가 → 같은 청크 안 오프셋 맞교대, 95회차 방식)
# before: 고객 관리 < 점검 업무 < 점검 달력   after: 점검 달력 < 고객 관리 < 점검 업무
docker exec erp-app-1 node -e '
const fs=require("fs"),path=require("path");const hits=[]
function walk(d){for(const f of fs.readdirSync(d)){const p=path.join(d,f);const s=fs.statSync(p);if(s.isDirectory())walk(p);else if(p.endsWith(".js")){const t=fs.readFileSync(p,"utf8");
 const a=t.indexOf("label:\"고객 관리\""),b=t.indexOf("label:\"점검 업무\""),c=t.indexOf("label:\"점검 달력\"");
 if(a>=0&&b>=0&&c>=0)hits.push({f:p.replace("/app/.next/",""),cust:a,work:b,cal:c,order:[["고객",a],["업무",b],["달력",c]].sort((x,y)=>x[1]-y[1]).map(x=>x[0]).join("<")})}}}
walk("/app/.next");console.log(JSON.stringify(hits))'
