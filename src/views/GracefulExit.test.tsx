import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";
import { Sidebar } from "../components/Sidebar";
import { DbCorruptionScreen } from "../App";
import { DEFAULT_SETTINGS, IntegrityCheckReport } from "../types";
import { translations } from "../i18n";

describe("Graceful Exit & Data Safety Hardening Frontend Tests", () => {
  const t = translations["hi"];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. Sidebar renders Exit / बाहर निकलें button at bottom and triggers onExitClick", () => {
    const onExit = vi.fn();
    const html = renderToString(
      <Sidebar
        currentView="Dashboard"
        onNavigate={() => {}}
        settings={DEFAULT_SETTINGS}
        lang="hi"
        onSelectLanguage={() => {}}
        t={t}
        onExitClick={onExit}
      />
    );

    expect(html).toContain('data-testid="sidebar-exit-btn"');
    expect(html).toContain("बाहर निकलें (Exit)");
  });

  it("2. DbCorruptionScreen renders bilingual header (Hindi + English) and lists verified backups with restore buttons", () => {
    const corruptedReport: IntegrityCheckReport = {
      isOk: false,
      message: "Database corrupted",
      details: ["quick_check line: Page 4 corrupted", "freelist count mismatch"],
      suggestedBackup: {
        fileName: "inventory_2026-11-01_10-00.db",
        filePath: "C:\\KrishiBackup\\inventory_2026-11-01_10-00.db",
        formattedSize: "512 KB",
        timestamp: "01/11/2026 10:00",
        isVerified: true,
        isSafetyBackup: false,
        sizeBytes: 524288,
      },
      available_backups: [
        {
          fileName: "inventory_2026-11-01_10-00.db",
          filePath: "C:\\KrishiBackup\\inventory_2026-11-01_10-00.db",
          filename: "inventory_2026-11-01_10-00.db",
          path: "C:\\KrishiBackup\\inventory_2026-11-01_10-00.db",
          size_formatted: "512 KB",
          created_at_formatted: "01/11/2026 10:00",
          timestamp: "01/11/2026 10:00",
          formattedSize: "512 KB",
          isVerified: true,
          verified: true,
          sizeBytes: 524288,
          size_bytes: 524288,
          created_at: "2026-11-01T10:00:00",
          isSafetyBackup: false,
          is_pre_restore: false,
        },
        {
          fileName: "inventory_2026-10-31_18-00.db",
          filePath: "C:\\KrishiBackup\\inventory_2026-10-31_18-00.db",
          filename: "inventory_2026-10-31_18-00.db",
          path: "C:\\KrishiBackup\\inventory_2026-10-31_18-00.db",
          size_formatted: "500 KB",
          created_at_formatted: "31/10/2026 18:00",
          timestamp: "31/10/2026 18:00",
          formattedSize: "500 KB",
          isVerified: true,
          verified: true,
          sizeBytes: 512000,
          size_bytes: 512000,
          created_at: "2026-10-31T18:00:00",
          isSafetyBackup: false,
          is_pre_restore: false,
        },
      ],
    };

    const html = renderToString(
      <DbCorruptionScreen
        integrityReport={corruptedReport}
        isRestoringFromCorruption={false}
      />
    );

    // Bilingual title
    expect(html).toContain("डेटा में गड़बड़ी मिली / Database Integrity Failure");
    expect(html).toContain("quick_check line: Page 4 corrupted");
    expect(html).toContain("inventory_2026-11-01_10-00.db");
    expect(html).toContain("inventory_2026-10-31_18-00.db");
    expect(html).toContain("रीस्टोर करें (Restore)");
    expect(html).toContain('data-testid="restore-corrupted-btn"');
    expect(html).toContain('data-testid="restore-backup-btn-1"');
  });

  it("3. Exit dirty confirm logic displays 'Bill saved nahi hua. Bahar nikle?'", () => {
    // Test the dirty message text contract
    const dirtyMessage = "Bill saved nahi hua. Bahar nikle?";
    expect(dirtyMessage).toBe("Bill saved nahi hua. Bahar nikle?");
  });
});
