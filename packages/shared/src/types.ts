export interface Entry {
  id: string;
  date: string; // YYYY-MM-DD format
  content: string;
  createdAt: string; // ISO 8601 string
  updatedAt: string; // ISO 8601 string
}

export interface EntryListItem {
  id: string;
  date: string;
  content: string;
  createdAt: string; // ISO 8601 string
}

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface WeeklySummary {
  weekStart: string; // Monday date
  weekEnd: string;   // Sunday date
  entries: Entry[];
  totalEntries: number;
}

export interface MonthlySummary {
  month: string; // YYYY-MM format
  entries: Entry[];
  totalEntries: number;
  weeks: WeeklySummary[];
}

// Config types
export interface SkipDay {
  id: string;
  type: "weekday" | "specific_date";
  value: string;
  createdAt: string;
}

export interface Template {
  id: string;
  name: string;
  content: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SkipDaysConfig {
  weekdays: number[]; // 0-6 (Sunday-Saturday)
  specificDates: string[]; // YYYY-MM-DD format
  raw: SkipDay[];
}

export type DayOfWeek = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

export interface Webhook {
  id: string;
  name: string;
  url: string;
  message: string;
  time: string; // HH:MM format
  days: DayOfWeek[];
  timezone: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
