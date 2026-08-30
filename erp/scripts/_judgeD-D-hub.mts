import { ANCHORS } from "../src/lib/xlsx-anchors.ts"
const hub = ANCHORS.filter(a => a.sheet === "개요").map(a => a.cell)
console.log("HUB anchors " + hub.length)
for (const c of ["D21","G10","I9","J9","C21"]) console.log(c + " wired=" + hub.includes(c))
