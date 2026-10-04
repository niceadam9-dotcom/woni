import { NextRequest, NextResponse } from 'next/server'
import { requireMobileUser, canTouchInspection } from '@/lib/mobile-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { addDefectCore, attachDefectPhotoCore, type DefectSeverity } from '@/app/(dashboard)/inspections/defect-save-core'

/** 모바일 불량 등록 (+사진) — C1 Phase E, 2026-10-04
 *
 *  웹 addDefectAction·uploadDefectPhotoAction과 **같은 코어**(defect-save-core.ts)를 탄다 —
 *  단계 동기화·사진 경로 저장(공개 URL 금지)·업로드 가드가 한 벌이다.
 *  proxy.ts가 `/api/mobile/`을 통과시키므로 **첫 줄에서 requireMobileUser**(규약).
 *
 *  멱등(오프라인 큐 at-least-once): `client_key`가 필수다. 같은 (점검, 키)가 이미 있으면 새로
 *  넣지 않고 그 행을 돌려준다(마이그 180 부분 유니크). 사진은 **아직 없을 때만** 붙인다 —
 *  불량은 들어갔는데 사진 업로드에서 끊긴 경우, 재전송이 사진만 마저 올린다.
 *
 *  multipart/form-data: inspectionId · clientKey · defectName · defectDetail? · severity? ·
 *  defectCode? · photo?(File) */

const SEVERITIES = new Set<DefectSeverity>(['경미', '보통', '중대'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/

export async function POST(req: NextRequest) {
  // proxy가 /api/mobile/을 통과시킨다 — 인증은 여기서(lib/mobile-auth)
  const auth = await requireMobileUser(req)
  if ('response' in auth) return auth.response
  let form: FormData
  try { form = await req.formData() } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 })
  }

  const str = (k: string) => { const v = form.get(k); return typeof v === 'string' ? v.trim() : '' }
  const inspectionId = str('inspectionId')
  const clientKey = str('clientKey')
  const defectName = str('defectName')
  const defectDetail = str('defectDetail') || null
  const defectCode = str('defectCode') || null
  const severityRaw = str('severity') || '보통'
  const photo = form.get('photo')

  if (!UUID_RE.test(inspectionId)) return NextResponse.json({ error: '점검 건 id가 필요합니다.' }, { status: 400 })
  if (!KEY_RE.test(clientKey)) return NextResponse.json({ error: '등록 키가 올바르지 않습니다.' }, { status: 400 })
  if (!defectName) return NextResponse.json({ error: '불량항목명을 입력해주세요.' }, { status: 400 })
  if (!SEVERITIES.has(severityRaw as DefectSeverity)) return NextResponse.json({ error: '등급은 경미·보통·중대 중 하나입니다.' }, { status: 400 })

  if (!(await canTouchInspection(inspectionId, auth.userId))) {
    return NextResponse.json({ error: '이 점검에 불량을 등록할 권한이 없습니다.' }, { status: 403 })
  }

  const admin = createAdminClient()
  const added = await addDefectCore(admin, auth.userId, {
    inspectionId, defectCode, defectName, defectDetail,
    severity: severityRaw as DefectSeverity, clientKey,
  }, 'route')
  if (added.error || !added.id) return NextResponse.json({ error: added.error ?? '불량 등록에 실패했습니다.' }, { status: 500 })

  // 사진 — 있고, 그 불량에 아직 사진이 없을 때만(재전송이 사진을 중복으로 올리지 않게)
  let photoAttached = !!added.photoUrl
  if (photo instanceof File && photo.size > 0 && !added.photoUrl) {
    const att = await attachDefectPhotoCore(admin, { inspectionId, defectId: added.id, file: photo, field: 'before' }, 'route')
    if (att.error && att.retryable) {
      // 불량은 저장됐다 — 앱이 같은 키로 다시 보내면 사진만 마저 붙는다(손실 0)
      return NextResponse.json({ error: att.error, defectId: added.id, photoPending: true }, { status: 502 })
    }
    if (att.error) {
      // 형식·크기 거절 — 다시 보내도 같다. 불량은 저장됐으니 성공으로 돌려주고 사진 거절만 알린다
      return NextResponse.json({ defectId: added.id, existed: added.existed ?? false, photoAttached: false, photoRejected: att.error })
    }
    photoAttached = true
  }

  return NextResponse.json({ defectId: added.id, existed: added.existed ?? false, photoAttached })
}
