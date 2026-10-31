import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AppSettings,
  DashboardStats,
  View,
  YesterdayComparison,
  TopReceivableParty,
  LowStockItem,
  BackupStatusInfo,
} from "../types";
import { Translations, Language } from "../i18n";
import { formatCurrency } from "../utils/formatters";
import {
  BahiLogoMark,
  DuotoneReceipt,
  DuotoneTruck,
  DuotoneWarehouse,
  DuotoneBook,
  DuotoneChart,
  ArrowDownLeft,
  ArrowUpRight,
  AlertCircle,
  Plus,
  Users,
  Database,
} from "../components/icons";
import { Pagination } from "../components/Pagination";
import { AddPartyModal } from "../components/AddPartyModal";

interface DashboardViewProps {
  settings: AppSettings;
  refreshTrigger: number;
  onNavigate: (v: View) => void;
  onOpenPayment?: (partyId: number | null, type: "receipt" | "payment") => void;
  onOpenAddItem?: () => void;
  onPrintInvoice?: (invNo: string, taxMode?: "with_tax" | "without_tax") => void;
  t: Translations;
  lang: Language;
}

export function DashboardView({
  settings,
  refreshTrigger,
  onNavigate,
  onOpenPayment,
  onOpenAddItem,
  t,
  lang,
}: DashboardViewProps) {
  const [stats, setStats] = useState<DashboardStats>({
    today_sales: 0,
    today_purchases: 0,
    total_receivable: 0,
    total_payable: 0,
  });
  const [yesterdayComp, setYesterdayComp] = useState<YesterdayComparison | null>(null);
  const [topReceivables, setTopReceivables] = useState<TopReceivableParty[]>([]);
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([]);
  const [backupStatus, setBackupStatus] = useState<BackupStatusInfo | null>(null);

  // Tab, filter & pagination state for Attention section
  const [activeListTab, setActiveListTab] = useState<"receivables" | "low_stock">("receivables");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [listSearch, setListSearch] = useState("");
  const [isAddPartyOpen, setIsAddPartyOpen] = useState(false);

  const isBillBlocked =
    !settings.shopName?.trim() || (settings.isGstRegistered && !settings.gstin?.trim());

  const todayIso = new Date().toISOString().split("T")[0];

  const loadAllData = async () => {
    try {
      const s = await invoke<DashboardStats>("get_dashboard_stats_cmd", { todayDate: todayIso });
      setStats(s);
    } catch (e) {
      console.error("get_dashboard_stats_cmd error:", e);
    }

    try {
      const comp = await invoke<YesterdayComparison>("get_yesterday_comparison_cmd", {
        todayDate: todayIso,
      });
      setYesterdayComp(comp);
    } catch (e) {
      console.error("get_yesterday_comparison_cmd error:", e);
    }

    try {
      const rec = await invoke<TopReceivableParty[]>("get_top_receivables_cmd", {
        limit: 20,
        asOfDate: todayIso,
      });
      setTopReceivables(rec);
    } catch (e) {
      console.error("get_top_receivables_cmd error:", e);
    }

    try {
      const low = await invoke<LowStockItem[]>("get_low_stock_items_cmd", {
        thresholdMilli: (settings.lowStockThreshold || 10) * 1000,
      });
      setLowStockItems(low.filter((item) => item.current_stock_milli > 0));
    } catch (e) {
      console.error("get_low_stock_items_cmd error:", e);
    }

    try {
      const bStatus = await invoke<BackupStatusInfo>("get_backup_status_cmd");
      setBackupStatus(bStatus);
    } catch (e) {
      console.error("get_backup_status_cmd error:", e);
    }
  };

  useEffect(() => {
    loadAllData();
  }, [refreshTrigger]);

  // Keyboard shortcut F1 (Sale), F2 (Purchase)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F1") {
        e.preventDefault();
        if (!isBillBlocked) onNavigate("Sale");
      } else if (e.key === "F2") {
        e.preventDefault();
        onNavigate("Purchase");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onNavigate, isBillBlocked]);

  // Formatted date string in Hindi or English (Zero English in Hindi mode)
  const todayFormattedString = (() => {
    const now = new Date();
    const dateNum = now.getDate();
    const year = now.getFullYear();
    if (lang === "hi") {
      const hindiDays = ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"];
      const hindiMonths = [
        "जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून",
        "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर",
      ];
      return `${hindiDays[now.getDay()]}, ${dateNum} ${hindiMonths[now.getMonth()]} ${year}`;
    } else {
      const enDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const enMonths = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
      ];
      return `${enDays[now.getDay()]}, ${dateNum} ${enMonths[now.getMonth()]} ${year}`;
    }
  })();

  const totalReceivable = stats.total_receivable;
  const totalPayable = stats.total_payable;

  // Filtered and paginated list items for Attention box
  const filteredReceivables = topReceivables.filter((p) =>
    p.name.toLowerCase().includes(listSearch.toLowerCase()),
  );
  const filteredLowStock = lowStockItems.filter((i) =>
    i.name.toLowerCase().includes(listSearch.toLowerCase()),
  );

  const currentList = activeListTab === "receivables" ? filteredReceivables : filteredLowStock;
  const totalItems = currentList.length;
  const paginatedList = currentList.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="h-full max-h-full flex flex-col justify-between overflow-hidden gap-2 text-ink font-body select-none">
      {/* 1. Top Header: Bada Heading 'आज क्या करना है?' + Shop Name + Backup Chip */}
      <div className="bg-surface border border-border border-t-4 border-t-emerald-600 rounded-panel p-2 sm:p-2.5 px-3.5 shadow-2xs flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <BahiLogoMark size={32} className="flex-shrink-0 shadow-2xs" />
          <div className="min-w-0">
            <h1 className="font-serif text-lg sm:text-xl font-bold tracking-tight text-ink flex items-center gap-2 truncate">
              <span>{lang === "hi" ? "आज क्या करना है?" : "What would you like to do today?"}</span>
            </h1>
            <p className="text-xs font-semibold text-muted tracking-wide truncate">
              <span className="text-forest font-bold">{settings.shopName}</span>
              <span className="mx-1.5 opacity-40">•</span>
              <span>{todayFormattedString}</span>
              <span className="mx-1.5 opacity-40">•</span>
              <span className="text-forest-2 font-serif font-bold">
                {lang === "hi" ? "डिजिटल बही-खाता" : "Digital Bahi-Khata"}
              </span>
            </p>
          </div>
        </div>

        {/* Right side: Backup status chip */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {backupStatus && (
            <button
              type="button"
              onClick={() => onNavigate("Backup")}
              data-testid="dashboard-backup-status-chip"
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-2xs ${
                (backupStatus.isBackupRecent ?? backupStatus.is_recent)
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-300"
                  : "bg-rose-50 text-rose-700 border border-rose-300"
              }`}
              title={lang === "hi" ? "बैकअप प्रबंधन" : "Backup Management"}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  (backupStatus.isBackupRecent ?? backupStatus.is_recent)
                    ? "bg-emerald-500"
                    : "bg-rose-500 animate-pulse"
                }`}
              />
              <span>
                {lang === "hi"
                  ? (backupStatus.isBackupRecent ?? backupStatus.is_recent)
                    ? "बैकअप सुरक्षित है ✓"
                    : "बैकअप लेना बाकी है!"
                  : (backupStatus.isBackupRecent ?? backupStatus.is_recent)
                  ? "Backup Up to Date ✓"
                  : "Backup Overdue!"}
              </span>
              {!backupStatus.secondaryFolder && (
                <span
                  data-testid="secondary-missing-dot"
                  className="w-2 h-2 rounded-full bg-amber-400 border border-amber-500 flex-shrink-0"
                  title={lang === "hi" ? "दूसरी जगह (पेनड्राइव) सेट नहीं है" : "Secondary backup not configured"}
                />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Warning banner when shop info incomplete */}
      {isBillBlocked && (
        <div
          data-testid="dashboard-incomplete-shop-alert"
          className="p-2 bg-amber-50 border border-amber-300 rounded-xl text-amber-900 text-xs flex items-center justify-between shadow-2xs flex-shrink-0"
        >
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-amber-600 flex-shrink-0" />
            <span className="font-semibold">
              {lang === "hi" ? "पहले दुकान की जानकारी भरें" : "Fill shop details first"}
            </span>
            <span className="text-amber-700 hidden sm:inline">
              ({lang === "hi" ? "बिल बनाने के लिए दुकान का नाम और GSTIN आवश्यक है" : "Shop name and GSTIN required to create bills"})
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate("Settings")}
            className="px-2.5 py-0.5 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
          >
            {lang === "hi" ? "जानकारी भरें" : "Update Settings"}
          </button>
        </div>
      )}

      {/* 2. Exactly 6 Big Colored Tiles (2 rows x 3 columns) */}
      <div className="grid grid-cols-3 gap-2 sm:gap-2.5 flex-shrink-0">
        {/* 1. बिल बनाओ (Sale) */}
        <button
          type="button"
          data-testid="dashboard-new-bill-btn"
          disabled={isBillBlocked}
          onClick={() => {
            if (isBillBlocked) return;
            onNavigate("Sale");
          }}
          className={`group p-2.5 sm:p-3 rounded-xl border-2 transition-all flex items-center gap-3 text-left shadow-2xs ${
            isBillBlocked
              ? "bg-slate-100 border-slate-200 opacity-60 cursor-not-allowed"
              : "bg-emerald-50/85 hover:bg-emerald-100/90 border-emerald-400 hover:border-emerald-500 hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
          }`}
        >
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-emerald-600 text-white flex items-center justify-center flex-shrink-0 shadow-xs group-hover:scale-105 transition-transform">
            <DuotoneReceipt size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className="font-serif font-bold text-base sm:text-lg text-emerald-950 truncate">
                {lang === "hi" ? "बिल बनाओ" : "Create Bill"}
              </span>
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-200/70 text-emerald-900">
                F1
              </span>
            </div>
            <p className="text-xs text-emerald-800/80 font-medium truncate mt-0.5">
              {lang === "hi" ? "सामान बेचना" : "Sell goods (Sale)"}
            </p>
          </div>
        </button>

        {/* 2. माल आया (Purchase) */}
        <button
          type="button"
          data-testid="dashboard-stock-in-btn"
          onClick={() => onNavigate("Purchase")}
          className="group p-2.5 sm:p-3 rounded-xl border-2 border-blue-400 bg-blue-50/85 hover:bg-blue-100/90 hover:border-blue-500 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center gap-3 text-left shadow-2xs cursor-pointer"
        >
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center flex-shrink-0 shadow-xs group-hover:scale-105 transition-transform">
            <DuotoneTruck size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className="font-serif font-bold text-base sm:text-lg text-blue-950 truncate">
                {lang === "hi" ? "माल आया" : "Stock In"}
              </span>
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-blue-200/70 text-blue-900">
                F2
              </span>
            </div>
            <p className="text-xs text-blue-800/80 font-medium truncate mt-0.5">
              {lang === "hi" ? "सामान खरीदना" : "Buy goods (Purchase)"}
            </p>
          </div>
        </button>

        {/* 3. पैसा मिला (Receipt) */}
        <button
          type="button"
          data-testid="tile-payment-receipt"
          onClick={() => {
            if (onOpenPayment) onOpenPayment(null, "receipt");
            else onNavigate("Payment");
          }}
          className="group p-2.5 sm:p-3 rounded-xl border-2 border-teal-400 bg-teal-50/85 hover:bg-teal-100/90 hover:border-teal-500 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center gap-3 text-left shadow-2xs cursor-pointer"
        >
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-teal-600 text-white flex items-center justify-center flex-shrink-0 shadow-xs group-hover:scale-105 transition-transform">
            <ArrowDownLeft size={26} strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1">
            <span className="font-serif font-bold text-base sm:text-lg text-teal-950 block truncate">
              {lang === "hi" ? "पैसा मिला" : "Receive Money"}
            </span>
            <p className="text-xs text-teal-800/80 font-medium truncate mt-0.5">
              {lang === "hi" ? "ग्राहक से पैसा आया" : "Payment from customer"}
            </p>
          </div>
        </button>

        {/* 4. पैसा दिया (Payment) */}
        <button
          type="button"
          data-testid="tile-payment-send"
          onClick={() => {
            if (onOpenPayment) onOpenPayment(null, "payment");
            else onNavigate("Payment");
          }}
          className="group p-2.5 sm:p-3 rounded-xl border-2 border-amber-400 bg-amber-50/85 hover:bg-amber-100/90 hover:border-amber-500 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center gap-3 text-left shadow-2xs cursor-pointer"
        >
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-amber-600 text-white flex items-center justify-center flex-shrink-0 shadow-xs group-hover:scale-105 transition-transform">
            <ArrowUpRight size={26} strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1">
            <span className="font-serif font-bold text-base sm:text-lg text-amber-950 block truncate">
              {lang === "hi" ? "पैसा दिया" : "Pay Money"}
            </span>
            <p className="text-xs text-amber-800/80 font-medium truncate mt-0.5">
              {lang === "hi" ? "सप्लायर को पैसा दिया" : "Payment to supplier"}
            </p>
          </div>
        </button>

        {/* 5. स्टॉक देखो (Stock) */}
        <button
          type="button"
          data-testid="tile-stock"
          onClick={() => onNavigate("Stock")}
          className="group p-2.5 sm:p-3 rounded-xl border-2 border-purple-400 bg-purple-50/85 hover:bg-purple-100/90 hover:border-purple-500 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center gap-3 text-left shadow-2xs cursor-pointer"
        >
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-purple-600 text-white flex items-center justify-center flex-shrink-0 shadow-xs group-hover:scale-105 transition-transform">
            <DuotoneWarehouse size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <span className="font-serif font-bold text-base sm:text-lg text-purple-950 block truncate">
              {lang === "hi" ? "स्टॉक देखो" : "View Stock"}
            </span>
            <p className="text-xs text-purple-800/80 font-medium truncate mt-0.5">
              {lang === "hi" ? "गोदाम में कितना माल है" : "Check item inventory"}
            </p>
          </div>
        </button>

        {/* 6. किससे कितना लेना है (Len-Den) */}
        <button
          type="button"
          data-testid="tile-lenden"
          onClick={() => onNavigate("Len-Den")}
          className="group p-2.5 sm:p-3 rounded-xl border-2 border-rose-400 bg-rose-50/85 hover:bg-rose-100/90 hover:border-rose-500 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center gap-3 text-left shadow-2xs cursor-pointer"
        >
          <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-rose-600 text-white flex items-center justify-center flex-shrink-0 shadow-xs group-hover:scale-105 transition-transform">
            <DuotoneBook size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <span className="font-serif font-bold text-base sm:text-lg text-rose-950 block truncate">
              {lang === "hi" ? "किससे कितना लेना है" : "Who Owes What"}
            </span>
            <p className="text-xs text-rose-800/80 font-medium truncate mt-0.5">
              {lang === "hi" ? "उधारी व बाकी हिसाब" : "Customer balances & khata"}
            </p>
          </div>
        </button>
      </div>

      {/* 3. Four Small Quick Action Buttons in 1 Line */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          data-testid="btn-add-item"
          onClick={() => {
            if (onOpenAddItem) onOpenAddItem();
            else onNavigate("Items");
          }}
          className="flex-1 py-1.5 px-2.5 rounded-lg border border-border bg-surface hover:bg-paper text-ink font-semibold text-xs shadow-2xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          <Plus size={14} className="text-emerald-700 font-bold flex-shrink-0" />
          <span className="truncate">{lang === "hi" ? "+ नया सामान जोड़ो" : "+ Add New Item"}</span>
        </button>

        <button
          type="button"
          data-testid="btn-add-party"
          onClick={() => setIsAddPartyOpen(true)}
          className="flex-1 py-1.5 px-2.5 rounded-lg border border-border bg-surface hover:bg-paper text-ink font-semibold text-xs shadow-2xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          <Users size={14} className="text-blue-700 font-bold flex-shrink-0" />
          <span className="truncate">
            {lang === "hi" ? "+ नया ग्राहक / सप्लायर जोड़ो" : "+ Add Customer / Supplier"}
          </span>
        </button>

        <button
          type="button"
          data-testid="btn-view-reports"
          onClick={() => onNavigate("Reports")}
          className="flex-1 py-1.5 px-2.5 rounded-lg border border-border bg-surface hover:bg-paper text-ink font-semibold text-xs shadow-2xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          <DuotoneChart size={14} className="text-indigo-700 flex-shrink-0" />
          <span className="truncate">{lang === "hi" ? "रिपोर्ट देखो" : "View Reports"}</span>
        </button>

        <button
          type="button"
          data-testid="btn-take-backup"
          onClick={() => onNavigate("Backup")}
          className="flex-1 py-1.5 px-2.5 rounded-lg border border-border bg-surface hover:bg-paper text-ink font-semibold text-xs shadow-2xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          <Database size={14} className="text-amber-700 flex-shrink-0" />
          <span className="truncate">{lang === "hi" ? "बैकअप लो" : "Take Backup"}</span>
        </button>
      </div>

      {/* 4. Four Compact KPI Cards in 1 Row */}
      <div className="grid grid-cols-4 gap-2 flex-shrink-0">
        {/* Card 1: आज की बिक्री */}
        <div className="bg-emerald-50/80 border border-emerald-200/90 rounded-lg p-2 shadow-2xs flex flex-col justify-between">
          <div className="text-[11px] font-bold text-emerald-900 truncate">
            {lang === "hi" ? "आज की बिक्री" : "Today's Sales"}
          </div>
          <div className="text-lg sm:text-xl font-serif font-bold text-emerald-950 num-tabular tracking-tight">
            {formatCurrency(stats.today_sales)}
          </div>
          <div className="text-[10px] text-emerald-800/80 font-medium truncate">
            {yesterdayComp && yesterdayComp.sales_growth_percent !== 0
              ? `${yesterdayComp.sales_growth_percent > 0 ? "+" : ""}${Math.abs(yesterdayComp.sales_growth_percent).toFixed(0)}% ${lang === "hi" ? "कल से" : "vs yesterday"}`
              : (lang === "hi" ? "नकद व उधार" : "Cash & Credit")}
          </div>
        </div>

        {/* Card 2: आज की खरीदी (माल आया) */}
        <div className="bg-blue-50/80 border border-blue-200/90 rounded-lg p-2 shadow-2xs flex flex-col justify-between">
          <div className="text-[11px] font-bold text-blue-900 truncate">
            {lang === "hi" ? "आज की खरीदी (माल आया)" : "Today's Purchases"}
          </div>
          <div className="text-lg sm:text-xl font-serif font-bold text-blue-950 num-tabular tracking-tight">
            {formatCurrency(stats.today_purchases)}
          </div>
          <div className="text-[10px] text-blue-800/80 font-medium truncate">
            {lang === "hi"
              ? `कल: ${yesterdayComp ? formatCurrency(yesterdayComp.yesterday_purchases) : "₹0"}`
              : `Yday: ${yesterdayComp ? formatCurrency(yesterdayComp.yesterday_purchases) : "₹0"}`}
          </div>
        </div>

        {/* Card 3: बाज़ार से लेना है */}
        <div className="bg-rose-50/80 border border-rose-200/90 rounded-lg p-2 shadow-2xs flex flex-col justify-between">
          <div className="text-[11px] font-bold text-rose-900 truncate">
            {lang === "hi" ? "बाज़ार से लेना है" : "To Collect"}
          </div>
          <div className="text-lg sm:text-xl font-serif font-bold text-rose-950 num-tabular tracking-tight">
            {formatCurrency(totalReceivable)}
          </div>
          <div className="text-[10px] text-rose-800/80 font-medium truncate">
            {topReceivables.length} {lang === "hi" ? "खाते बाकी" : "parties"}
          </div>
        </div>

        {/* Card 4: सप्लायर को देना है */}
        <div className="bg-amber-50/80 border border-amber-200/90 rounded-lg p-2 shadow-2xs flex flex-col justify-between">
          <div className="text-[11px] font-bold text-amber-900 truncate">
            {lang === "hi" ? "सप्लायर को देना है" : "To Pay"}
          </div>
          <div className="text-lg sm:text-xl font-serif font-bold text-amber-950 num-tabular tracking-tight">
            {formatCurrency(totalPayable)}
          </div>
          <div className="text-[10px] text-amber-800/80 font-medium truncate">
            {lang === "hi" ? "सप्लायर बाकी" : "Supplier due"}
          </div>
        </div>
      </div>

      {/* 5. 'ध्यान दें' (Attention) Section with Tabs & Compact Table */}
      <div className="bg-surface border border-border rounded-panel flex flex-col min-h-0 flex-1 overflow-hidden shadow-2xs">
        <div className="p-2 border-b border-border/80 flex items-center justify-between gap-2 flex-shrink-0 bg-paper/60">
          <div className="flex items-center gap-2">
            <span className="font-serif font-bold text-xs text-ink flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              {lang === "hi" ? "ध्यान दें" : "Attention"}
            </span>
            <div className="flex items-center bg-border/60 p-0.5 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setActiveListTab("receivables");
                  setPage(1);
                }}
                className={`px-2.5 py-0.5 text-[11px] font-bold rounded-md transition-all cursor-pointer ${
                  activeListTab === "receivables"
                    ? "bg-surface text-ink shadow-2xs"
                    : "text-muted hover:text-ink"
                }`}
              >
                {lang === "hi" ? "उधारी सूची (लेना है)" : "Receivables"} ({filteredReceivables.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveListTab("low_stock");
                  setPage(1);
                }}
                className={`px-2.5 py-0.5 text-[11px] font-bold rounded-md transition-all cursor-pointer ${
                  activeListTab === "low_stock"
                    ? "bg-surface text-ink shadow-2xs"
                    : "text-muted hover:text-ink"
                }`}
              >
                {lang === "hi" ? "कम स्टॉक" : "Low Stock"} ({filteredLowStock.length})
              </button>
            </div>
          </div>

          <input
            type="text"
            placeholder={lang === "hi" ? "सूची में खोजें..." : "Filter..."}
            value={listSearch}
            onChange={(e) => {
              setListSearch(e.target.value);
              setPage(1);
            }}
            className="text-xs px-2 py-0.5 bg-surface border border-border rounded-lg text-ink focus:outline-none focus:ring-1 focus:ring-forest w-32 sm:w-40"
          />
        </div>

        {/* Table container with data-scroll="true" */}
        <div className="flex-1 min-h-0 overflow-y-auto" data-scroll="true">
          {activeListTab === "receivables" ? (
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-paper/90 sticky top-0 border-b border-border text-muted font-bold">
                <tr>
                  <th className="py-1 px-3">{lang === "hi" ? "पार्टी" : "Party"}</th>
                  <th className="py-1 px-2">{lang === "hi" ? "गांव / फोन" : "Village/Phone"}</th>
                  <th className="py-1 px-3 text-right">{lang === "hi" ? "बाकी रकम" : "Balance"}</th>
                  <th className="py-1 px-2 text-center">{lang === "hi" ? "स्थिति" : "Status"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {paginatedList.length > 0 ? (
                  paginatedList.map((row: any) => (
                    <tr key={row.party_id} className="hover:bg-paper/40 transition-colors">
                      <td className="py-1 px-3 font-bold text-ink">
                        {row.name}
                      </td>
                      <td className="py-1 px-2 text-muted">
                        {row.village || row.phone || "-"}
                      </td>
                      <td className="py-1 px-3 text-right font-bold text-rose-700 num-tabular">
                        {formatCurrency(row.receivable_paise)}
                      </td>
                      <td className="py-1 px-2 text-center">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            row.oldest_debt_days >= 30
                              ? "bg-rose-100 text-rose-800 border border-rose-300"
                              : "bg-amber-100 text-amber-800 border border-amber-300"
                          }`}
                        >
                          {row.oldest_debt_days >= 30
                            ? lang === "hi"
                              ? "30+ दिन पुराना"
                              : "Overdue (30+ days)"
                            : `${row.oldest_debt_days} ${lang === "hi" ? "दिन" : "days"}`}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-muted">
                      {lang === "hi" ? "कोई उधारी बाकी नहीं है" : "No pending receivables"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-paper/90 sticky top-0 border-b border-border text-muted font-bold">
                <tr>
                  <th className="py-1 px-3">{lang === "hi" ? "सामान" : "Item"}</th>
                  <th className="py-1 px-2">{lang === "hi" ? "गोदाम" : "Godown"}</th>
                  <th className="py-1 px-3 text-right">{lang === "hi" ? "उपलब्ध" : "Stock"}</th>
                  <th className="py-1 px-2 text-center">{lang === "hi" ? "स्थिति" : "Status"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {paginatedList.length > 0 ? (
                  paginatedList.map((row: any) => (
                    <tr key={row.item_id} className="hover:bg-paper/40 transition-colors">
                      <td className="py-1 px-3 font-bold text-ink">
                        {row.name}
                      </td>
                      <td className="py-1 px-2 text-muted">
                        {row.godown_name}
                      </td>
                      <td className="py-1 px-3 text-right font-bold text-amber-700 num-tabular">
                        {(row.current_stock_milli / 1000).toFixed(1)} {row.base_unit}
                      </td>
                      <td className="py-1 px-2 text-center">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                          {lang === "hi" ? "कम स्टॉक" : "Low Stock"}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-muted">
                      {lang === "hi" ? "सभी सामान पर्याप्त हैं" : "Stock is healthy"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <Pagination
          currentPage={page}
          totalItems={totalItems}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          pageSizeOptions={[5, 10]}
          lang={lang}
          compact
        />
      </div>

      {/* Add Party Modal from Quick Action */}
      <AddPartyModal
        isOpen={isAddPartyOpen}
        onClose={() => setIsAddPartyOpen(false)}
        onSuccess={() => {
          setIsAddPartyOpen(false);
          loadAllData();
        }}
        defaultType="both"
        t={t}
      />
    </div>
  );
}
