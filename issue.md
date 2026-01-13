# UX Issues

## Fixed

- [x] **Auto-save implemented** - Drafts auto-save to localStorage every 500ms
- [x] **Dark mode toggle** - Theme selector added to config page (system/light/dark)

## Won't Fix

- **No unsaved changes warning (beforeunload)** - Not needed because:
  - Auto-save drafts to localStorage with 500ms debounce
  - Drafts restore automatically when returning to a date
  - Better UX than disruptive browser dialogs
  - Works across refreshes and tab switches

## Open Issues

### High Priority

- [ ] **No search** - Can't find "that thing I wrote about X" - will hurt as entries grow
- [ ] **No keyboard shortcuts** - Cmd+S to save, Esc to cancel - expected in any editor

### Medium Priority

- [ ] **Calendar doesn't show skipped days** - Configured Sat/Sun to skip but calendar doesn't gray them out
- [ ] **Date shows as `2024-01-06`** - `Mon, Jan 6` is more human-friendly

### Low Priority

- [ ] **Monthly page is repetitive** - Same entries shown 3 times (calendar dots, monthly list, weekly accordion)
- [ ] **"Stack" terminology** - Non-devs might not get it - "Recent Entries" clearer
- [ ] **Implement Notifications feature** - Currently shows "Coming soon" placeholder
