/** 달력 단계 사이드바의 버튼·문서 칸 모양 — **한 벌** (2026-09-23 사용자 요청 image-14 → image-15
 *  「동일한 패턴으로」「입력하기 버튼도 너무 크고 — 버튼 사이즈도 동일하게」「사이드바 한눈에·스크롤 없이」).
 *
 *  ⚠ 사이드바의 **모든 버튼**(단계 [배치확인서]·[사유 완료], 문서 [보고서 엑셀]·[입력])이 이 두 클래스를 쓴다.
 *    각자 적으면 한쪽만 커져 다시 어긋난다(image-15: 문서 칸만 h-form-8·큰 글씨라 단계 버튼과 달랐다).
 *  색 규칙: **칠한 보라 = 들어가서 입력** · **테두리 = 받기·확정 같은 보조**.
 *  높이는 h-form-7(글자 배율을 탄다) — 고정 px면 큰 배율에서 글자가 버튼 밖으로 나온다. */
const PANEL_BTN = 'inline-flex items-center justify-center gap-1 h-form-7 px-2.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors disabled:opacity-50'
export const PANEL_BTN_PRIMARY = `${PANEL_BTN} bg-brand text-white hover:bg-brand-strong`
export const PANEL_BTN_OUTLINE = `${PANEL_BTN} border border-line text-ink-sub hover:bg-brand-tint hover:text-brand`

/** 문서 칸 한 줄 — [문서 엑셀(남는 폭 전부)] [입력(고정 폭)].
 *  입력 열을 **em 고정 폭**으로 둔다: 보고서 [입력 5]와 소방계획서 [입력]의 글씨 길이가 달라도 두 줄의
 *  버튼 x가 어긋나지 않게(em이라 글자 배율을 따라 같이 커진다). */
export const DOC_ROW = 'grid grid-cols-[minmax(0,1fr)_6.5em] gap-2 items-center text-xs'
