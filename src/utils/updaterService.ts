import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";

export interface UpdateStatus {
  isChecking: boolean;
  available: boolean;
  version?: string;
  currentVersion?: string;
  body?: string;
  date?: string;
  error?: string | null;
  downloadProgress?: number; // 0 to 100
  isDownloading?: boolean;
  isReadyToRestart?: boolean;
}

let activeUpdateInstance: Update | null = null;

/**
 * Check if a new version is available from GitHub Releases
 */
export async function checkForUpdates(): Promise<{
  available: boolean;
  version?: string;
  currentVersion?: string;
  body?: string;
  date?: string;
  error?: string | null;
}> {
  // If not running inside Tauri (e.g. unit test or web preview)
  if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
    return {
      available: false,
      error: "Updater is only active in the desktop application",
    };
  }

  try {
    const update = await check();
    if (update && update.available) {
      activeUpdateInstance = update;
      return {
        available: true,
        version: update.version,
        currentVersion: update.currentVersion,
        body: update.body || "",
        date: update.date || "",
      };
    }
    activeUpdateInstance = null;
    return {
      available: false,
    };
  } catch (err: any) {
    console.warn("Update check failed:", err);
    activeUpdateInstance = null;
    const msg = typeof err === "string" ? err : err?.message || String(err);
    return {
      available: false,
      error: msg,
    };
  }
}

/**
 * Download and install update safely:
 * 1. Takes an automatic database safety backup before updating
 * 2. Downloads and verifies cryptographic signature
 * 3. Installs and relaunches the app
 */
export async function installUpdate(
  onProgress?: (percent: number, statusText: string) => void
): Promise<void> {
  if (!activeUpdateInstance) {
    throw new Error("No update instance ready for download");
  }

  // 1. Safety First: Pre-update database backup
  if (onProgress) {
    onProgress(5, "डेटाबेस का सुरक्षा बैकअप लिया जा रहा है... (Creating safety backup)");
  }
  try {
    await invoke("backup_now_cmd");
  } catch (backupErr) {
    console.warn("Pre-update backup warning (proceeding):", backupErr);
  }

  // 2. Download and install with progress tracking
  let totalBytes = 0;
  let downloadedBytes = 0;

  await activeUpdateInstance.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        totalBytes = event.data.contentLength || 0;
        if (onProgress) {
          onProgress(10, "नया संस्करण डाउनलोड होना शुरू हुआ... (Download started)");
        }
        break;
      case "Progress":
        downloadedBytes += event.data.chunkLength;
        if (totalBytes > 0 && onProgress) {
          const pct = Math.min(95, Math.round(10 + (downloadedBytes / totalBytes) * 80));
          const mbDownloaded = (downloadedBytes / (1024 * 1024)).toFixed(1);
          const mbTotal = (totalBytes / (1024 * 1024)).toFixed(1);
          onProgress(pct, `डाउनलोड हो रहा है: ${mbDownloaded} MB / ${mbTotal} MB (${pct}%)`);
        }
        break;
      case "Finished":
        if (onProgress) {
          onProgress(98, "सत्यापन और इंस्टॉलेशन पूरा हुआ... (Verifying update)");
        }
        break;
    }
  });

  if (onProgress) {
    onProgress(100, "सफलतापूर्वक अपडेट हुआ! ऐप रीस्टार्ट हो रहा है... (Restarting app)");
  }

  // 3. Relaunch the application
  await relaunch();
}

