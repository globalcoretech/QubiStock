import { describe, it, expect, vi } from "vitest";
import { migrateLocalStorageSettingsToSqlite } from "./settingsMigration";
import { DEFAULT_SETTINGS } from "../types";

// In-memory Mock Storage implementation
class MockStorage implements Storage {
  private store: Record<string, string> = {};

  get length(): number {
    return Object.keys(this.store).length;
  }

  clear(): void {
    this.store = {};
  }

  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }

  key(index: number): string | null {
    return Object.keys(this.store)[index] ?? null;
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }
}

describe("migrateLocalStorageSettingsToSqlite", () => {
  it("does nothing when localStorage has no settings", async () => {
    const storage = new MockStorage();
    storage.setItem("krishi_kendra_lang", "hi");
    const invokeMock = vi.fn().mockResolvedValue({});

    const result = await migrateLocalStorageSettingsToSqlite(invokeMock, storage);

    expect(result.migrated).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(storage.getItem("krishi_kendra_lang")).toBe("hi");
  });

  it("migrates legacy settings to SQLite and removes key from localStorage leaving only language", async () => {
    const storage = new MockStorage();
    storage.setItem("krishi_kendra_lang", "en");
    storage.setItem(
      "krishi_kendra_settings",
      JSON.stringify({
        shopName: "किसान सेवा केंद्र",
        phone: "+91 99999 88888",
        isComposition: true,
      })
    );

    const invokeMock = vi.fn().mockResolvedValue({});

    const result = await migrateLocalStorageSettingsToSqlite(invokeMock, storage);

    expect(result.migrated).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("set_settings_cmd", {
      settings: expect.objectContaining({
        shopName: "किसान सेवा केंद्र",
        phone: "+91 99999 88888",
        isComposition: true,
        gstin: DEFAULT_SETTINGS.gstin, // default preserved
      }),
    });

    // Verify localStorage key is removed
    expect(storage.getItem("krishi_kendra_settings")).toBeNull();
    // Language must remain in localStorage
    expect(storage.getItem("krishi_kendra_lang")).toBe("en");
  });

  it("handles corrupted JSON gracefully without crashing", async () => {
    const storage = new MockStorage();
    storage.setItem("krishi_kendra_settings", "{ invalid json");
    const invokeMock = vi.fn().mockResolvedValue({});

    const result = await migrateLocalStorageSettingsToSqlite(invokeMock, storage);

    expect(result.migrated).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
