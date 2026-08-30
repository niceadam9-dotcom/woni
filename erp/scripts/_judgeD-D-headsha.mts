import { execFileSync } from "node:child_process"
import crypto from "node:crypto"
const git = "F:\\AI\\tools\\MinGit\\cmd\\git.exe"
for (const rev of ["HEAD", "1f19a09"]) {
  const buf = execFileSync(git, ["-C", "F:\\AI\\ERP", "cat-file", "blob", rev + ":erp/templates/report-workbook-full.xlsx"], { maxBuffer: 1 << 28 })
  console.log(rev + " sha256=" + crypto.createHash("sha256").update(buf).digest("hex") + " bytes=" + buf.length)
}
