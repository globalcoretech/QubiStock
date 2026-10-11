import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./index.css";
import { View, AppSettings, DEFAULT_SETTINGS } from "./types";
import { Language, translations, getInitialLanguage, saveLanguagePreference } from "./i18n";
import { Sidebar } from "./components/Sidebar";
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
import { PaymentView } from "./views/PaymentView";
import { PrintInvoiceModal } from "./components/PrintInvoiceModal";

export default function App() {
  const [currentView, setCurrentView] = useState<View>("Dashboard");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [paymentInitialPartyId, setPaymentInitialPartyId] = useState<number | null>(null);
  const [paymentInitialType, setPaymentInitialType] = useState<"receipt" | "payment">("receipt");

  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem("krishi_kendra_settings");
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error("error loading settings:", e);
    }
    return DEFAULT_SETTINGS;
  });

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

  const updateSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    localStorage.setItem("krishi_kendra_settings", JSON.stringify(newSettings));
    triggerGlobalRefresh();
  };

  useEffect(() => {
    (window as any).__openPrintInvoice = openPrintModal;
    (window as any).__closePrintInvoice = () => setIsPrintModalOpen(false);
    invoke<string>("init_db_cmd").catch((err) =>
      console.error("init_db_cmd error:", err)
    );
  }, []);

  return (
    <div className="flex h-screen bg-paper font-body text-ink overflow-x-hidden">
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

      {/* Main Content Area in paper tone */}
      <main className={`flex-1 overflow-y-auto overflow-x-hidden ${currentView === "Dashboard" ? "p-3 sm:p-4 lg:p-5" : "p-5 lg:p-7"} bg-paper`}>
        <div className={currentView === "Dashboard" ? "" : "bg-surface rounded-panel border border-border p-6 lg:p-8 min-h-full shadow-[0_1px_2px_rgba(28,43,36,0.04)]"}>
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
        </div>
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
