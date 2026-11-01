/**
 * Utilities for consistent local timezone date formatting and fiscal year calculations.
 * Avoids UTC timezone shifts caused by .toISOString().
 */

/**
 * Formats a Date object into 'YYYY-MM-DD' using local timezone components.
 */
export function localDateIso(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Returns today's date in 'YYYY-MM-DD' using local timezone.
 */
export function localTodayIso(): string {
  return localDateIso(new Date());
}

/**
 * Returns the start of the month in 'YYYY-MM-DD' for the given date (defaults to current date).
 */
export function localMonthStartIso(d: Date = new Date()): string {
  return localDateIso(new Date(d.getFullYear(), d.getMonth(), 1));
}

/**
 * Returns the end of the month in 'YYYY-MM-DD' for the given date (defaults to current date).
 */
export function localMonthEndIso(d: Date = new Date()): string {
  return localDateIso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/**
 * Returns the start date ('YYYY-04-01') of the Indian Financial Year (April 1 to March 31).
 * If month is Jan..Mar (0..2), FY started on April 1 of previous year.
 * If month is Apr..Dec (3..11), FY started on April 1 of current year.
 */
export function localFyStartIso(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-indexed
  const fyYear = month < 3 ? year - 1 : year;
  return `${fyYear}-04-01`;
}

/**
 * Returns the end date ('YYYY-03-31') of the Indian Financial Year (April 1 to March 31).
 */
export function localFyEndIso(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = d.getMonth();
  const fyYear = month < 3 ? year : year + 1;
  return `${fyYear}-03-31`;
}

/**
 * Safely parses a 'YYYY-MM-DD' string into a local Date without UTC timezone distortion.
 */
export function parseLocalDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  const clean = dateStr.split("T")[0].trim();
  const parts = clean.split("-");
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return new Date(y, m, d, 0, 0, 0, 0);
    }
  }
  return new Date(dateStr);
}
