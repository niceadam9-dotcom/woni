/** 대조군 — 체크박스를 **달지 않은** 워크북(같은 주입까지만). 「저 띠가 원래 있던 것인가」를 가른다. */
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { injectWorkbook } from "../src/lib/xlsx-inject.ts"
import { labelAt } from "../src/lib/fire-plan-xlsx-manifest.ts"
const HERE = import.meta.dirname
const S14 = "1.4 소방시설 현황"
const ON = ["J3", "J5", "AJ7", "J13", "J19", "AJ19", "J24"]
const bytes = new Uint8Array(await readFile(path.join(HERE, "..", "templates", "fire-plan-workbook.xlsx")))
const injected = await injectWorkbook(bytes, ON.map(cell => ({ sheet: S14, cell, value: labelAt(S14, cell).replace(/[□☐]/, "■") })))
if (injected.missed.length) throw new Error("주입 미착지")
const out = path.join(process.env.TEMP ?? "/tmp", "fireplan-nocb.xlsx")
await writeFile(out, Buffer.from(injected.bytes))
console.log("대조군 작성: " + out)
