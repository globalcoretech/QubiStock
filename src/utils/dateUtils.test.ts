import { describe, it, expect } from "vitest";
import {
  localDateIso,
  localTodayIso,
  localMonthStartIso,
  localMonthEndIso,
  localFyStartIso,
  localFyEndIso,
  parseLocalDate,
} from "./dateUtils";

describe("dateUtils: Local timezone date and fiscal year helpers", () => {
  it("formats local 12:30 AM date correctly without UTC shift", () => {
    // 1 Nov 2026, 12:30 AM local time
    // In UTC (for IST +05:30), this is 2026-10-31T19:00:00Z.
    // .toISOString() would return 2026-10-31, but localDateIso MUST return 2026-11-01.
    const midnightTestDate = new Date(2026, 10, 1, 0, 30);
    expect(localDateIso(midnightTestDate)).toBe("2026-11-01");
  });

  it("calculates Indian Financial Year start for Nov 2026 as 2026-04-01", () => {
    const testDate = new Date(2026, 10, 1, 0, 30);
    expect(localFyStartIso(testDate)).toBe("2026-04-01");
    expect(localFyEndIso(testDate)).toBe("2027-03-31");
  });

  it("calculates Indian Financial Year for Jan 2027 correctly (FY 2026-27)", () => {
    const janDate = new Date(2027, 0, 15, 14, 0); // 15 Jan 2027
    expect(localDateIso(janDate)).toBe("2027-01-15");
    expect(localFyStartIso(janDate)).toBe("2026-04-01");
    expect(localFyEndIso(janDate)).toBe("2027-03-31");
  });

  it("calculates month start and month end accurately", () => {
    const testDate = new Date(2026, 10, 15); // Nov 2026
    expect(localMonthStartIso(testDate)).toBe("2026-11-01");
    expect(localMonthEndIso(testDate)).toBe("2026-11-30");

    const leapFeb = new Date(2024, 1, 10); // Feb 2024 (leap year)
    expect(localMonthStartIso(leapFeb)).toBe("2024-02-01");
    expect(localMonthEndIso(leapFeb)).toBe("2024-02-29");
  });

  it("safely parses local date without timezone distortion", () => {
    const parsed = parseLocalDate("2026-11-01");
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(10); // November
    expect(parsed.getDate()).toBe(1);
    expect(localDateIso(parsed)).toBe("2026-11-01");
  });

  it("localTodayIso matches current local date", () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(localTodayIso()).toBe(expected);
  });
});
