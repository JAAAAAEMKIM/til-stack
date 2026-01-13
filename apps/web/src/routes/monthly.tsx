import { createRoute, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Loader2, Pencil } from "lucide-react";
import { rootRoute } from "./__root";
import { trpc } from "@/lib/trpc";
import { formatDateShort, getLocalDateString } from "@/lib/date-utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Entry } from "@til-stack/shared";
import { AISummary } from "@/components/ai-summary";

export const monthlyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/monthly",
  component: MonthlyPage,
});

function getMonthDates(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();

  // Get the day of week for the first day (0 = Sunday)
  const startDayOfWeek = firstDay.getDay();

  const dates: (string | null)[] = [];

  // Add empty slots for days before the first of the month
  for (let i = 0; i < startDayOfWeek; i++) {
    dates.push(null);
  }

  // Add all days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    dates.push(getLocalDateString(date));
  }

  return dates;
}

function getWeeksInMonth(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // Adjust first day to Sunday of that week
  const startDayOfWeek = firstDay.getDay();
  const sundayOffset = -startDayOfWeek;
  const firstSunday = new Date(year, month, 1 + sundayOffset);

  const weeks: { weekStart: string; weekEnd: string }[] = [];
  let currentSunday = new Date(firstSunday);

  while (currentSunday <= lastDay) {
    const weekEnd = new Date(currentSunday);
    weekEnd.setDate(weekEnd.getDate() + 6);

    weeks.push({
      weekStart: getLocalDateString(currentSunday),
      weekEnd: getLocalDateString(weekEnd),
    });

    currentSunday.setDate(currentSunday.getDate() + 7);
  }

  return weeks;
}

function MonthlyPage() {
  const navigate = useNavigate();
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const monthYear = new Date(currentYear, currentMonth).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const monthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}`;

  // Get all dates for the calendar grid
  const calendarDates = useMemo(
    () => getMonthDates(currentYear, currentMonth),
    [currentYear, currentMonth]
  );

  // Get weeks for weekly summaries
  const weeks = useMemo(
    () => getWeeksInMonth(currentYear, currentMonth),
    [currentYear, currentMonth]
  );

  // Fetch monthly summary (includes entries and weeks)
  const { data: monthlySummary, isLoading } = trpc.entries.getMonthlySummary.useQuery({
    month: monthStr,
  });

  // Create a set of dates that have entries for quick lookup
  const datesWithEntries = useMemo(() => {
    if (!monthlySummary) return new Set<string>();
    return new Set(monthlySummary.entries.map((e) => e.date));
  }, [monthlySummary]);

  // Group entries by date for quick access
  const entriesByDate = useMemo(() => {
    if (!monthlySummary) return new Map<string, Entry>();
    return new Map(monthlySummary.entries.map((e) => [e.date, e]));
  }, [monthlySummary]);

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentYear(currentYear - 1);
      setCurrentMonth(11);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    const now = new Date();
    const isCurrentMonth =
      currentYear === now.getFullYear() && currentMonth === now.getMonth();
    if (isCurrentMonth) return;

    if (currentMonth === 11) {
      setCurrentYear(currentYear + 1);
      setCurrentMonth(0);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  const handleDayClick = (dateStr: string) => {
    // Toggle selection: if already selected, deselect; otherwise select
    setSelectedDate((prev) => (prev === dateStr ? null : dateStr));
  };

  const handleEditEntry = (dateStr: string) => {
    // Navigate to main page for editing
    navigate({ to: "/", search: { date: dateStr } });
  };

  // Get the entry for the selected date
  const selectedEntry = selectedDate ? entriesByDate.get(selectedDate) : null;

  const isCurrentMonth =
    currentYear === today.getFullYear() && currentMonth === today.getMonth();
  const todayStr = getLocalDateString(today);

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="space-y-6">
      {/* Month Navigator */}
      <div className="flex items-center justify-center gap-4">
        <Button variant="ghost" size="icon" onClick={handlePrevMonth}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-semibold min-w-[180px] text-center">{monthYear}</h1>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleNextMonth}
          disabled={isCurrentMonth}
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {/* Calendar Grid */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Calendar</CardTitle>
          <CardDescription>Click a day to view its entry below</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {/* Day headers */}
              {dayNames.map((day) => (
                <div
                  key={day}
                  className="text-center text-xs font-medium text-muted-foreground py-2"
                >
                  {day}
                </div>
              ))}
              {/* Calendar days */}
              {calendarDates.map((dateStr, index) => {
                if (!dateStr) {
                  return <div key={`empty-${index}`} className="aspect-square" />;
                }

                const dayNum = parseInt(dateStr.split("-")[2]);
                const hasEntry = datesWithEntries.has(dateStr);
                const isToday = dateStr === todayStr;
                const isFuture = dateStr > todayStr;
                const isSelected = dateStr === selectedDate;

                return (
                  <button
                    key={dateStr}
                    onClick={() => !isFuture && handleDayClick(dateStr)}
                    disabled={isFuture}
                    className={`
                      aspect-square flex flex-col items-center justify-center rounded-lg
                      text-sm transition-colors relative
                      ${isFuture ? "text-muted-foreground/50 cursor-not-allowed" : "hover:bg-accent cursor-pointer"}
                      ${isToday && !isSelected ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}
                      ${isSelected ? "ring-2 ring-primary ring-offset-2 bg-accent" : ""}
                      ${hasEntry && !isToday && !isSelected ? "bg-accent" : ""}
                    `}
                  >
                    <span>{dayNum}</span>
                    {hasEntry && (
                      <span
                        className={`absolute bottom-1 w-1.5 h-1.5 rounded-full ${
                          isToday ? "bg-primary-foreground" : "bg-primary"
                        }`}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Selected Entry Detail */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">
                {selectedDate || "Select a date"}
              </CardTitle>
              <CardDescription>
                {selectedDate
                  ? `${formatDateShort(selectedDate)}${selectedEntry ? " • Entry available" : " • No entry"}`
                  : "Click on a calendar date to view its entry"}
              </CardDescription>
            </div>
            {selectedDate && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleEditEntry(selectedDate)}
              >
                <Pencil className="h-4 w-4 mr-1" />
                {selectedEntry ? "Edit" : "Create"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {selectedEntry ? (
            <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:mt-2 prose-headings:mb-2 prose-p:my-1 prose-ul:my-1 prose-ol:my-1">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {selectedEntry.content}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-4">
              {selectedDate
                ? "No entry for this date. Click \"Create\" to add one."
                : "Your selected entry will appear here."}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Monthly Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Monthly Summary</CardTitle>
          <CardDescription>
            {monthlySummary?.totalEntries ?? 0} entries this month
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : monthlySummary && monthlySummary.entries.length > 0 ? (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {monthlySummary.entries.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => handleDayClick(entry.date)}
                  className="w-full text-left p-3 rounded-lg hover:bg-accent transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{entry.date}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateShort(entry.date)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {entry.content.replace(/^#+ /gm, "").slice(0, 100)}
                    {entry.content.length > 100 ? "..." : ""}
                  </p>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">
              No entries this month
            </p>
          )}
        </CardContent>
      </Card>

      {/* Weekly Summaries */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Weekly Summaries</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              {weeks.map((week) => {
                const weekEntries = monthlySummary?.entries.filter(
                  (e) => e.date >= week.weekStart && e.date <= week.weekEnd
                ) ?? [];

                return (
                  <WeekSummary
                    key={week.weekStart}
                    weekStart={week.weekStart}
                    weekEnd={week.weekEnd}
                    entries={weekEntries}
                    onDayClick={handleDayClick}
                  />
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface WeekSummaryProps {
  weekStart: string;
  weekEnd: string;
  entries: Array<{
    id: string;
    date: string;
    content: string;
  }>;
  onDayClick: (date: string) => void;
}

function WeekSummary({ weekStart, weekEnd, entries, onDayClick }: WeekSummaryProps) {
  const [expanded, setExpanded] = useState(false);

  const weekContext = `Week of ${formatDateShort(weekStart)} - ${formatDateShort(weekEnd)}`;

  return (
    <div className="border rounded-lg p-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-left"
      >
        <div>
          <span className="text-sm font-medium">
            {formatDateShort(weekStart)} - {formatDateShort(weekEnd)}
          </span>
          <span className="ml-2 text-xs text-muted-foreground">
            ({entries.length} {entries.length === 1 ? "entry" : "entries"})
          </span>
        </div>
        <ChevronRight
          className={`h-4 w-4 text-muted-foreground transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        />
      </button>

      {expanded && entries.length > 0 && (
        <div className="mt-3 border-t pt-3">
          {/* AI Summary - auto-starts when expanded */}
          <AISummary entries={entries} context={weekContext} autoStart />

          {/* Entry list */}
          <div className="space-y-3">
            {entries.map((entry) => (
              <button
                key={entry.id}
                onClick={() => onDayClick(entry.date)}
                className="w-full text-left p-2 rounded hover:bg-accent transition-colors"
              >
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  {entry.date}
                </div>
                <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-sm prose-headings:mt-1 prose-headings:mb-1 prose-p:my-0.5 prose-ul:my-0.5 prose-ol:my-0.5">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {entry.content.length > 300
                      ? entry.content.slice(0, 300) + "..."
                      : entry.content}
                  </ReactMarkdown>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {expanded && entries.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground text-center py-2 border-t">
          No entries this week
        </p>
      )}
    </div>
  );
}
