import { createRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChevronLeft, ChevronRight, Trash2, Save, Loader2, Pencil, Copy, Check, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";
import { rootRoute } from "./__root";
import { z } from "zod";

const searchSchema = z.object({
  date: z.string().optional(),
});

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: searchSchema,
  component: HomePage,
});

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDateLabel(dateStr: string): string {
  const today = getLocalDateString(new Date());
  const yesterday = getLocalDateString(new Date(Date.now() - 86400000));
  const tomorrow = getLocalDateString(new Date(Date.now() + 86400000));

  if (dateStr === today) return "Today";
  if (dateStr === yesterday) return "Yesterday";
  if (dateStr === tomorrow) return "Tomorrow";
  return formatDate(dateStr);
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + "T00:00:00");
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

interface SkipDaysConfig {
  weekdays: number[];
  specificDates: string[];
}

function shouldSkipDate(
  dateStr: string,
  config: SkipDaysConfig | undefined
): boolean {
  if (!config) return false;

  if (config.specificDates.includes(dateStr)) return true;

  const date = new Date(dateStr + "T00:00:00");
  const weekday = date.getDay();
  if (config.weekdays.includes(weekday)) return true;

  return false;
}

function getNextValidDay(
  dateStr: string,
  direction: number,
  config: SkipDaysConfig | undefined
): string {
  let result = dateStr;
  let maxIterations = 365;

  do {
    result = addDays(result, direction);
    maxIterations--;
  } while (shouldSkipDate(result, config) && maxIterations > 0);

  return result;
}

// =============================================================================
// NewEntryCard - For creating new entries (always in edit mode)
// =============================================================================
interface NewEntryCardProps {
  date: string;
  defaultTemplate?: string;
}

function NewEntryCard({ date, defaultTemplate }: NewEntryCardProps) {
  const [content, setContent] = useState(defaultTemplate || "");
  const [hasChanges, setHasChanges] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const utils = trpc.useUtils();

  const upsertMutation = trpc.entries.upsert.useMutation({
    onSettled: () => {
      utils.entries.getByDate.invalidate();
      utils.entries.list.invalidate();
    },
  });

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [content]);

  const handleContentChange = (value: string) => {
    setContent(value);
    setHasChanges(value !== (defaultTemplate || ""));
  };

  const handleSave = () => {
    if (!content.trim()) return;
    upsertMutation.mutate({ date, content });
    setHasChanges(false);
  };

  const isSaving = upsertMutation.isPending;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <CardTitle className="text-sm font-medium">{date}</CardTitle>
          <span className="text-xs text-muted-foreground">New Entry</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          placeholder="# Today I learned..."
          className="min-h-[80px] resize-none font-mono text-sm overflow-hidden"
        />
        <div className="flex justify-between">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!hasChanges || !content.trim() || isSaving}
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// EntryView - For viewing/editing existing entries (has internal isEditing state)
// =============================================================================
interface EntryViewProps {
  entry: {
    id: string;
    date: string;
    content: string;
    createdAt: string;
    updatedAt: string;
  };
}

function EntryView({ entry }: EntryViewProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(entry.content);
  const [hasChanges, setHasChanges] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const utils = trpc.useUtils();

  const upsertMutation = trpc.entries.upsert.useMutation({
    onSettled: () => {
      utils.entries.getByDate.invalidate();
      utils.entries.list.invalidate();
    },
  });

  const deleteMutation = trpc.entries.delete.useMutation({
    onSettled: () => {
      utils.entries.getByDate.invalidate();
      utils.entries.list.invalidate();
    },
  });

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [content]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(entry.content);
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleContentChange = (value: string) => {
    setContent(value);
    setHasChanges(value !== entry.content);
  };

  const handleSave = () => {
    if (!content.trim()) return;
    upsertMutation.mutate({ date: entry.date, content });
    setHasChanges(false);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setContent(entry.content);
    setHasChanges(false);
    setIsEditing(false);
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this entry?")) {
      deleteMutation.mutate({ date: entry.date });
    }
  };

  const isSaving = upsertMutation.isPending;
  const isDeleting = deleteMutation.isPending;

  return (
    <Card className="group">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between min-h-[40px]">
          <div className="flex items-center gap-3">
            <CardTitle className="text-sm font-medium">{entry.date}</CardTitle>
            <span className="text-xs text-muted-foreground">
              {isEditing ? "Editing" : getDateLabel(entry.date)}
            </span>
          </div>
          {!isEditing && (
            <div className="flex items-center gap-1 h-8">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-200"
                onClick={handleCopy}
              >
                {copiedId === entry.id ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 transition-opacity duration-200"
                onClick={() => setIsEditing(true)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isEditing ? (
          <>
            <Textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder="# Today I learned..."
              className="min-h-[80px] resize-none font-mono text-sm overflow-hidden"
            />
            <div className="flex justify-between">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!hasChanges || !content.trim() || isSaving}
                >
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Save
                </Button>
                <Button variant="secondary" size="sm" onClick={handleCancel}>
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
              </div>
              <Button
                variant="destructive"
                size="icon"
                className="h-8 w-8"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            </div>
          </>
        ) : (
          <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:mt-2 prose-headings:mb-1 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-pre:my-2 prose-pre:bg-muted">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {entry.content}
            </ReactMarkdown>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// HomePage - Main component
// =============================================================================
function HomePage() {
  const { date: initialDate } = indexRoute.useSearch();
  const today = getLocalDateString(new Date());
  const [selectedDate, setSelectedDate] = useState(initialDate || today);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Update selected date when search param changes
  useEffect(() => {
    if (initialDate && initialDate !== selectedDate) {
      setSelectedDate(initialDate);
    }
  }, [initialDate]);

  // Fetch config
  const { data: skipDaysConfig } = trpc.config.getSkipDays.useQuery();
  const { data: defaultTemplate } = trpc.config.getDefaultTemplate.useQuery();

  // Fetch entry for selected date
  const { data: entry, isFetching: isLoadingEntry } = trpc.entries.getByDate.useQuery(
    { date: selectedDate },
    { staleTime: 0 }
  );

  // Infinite scroll list
  const {
    data: entriesData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = trpc.entries.list.useInfiniteQuery(
    { limit: 20 },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      staleTime: 0,
    }
  );

  const handleCopy = async (text: string, id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handlePrevDay = () =>
    setSelectedDate(getNextValidDay(selectedDate, -1, skipDaysConfig));
  const handleNextDay = () =>
    setSelectedDate(getNextValidDay(selectedDate, 1, skipDaysConfig));
  const handleToday = () => setSelectedDate(today);

  const handleEntryClick = (date: string) => {
    setSelectedDate(date);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Infinite scroll observer
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (isFetchingNextPage) return;
      if (observerRef.current) observerRef.current.disconnect();
      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasNextPage) {
          fetchNextPage();
        }
      });
      if (node) observerRef.current.observe(node);
    },
    [isFetchingNextPage, hasNextPage, fetchNextPage]
  );

  const allEntries = entriesData?.pages.flatMap((page) => page.items) ?? [];
  const stackEntries = allEntries.filter((e) => e.date < selectedDate);
  const isToday = selectedDate === today;

  return (
    <div className="space-y-6">
      {/* Date Navigator */}
      <div className="flex items-center justify-center gap-2">
        <Button variant="ghost" size="icon" onClick={handlePrevDay}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <button
          onClick={handleToday}
          className="text-center min-w-[200px] hover:bg-accent rounded-lg p-2 transition-colors"
        >
          <div className="text-lg font-semibold">{selectedDate}</div>
          <div className="text-sm text-muted-foreground">{getDateLabel(selectedDate)}</div>
        </button>
        <Button variant="ghost" size="icon" onClick={handleNextDay} disabled={isToday}>
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {/* Entry Card - Loading / Entry / New Entry */}
      {isLoadingEntry ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <CardTitle className="text-sm font-medium">{selectedDate}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center h-[200px]">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      ) : entry ? (
        <EntryView key={entry.id} entry={entry} />
      ) : (
        <NewEntryCard key={selectedDate} date={selectedDate} defaultTemplate={defaultTemplate?.content} />
      )}

      {/* Stack - entries before selected date */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Stack</h2>
        {stackEntries.length === 0 ? (
          <Card className="p-6">
            <p className="text-center text-muted-foreground">
              No previous entries in the stack.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {stackEntries.map((entryItem) => (
              <StackEntryCard
                key={entryItem.id}
                entry={entryItem}
                onClick={() => handleEntryClick(entryItem.date)}
                onCopy={(e) => handleCopy(entryItem.content, entryItem.id, e)}
                isCopied={copiedId === entryItem.id}
              />
            ))}
            <div ref={loadMoreRef} className="h-4" />
            {isFetchingNextPage && (
              <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// StackEntryCard - For displaying entries in the stack (read-only preview)
// =============================================================================
interface StackEntryCardProps {
  entry: {
    id: string;
    date: string;
    content: string;
    createdAt: string;
  };
  onClick: () => void;
  onCopy: (e: React.MouseEvent) => void;
  isCopied: boolean;
}

function StackEntryCard({ entry, onClick, onCopy, isCopied }: StackEntryCardProps) {
  return (
    <Card
      className="group cursor-pointer transition-all hover:shadow-md"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-sm font-medium">{entry.date}</CardTitle>
            <span className="text-xs text-muted-foreground">
              {getDateLabel(entry.date)}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
            onClick={onCopy}
          >
            {isCopied ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:mt-2 prose-headings:mb-1 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-pre:my-2 prose-pre:bg-muted">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
            {entry.content.length > 500
              ? entry.content.slice(0, 500) + "..."
              : entry.content}
          </ReactMarkdown>
        </div>
      </CardContent>
    </Card>
  );
}
