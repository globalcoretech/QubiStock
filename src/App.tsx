import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./index.css";
import { View, AppSettings, DEFAULT_SETTINGS, IntegrityCheckReport, RestoreResult } from "./types";
import { Language, translations, getInitialLanguage, saveLanguagePreference } from "./i18n";
import { Sidebar } from "./components/Sidebar";
import { AlertCircle } from "./components/icons";
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
}

export function DbCorruptionScreen({
  integrityReport,
  isRestoringFromCorruption = false,
  corruptionFeedback = null,
  onRestore,
}: DbCorruptionScreenProps) {
  const detailsList = integrityReport.details ?? (integrityReport.message ? [integrityReport.message] : []);
  const suggested = integrityReport.suggestedBackup ?? integrityReport.suggested_backup;
  const backupFileName = suggested?.fileName ?? suggested?.filename ?? "";
  const backupTimestamp = suggested?.timestamp ?? suggested?.created_at_formatted ?? "";
  const backupSize = suggested?.formattedSize ?? suggested?.size_formatted ?? "";

  return (
    <div
      data-testid="db-corruption-screen"
      className="min-h-screen w-screen bg-rose-50 flex items-center justify-center p-6 text-slate-900 font-body select-none"
    >
      <div className="max-w-xl w-full bg-white rounded-2xl shadow-xl border-2 border-rose-300 p-8 space-y-6">
        <div className="flex items-center gap-4 text-rose-600">
          <div className="w-14 h-14 rounded-full bg-rose-100 flex items-center justify-center flex-shrink-0">
            <AlertCircle size={32} />
          </div>
          <div>
            <h1 className="text-2xl font-bold font-serif text-rose-900">
              डेटा में गड़बड़ी मिली
            </h1>
            <p className="text-sm text-rose-700 font-medium mt-1">
              डेटाबेस फ़ाइल में खराबी या अनपेक्षित बदलाव पाया गया है।
            </p>
          </div>
        </div>

        <div className="bg-rose-50/80 rounded-xl p-4 border border-rose-200 text-xs font-mono text-rose-900 max-h-36 overflow-y-auto space-y-1">
          {detailsList.map((d, i) => (
            <div key={i}>• {d}</div>
          ))}
        </div>

        {suggested ? (
          <div className="bg-emerald-50 rounded-xl p-5 border border-emerald-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-800 uppercase tracking-wide">
                सुझाया गया सुरक्षित बैकअप
              </span>
              <span className="text-xs bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                जाँचा हुआ ✓
              </span>
            </div>
            <div className="text-sm font-semibold text-slate-800 space-y-1">
              <div>फ़ाइल: {backupFileName}</div>
              <div className="text-xs text-slate-600">
                तारीख: {backupTimestamp} • आकार: {backupSize}
              </div>
            </div>

            {corruptionFeedback ? (
              <div className="p-3 bg-emerald-100 border border-emerald-300 rounded-lg text-emerald-950 font-bold text-sm">
                {corruptionFeedback}
              </div>
            ) : (
              <button
                type="button"
                data-testid="restore-corrupted-btn"
                disabled={isRestoringFromCorruption}
                onClick={onRestore}
                className="w-full min-h-[48px] py-3 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-base shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {isRestoringFromCorruption ? "तैयारी चल रही है..." : "इस बैकअप से वापस लाओ"}
              </button>
            )}
          </div>
        ) : (
          <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl text-amber-900 text-sm">
            कोई वैध बैकअप नहीं मिला। कृपया अपने बैकअप फ़ोल्डर (Documents\KrishiBackup) की जांच करें या तकनीकी सहायता लें।
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

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [integrityReport, setIntegrityReport] = useState<IntegrityCheckReport | null>(null);
  const [isRestoringFromCorruption, setIsRestoringFromCorruption] = useState(false);
  const [corruptionFeedback, setCorruptionFeedback] = useState<string | null>(null);

  const [lang, setLang] = useState<Language>(() => getInitialLanguage());
  const t = translations[lang];

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

  useEffect(() => {
    (window as any).__openPrintInvoice = openPrintModal;
    (window as any).__closePrintInvoice = () => setIsPrintModalOpen(false);

    invoke<string>("init_db_cmd")
      .then(async () => {
        // Startup integrity check
        try {
          const report = await invoke<IntegrityCheckReport>("check_db_integrity_cmd");
          if (report && (report.isOk === false || report.is_ok === false)) {
            setIntegrityReport(report);
            return;
          }
        } catch (e) {
          console.error("check_db_integrity_cmd startup error:", e);
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
  }, []);

  // 4. Startup par PRAGMA integrity_check. Fail ho to poori screen Hindi me "डेटा में गड़बड़ी मिली"
  const isCorrupted = integrityReport && (integrityReport.isOk === false || integrityReport.is_ok === false);
  if (isCorrupted && integrityReport) {
    return (
      <DbCorruptionScreen
        integrityReport={integrityReport}
        isRestoringFromCorruption={isRestoringFromCorruption}
        corruptionFeedback={corruptionFeedback}
        onRestore={async () => {
          const suggested = integrityReport.suggestedBackup ?? integrityReport.suggested_backup;
          const backupPath = suggested?.filePath ?? suggested?.path;
          if (!backupPath) return;
          setIsRestoringFromCorruption(true);
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
          }
        }}
      />
    );
  }

  // Pehli baar ka setup screen: shopName khali ho to poori screen "पहली बार सेटअप" aaye
  if (!settings.shopName || !settings.shopName.trim()) {
    return (
      <FirstTimeSetupView
        initialSettings={settings}
        onSave={async (newSettings) => {
          await updateSettings(newSettings);
          setCurrentView("Dashboard");
        }}
        lang={lang}
        onSelectLanguage={handleLanguageChange}
        t={t}
      />
    );
  }

  return (
    <div className="flex h-screen max-h-screen w-screen max-w-full overflow-hidden bg-paper font-body text-ink select-none">
      {/* Sidebar with dark forest green and marigold bahi-khata theme */}
      <Sidebar
        currentView={currentView}
        onNavigate={(v) => {
          setCurrentView(v);
          triggerGlobalRefresh();
        }}
        settings={settings}
        lang={lang}
        onSelectLanguage={handleLanguageChange}
        t={t}
      />

      {/* Main Content Area in paper tone: Fixed layout, zero page-level scroll */}
      <main className="flex-1 h-screen max-h-screen overflow-hidden bg-paper flex flex-col p-2 sm:p-2.5 min-w-0">
        {/* Inner View Container */}
        {(() => {
          const isFrameless =
            currentView === "Dashboard" ||
            currentView === "Sale" ||
            currentView === "Purchase" ||
            currentView === "Reports" ||
            currentView === "Settings" ||
            currentView === "PrinterSetup" ||
            currentView === "Backup";
          return (
            <div
              className={`flex-1 h-full max-h-full overflow-hidden flex flex-col min-w-0 ${
                isFrameless
                  ? ""
                  : "bg-surface rounded-panel border border-border p-3 sm:p-4 shadow-[0_1px_2px_rgba(28,43,36,0.04)]"
              }`}
            >
              {currentView === "Dashboard" && (
                <DashboardView
                  settings={settings}
                  refreshTrigger={refreshTrigger}
                  onNavigate={(v) => {
                    setItemsInitialOpenForm(false);
                    setCurrentView(v);
                    triggerGlobalRefresh();
                  }}
                  onOpenPayment={(partyId, type) => {
                    setItemsInitialOpenForm(false);
                    setPaymentInitialPartyId(partyId);
                    setPaymentInitialType(type);
                    setCurrentView("Payment");
                    triggerGlobalRefresh();
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
                  t={t}
                  lang={lang}
                />
              )}

          {currentView === "Stock" && (
            <StockView
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
              t={t}
              lang={lang}
              initialPartyId={paymentInitialPartyId}
              initialType={paymentInitialType}
            />
          )}

          {currentView === "Len-Den" && (
            <LenDenView
              refreshTrigger={refreshTrigger}
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
              refreshTrigger={refreshTrigger}
              onRefresh={triggerGlobalRefresh}
              t={t}
              lang={lang}
            />
          )}

          {currentView === "Items" && (
            <ItemsView
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
              settings={settings}
              refreshTrigger={refreshTrigger}
              onPrintInvoice={openPrintModal}
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
  </main>

      {/* Global Print Modal */}
      <PrintInvoiceModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        invoiceNo={activePrintInvoiceNo}
        settings={settings}
        lang={lang}
        t={t}
        initialTaxMode={activePrintTaxMode}
      />
    </div>
  );
}
