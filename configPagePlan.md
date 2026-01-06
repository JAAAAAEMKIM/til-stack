# Config Page Implementation Plan

## Overview

Add a Config page (`/config`) with three sections:
1. **Days to Skip** - Recurring weekdays + specific dates
2. **Templates** - CRUD with default template (auto-fills new entries)
3. **Notifications** - Placeholder

Single scrollable page design for mobile-friendliness.

---

## Implementation Phases

### Phase 1: Database Schema

**File:** `apps/api/src/db/schema.ts`

Add two tables:
- `skipDays` - type ("weekday"|"specific_date"), value (0-6 or YYYY-MM-DD)
- `templates` - name, content, isDefault (boolean)

Then run:
```bash
pnpm db:generate
pnpm db:migrate
```

### Phase 2: Shared Types & Validators

**Files:**
- `packages/shared/src/types.ts` - Add `SkipDay`, `Template`, `SkipDaysConfig` interfaces
- `packages/shared/src/validators.ts` - Add schemas for all config mutations

Then rebuild: `pnpm --filter @til-stack/shared build`

### Phase 3: API Routes

**New file:** `apps/api/src/routes/config.ts`

Procedures:
- `getSkipDays`, `addSkipWeekday`, `addSkipDate`, `removeSkipDay`
- `getTemplates`, `getDefaultTemplate`, `createTemplate`, `updateTemplate`, `deleteTemplate`, `setDefaultTemplate`

**Update:** `apps/api/src/routes/index.ts` - Register `configRouter`

### Phase 4: Config Page UI

**New file:** `apps/web/src/routes/config.tsx`

Three sections:
- `SkipDaysSection` - Weekday toggle buttons + date picker for specific dates
- `TemplatesSection` - List with create/edit/delete + star for default
- `NotificationsSection` - "Coming soon" placeholder

### Phase 5: Router & Navigation

**Update:** `apps/web/src/routeTree.gen.ts` - Add `configRoute`
**Update:** `apps/web/src/routes/__root.tsx` - Add Settings nav link with gear icon

### Phase 6: Integration

**Update:** `apps/web/src/routes/index.tsx`

1. Fetch `skipDaysConfig` and `defaultTemplate`
2. Create `shouldSkipDate()` helper
3. Replace `addDays()` with `getNextValidDay()` that skips configured days
4. Pre-fill content with default template when entry doesn't exist

---

## Critical Files

| File | Change |
|------|--------|
| `apps/api/src/db/schema.ts` | Add `skipDays`, `templates` tables |
| `packages/shared/src/validators.ts` | Add config Zod schemas |
| `packages/shared/src/types.ts` | Add `SkipDay`, `Template` types |
| `apps/api/src/routes/config.ts` | New config router (create) |
| `apps/api/src/routes/index.ts` | Register configRouter |
| `apps/web/src/routes/config.tsx` | New config page (create) |
| `apps/web/src/routes/__root.tsx` | Add Settings nav link |
| `apps/web/src/routeTree.gen.ts` | Add configRoute |
| `apps/web/src/routes/index.tsx` | Integrate skip days + default template |

---

## Testing Checklist

- [ ] Skip weekdays toggle on/off
- [ ] Add/remove specific skip dates
- [ ] Navigation skips configured days
- [ ] Template CRUD works
- [ ] Set/unset default template
- [ ] Default template pre-fills new entries
- [ ] Mobile layout responsive

---

## Future Ideas

### Template Variables
Support dynamic placeholders in templates:
- `{{date}}` - Current date (YYYY-MM-DD)
- `{{dayOfWeek}}` - Day name (Monday, Tuesday, etc.)
- `{{week}}` - Week number of year
- `{{month}}` - Month name

Templates would be processed at entry creation time, replacing variables with actual values.
