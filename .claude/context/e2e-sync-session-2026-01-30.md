# E2E Sync Test Session - 2026-01-30

## Summary

E2E 테스트 전면 수정 및 Backend DB 직접 검증 테스트 추가 완료.

## Commits Made

1. `c997714` - test(e2e): fix all skipped tests and rewrite pagination tests
2. `b417df8` - test(e2e): add backend DB sync verification tests

## Test Results

**Total: 72 passed, 0 skipped, 0 failed**

### Test Files

| File | Tests | Status |
|------|-------|--------|
| auth.spec.ts | 로그인/로그아웃 | ✅ |
| guest.spec.ts | 게스트 CRUD | ✅ |
| multi-device-sync.spec.ts | 6개 | ✅ |
| multi-user-cycling.spec.ts | 멀티유저 전환 | ✅ |
| debug-sync.spec.ts | 디버그 싱크 | ✅ |
| user-isolation.spec.ts | 유저 격리 | ✅ |
| sync-auth.spec.ts | 13개 | ✅ |
| sync-pagination.spec.ts | 4개 (재작성) | ✅ |
| backend-sync.spec.ts | 4개 (신규) | ✅ |

## Key Fixes

### 1. multi-device-sync.spec.ts
- **문제**: `http://localhost:3000/` 하드코딩
- **수정**: `/`로 변경 (Playwright baseURL 사용)

### 2. cross-context sync via server
- **문제**: `devLogin()` 후 `/config`에 있는데 `createEntry()` 호출
- **수정**: `devLogin()` 후 `page.goto("/")` 추가

### 3. offline edit syncs when online
- **문제**: 로그인 전에 엔트리 생성 시도
- **수정**: 로그인 → 홈 이동 → 엔트리 생성 순서로 변경

### 4. auth-auto-sync, auth-sync-conflict
- **문제**: route mocking이 SharedWorker 내부 fetch를 못 가로챔
- **수정**: mock 대신 실제 dev login 사용

### 5. sync-pagination.spec.ts (전면 재작성)
- **이전**: 서버 응답 mock으로 페이지네이션 테스트 (SharedWorker 한계로 불가)
- **수정**: 실제 UI로 엔트리 생성 후 검증
  - cross-context sync fetches all entries
  - entries persist after creating many
  - handles empty server gracefully
  - navigate through entries via date

### 6. backend-sync.spec.ts (신규)
- SQLite CLI로 backend DB 직접 쿼리
- **검증 항목**:
  - Anonymous 엔트리 → backend에 안 감 ✅
  - Logged-in 엔트리 → backend에 감 ✅
  - 마이그레이션 후 수정 → backend에 sync ✅
  - 멀티유저 데이터 격리 ✅

## Architecture Notes

### SharedWorker 구조
- Service Worker 대신 SharedWorker 사용
- tRPC 요청을 SharedWorker가 처리
- Playwright route mocking이 SharedWorker 내부 fetch를 가로챌 수 없음
- 따라서 mock 대신 실제 동작 테스트로 전환

### DB Schema (apps/api/data/local.db)
```sql
CREATE TABLE entries (
  id text PRIMARY KEY NOT NULL,
  date text NOT NULL,
  content text NOT NULL,
  user_id text,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  deleted_at text
);

CREATE TABLE users (
  id text PRIMARY KEY NOT NULL,
  google_id text NOT NULL,  -- dev login 시 'dev_' prefix 붙음
  created_at text NOT NULL
);
```

### Dev Login
- google_id에 `dev_` prefix가 붙음
- 예: `test-user-123` → `dev_test-user-123`

## Remaining Work

현재 완료된 상태. 추가 작업 없음.

## Related Files

- `e2e/*.spec.ts` - 테스트 파일들
- `apps/web/src/worker/` - SharedWorker 구현
- `apps/api/data/local.db` - Backend SQLite DB
- `playwright.config.ts` - Playwright 설정 (port 3070)
