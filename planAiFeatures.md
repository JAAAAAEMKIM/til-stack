# AI Features Implementation Plan

## Overview

Integrate Chrome's built-in Summarizer API (Gemini Nano) to generate AI summaries for weekly and monthly TIL entries. Runs locally in the browser - no server costs, fully private.

## Requirements

- Chrome 138+
- 22GB free storage
- GPU (>4GB VRAM) or CPU (16GB RAM, 4+ cores)
- macOS 13+, Windows 10/11, Linux, or ChromeOS

---

## Implementation Phases

### Phase 1: AI Configuration (Config Page)

Add AI settings section to `/config` page. Only visible if browser supports Chrome AI.

#### 1.1 AI Section UI

**Location:** `apps/web/src/routes/config.tsx` - Add `<AISection />` component

**Visibility:** Only render if `'Summarizer' in window` is true

**Contents:**
- **AI Status Indicator** - Show current state (Available / Not Downloaded / Unsupported)
- **Enable AI Toggle** - Master switch to enable/disable AI features app-wide
- **Download Model Button** - If status is "downloadable", show button with progress
- **Summarizer Prompt** - Custom context/instructions for the summarizer

```
┌─────────────────────────────────────────────────────┐
│ AI Features                                    ⚡    │
│ Powered by Chrome's built-in Gemini Nano           │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Status: ● Available                                 │
│                                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │ [✓] Enable AI Summaries                         │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ Summarizer Prompt                                   │
│ ┌─────────────────────────────────────────────────┐ │
│ │ These are daily TIL (Today I Learned) entries   │ │
│ │ from a developer's learning journal. Summarize  │ │
│ │ the key technical learnings and insights.       │ │
│ └─────────────────────────────────────────────────┘ │
│ This context helps the AI understand your entries.  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

#### 1.2 AI Config Storage

**Option A: LocalStorage** (simpler, client-only)
```typescript
interface AIConfig {
  enabled: boolean;
  summarizerPrompt: string;
}
// Store in localStorage: "til-ai-config"
```

**Option B: Database** (syncs across devices if auth added later)
- Add `ai_config` table to database
- Add tRPC procedures for get/update

**Recommendation:** Start with LocalStorage (Option A) for simplicity.

#### 1.3 Create `useAIConfig` Hook

**File:** `apps/web/src/lib/ai-config.ts`

```typescript
interface UseAIConfigReturn {
  isSupported: boolean;      // Browser supports Summarizer API
  isEnabled: boolean;        // User has enabled AI features
  summarizerPrompt: string;  // Custom prompt for summarizer
  setEnabled: (enabled: boolean) => void;
  setPrompt: (prompt: string) => void;
}
```

---

### Phase 2: Core AI Infrastructure

#### 2.1 Create `useSummarizer` Hook

**File:** `apps/web/src/lib/summarizer.ts`

```typescript
type SummarizerStatus = "unavailable" | "downloadable" | "downloading" | "available";

interface UseSummarizerReturn {
  status: SummarizerStatus;
  downloadProgress: number;
  summarize: (text: string, options?: SummarizeOptions) => Promise<string>;
  summarizeStream: (text: string, options?: SummarizeOptions) => AsyncIterable<string>;
  initDownload: () => Promise<void>;
}
```

**Responsibilities:**
- Check browser support (`'Summarizer' in self`)
- Check model availability (`Summarizer.availability()`)
- Handle model download with progress tracking
- Provide `summarize()` and `summarizeStream()` methods
- Cache summarizer instance
- Read custom prompt from `useAIConfig`

#### 2.2 Add TypeScript Declarations

**File:** `apps/web/src/types/chrome-ai.d.ts`

Declare types for Chrome's Summarizer API since it's not in standard lib.dom yet:
- `Summarizer` class
- `SummarizerCreateOptions` interface
- `SummarizerType`: "key-points" | "tldr" | "teaser" | "headline"
- `SummarizerFormat`: "markdown" | "plain-text"
- `SummarizerLength`: "short" | "medium" | "long"

---

### Phase 3: Calendar Page Integration

#### 3.1 Create AI Summary Component

**File:** `apps/web/src/components/ai-summary.tsx`

```tsx
interface AISummaryProps {
  entries: Array<{ date: string; content: string }>;
  type: "week" | "month";
  context?: string; // e.g., "Week of Jan 6-12" or "January 2025"
}
```

**States:**
1. **Unavailable** - Browser doesn't support, show nothing
2. **Downloadable** - Show "Enable AI Summaries" button with info tooltip
3. **Downloading** - Show progress bar
4. **Available** - Show "Generate Summary" button
5. **Generating** - Show streaming text with loading indicator
6. **Complete** - Show full summary with "Regenerate" option

**UI Elements:**
- Sparkles icon for AI features
- Collapsible summary card
- Copy summary button
- "Powered by Gemini Nano" footer text

#### 3.2 Integrate into Monthly Page

**File:** `apps/web/src/routes/monthly.tsx`

**Weekly Summary Enhancement:**
- Add `<AISummary>` component inside expanded `WeekSummary`
- Pass week's entries and context
- Summary type: `key-points` with `short` length
- Only visible if AI is enabled in config

**Monthly Summary Enhancement:**
- Add `<AISummary>` component in Monthly Summary card
- Pass all month's entries
- Summary type: `tldr` with `medium` length
- Only visible if AI is enabled in config

#### 3.3 Summary Generation Strategy

**For Weekly Summary:**
```typescript
const prompt = entries.map(e => `## ${e.date}\n${e.content}`).join("\n\n");
const options = {
  type: "key-points",
  format: "markdown",
  length: "short",
  sharedContext: "These are daily TIL (Today I Learned) entries from a developer's learning journal."
};
```

**For Monthly Summary:**
```typescript
const prompt = entries.map(e => `## ${e.date}\n${e.content}`).join("\n\n");
const options = {
  type: "tldr",
  format: "markdown",
  length: "medium",
  sharedContext: "These are daily TIL entries from a developer's learning journal for the month."
};
```

---

## Additional Considerations

### Caching & Performance

- Cache generated summaries in React state (not localStorage - summaries should regenerate fresh)
- Use streaming for better UX on longer summaries
- Debounce regeneration requests
- Don't auto-generate - always require user action (saves resources)

### Error Handling

- Model download failed -> Show retry button
- Summarization failed -> Show error with retry option
- Text too short -> Show "Not enough content to summarize"
- Text too long -> Truncate to last N entries with note

---

## File Changes Summary

| Phase | File | Action |
|-------|------|--------|
| 1 | `apps/web/src/lib/ai-config.ts` | Create - useAIConfig hook |
| 1 | `apps/web/src/routes/config.tsx` | Modify - Add AISection component |
| 2 | `apps/web/src/types/chrome-ai.d.ts` | Create - TypeScript declarations |
| 2 | `apps/web/src/lib/summarizer.ts` | Create - useSummarizer hook |
| 3 | `apps/web/src/components/ai-summary.tsx` | Create - AISummary component |
| 3 | `apps/web/src/routes/monthly.tsx` | Modify - Integrate AI summaries |

## UX Flow

### Config Page Flow
```
User visits /config
    │
    ├─► Browser unsupported → AI section not shown
    │
    └─► Browser supported → AI section visible
            │
            ├─► Model not downloaded
            │       │
            │       └─► "Download AI Model" button → Progress bar → Complete
            │
            └─► Model available
                    │
                    ├─► Enable/Disable toggle
                    └─► Custom summarizer prompt textarea
```

### Calendar Page Flow
```
User visits /monthly
    │
    ├─► AI disabled in config → No AI buttons shown
    │
    └─► AI enabled in config
            │
            ├─► Monthly Summary section → "Summarize Month" button
            │       │
            │       └─► Click → Streaming summary → Complete
            │
            └─► Weekly Summary (expanded) → "Summarize Week" button
                    │
                    └─► Click → Streaming summary → Complete
```

## Future Enhancements

1. **Summary History** - Store past summaries with timestamps
2. **Custom Prompts** - Let users customize summary style in config
3. **Export Summaries** - Include AI summaries in data export
4. **Prompt API** - Use for more advanced features when it leaves extension-only
5. **Compare Weeks** - AI comparison of learning progress across weeks
