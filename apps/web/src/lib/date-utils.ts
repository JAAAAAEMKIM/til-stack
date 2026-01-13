/**
 * Get current date as YYYY-MM-DD string in local timezone
 */
export function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Format date as full readable string (e.g., "Monday, January 6, 2025")
 */
export function formatDateFull(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Format date as short string (e.g., "Jan 6")
 */
export function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Get human-friendly label for a date (Today, Yesterday, Tomorrow, or full date)
 */
export function getDateLabel(dateStr: string): string {
  const today = getLocalDateString();
  const yesterday = getLocalDateString(new Date(Date.now() - 86400000));
  const tomorrow = getLocalDateString(new Date(Date.now() + 86400000));

  if (dateStr === today) return "Today";
  if (dateStr === yesterday) return "Yesterday";
  if (dateStr === tomorrow) return "Tomorrow";
  return formatDateFull(dateStr);
}

/**
 * Add days to a date string
 */
export function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + "T00:00:00");
  date.setDate(date.getDate() + days);
  return getLocalDateString(date);
}

export interface SkipDaysConfig {
  weekdays: number[];
  specificDates: string[];
}

/**
 * Check if a date should be skipped based on config
 */
export function shouldSkipDate(
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

/**
 * Get next valid day (skipping configured skip days)
 */
export function getNextValidDay(
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
