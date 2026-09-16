import { blankReport } from '../src/lib/fire-plan-blanks.ts'
import { FIRE_PLAN_MANIFEST as M } from '../src/lib/fire-plan-xlsx-manifest.ts'
const names = M.sheets.map(s => s.name)
let t = performance.now(); await blankReport(names, null); const first = performance.now() - t
t = performance.now(); await blankReport(names, null); const second = performance.now() - t
t = performance.now(); await blankReport(names, null); const third = performance.now() - t
console.log(`1회차 ${first.toFixed(0)}ms · 2회차 ${second.toFixed(0)}ms · 3회차 ${third.toFixed(0)}ms`)
