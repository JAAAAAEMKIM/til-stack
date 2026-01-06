import { createRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Card,
  CardContent,
  CardDescription,
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

function HomePage() {
  const { date: initialDate } = indexRoute.useSearch();
  const today = getLocalDateString(new Date());
  const [selectedDate, setSelectedDate] = useState(initialDate || today);
  const [content, setContent] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleCopy = async (text: string, id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Update selected date when search param changes
  useEffect(() => {
    if (initialDate && initialDate !== selectedDate) {
      setSelectedDate(initialDate);
    }
  }, [initialDate]);

  const utils = trpc.useUtils();

  // Fetch entry for selected date
  const { data: entry, isLoading: isLoadingEntry } = trpc.entries.getByDate.useQuery(
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

  // Upsert mutation with optimistic update
  const upsertMutation = trpc.entries.upsert.useMutation({
    onMutate: async (newEntry) => {
      await utils.entries.getByDate.cancel({ date: newEntry.date });
      await utils.entries.list.cancel();

      const previousEntry = utils.entries.getByDate.getData({ date: newEntry.date });

      utils.entries.getByDate.setData({ date: newEntry.date }, (old) => ({
        id: old?.id ?? "temp-id",
        date: newEntry.date,
        content: newEntry.content,
        createdAt: old?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));

      return { previousEntry };
    },
    onError: (_err, newEntry, context) => {
      if (context?.previousEntry !== undefined) {
        utils.entries.getByDate.setData({ date: newEntry.date }, context.previousEntry);
      }
    },
    onSettled: () => {
      utils.entries.getByDate.invalidate();
      utils.entries.list.invalidate();
    },
  });

  // Delete mutation with optimistic update
  const deleteMutation = trpc.entries.delete.useMutation({
    onMutate: async ({ date }) => {
      await utils.entries.getByDate.cancel({ date });
      await utils.entries.list.cancel();

      const previousEntry = utils.entries.getByDate.getData({ date });

      utils.entries.getByDate.setData({ date }, null);

      return { previousEntry };
    },
    onError: (_err, { date }, context) => {
      if (context?.previousEntry) {
        utils.entries.getByDate.setData({ date }, context.previousEntry);
      }
    },
    onSettled: () => {
      utils.entries.getByDate.invalidate();
      utils.entries.list.invalidate();
    },
  });

  // Sync content when entry changes and reset edit mode
  useEffect(() => {
    setContent(entry?.content ?? "");
    setHasChanges(false);
    setIsEditing(false);
  }, [entry, selectedDate]);

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
    setHasChanges(value !== (entry?.content ?? ""));
  };

  const handleSave = () => {
    if (!content.trim()) return;
    upsertMutation.mutate({ date: selectedDate, content });
    setHasChanges(false);
    setIsEditing(false);
  };

  const handleDelete = () => {
    if (!entry) return;
    if (confirm("Are you sure you want to delete this entry?")) {
      deleteMutation.mutate({ date: selectedDate });
      setContent("");
      setHasChanges(false);
    }
  };

  const handlePrevDay = () => setSelectedDate(addDays(selectedDate, -1));
  const handleNextDay = () => setSelectedDate(addDays(selectedDate, 1));
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
  // Filter entries to show only those before the selected date (the "stack" below current date)
  const stackEntries = allEntries.filter((e) => e.date < selectedDate);
  const isToday = selectedDate === today;
  const isSaving = upsertMutation.isPending;
  const isDeleting = deleteMutation.isPending;

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

      {/* Entry Card */}
      <Card className="group">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            {entry && !isEditing ? (
              /* Read mode - show date like stack entries */
              <>
                <div className="flex items-center gap-3">
                  <CardTitle className="text-sm font-medium">{selectedDate}</CardTitle>
                  <span className="text-xs text-muted-foreground">
                    {getDateLabel(selectedDate)}
                  </span>
                </div>
                {!isLoadingEntry && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                      onClick={() => handleCopy(entry.content, `main-${entry.id}`)}
                    >
                      {copiedId === `main-${entry.id}` ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsEditing(true)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </>
            ) : (
              /* Edit/New mode */
              <div>
                <CardTitle className="text-lg">
                  {entry ? "Edit Entry" : "New Entry"}
                </CardTitle>
                <CardDescription>
                  Write your TIL, daily scrum notes, or diary entry in markdown
                </CardDescription>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingEntry ? (
            <div className="flex items-center justify-center h-[200px]">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : entry && !isEditing ? (
            /* Read Mode */
            <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:mt-2 prose-headings:mb-1 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-pre:my-2 prose-pre:bg-muted">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {entry.content}
              </ReactMarkdown>
            </div>
          ) : (
            /* Edit Mode */
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
                  {entry && isEditing && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setContent(entry.content);
                        setHasChanges(false);
                        setIsEditing(false);
                      }}
                    >
                      <X className="h-4 w-4 mr-2" />
                      Cancel
                    </Button>
                  )}
                </div>
                {entry && (
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
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

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
              <EntryCard
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

interface EntryCardProps {
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

function EntryCard({ entry, onClick, onCopy, isCopied }: EntryCardProps) {
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
