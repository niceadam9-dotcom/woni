# 설계 JSON 상태 표기 규칙 (Json_Rule) — 과대 표기 재발 방지

작성: 2026-07-16. 배경: 소방계획서-필드확장-설계.json의 섹션 4·5·6이 "implemented"로 표기됐으나
검증 결과 세부 4건(건축물대장 재가져오기 버튼, 누락 칩 클릭 포커스, 생성 페이지 사전 체크,
워커 missing[] 5·6차 필드) 미구현이 확인됨. 원인은 ①섹션 단위 뭉뚱그린 판정 ②구현자가 스스로
완료 판정까지 내린 것. 아래 규칙은 훅 자동 동기화(Task subject 방식) **이외의** 보완 장치다.

## 규칙 1 — 판정 단위 세분화 + `partial` 상태 (기본 규약)

- status는 섹션이 아니라 **검증 가능한 최소 항목(수용 기준, criteria) 단위**로 기록한다.
- 섹션 status는 하위 criteria에서 도출한다: 전부 implemented → `implemented`,
  일부만 → `partial`, 전부 미착수 → `pending_order`.
- status_legend에 반드시 포함: `"partial": "부분 구현 — criteria 참조"`

```json
{ "id": "5", "title": "확인 UX", "status": "partial",
  "criteria": [
    { "id": "5-1a", "desc": "준비율 게이지 표시", "status": "implemented" },
    { "id": "5-1b", "desc": "누락 칩 클릭 → 스크롤·포커스", "status": "pending_order" },
    { "id": "5-2",  "desc": "생성 페이지 사전 체크", "status": "pending_order" }
  ] }
```

- 취지: "일부 미완인데 implemented로 적는" 선택지 자체를 없앤다. 90% 구현은 `partial`이다.

## 규칙 2 — `implemented`에 증거(verified) 필드 필수 (기본 규약)

- status를 `implemented`로 올릴 때는 `verified` 필드를 반드시 동반한다.
- `verified` 없는 `implemented`는 "자기 신고"로 간주하며 무효다.

```json
{ "status": "implemented",
  "verified": { "date": "2026-07-15", "commit": "79e1a9d",
                "evidence": ["fire-plan-info-panel.tsx:102-108 급수 세그먼트"],
                "method": "코드 대조 | E2E | 수동 확인" } }
```

- evidence에는 **실제 파일:라인**을 적는다. 코드를 열어봐야만 적을 수 있으므로
  "구현했다고 기억함" 수준의 표기가 걸러진다.

## 규칙 3 — 완료 판정을 독립 검증 절차로 분리 (차수 완료 시점마다)

- **구현자 ≠ 판정자.** 구현 세션은 status를 `code_present`(코드 존재)까지만 올린다.
- `implemented` 승격은 별도 검증 패스를 통과한 항목만 허용한다:
  1. 설계 MD의 요구 항목을 체크리스트로 추출
  2. 독립 검증(Explore 에이전트 등)이 항목별로 파일:라인 근거와 함께 ✅/❌/부분 판정
  3. ✅ 판정 항목만 `implemented` + `verified` 기록
- 2026-07-16 소방계획서 필드확장 검증에서 이 절차로 갭 4건을 발견함 — 표준 절차로 유지한다.

## 규칙 4 — 기계 검증 가능 항목은 검증 스크립트 (보조 수단)

- JSON 항목에 `checks: [{ "file": "...", "pattern": "..." }]`를 달고, 스크립트가
  grep/파일 존재를 검사해 `implemented`인데 근거 패턴이 없는 항목을 리포트한다.
  (예: `node scripts/verify-design-json.mjs`)
- DB 컬럼·마이그레이션·함수 존재 검증에는 강력하지만, "칩 클릭 시 포커스" 같은
  UX 동작은 패턴 검증이 어렵다 — 규칙 1~3의 보조로만 사용한다.

## 적용 우선순위

1. **규칙 1 + 2를 기본 규약**으로 즉시 적용 (JSON 구조 변경만으로 효과)
2. 차수/단계 완료 시점마다 **규칙 3의 독립 검증 패스** 1회 실행
3. 규칙 4는 기계 검증 가능 항목이 많아지면 추가

## 상태 어휘 정리

| status | 의미 |
|---|---|
| `pending_order` | 미구현·지시 대기 |
| `code_present` | 코드 존재(구현자 자기 신고) — 검증 전 |
| `partial` | 부분 구현 — criteria에 세부 상태 기록 |
| `implemented` | 독립 검증 통과 + `verified` 증거 동반 |
| `deferred` / `proposal` / `confirmed` | 기존 규약 유지 (보류/제안/확정) |
