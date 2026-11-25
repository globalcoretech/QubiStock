// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  setUpdateSnooze,
  isUpdateSnoozed,
  clearUpdateSnooze,
  SNOOZE_STORAGE_KEY,
} from "./updateScheduler";

describe("updateScheduler", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns false when no snooze is set", () => {
    expect(isUpdateSnoozed()).toBe(false);
  });

  it("sets and checks snooze for positive minutes", () => {
    setUpdateSnooze(30);
    expect(isUpdateSnoozed()).toBe(true);
    const stored = localStorage.getItem(SNOOZE_STORAGE_KEY);
    expect(stored).toBeTruthy();
  });

  it("sets session snooze when minutes is negative", () => {
    setUpdateSnooze(-1);
    expect(localStorage.getItem(SNOOZE_STORAGE_KEY)).toBe("session");
    expect(isUpdateSnoozed()).toBe(true);
  });

  it("clears snooze and returns false", () => {
    setUpdateSnooze(15);
    expect(isUpdateSnoozed()).toBe(true);
    clearUpdateSnooze();
    expect(isUpdateSnoozed()).toBe(false);
    expect(localStorage.getItem(SNOOZE_STORAGE_KEY)).toBeNull();
  });

  it("returns false if snooze timestamp has expired", () => {
    const expiredTimestamp = Date.now() - 5000;
    localStorage.setItem(SNOOZE_STORAGE_KEY, expiredTimestamp.toString());
    expect(isUpdateSnoozed()).toBe(false);
    // Should have cleared expired key
    expect(localStorage.getItem(SNOOZE_STORAGE_KEY)).toBeNull();
  });
});
