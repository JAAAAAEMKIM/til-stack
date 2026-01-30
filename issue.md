# TIL Stack - Known Issues

This document consolidates all known issues, test findings, and bug reports for the TIL Stack application.

---

## Open Issues

### Critical Severity

#### Issue #1: Server Data Isolation (CRITICAL)

**Status**: Open
**Severity**: Critical
**Impact**: All API queries return ALL entries regardless of user

**Problem**: Multi-user data leakage - any user can read/modify any other user's data.

**Files Affected**:
- `apps/api/src/routes/entries.ts`
- `apps/api/src/routes/config.ts`

**Root Cause**:
```typescript
// Current vulnerable code
getByDate: publicProcedure.input(getByDateSchema).query(async ({ input }) => {
    const entry = await db
      .select()
      .from(schema.entries)
      .where(eq(schema.entries.date, input.date))  // ❌ No userId filter!
      .get();
    return entry ?? null;
});
```

**Fix Required**:
```typescript
getByDate: publicProcedure.input(getByDateSchema).query(async ({ input, ctx }) => {
    const entry = await db
      .select()
      .from(schema.entries)
      .where(
        and(
          eq(schema.entries.date, input.date),
          ctx.user?.id
            ? eq(schema.entries.userId, ctx.user.id)  // ✅ Add userId filter
            : isNull(schema.entries.userId)
        )
      )
      .get();
    return entry ?? null;
});
```

**All affected routes**:
1. `entries.list`
2. `entries.getByDate`
3. `entries.getByDateRange`
4. `entries.upsert` (doesn't set userId)
5. `entries.delete` (doesn't check userId)
6. `entries.getWeeklySummary`
7. `entries.getMonthlySummary`
8. `config.getSkipDays`
9. `config.getTemplates`

---

### High Severity

#### Issue #2: userId Never Set in Mutations (HIGH)

**Status**: Open
**Severity**: High
**Impact**: Data ownership cannot be enforced

**Problem**: `entries.upsert` doesn't set userId when creating entries.

**Current Code**:
```typescript
const created = await db
  .insert(schema.entries)
  .values({
    id: nanoid(),
    date: input.date,
    content: input.content,
    // userId not set!
  })
```

**Fixed Code**:
```typescript
const created = await db
  .insert(schema.entries)
  .values({
    id: nanoid(),
    date: input.date,
    content: input.content,
    userId: ctx.user?.id ?? null,  // Set userId from context
  })
```

---

#### Issue #3: Unauthenticated Access (HIGH)

**Status**: Open
**Severity**: High
**Impact**: Anonymous users can create/delete entries

**Problem**: No auth middleware on entry mutations.

**Current Behavior**:
| Operation | Result |
|-----------|--------|
| Create entry | ✅ Allowed (entry created with userId=null) |
| Read entry | ❌ Returns 0 entries |
| List entries | ❌ Returns 0 entries |
| Delete entry | ✅ Allowed |

**Root Cause**: `publicProcedure` used instead of `protectedProcedure` for mutations.

**Fix Required**: Add auth middleware to all entry mutations.

---

#### Issue #4: No search (HIGH)

**Status**: Open
**Priority**: High
**Impact**: Can't find "that thing I wrote about X" - will hurt as entries grow

**UX Issue**: Users cannot search through their historical entries, making it difficult to find specific information as the entry count grows.

---

### Medium Severity

#### Issue #5: Multi-Device Sync - Last-to-Sync-Wins (Not Last-to-Edit-Wins)

**Status**: Open
**Severity**: Medium
**Reported**: 2026-01-28

**Description**: When the same user edits entries on multiple devices, the device that syncs last wins, regardless of which edit was more recent.

**Scenario**:
```
Device A (offline)      Server          Device B (online)
     │                    │                   │
     │  Edit: "Hello"     │                   │
     │  (T1, local save)  │                   │
     │                    │    Edit: "World"  │
     │                    │◄──────────────────│
     │                    │    (T2, T2 > T1)  │
     │                    │                   │
     │  Goes online       │                   │
     │                    │                   │
     │  1. Pull ─────────►│  "World" (T2)     │
     │  2. Push pending ─►│  "Hello" → T3    │
     │  3. Pull ─────────►│  "Hello" (T3)    │
```

**Result**: Device A's older edit ("Hello") overwrites Device B's newer edit ("World")

**Root Cause**: `updateLocalEntry()` in `service-worker.ts:815-825` does not compare timestamps before updating.

**Affected Files**: `/apps/web/src/service-worker.ts` - `updateLocalEntry()` function (line 802-826)

**Proposed Fix**: Add timestamp comparison before updating entries during pull (similar to `updateLocalTemplates()` which correctly implements timestamp-based merge).

---

#### Issue #6: Service Worker Dev Mode (MEDIUM)

**Status**: Open
**Severity**: Medium
**Impact**: Cannot test local-first behavior in dev environment

**Problem**: sql.js fails to initialize in service worker dev mode.

**Error**: `XMLHttpRequest is not defined`

**Cause**: sql.js tries to use XHR for WASM loading, but service workers don't have XHR.

**Fix Options**:
1. Pre-bundle WASM binary and pass to initSqlJs
2. Use fetch() to load WASM before sql.js init
3. Use production build for testing

---

#### Issue #7: Calendar doesn't show skipped days (MEDIUM)

**Status**: Open
**Priority**: Medium
**Impact**: Configured Sat/Sun to skip but calendar doesn't gray them out

**UX Issue**: Users cannot visually distinguish skipped days from regular days in the calendar view.

---

#### Issue #8: Date shows as `2024-01-06` (MEDIUM)

**Status**: Open
**Priority**: Medium
**Impact**: `Mon, Jan 6` is more human-friendly

**UX Issue**: Date display format is not user-friendly.

---

#### Issue #9: No keyboard shortcuts (MEDIUM)

**Status**: Open
**Priority**: Medium
**Impact**: Cmd+S to save, Esc to cancel - expected in any editor

**UX Issue**: Users expect standard keyboard shortcuts for editor operations.

---

### Low Severity

#### Issue #10: Monthly page is repetitive (LOW)

**Status**: Open
**Priority**: Low
**Impact**: Same entries shown 3 times (calendar dots, monthly list, weekly accordion)

**UX Issue**: Redundant display of the same information reduces usability.

---

#### Issue #11: "Stack" terminology (LOW)

**Status**: Open
**Priority**: Low
**Impact**: Non-devs might not get it - "Recent Entries" clearer

**UX Issue**: Terminology may not be intuitive for non-technical users.

---

#### Issue #12: Notifications feature placeholder (LOW)

**Status**: Open
**Priority**: Low
**Impact**: Currently shows "Coming soon" placeholder

**Feature Gap**: Notifications feature is not yet implemented.

---

## Fixed Issues

### Auto-save implemented ✅

**Fixed**: Yes
**Date**: Before 2026-01-15

Drafts auto-save to localStorage every 500ms, preventing data loss on page refresh or navigation.

---

### Dark mode toggle ✅

**Fixed**: Yes
**Date**: Before 2026-01-15

Theme selector added to config page (system/light/dark options).

---

## Won't Fix

### No unsaved changes warning (beforeunload)

**Decision**: Won't Fix
**Rationale**: Not needed because:
- Auto-save drafts to localStorage with 500ms debounce
- Drafts restore automatically when returning to a date
- Better UX than disruptive browser dialogs
- Works across refreshes and tab switches

---

## Test Reports (Archive)

### Comprehensive Login & Data Safety Test (2026-01-15)

**Test Environment**:
- API Server: http://localhost:3003
- Web Server: http://localhost:3002

**Results Summary**:
| Metric | Value |
|--------|-------|
| Tests Executed | 12 |
| PASS | 1 |
| WARNING | 3 |
| CRITICAL Issues | 1 |
| HIGH Severity | 2 |

**Key Findings**:
1. **CRITICAL**: Server has NO user data isolation - All entries are globally shared
2. **HIGH**: userId column exists but is never set - Schema/API mismatch
3. **HIGH**: Unauthenticated users can create entries - No auth middleware
4. Service Worker local-first mode has XMLHttpRequest bug in dev

**Architecture Understanding**:

The application uses a **local-first architecture**:
- **Service Worker** (IndexedDB) provides user isolation via namespacing: `sqlite-data-{userId}`
- **API Server** (SQLite) has NO user isolation - all queries return ALL entries

This is **safe for single-user deployments** but **dangerous for multi-user scenarios**.

---

## Recommendations

### Immediate Actions (Security - Critical Priority)

1. **Add userId filtering to ALL queries**
   - Priority: CRITICAL
   - Effort: 2-4 hours
   - Risk if not done: Any user can read/modify any other user's data

2. **Set userId in mutations**
   - Priority: HIGH
   - Effort: 1 hour
   - Risk if not done: Data ownership cannot be enforced

3. **Add auth middleware to protected routes**
   - Priority: HIGH
   - Effort: 2 hours
   - Risk if not done: Anonymous users can create orphan entries

### Medium-Term Improvements

4. **Add unique constraint on (date, user_id)**
   - Allows multiple users to have entries for same date
   - Prevents duplicate date entries per user

5. **Fix service worker sql.js initialization**
   - Pre-fetch WASM using fetch() API
   - Improves dev experience and testability

6. **Fix multi-device sync conflict resolution**
   - Implement timestamp-based last-write-wins in `updateLocalEntry()`
   - Align with `updateLocalTemplates()` behavior

### UX Improvements

7. **Implement search functionality** (High Priority)
8. **Add keyboard shortcuts** (Medium Priority)
9. **Improve calendar visual feedback for skipped days** (Medium Priority)
10. **Improve date formatting** (Low Priority)

---

## Related Documentation

- Architecture: `ARCHITECTURE.md`
- E2E Tests: `e2e/TEST.md`
- User Cases: `e2e/USER_CASES.md`
- Development Plan: `PLAN.md`
- Project Instructions: `CLAUDE.md`

---

*Last updated: 2026-01-30*
