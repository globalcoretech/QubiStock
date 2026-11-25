// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkForUpdates, installUpdate } from "./updaterService";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("updaterService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as any).__TAURI_INTERNALS__;
  });

  describe("checkForUpdates", () => {
    it("returns available: false when running outside Tauri desktop (e.g. web preview / browser)", async () => {
      const res = await checkForUpdates();
      expect(res.available).toBe(false);
      expect(res.error).toContain("desktop application");
      expect(check).not.toHaveBeenCalled();
    });

    it("returns available: false when no update is found from endpoint", async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      (check as any).mockResolvedValueOnce(null);

      const res = await checkForUpdates();
      expect(res.available).toBe(false);
      expect(check).toHaveBeenCalledTimes(1);
    });

    it("returns available: true with version and release notes when update is available", async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      (check as any).mockResolvedValueOnce({
        available: true,
        version: "0.2.0",
        currentVersion: "0.1.0",
        body: "- New GST Reports\n- Faster billing",
        date: "2026-11-25",
      });

      const res = await checkForUpdates();
      expect(res.available).toBe(true);
      expect(res.version).toBe("0.2.0");
      expect(res.currentVersion).toBe("0.1.0");
      expect(res.body).toContain("New GST Reports");
      expect(res.date).toBe("2026-11-25");
    });

    it("catches network / endpoint errors gracefully and returns error message", async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      (check as any).mockRejectedValueOnce(new Error("Network 404: release not found"));

      const res = await checkForUpdates();
      expect(res.available).toBe(false);
      expect(res.error).toBe("Network 404: release not found");
    });
  });

  describe("installUpdate", () => {
    it("throws error when installUpdate is called before checking or when no update is ready", async () => {
      await expect(installUpdate()).rejects.toThrow("No update instance ready for download");
    });

    it("safely backs up database, downloads update with progress, and relaunches app", async () => {
      (window as any).__TAURI_INTERNALS__ = {};
      const mockDownloadAndInstall = vi.fn().mockImplementation(async (callback) => {
        // Simulate Started
        callback({ event: "Started", data: { contentLength: 1000 } });
        // Simulate Progress
        callback({ event: "Progress", data: { chunkLength: 500 } });
        callback({ event: "Progress", data: { chunkLength: 500 } });
        // Simulate Finished
        callback({ event: "Finished" });
      });

      (check as any).mockResolvedValueOnce({
        available: true,
        version: "0.2.0",
        currentVersion: "0.1.0",
        downloadAndInstall: mockDownloadAndInstall,
      });

      // 1. Check for update to set active instance
      const checkRes = await checkForUpdates();
      expect(checkRes.available).toBe(true);

      // 2. Install update with progress tracker
      const progressSteps: number[] = [];
      const statusTexts: string[] = [];

      await installUpdate((pct, msg) => {
        progressSteps.push(pct);
        statusTexts.push(msg);
      });

      // Verification
      // a. Database safety backup was invoked
      expect(invoke).toHaveBeenCalledWith("backup_now_cmd");
      // b. Download & install was executed
      expect(mockDownloadAndInstall).toHaveBeenCalledTimes(1);
      // c. Progress steps reached 100
      expect(progressSteps).toContain(5); // Backup stage
      expect(progressSteps).toContain(10); // Download started
      expect(progressSteps).toContain(98); // Verification stage
      expect(progressSteps[progressSteps.length - 1]).toBe(100);
      // d. App relaunch was triggered
      expect(relaunch).toHaveBeenCalledTimes(1);
    });
  });
});
