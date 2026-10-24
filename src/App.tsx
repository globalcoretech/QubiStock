import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./index.css";
import { View, AppSettings, DEFAULT_SETTINGS } from "./types";
import { Language, translations, getInitialLanguage, saveLanguagePreference } from "./i18n";
import { Sidebar } from "./components/Sidebar";
import { PanelLeftOpen } from "./components/icons";
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
import { PrintInvoiceModal } from "./components/PrintInvoiceModal";
import { BillPreviewPage } from "./components/bills/BillPreviewPage";
import { migrateLocalStorageSettingsToSqlite } from "./utils/settingsMigration";

export const toSettingsPayload = (s: any) => {
  const { logoUrl, signatureUrl, ...rest } = s;
  return {
    ...rest,
    logoData: rest.logoData ?? logoUrl ?? null,
    signatureData: rest.signatureData ?? signatureUrl ?? null,
  };
};

export default function App() {
  if (typeof window !== "undefined" && window.location.search.includes("bill_preview")) {
    return <BillPreviewPage />;
  }

  const [currentView, setCurrentView] = useState<View>("Dashboard");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [paymentInitialPartyId, setPaymentInitialPartyId] = useState<number | null>(null);
  const [paymentInitialType, setPaymentInitialType] = useState<"receipt" | "payment">("receipt");

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("krishi_kendra_sidebar_collapsed") === "true";
    } catch {
      return false;
    }
  });

  const toggleSidebar = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("krishi_kendra_sidebar_collapsed", String(next));
      } catch (e) {
        console.error("error saving sidebar preference:", e);
      }
      return next;
    });
  };

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  const [lang, setLang] = useState<Language>(() => getInitialLanguage());
  const t = translations[lang];

  const handleLanguageChange = (newLang: Language) => {
    setLang(newLang);
    saveLanguagePreference(newLang);
  };

  const [activePrintInvoiceNo, setActivePrintInvoiceNo] = useState("");
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  const openPrintModal = (invNo: string) => {
    setActivePrintInvoiceNo(invNo);
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
          if (sqlSettings && sqlSettings.shopName) {
            setSettings({ ...DEFAULT_SETTINGS, ...sqlSettings });
          }
        } catch (e) {
          console.error("get_settings_cmd load error:", e);
        }
      })
      .catch((err) => console.error("init_db_cmd error:", err));

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={toggleSidebar}
      />

      {/* Main Content Area in paper tone: Fixed layout, zero page-level scroll */}
      <main className="flex-1 h-screen max-h-screen overflow-hidden bg-paper flex flex-col p-2 sm:p-2.5 min-w-0">
        {isSidebarCollapsed && (
          <div className="mb-2 flex items-center gap-2 no-print flex-shrink-0">
            <button
              type="button"
              onClick={toggleSidebar}
              title={lang === "hi" ? "साइडबार खोलें (Ctrl+B)" : "Expand Sidebar (Ctrl+B)"}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-surface border border-border text-forest hover:bg-forest hover:text-surface shadow-2xs transition-all"
            >
              <PanelLeftOpen size={15} />
              <span>{lang === "hi" ? "साइडबार खोलें (Ctrl+B)" : "Expand Sidebar (Ctrl+B)"}</span>
            </button>
          </div>
        )}
        {/* Inner View Container */}
        {(() => {
          const isFrameless =
            currentView === "Dashboard" ||
            currentView === "Sale" ||
            currentView === "Purchase" ||
            currentView === "Reports" ||
            currentView === "Settings" ||
            currentView === "PrinterSetup";
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
                    setCurrentView(v);
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
      />
    </div>
  );
}
