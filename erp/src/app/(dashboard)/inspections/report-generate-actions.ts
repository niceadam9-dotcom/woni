'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/auth'

/** 소방시설등점검표(엑셀) — **생성 폐지** (소방계획서_21 R5-6 / 소방계획서_7 D-9 실행, 2026-08-13)
 *
 *  없앤 것: generateOperationalReportAction · printOperationalReportAction ·
 *           buildOperationalReportBytes · lib/report-generator.ts (37시트 템플릿 주입기)
 *  대체: 별지 4호 PDF(HTML→Chromium 경로, lib/doc-templates/report4.ts)
 *
 *  폐지 전에 확인한 것 — R5-7 대조:
 *   · 엑셀에만 있던 점검항목 12건은 전부 **법정 실재 항목**이었고 마이그레이션 132·133으로 편입했다
 *     (원문 XML에 항목번호가 문장과 나란히 인쇄돼 있었다 — 우리가 만든 번호가 아니었다)
 *   · 펌프성능시험 실측치는 131로 자리를 만들어 별지 4호 표에 실린다
 *   · 내용 대조 결과 유실 0 (결과가 찍힌 24건 전부 별지 4호에 수록)
 *
 *  ⚠ 남긴 것 두 가지 — 둘 다 되돌릴 수 없는 것을 지키기 위해서다:
 *   1. **과거 생성물 다운로드**(아래 액션). 폐지 대상은 생성이지 이미 만들어 둔 기록이 아니다.
 *      실고객의 기존 xlsx가 Storage에 남아 있고, 이 경로가 없으면 거기 닿을 길이 사라진다.
 *   2. **Storage 템플릿 `templates/operational_v2026.xlsx`**. 스테이징 레이아웃 대조를 아직
 *      하지 않았으므로(사용자가 세운 게이트), 나중에 이 커밋을 revert하면 대조를 다시 할 수 있어야 한다.
 */

/** 생성 이력 파일 재다운로드 URL */
export async function getGeneratedReportUrlAction(reportId: string): Promise<{ error?: string; url?: string; fileName?: string }> {
  await requirePermission('inspection_register')
  const admin = createAdminClient()
  const { data } = await admin.from('generated_reports').select('xlsx_path, file_name').eq('id', reportId).single()
  if (!data) return { error: '파일을 찾을 수 없습니다.' }
  const r = data as { xlsx_path: string; file_name: string }
  const { data: signed, error } = await admin.storage.from('reports').createSignedUrl(r.xlsx_path, 300)
  if (error || !signed) return { error: 'URL 생성 실패' }
  return { url: signed.signedUrl, fileName: r.file_name }
}
