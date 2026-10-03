// 타입 위치에서만 쓴다 — 값으로 가져오면 server-only 모듈이 딸려 와 tsx 프로브가 annex-cover-official을 못 부른다
import type { createAdminClient } from '@/lib/supabase/admin'

/** 회사 직인 이미지 — 읽기 (통합 실행계획 C5 마무리, 2026-10-03 · 마이그 174)
 *
 *  비공개 버킷 `company-assets`에 두고 **서버(service role)만** 바이트로 읽는다(사용자 결정 — 위조 위험 자산).
 *  공개 URL을 만들지 않는다: PDF는 data URI로, 엑셀은 그림 파트로 문서 안에 굽는다.
 *  저장 쪽 정규화(바탕 투명·여백 제거, sharp)는 server-only인 lib/company-seal-normalize. */

type Admin = ReturnType<typeof createAdminClient>

export const SEAL_BUCKET = 'company-assets'

export type SealImage = { png: Uint8Array; width: number; height: number }

/** PNG 헤더(IHDR)에서 크기 — sharp 없이. PNG가 아니면 null */
export function pngSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  return { width: dv.getUint32(16), height: dv.getUint32(20) }
}

/** 문서 생성용 — 경로가 없으면 null(문서는 「(직인생략)」으로 나간다). 읽기 실패는 조용히 삼키지 않고
 *  note로 돌려 호출부가 missing·고지에 싣는다. */
export async function loadCompanySeal(admin: Admin, path: string | null | undefined): Promise<{ seal: SealImage | null; note?: string }> {
  if (!path) return { seal: null }
  const fail = (why: string) => ({ seal: null, note: `직인 이미지를 읽지 못해 (직인생략)으로 인쇄 — ${why}` })
  try {
    const { data, error } = await admin.storage.from(SEAL_BUCKET).download(path)
    if (error || !data) return fail(error?.message ?? '빈 응답')
    const png = new Uint8Array(await data.arrayBuffer())
    const size = pngSize(png)
    if (!size) return fail('PNG가 아님')
    return { seal: { png, ...size } }
  } catch (e) {
    return fail((e as Error).message)
  }
}

export const sealDataUri = (s: SealImage) => `data:image/png;base64,${Buffer.from(s.png).toString('base64')}`
