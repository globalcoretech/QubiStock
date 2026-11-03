// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import App from "./App";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const defaultMockHandler = (cmd: string) => {
  if (cmd === "init_db_cmd") return Promise.resolve("ok");
  if (cmd === "get_security_status_cmd") {
    return Promise.resolve({
      has_users: true,
      security_enabled: true,
      current_user: null,
      is_locked: false,
      auto_lock_minutes: 10,
    });
  }
  if (cmd === "get_users_cmd") {
    return Promise.resolve([
      { id: 1, name: "OwnerJi", role: "owner", is_active: true, failed_attempts: 0, locked_until: null, created_at: "" },
    ]);
  }
  if (cmd === "get_settings_cmd") return Promise.resolve({ shopName: "कृषि सेवा केंद्र" });
  if (cmd === "get_db_safety_info_cmd") return Promise.resolve(null);
  if (cmd === "get_dashboard_stats_cmd") {
    return Promise.resolve({
      today_sales: 0,
      month_sales: 0,
      today_invoices_count: 0,
      low_stock_count: 0,
      expiring_soon_count: 0,
      total_receivable: 0,
      total_payable: 0,
      cash_in_hand: 0,
    });
  }
  if (cmd === "get_top_receivables_cmd") return Promise.resolve([]);
  if (cmd === "get_low_stock_items_cmd") return Promise.resolve([]);
  if (cmd === "get_recent_invoices_cmd") return Promise.resolve([]);
  if (cmd === "get_inventory_health_cmd") return Promise.resolve({ low_stock_count: 0, expiring_count: 0 });
  return Promise.resolve(null);
};

describe("Startup Health & Corruption Screen Routing", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("1. Unhealthy startup flag (corruption_detected = true) displays the DbCorruptionScreen", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_startup_health_cmd") {
        return Promise.resolve({
          healthy: false,
          corruption_detected: true,
        });
      }
      if (cmd === "check_db_integrity_cmd") {
        return Promise.resolve({
          isOk: false,
          is_ok: false,
          message: "डेटाबेस क्षतिग्रस्त है",
          details: ["PRAGMA quick_check failed with corruption"],
          suggestedBackup: null,
          availableBackups: [],
        });
      }
      return defaultMockHandler(cmd);
    });

    const root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });

    // Verify DbCorruptionScreen is rendered
    expect(container.querySelector('[data-testid="db-corruption-screen"]')).toBeTruthy();
    expect(container.textContent).toContain("डेटा में गड़बड़ी मिली");
    expect(container.textContent).toContain("Database Integrity Failure");
  });

  it("2. IPC permission error on startup check does NOT trigger DbCorruptionScreen", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_startup_health_cmd") {
        // Simulating an IPC error (e.g. Permission denied or command error)
        return Promise.reject(new Error("Permission denied: Login required for check_db_integrity_cmd"));
      }
      return defaultMockHandler(cmd);
    });

    const root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });

    // Corruption screen must NOT be shown!
    expect(container.querySelector('[data-testid="db-corruption-screen"]')).toBeNull();
    expect(container.textContent).not.toContain("डेटा में गड़बड़ी मिली");
    expect(container.textContent).not.toContain("Database Integrity Failure");
    // Normal login modal should be shown
    expect(container.textContent).toContain("लॉगिन करें");
  });

  it("3. Healthy startup flag (corruption_detected = false) does NOT trigger DbCorruptionScreen", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_startup_health_cmd") {
        return Promise.resolve({
          healthy: true,
          corruption_detected: false,
        });
      }
      return defaultMockHandler(cmd);
    });

    const root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });

    // Corruption screen must NOT be shown!
    expect(container.querySelector('[data-testid="db-corruption-screen"]')).toBeNull();
    expect(container.textContent).not.toContain("डेटा में गड़बड़ी मिली");
    expect(container.textContent).not.toContain("Database Integrity Failure");
    // Normal login modal should be shown
    expect(container.textContent).toContain("लॉगिन करें");
  });
});
