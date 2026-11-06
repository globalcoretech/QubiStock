import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./index.css";
import { View, AppSettings, DEFAULT_SETTINGS, IntegrityCheckReport, StartupHealthInfo, RestoreResult, DbSafetyInfo, BackupInfo, SessionUser, SecurityStatus } from "./types";
import { InitialSetupWizard } from "./components/InitialSetupWizard";
import { LoginModal } from "./components/LoginModal";
import { LockScreenOverlay } from "./components/LockScreenOverlay";
import { Language, translations, getInitialLanguage, saveLanguagePreference } from "./i18n";
import { Sidebar } from "./components/Sidebar";
import { AlertCircle, LogOut } from "./components/icons";
import { DashboardView } from "./views/DashboardView";
import { TransactionView } from "./views/TransactionView";
import { StockView } from "./views/StockView";
import { OpeningStockView } from "./views/OpeningStockView";
import { StockAdjustmentView } from "./views/StockAdjustmentView";
import { LenDenView } from "./views/LenDenView";
import { PartiesView } from "./views/PartiesView";
import { ItemsView } from "./views/ItemsView";
import { TallyImportView } from "./views/TallyImportView";
import { ReportsView } from "./views/ReportsView";
import { SettingsView } from "./views/SettingsView";
import { PrinterSetupView } from "./views/PrinterSetupView";
import { PaymentView } from "./views/PaymentView";
import { BackupView } from "./views/BackupView";
import { PrintInvoiceModal } from "./components/PrintInvoiceModal";
import { BillPreviewPage } from "./components/bills/BillPreviewPage";
import { FirstTimeSetupView } from "./views/FirstTimeSetupView";
import { SplashScreen } from "./components/SplashScreen";
import { UpdateNotificationModal } from "./components/UpdateNotificationModal";
import { checkForUpdates } from "./utils/updaterService";
import { migrateLocalStorageSettingsToSqlite } from "./utils/settingsMigration";

export const toSettingsPayload = (s: any) => {
  const { logoUrl, signatureUrl, ...rest } = s;
  return {
    ...rest,
    logoData: rest.logoData ?? logoUrl ?? null,
    signatureData: rest.signatureData ?? signatureUrl ?? null,
  };
};

export interface DbCorruptionScreenProps {
  integrityReport: IntegrityCheckReport;
  isRestoringFromCorruption?: boolean;
  corruptionFeedback?: string | null;
  onRestore?: () => Promise<void> | void;
  onRestoreBackup?: (backupPath: string) => Promise<void> | void;
}

export function DbCorruptionScreen({
  integrityReport,
  isRestoringFromCorruption = false,
  corruptionFeedback = null,
  onRestore,
  onRestoreBackup,
}: DbCorruptionScreenProps) {
  const detailsList = integrityReport.details ?? (integrityReport.message ? [integrityReport.message] : []);
  const suggested = integrityReport.suggestedBackup ?? integrityReport.suggested_backup;
  const availableBackups: BackupInfo[] =
    integrityReport.available_backups ||
    integrityReport.availableBackups ||
    (suggested ? [suggested as unknown as BackupInfo] : []);

  const handleRestorePath = (path: string) => {
    if (onRestoreBackup) {
      onRestoreBackup(path);
    } else if (onRestore) {
      onRestore();
    }
  };

  return (
    <div
      data-testid="db-corruption-screen"
      className="min-h-screen w-screen bg-rose-50 flex items-center justify-center p-6 text-slate-900 font-body select-none"
    >
      <div className="max-w-2xl w-full bg-white rounded-2xl shadow-xl border-2 border-rose-300 p-8 space-y-6">
        <div className="flex items-center gap-4 text-rose-600">
          <div className="w-14 h-14 rounded-full bg-rose-100 flex items-center justify-center flex-shrink-0">
            <AlertCircle size={32} />
          </div>
          <div>
            <h1 className="text-2xl font-bold font-serif text-rose-900">
              डेटा में गड़बड़ी मिली / Database Integrity Failure
            </h1>
            <p className="text-sm text-rose-700 font-medium mt-1">
              डेटाबेस फ़ाइल में खराबी या अनपेक्षित बदलाव पाया गया है। कृपया नीचे दिए गए सत्यापित बैकअप से रीस्टोर करें।
            </p>
            <p className="text-xs text-rose-600 mt-0.5">
              Database integrity check failed. Never operating silently on damaged data. Please restore from a verified backup.
            </p>
          </div>
        </div>

        <div className="bg-rose-50/80 rounded-xl p-4 border border-rose-200 text-xs font-mono text-rose-900 max-h-36 overflow-y-auto space-y-1">
          {detailsList.map((d, i) => (
            <div key={i}>• {d}</div>
          ))}
        </div>

        {corruptionFeedback ? (
          <div className="p-4 bg-emerald-100 border border-emerald-300 rounded-xl text-emerald-950 font-bold text-sm text-center space-y-2">
            <div>{corruptionFeedback}</div>
            <div className="text-xs font-normal text-emerald-800">
              रीस्टोर फ़ाइल तैयार है। कृपया ऐप बंद करके फिर से खोलें (Restart the application).
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                सुझाया गया सुरक्षित बैकअप / उपलब्ध सत्यापित बैकअप (Available Verified Backups)
              </span>
              <span className="text-xs bg-emerald-100 text-emerald-800 font-bold px-2.5 py-0.5 rounded-full">
                जाँचा हुआ ✓ / Safe Recovery
              </span>
            </div>

            {availableBackups.length > 0 ? (
              <div className="max-h-64 overflow-y-auto space-y-2.5 pr-1">
                {availableBackups.map((b, idx) => {
                  const bName = b.fileName || b.filename || "";
                  const bDate = b.timestamp || b.created_at_formatted || "";
                  const bSize = b.formattedSize || b.size_formatted || "";
                  const bPath = b.filePath || b.path || "";
                  const isSuggested = suggested && (suggested.fileName === bName || suggested.filename === bName);

                  return (
                    <div
                      key={idx}
                      className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
                        isSuggested
                          ? "bg-emerald-50/80 border-emerald-300 shadow-2xs"
                          : "bg-slate-50 border-slate-200 hover:bg-slate-100/70"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-900 truncate">{bName}</span>
                          {isSuggested && (
                            <span className="text-[10px] bg-emerald-200 text-emerald-900 font-extrabold px-1.5 py-0.5 rounded">
                              सुझाया गया / Latest
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          तारीख: {bDate} • आकार: {bSize}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid={isSuggested ? "restore-corrupted-btn" : `restore-backup-btn-${idx}`}
                        disabled={isRestoringFromCorruption}
                        onClick={() => handleRestorePath(bPath)}
                        className={`py-2 px-3.5 rounded-lg font-bold text-xs shadow-xs transition-all flex items-center justify-center flex-shrink-0 cursor-pointer ${
                          isSuggested
                            ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                            : "bg-slate-800 hover:bg-slate-900 text-white"
                        }`}
                      >
                        {isRestoringFromCorruption
                          ? "तैयारी चल रही है..."
                          : isSuggested
                          ? "इस बैकअप से वापस लाओ"
                          : "रीस्टोर करें (Restore)"}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl text-amber-900 text-sm">
                कोई वैध बैकअप नहीं मिला। कृपया अपने बैकअप फ़ोल्डर (Documents\KrishiBackup) की जांच करें या तकनीकी सहायता लें।
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  if (typeof window !== "undefined" && window.location.search.includes("bill_preview")) {
    return <BillPreviewPage />;
  }

  const [currentView, setCurrentView] = useState<View>("Dashboard");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [paymentInitialPartyId, setPaymentInitialPartyId] = useState<number | null>(null);
  const [paymentInitialType, setPaymentInitialType] = useState<"receipt" | "payment">("receipt");

  const [itemsInitialOpenForm, setItemsInitialOpenForm] = useState(false);
  const [alteringInvoice, setAlteringInvoice] = useState<{ invoiceNo: string; type: "sale" | "purchase" } | null>(null);

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [integrityReport, setIntegrityReport] = useState<IntegrityCheckReport | null>(null);
  const [isRestoringFromCorruption, setIsRestoringFromCorruption] = useState(false);
  const [corruptionFeedback, setCorruptionFeedback] = useState<string | null>(null);

  // Safety & Graceful Exit states
  const [safetyInfo, setSafetyInfo] = useState<DbSafetyInfo | null>(null);
  const [dismissedLocationWarning, setDismissedLocationWarning] = useState(false);
  const [exitModalState, setExitModalState] = useState<"none" | "busy" | "dirty" | "clean" | "exiting">("none");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("krishi_sidebar_collapsed") === "true";
    }
    return false;
  });

  // Local Auth & Security State
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [securityStatus, setSecurityStatus] = useState<SecurityStatus | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [showInitialSetup, setShowInitialSetup] = useState(false);
  const [exitListenerWarning, setExitListenerWarning] = useState<string | null>(null);

  // Dirty and Busy tracking
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const isBackingUp = false;

  const appStateRef = useRef({
    isDirty: false,
    isBusy: false,
  });

  appStateRef.current = {
    isDirty,
    isBusy: isSaving || isPrinting || isBackingUp || isRestoring,
  };

  const [lang, setLang] = useState<Language>(() => getInitialLanguage());
  const t = translations[lang];

  const [showSplash, setShowSplash] = useState<boolean>(() => {
    if (typeof process !== "undefined" && process.env.NODE_ENV === "test") {
      return false;
    }
    return true;
  });

  const [availableUpdate, setAvailableUpdate] = useState<{
    version: string;
    currentVersion?: string;
    body?: string;
    date?: string;
  } | null>(null);

  const handleLanguageChange = (newLang: Language) => {
    setLang(newLang);
    saveLanguagePreference(newLang);
  };

  const [activePrintInvoiceNo, setActivePrintInvoiceNo] = useState("");
  const [activePrintTaxMode, setActivePrintTaxMode] = useState<"with_tax" | "without_tax">("with_tax");
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  const openPrintModal = (invNo: string, taxMode: "with_tax" | "without_tax" = "with_tax") => {
    setActivePrintInvoiceNo(invNo);
    setActivePrintTaxMode(taxMode);
    setIsPrintModalOpen(true);
    setIsPrinting(true);
  };

  const closePrintModal = () => {
    setIsPrintModalOpen(false);
    setIsPrinting(false);
  };

  const triggerGlobalRefresh = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  const updateSettings = async (newSettings: AppSettings) => {
    try {
      await invoke("set_settings_cmd", { settings: toSettingsPayload(newSettings) });
      setSettings(newSettings);
      triggerGlobalRefresh();
    } catch (e) {
      console.error("set_settings_cmd SQLite error:", e);
      throw e;
    }
  };

  const handleRequestExit = () => {
    // If user is not logged in yet (or initial setup is open), there is no active session or unsaved documents.
    // Exit application immediately and safely!
    if (!currentUser) {
      handleConfirmExit();
      return;
    }
    const { isDirty: currentDirty, isBusy: currentBusy } = appStateRef.current;
    if (currentBusy) {
      setExitModalState("busy");
    } else if (currentDirty) {
      setExitModalState("dirty");
    } else {
      setExitModalState("clean");
    }
  };

  const handleConfirmExit = async () => {
    setExitModalState("exiting");
    try {
      await invoke("safe_exit_app_cmd");
    } catch (e) {
      console.error("safe_exit_app_cmd error:", e);
      setExitModalState("none");
    }
  };

  const refreshSecurityStatus = async () => {
    try {
      const sec = await invoke<SecurityStatus>("get_security_status_cmd");
      setSecurityStatus(sec);
      if (!sec.has_users) {
        setShowInitialSetup(true);
      } else if (sec.security_enabled) {
        if (sec.current_user) {
          setCurrentUser(sec.current_user);
          setIsLocked(sec.is_locked);
        } else {
          setCurrentUser(null);
          setIsLocked(false);
        }
      } else {
        setCurrentUser({
          id: 0,
          name: "व्यवस्थापक (Owner)",
          role: "owner",
        });
        setIsLocked(false);
      }
      return sec;
    } catch (e) {
      console.error("get_security_status_cmd load error:", e);
    }
  };

  const handleLockClick = async () => {
    try {
      await invoke("lock_session_cmd");
      setIsLocked(true);
    } catch (err) {
      console.error("Manual lock error:", err);
    }
  };

  const handleUnlock = async () => {
    setIsLocked(false);
    await refreshSecurityStatus();
  };

  const handleSwitchUser = () => {
    setIsLocked(false);
    setCurrentUser(null);
  };

  // Auto-lock idle timer
  useEffect(() => {
    if (!securityStatus?.security_enabled || !currentUser || isLocked) {
      return;
    }

    const mins = securityStatus.auto_lock_minutes > 0 ? securityStatus.auto_lock_minutes : 10;
    const timeoutMs = mins * 60 * 1000;
    let timer: any = null;

    const resetTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          await invoke("lock_session_cmd");
          setIsLocked(true);
        } catch (err) {
          console.error("Auto lock error:", err);
        }
      }, timeoutMs);
    };

    const activityEvents = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    activityEvents.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      if (timer) clearTimeout(timer);
      activityEvents.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [securityStatus?.security_enabled, securityStatus?.auto_lock_minutes, currentUser, isLocked]);

  // Deny staff from accessing restricted views
  useEffect(() => {
    if (currentUser?.role === "staff") {
      const staffBlockedViews: View[] = [
        "Opening Stock",
        "Stock Adjustment",
        "Tally Import",
        "Settings",
        "Backup",
      ];
      if (staffBlockedViews.includes(currentView)) {
        setCurrentView("Dashboard");
      }
    }
  }, [currentUser, currentView]);

  const handleRestoreFromPath = async (backupPath: string) => {
    if (!backupPath) return;
    setIsRestoringFromCorruption(true);
    setIsRestoring(true);
    try {
      await invoke<RestoreResult>("prepare_restore_cmd", {
        backupPath: backupPath,
      });
      setCorruptionFeedback(
        "बैकअप सुरक्षित सेट हो गया है। कृपया ऐप को बंद करके दोबारा चालू (Restart) करें।"
      );
    } catch (err: any) {
      setCorruptionFeedback(`रीस्टोर विफल: ${err?.message || String(err)}`);
    } finally {
      setIsRestoringFromCorruption(false);
      setIsRestoring(false);
    }
  };

  useEffect(() => {
    (window as any).__openPrintInvoice = openPrintModal;
    (window as any).__closePrintInvoice = closePrintModal;

    // Listen for CloseRequested interception event from Rust Tauri window
    let unlistenExit: (() => void) | undefined;
    try {
      import("@tauri-apps/api/event")
        .then(({ listen }) => {
          listen("request-app-exit", () => {
            invoke("acknowledge_exit_request_cmd").catch(() => {});
            handleRequestExit();
          })
            .then((unsub) => {
              unlistenExit = unsub;
            })
            .catch((err) => {
              console.warn("Failed to listen for request-app-exit:", err);
              setExitListenerWarning(
                typeof err === "string" ? err : err?.message || String(err)
              );
            });
        })
        .catch((err) => {
          console.warn("Failed to load @tauri-apps/api/event:", err);
          setExitListenerWarning(String(err));
        });
    } catch (err) {
      console.warn("Exception during exit listener registration:", err);
      setExitListenerWarning(String(err));
    }

    invoke<string>("init_db_cmd")
      .then(async () => {
        await refreshSecurityStatus();
        // Startup health check (PRAGMA quick_check from startup)
        try {
          const health = await invoke<StartupHealthInfo>("get_startup_health_cmd");
          if (health && health.corruption_detected) {
            try {
              const report = await invoke<IntegrityCheckReport>("check_db_integrity_cmd");
              setIntegrityReport(report);
            } catch {
              setIntegrityReport({
                isOk: false,
                is_ok: false,
                message: "डेटाबेस क्षतिग्रस्त है (Database corruption detected)",
                details: ["PRAGMA quick_check failed during startup."],
                suggestedBackup: null,
                availableBackups: [],
              });
            }
            return;
          }
        } catch (e) {
          console.warn("get_startup_health_cmd startup error (ignored, not treated as corruption):", e);
        }

        // Check DB safety info (location warning for cloud-synced / removable drive)
        try {
          const sInfo = await invoke<DbSafetyInfo>("get_db_safety_info_cmd");
          if (sInfo) {
            setSafetyInfo(sInfo);
          }
        } catch (e) {
          console.error("get_db_safety_info_cmd startup error:", e);
        }

        // One-time migration: If old settings exist in localStorage, save to SQLite & remove from localStorage
        try {
          const migRes = await migrateLocalStorageSettingsToSqlite(invoke, localStorage);
          if (migRes && !migRes.migrated && migRes.error) {
            console.error("Settings migration error:", migRes.error);
          }
        } catch (e) {
          console.error("Settings migration error:", e);
        }

        // Load persisted settings from SQLite table
        try {
          const sqlSettings = await invoke<AppSettings>("get_settings_cmd");
          if (sqlSettings) {
            setSettings((prev) => ({ ...prev, ...sqlSettings }));
          }
        } catch (e) {
          console.error("get_settings_cmd load error:", e);
        }
      })
      .catch((err) => console.error("init_db_cmd error:", err));

    return () => {
      if (unlistenExit) unlistenExit();
    };
  }, []);

  // Background check for updates from GitHub (runs 5 seconds after startup, bypassed in tests)
  useEffect(() => {
    if (typeof process !== "undefined" && process.env.NODE_ENV === "test") return;
    const updateTimer = setTimeout(async () => {
      try {
        const res = await checkForUpdates();
        if (res && res.available && res.version) {
          setAvailableUpdate({
            version: res.version,
            currentVersion: res.currentVersion || "v0.1.0",
            body: res.body,
            date: res.date,
          });
        }
      } catch (err) {
        console.warn("Background update check error:", err);
      }
    }, 5000);
    return () => clearTimeout(updateTimer);
  }, []);

  // 4. Startup check: PRAGMA quick_check at launch. If fails, show recovery screen in Hindi + English
  const isCorrupted = integrityReport && (integrityReport.isOk === false || integrityReport.is_ok === false);
  if (isCorrupted && integrityReport) {
    return (
      <DbCorruptionScreen
        integrityReport={integrityReport}
        isRestoringFromCorruption={isRestoringFromCorruption}
        corruptionFeedback={corruptionFeedback}
        onRestoreBackup={handleRestoreFromPath}
        onRestore={() => {
          const suggested = integrityReport.suggestedBackup ?? integrityReport.suggested_backup;
          const backupPath = suggested?.filePath ?? suggested?.path ?? "";
          return handleRestoreFromPath(backupPath);
        }}
      />
    );
  }

  // Pehli baar ka setup screen: shopName khali ho to poori screen "पहली बार सेटअप" aaye
  if (!settings.shopName || !settings.shopName.trim()) {
    return (
      <>
        {showSplash && <SplashScreen onFinish={() => setShowSplash(false)} />}
        <FirstTimeSetupView
          initialSettings={settings}
          onSave={async (newSettings) => {
            await updateSettings(newSettings);
          }}
          t={t}
          lang={lang}
        />
      </>
    );
  }

  return (
    <>
      {showSplash && <SplashScreen onFinish={() => setShowSplash(false)} />}
      <div className="flex h-screen w-screen overflow-hidden bg-paper text-ink font-body">
      {/* Sidebar with Navigation + Exit Button */}
      <Sidebar
        currentView={currentView}
        currentUser={currentUser}
        onLockClick={securityStatus?.security_enabled && currentUser ? handleLockClick : undefined}
        onNavigate={(v) => {
          setCurrentView(v);
          setAlteringInvoice(null);
        }}
        settings={settings}
        lang={lang}
        onSelectLanguage={handleLanguageChange}
        t={t}
        onExitClick={handleRequestExit}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => {
          setIsSidebarCollapsed((prev) => {
            const next = !prev;
            if (typeof window !== "undefined") {
              localStorage.setItem("krishi_sidebar_collapsed", String(next));
            }
            return next;
          });
        }}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-slate-100/70">
        {/* Close Listener Failure Visible Warning Banner */}
        {exitListenerWarning && (
          <div
            data-testid="exit-listener-warning-banner"
            className="bg-amber-100 border-b border-amber-300 px-4 py-2 text-amber-950 text-xs font-semibold flex items-center justify-between shadow-2xs z-30"
          >
            <span>
              {lang === "hi"
                ? `चेतावनी: विंडो क्लोज़ लिसनर सक्रिय नहीं हो सका (${exitListenerWarning})। सुरक्षित एग्जिट फॉलबैक सक्रिय है।`
                : `Warning: Window close listener could not be registered (${exitListenerWarning}). Safe exit fallback active.`}
            </span>
            <button
              type="button"
              onClick={() => setExitListenerWarning(null)}
              className="px-2 py-0.5 rounded bg-amber-200 hover:bg-amber-300 text-amber-900 text-xs font-bold transition-colors cursor-pointer ml-3"
            >
              {lang === "hi" ? "समझ गया" : "Dismiss"}
            </button>
          </div>
        )}

        {/* Storage Location Warning Banner (OneDrive / Dropbox / Removable drive) */}
        {(safetyInfo?.sync_warning || safetyInfo?.syncWarning) && !dismissedLocationWarning && (
          <div
            data-testid="db-location-warning-banner"
            className="bg-amber-100 border-b border-amber-300 px-4 py-2 text-amber-950 text-xs font-semibold flex items-center justify-between shadow-2xs z-30"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle size={16} className="text-amber-700 flex-shrink-0" />
              <span className="truncate">{safetyInfo.sync_warning || safetyInfo.syncWarning}</span>
            </div>
            <button
              type="button"
              data-testid="dismiss-location-warning-btn"
              onClick={() => setDismissedLocationWarning(true)}
              className="ml-3 px-2 py-0.5 rounded bg-amber-200 hover:bg-amber-300 text-amber-900 text-xs font-bold cursor-pointer flex-shrink-0"
            >
              {lang === "hi" ? "समझ गया / बंद करें" : "Dismiss"}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-auto min-w-0 p-3 sm:p-3.5 lg:p-4">
          {(() => {
            return (
              <div className="h-full min-h-0">
                {currentView === "Dashboard" && (
                  <DashboardView
                    currentUser={currentUser}
                    settings={settings}
                    refreshTrigger={refreshTrigger}
                    onNavigate={(v) => {
                      setCurrentView(v);
                      setAlteringInvoice(null);
                    }}
                    onOpenPayment={(partyId, type) => {
                      setPaymentInitialPartyId(partyId || null);
                      setPaymentInitialType(type || "receipt");
                      setCurrentView("Payment");
                    }}
                    onOpenAddItem={() => {
                      setItemsInitialOpenForm(true);
                      setCurrentView("Items");
                      triggerGlobalRefresh();
                    }}
                    onPrintInvoice={openPrintModal}
                    t={t}
                    lang={lang}
                  />
                )}

                {currentView === "Sale" && (
                  <TransactionView
                    type="sale"
                    settings={settings}
                    refreshTrigger={refreshTrigger}
                    onRefresh={triggerGlobalRefresh}
                    onPrintInvoice={openPrintModal}
                    alteringInvoiceNo={alteringInvoice?.type === "sale" ? alteringInvoice.invoiceNo : null}
                    onCancelAlteration={() => setAlteringInvoice(null)}
                    onDirtyChange={setIsDirty}
                    onSavingChange={setIsSaving}
                    t={t}
                    lang={lang}
                  />
                )}

                {currentView === "Purchase" && (
                  <TransactionView
                    type="purchase"
                    settings={settings}
                    refreshTrigger={refreshTrigger}
                    onRefresh={triggerGlobalRefresh}
                    onPrintInvoice={openPrintModal}
                    alteringInvoiceNo={alteringInvoice?.type === "purchase" ? alteringInvoice.invoiceNo : null}
                    onCancelAlteration={() => setAlteringInvoice(null)}
                    onDirtyChange={setIsDirty}
                    onSavingChange={setIsSaving}
                    t={t}
                    lang={lang}
                  />
                )}

                {currentView === "Stock" && (
                  <StockView
                    currentUser={currentUser}
                    settings={settings}
                    refreshTrigger={refreshTrigger}
                    t={t}
                    lang={lang}
                  />
                )}

                {currentView === "Opening Stock" && (
                  <OpeningStockView
                    refreshTrigger={refreshTrigger}
                    onRefresh={triggerGlobalRefresh}
                    t={t}
                    lang={lang}
                  />
                )}

                {currentView === "Stock Adjustment" && (
                  <StockAdjustmentView
                    refreshTrigger={refreshTrigger}
                    onRefresh={triggerGlobalRefresh}
                    t={t}
                    lang={lang}
                  />
                )}

                {currentView === "Payment" && (
                  <PaymentView
                    refreshTrigger={refreshTrigger}
                    onRefresh={triggerGlobalRefresh}
                    onDirtyChange={setIsDirty}
                    onSavingChange={setIsSaving}
                    t={t}
                    lang={lang}
                    currentUser={currentUser}
                    initialPartyId={paymentInitialPartyId}
                    initialType={paymentInitialType}
                  />
                )}

                {currentView === "Len-Den" && (
                  <LenDenView
                    currentUser={currentUser}
                    refreshTrigger={refreshTrigger}
                    onRefresh={triggerGlobalRefresh}
                    booksLockedUntil={settings.booksLockedUntil}
                    t={t}
                    lang={lang}
                    shopName={settings.shopName}
                    onOpenPayment={(partyId, type) => {
                      setPaymentInitialPartyId(partyId || null);
                      setPaymentInitialType(type || "receipt");
                      setCurrentView("Payment");
                    }}
                  />
                )}

                {currentView === "Parties" && (
                  <PartiesView
                    currentUser={currentUser}
                    refreshTrigger={refreshTrigger}
                    onRefresh={triggerGlobalRefresh}
                    t={t}
                    lang={lang}
                  />
                )}

                {currentView === "Items" && (
                  <ItemsView
                    currentUser={currentUser}
                    refreshTrigger={refreshTrigger}
                    onRefresh={triggerGlobalRefresh}
                    t={t}
                    lang={lang}
                    initialOpenForm={itemsInitialOpenForm}
                  />
                )}

                {currentView === "Tally Import" && (
                  <TallyImportView
                    onImportSuccess={triggerGlobalRefresh}
                    t={t}
                    lang={lang}
                  />
                )}

                {currentView === "Reports" && (
                  <ReportsView
                    currentUser={currentUser}
                    settings={settings}
                    refreshTrigger={refreshTrigger}
                    onRefresh={triggerGlobalRefresh}
                    onPrintInvoice={openPrintModal}
                    onAlterInvoice={(invNo, type) => {
                      setAlteringInvoice({ invoiceNo: invNo, type });
                      setCurrentView(type === "sale" ? "Sale" : "Purchase");
                      triggerGlobalRefresh();
                    }}
                    t={t}
                    lang={lang}
                  />
                )}

                {currentView === "Settings" && (
                  <SettingsView
                    settings={settings}
                    onSave={updateSettings}
                    t={t}
                    lang={lang}
                    currentUser={currentUser}
                    securityStatus={securityStatus}
                    onEnableSecurity={() => setShowInitialSetup(true)}
                    onUpdateAutoLock={async (minutes) => {
                      try {
                        const updated = { ...settings, autoLockMinutes: minutes };
                        await updateSettings(updated);
                        await refreshSecurityStatus();
                      } catch (e) {
                        console.error("Update auto lock error:", e);
                      }
                    }}
                  />
                )}

                {currentView === "PrinterSetup" && (
                  <PrinterSetupView
                    settings={settings}
                    onSave={updateSettings}
                    t={t}
                    lang={lang}
                  />
                )}

                {currentView === "Backup" && (
                  <BackupView
                    settings={settings}
                    refreshTrigger={refreshTrigger}
                    onRefresh={triggerGlobalRefresh}
                    onUpdateSettings={updateSettings}
                    t={t}
                    lang={lang}
                  />
                )}
              </div>
            );
          })()}
        </div>
      </main>

      {/* Global Print Modal */}
      <PrintInvoiceModal
        isOpen={isPrintModalOpen}
        onClose={closePrintModal}
        invoiceNo={activePrintInvoiceNo}
        settings={settings}
        lang={lang}
        t={t}
        initialTaxMode={activePrintTaxMode}
      />

      {/* Graceful Exit Modals */}
      {exitModalState === "busy" && (
        <div data-testid="exit-busy-modal" className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3 text-amber-600">
              <AlertCircle size={24} />
              <h3 className="text-lg font-bold text-slate-900">काम चल रहा है / Operation in Progress</h3>
            </div>
            <p className="text-sm text-slate-700">
              {lang === "hi"
                ? "डेटा सुरक्षित किया जा रहा है (सहेजना, प्रिंट या बैकअप चल रहा है)। कृपया प्रक्रिया पूरी होने तक प्रतीक्षा करें।"
                : "An operation is currently in progress (saving, printing, or backup). Please wait until it completes."}
            </p>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                data-testid="exit-busy-ok-btn"
                onClick={() => setExitModalState("none")}
                className="px-5 py-2 rounded-xl bg-forest text-white font-bold text-sm hover:bg-forest-dark cursor-pointer shadow-xs"
              >
                {lang === "hi" ? "ठीक है" : "OK"}
              </button>
            </div>
          </div>
        </div>
      )}

      {exitModalState === "dirty" && (
        <div data-testid="exit-dirty-modal" className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-rose-200 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <AlertCircle size={24} />
              <h3 className="text-lg font-bold text-rose-900">बिल सेव नहीं हुआ / Unsaved Bill</h3>
            </div>
            <p className="text-sm text-slate-800 font-semibold">
              Bill saved nahi hua. Bahar nikle?
            </p>
            <p className="text-xs text-slate-500">
              {lang === "hi"
                ? "यदि आप अभी बाहर निकलते हैं, तो बिना सहेजा गया डेटा मिट जाएगा।"
                : "You have unsaved changes in the current bill or payment that will be lost."}
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                data-testid="exit-cancel-btn"
                onClick={() => setExitModalState("none")}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm cursor-pointer"
              >
                {lang === "hi" ? "रद्द करें (Cancel)" : "Cancel"}
              </button>
              <button
                type="button"
                data-testid="exit-confirm-btn"
                onClick={handleConfirmExit}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm cursor-pointer shadow-xs"
              >
                {lang === "hi" ? "हाँ, बाहर निकलें (Exit anyway)" : "Exit anyway"}
              </button>
            </div>
          </div>
        </div>
      )}

      {exitModalState === "clean" && (
        <div data-testid="exit-clean-modal" className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center gap-3 text-slate-700">
              <LogOut size={24} className="text-slate-600" />
              <h3 className="text-lg font-bold text-slate-900">बाहर निकलें / Exit Application</h3>
            </div>
            <p className="text-sm text-slate-700">
              {lang === "hi"
                ? "क्या आप वाकई कृषि केंद्र ऐप से बाहर निकलना चाहते हैं?"
                : "Are you sure you want to exit the application?"}
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                data-testid="exit-cancel-btn"
                onClick={() => setExitModalState("none")}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm cursor-pointer"
              >
                {lang === "hi" ? "रद्द करें (Cancel)" : "Cancel"}
              </button>
              <button
                type="button"
                data-testid="exit-confirm-btn"
                onClick={handleConfirmExit}
                className="px-4 py-2 rounded-xl bg-forest hover:bg-forest-dark text-white font-bold text-sm cursor-pointer shadow-xs"
              >
                {lang === "hi" ? "बाहर निकलें (Exit)" : "Exit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {exitModalState === "exiting" && (
        <div data-testid="exit-overlay" className="fixed inset-0 bg-forest-dark/95 z-[100] flex flex-col items-center justify-center p-6 text-white text-center">
          <div className="w-12 h-12 border-4 border-marigold border-t-transparent rounded-full animate-spin mb-4" />
          <h2 className="text-xl font-bold font-serif mb-2">सुरक्षित रूप से बंद हो रहा है...</h2>
          <p className="text-sm text-surface/80">WAL चेकपॉइंट और बैकअप लिया जा रहा है। कृपया प्रतीक्षा करें।</p>
        </div>
      )}

      {/* Local Auth Setup Wizard (First launch after update or manual enable) */}
      {showInitialSetup && (
        <InitialSetupWizard
          onComplete={async () => {
            setShowInitialSetup(false);
            await refreshSecurityStatus();
          }}
        />
      )}

      {/* Login Modal at App Start */}
      {securityStatus?.security_enabled && !currentUser && !showInitialSetup && (
        <LoginModal
          onLoginSuccess={(user) => {
            setCurrentUser(user);
            setIsLocked(false);
          }}
          onExitApp={handleConfirmExit}
        />
      )}

      {/* Lock Screen Overlay (Over the app WITHOUT unmounting views) */}
      {isLocked && currentUser && (
        <LockScreenOverlay
          currentUser={currentUser}
          hasUnsavedWork={isDirty}
          onUnlocked={handleUnlock}
          onSwitchUser={handleSwitchUser}
        />
      )}
      {/* Update Notification Modal */}
      {availableUpdate && (
        <UpdateNotificationModal
          version={availableUpdate.version}
          currentVersion={availableUpdate.currentVersion}
          notes={availableUpdate.body}
          date={availableUpdate.date}
          onClose={() => setAvailableUpdate(null)}
          lang={lang}
        />
      )}
    </div>
    </>
  );
}
