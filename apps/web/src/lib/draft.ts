const DRAFT_KEY_PREFIX = "til-draft-";

export function getDraftKey(date: string): string {
  return `${DRAFT_KEY_PREFIX}${date}`;
}

export function saveDraft(date: string, content: string): void {
  if (!content.trim()) {
    removeDraft(date);
    return;
  }
  try {
    localStorage.setItem(getDraftKey(date), content);
  } catch {
    // localStorage full or unavailable - silently fail
  }
}

export function loadDraft(date: string): string | null {
  try {
    return localStorage.getItem(getDraftKey(date));
  } catch {
    return null;
  }
}

export function removeDraft(date: string): void {
  try {
    localStorage.removeItem(getDraftKey(date));
  } catch {
    // silently fail
  }
}
