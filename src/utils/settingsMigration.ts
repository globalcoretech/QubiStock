import { AppSettings, DEFAULT_SETTINGS } from "../types";

export interface SettingsMigrationResult {
  migrated: boolean;
  settings: AppSettings | null;
  error?: string;
}

/**
 * Migrates legacy settings stored in localStorage to SQLite via set_settings_cmd.
 * Once migrated, settings are deleted from localStorage so only language preference
 * ('krishi_kendra_lang') remains in localStorage.
 *
 * @param invokeFn Tauri invoke function (or mock)
 * @param storage Storage interface (defaults to window.localStorage)
 */
export async function migrateLocalStorageSettingsToSqlite(
  invokeFn: (cmd: string, args?: any) => Promise<any>,
  storage: Storage = typeof window !== "undefined" ? window.localStorage : ({} as Storage)
): Promise<SettingsMigrationResult> {
  if (!storage || typeof storage.getItem !== "function") {
    return { migrated: false, settings: null };
  }

  const legacyKey = "krishi_kendra_settings";
  const raw = storage.getItem(legacyKey);

  if (!raw) {
    return { migrated: false, settings: null };
  }

  try {
    const parsed = JSON.parse(raw);
    const logoData = parsed.logoData ?? parsed.logoUrl ?? DEFAULT_SETTINGS.logoData ?? "";
    const signatureData = parsed.signatureData ?? parsed.signatureUrl ?? DEFAULT_SETTINGS.signatureData ?? "";
    const printOffsetXMm = parsed.printOffsetXMm ?? parsed.printOffsetXmm ?? DEFAULT_SETTINGS.printOffsetXMm ?? 0;
    const printOffsetYMm = parsed.printOffsetYMm ?? parsed.printOffsetYmm ?? DEFAULT_SETTINGS.printOffsetYMm ?? 0;

    const merged: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      logoData,
      signatureData,
      printOffsetXMm,
      printOffsetYMm,
    };

    // Clean up legacy keys so they are not sent to Rust
    delete (merged as any).logoUrl;
    delete (merged as any).signatureUrl;
    delete (merged as any).printOffsetXmm;
    delete (merged as any).printOffsetYmm;

    // Save to SQLite
    const toSettingsPayload = (s: any) => {
      const { logoUrl, signatureUrl, ...rest } = s;
      return {
        ...rest,
        logoData: rest.logoData ?? logoUrl ?? null,
        signatureData: rest.signatureData ?? signatureUrl ?? null,
      };
    };
    await invokeFn("set_settings_cmd", { settings: toSettingsPayload(merged) });

    // Clean up localStorage key so only language preference remains
    storage.removeItem(legacyKey);

    return { migrated: true, settings: merged };
  } catch (error) {
    console.error("Settings migration from localStorage failed:", error);
    return { migrated: false, settings: null, error: String(error) };
  }
}
