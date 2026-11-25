/**
 * Utilities for scheduling and snoozing update notifications
 */

export const SNOOZE_STORAGE_KEY = "qubistock_update_snooze_until";

function getStorage(): Storage | null {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  if (typeof localStorage !== "undefined") {
    return localStorage;
  }
  return null;
}

/**
 * Snooze update notifications for a specified number of minutes.
 * If minutes <= 0, it snoozes for the session / until next app restart.
 */
export function setUpdateSnooze(minutes: number): void {
  try {
    const storage = getStorage();
    if (!storage) return;

    if (minutes <= 0) {
      storage.setItem(SNOOZE_STORAGE_KEY, "session");
      return;
    }
    const snoozeUntil = Date.now() + minutes * 60 * 1000;
    storage.setItem(SNOOZE_STORAGE_KEY, snoozeUntil.toString());
  } catch (e) {
    console.warn("Failed to set update snooze in localStorage:", e);
  }
}

/**
 * Check if update notifications are currently snoozed.
 */
export function isUpdateSnoozed(): boolean {
  try {
    const storage = getStorage();
    if (!storage) return false;

    const val = storage.getItem(SNOOZE_STORAGE_KEY);
    if (!val) return false;
    if (val === "session") return true;

    const snoozeUntil = parseInt(val, 10);
    if (isNaN(snoozeUntil)) {
      storage.removeItem(SNOOZE_STORAGE_KEY);
      return false;
    }

    if (Date.now() < snoozeUntil) {
      return true;
    }

    // Snooze time has expired, clear it
    storage.removeItem(SNOOZE_STORAGE_KEY);
    return false;
  } catch (e) {
    console.warn("Failed to read update snooze from localStorage:", e);
    return false;
  }
}

/**
 * Clear the snooze setting immediately
 */
export function clearUpdateSnooze(): void {
  try {
    const storage = getStorage();
    if (!storage) return;
    storage.removeItem(SNOOZE_STORAGE_KEY);
  } catch (e) {
    console.warn("Failed to clear update snooze:", e);
  }
}
