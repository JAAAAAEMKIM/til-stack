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
