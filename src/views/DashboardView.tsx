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
  SessionUser,
} from "../types";
import { Translations, Language } from "../i18n";
import { formatCurrency } from "../utils/formatters";
import { localTodayIso } from "../utils/dateUtils";
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
  currentUser?: SessionUser | null;
}

export function DashboardView({
  settings,
  refreshTrigger,
  onNavigate,
  onOpenPayment,
  onOpenAddItem,
  t,
  lang,
  currentUser,
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
  const [loadError, setLoadError] = useState<string | null>(null);

  // Tab, filter & pagination state for Attention section
  const [activeListTab, setActiveListTab] = useState<"receivables" | "low_stock">("receivables");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [listSearch, setListSearch] = useState("");
  const [isAddPartyOpen, setIsAddPartyOpen] = useState(false);

  const isBillBlocked =
    !settings.shopName?.trim() || (settings.isGstRegistered && !settings.gstin?.trim());

  const isStaff = currentUser?.role === "staff";

  const todayIso = localTodayIso();

  const loadAllData = async () => {
    const errors: string[] = [];

    try {
      const s = await invoke<DashboardStats>("get_dashboard_stats_cmd", { todayDate: todayIso });
      setStats(s);
    } catch (e: any) {
      console.error("get_dashboard_stats_cmd error:", e);
      errors.push(`Stats: ${typeof e === "string" ? e : e?.message || String(e)}`);
    }

    try {
      const comp = await invoke<YesterdayComparison>("get_yesterday_comparison_cmd", {
        todayDate: todayIso,
      });
      setYesterdayComp(comp);
    } catch (e: any) {
      console.error("get_yesterday_comparison_cmd error:", e);
      errors.push(`Comparison: ${typeof e === "string" ? e : e?.message || String(e)}`);
    }

    try {
      const rec = await invoke<TopReceivableParty[]>("get_top_receivables_cmd", {
        limit: 20,
        asOfDate: todayIso,
      });
      setTopReceivables(rec);
    } catch (e: any) {
      console.error("get_top_receivables_cmd error:", e);
      errors.push(`Receivables: ${typeof e === "string" ? e : e?.message || String(e)}`);
    }

    try {
      const low = await invoke<LowStockItem[]>("get_low_stock_items_cmd", {
        thresholdMilli: (settings.lowStockThreshold || 10) * 1000,
      });
      setLowStockItems(low.filter((item) => item.current_stock_milli > 0));
    } catch (e: any) {
      console.error("get_low_stock_items_cmd error:", e);
      errors.push(`Low Stock: ${typeof e === "string" ? e : e?.message || String(e)}`);
    }

    try {
      const bStatus = await invoke<BackupStatusInfo>("get_backup_status_cmd");
      setBackupStatus(bStatus);
    } catch (e: any) {
      console.error("get_backup_status_cmd error:", e);
      errors.push(`Backup: ${typeof e === "string" ? e : e?.message || String(e)}`);
    }

    setLoadError(errors.length > 0 ? errors.join(" | ") : null);
  };

  useEffect(() => {
    loadAllData();
    const handleFocus = () => {
      loadAllData();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
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
    <div className="h-full max-h-full flex flex-col justify-between overflow-hidden gap-2.5 text-slate-900 font-body select-none">
      {/* 1. Top Header: Bada Heading 'आज क्या करना है?' + Shop Name + Backup Chip */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-2.5 sm:p-3 px-4 flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-1 rounded-xl bg-slate-50 border border-slate-100 flex-shrink-0">
            <BahiLogoMark size={32} className="flex-shrink-0" />
          </div>
          <div className="min-w-0">
            <h1 className="font-serif text-lg sm:text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2 truncate">
              <span>{lang === "hi" ? "आज क्या करना है?" : "What would you like to do today?"}</span>
            </h1>
            <p className="text-xs font-semibold text-slate-500 tracking-wide truncate flex items-center gap-1.5 mt-0.5">
              <span className="text-emerald-700 font-bold">{settings.shopName}</span>
              <span className="opacity-40">•</span>
              <span>{todayFormattedString}</span>
              <span className="opacity-40">•</span>
              <span className="text-emerald-800 font-serif font-bold">
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
              onClick={() => {
                if (!isStaff) onNavigate("Backup");
              }}
              data-testid="dashboard-backup-status-chip"
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-2xs ${
                (backupStatus.isBackupRecent ?? backupStatus.is_recent)
                  ? "bg-emerald-50 text-emerald-800 border border-emerald-300"
                  : "bg-rose-50 text-rose-700 border border-rose-300"
              }`}
              title={lang === "hi" ? "बैकअप प्रबंधन" : "Backup Management"}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  (backupStatus.isBackupRecent ?? backupStatus.is_recent)
                    ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]"
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

      {/* Red Warning Banner if last backup is older than 3 days */}
      {(backupStatus?.isOlderThan3Days || backupStatus?.is_older_than_3_days) && (
        <div
          data-testid="backup-overdue-banner"
          className="p-3 bg-rose-600 text-white rounded-xl shadow-sm flex items-center justify-between text-xs font-semibold flex-shrink-0"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <AlertCircle size={20} className="text-white flex-shrink-0 animate-pulse" />
            <div>
              <span className="font-bold text-sm block">
                {lang === "hi"
                  ? "चेतावनी: आख़िरी बैकअप 3 दिन से पुराना है!"
                  : "Warning: Last backup is older than 3 days!"}
              </span>
              <span className="text-white/90 text-xs">
                {lang === "hi"
                  ? "डेटा सुरक्षित रखने और किसी भी नुकसान से बचने के लिए तुरंत नया बैकअप लें।"
                  : "Please take a backup immediately to prevent data loss."}
              </span>
            </div>
          </div>
          <button
            type="button"
            data-testid="backup-now-btn"
            onClick={() => onNavigate("Backup")}
            className="px-3.5 py-1.5 bg-white text-rose-700 hover:bg-rose-50 rounded-lg font-bold text-xs shadow-xs transition-colors cursor-pointer flex-shrink-0 ml-3"
          >
            {lang === "hi" ? "अभी बैकअप लें" : "Backup Now"}
          </button>
        </div>
      )}

      {/* Visible Error Banner if any dashboard invoke failed */}
      {loadError && (
        <div
          data-testid="dashboard-error-banner"
          className="p-2.5 bg-rose-50 border border-rose-300 rounded-xl text-rose-900 text-xs flex items-center justify-between shadow-2xs flex-shrink-0 animate-in fade-in"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle size={16} className="text-rose-600 flex-shrink-0" />
            <span className="font-semibold truncate">
              {lang === "hi" ? "डैशबोर्ड लोड करने में समस्या आई: " : "Dashboard load error: "}
              <span className="font-mono text-[11px] text-rose-800">{loadError}</span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => loadAllData()}
            className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer flex-shrink-0 ml-2"
          >
            {lang === "hi" ? "पुनः प्रयास करें" : "Retry"}
          </button>
        </div>
      )}

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

      {/* 2. Exactly 6 Big Action Cards (2 rows x 3 columns) */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3 flex-shrink-0">
        {/* 1. बिल बनाओ (Sale) */}
        <button
          type="button"
          data-testid="dashboard-new-bill-btn"
          disabled={isBillBlocked}
          onClick={() => {
            if (isBillBlocked) return;
            onNavigate("Sale");
          }}
          className={`group p-3 sm:p-3.5 rounded-2xl border transition-all flex items-center gap-3.5 text-left shadow-xs ${
            isBillBlocked
              ? "bg-slate-100 border-slate-200 opacity-60 cursor-not-allowed"
              : "bg-white hover:bg-emerald-50/30 border-slate-200/90 hover:border-emerald-500/60 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 cursor-pointer"
          }`}
        >
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100/80 group-hover:bg-emerald-600 group-hover:text-white transition-all duration-200 flex items-center justify-center flex-shrink-0 shadow-2xs">
            <DuotoneReceipt size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className="font-serif font-bold text-base sm:text-lg text-slate-900 group-hover:text-emerald-800 transition-colors truncate">
                {lang === "hi" ? "बिल बनाओ" : "Create Bill"}
              </span>
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200/80 text-slate-600 shadow-2xs">
                F1
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium truncate mt-0.5">
              {lang === "hi" ? "सामान बेचना" : "Sell goods (Sale)"}
            </p>
          </div>
        </button>

        {/* 2. माल आया (Purchase) */}
        <button
          type="button"
          data-testid="dashboard-stock-in-btn"
          onClick={() => onNavigate("Purchase")}
          className="group p-3 sm:p-3.5 rounded-2xl border border-slate-200/90 bg-white hover:bg-blue-50/30 hover:border-blue-500/60 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 transition-all duration-200 flex items-center gap-3.5 text-left shadow-xs cursor-pointer"
        >
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 border border-blue-100/80 group-hover:bg-blue-600 group-hover:text-white transition-all duration-200 flex items-center justify-center flex-shrink-0 shadow-2xs">
            <DuotoneTruck size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className="font-serif font-bold text-base sm:text-lg text-slate-900 group-hover:text-blue-800 transition-colors truncate">
                {lang === "hi" ? "माल आया" : "Stock In"}
              </span>
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200/80 text-slate-600 shadow-2xs">
                F2
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium truncate mt-0.5">
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
          className="group p-3 sm:p-3.5 rounded-2xl border border-slate-200/90 bg-white hover:bg-teal-50/30 hover:border-teal-500/60 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 transition-all duration-200 flex items-center gap-3.5 text-left shadow-xs cursor-pointer"
        >
          <div className="w-12 h-12 rounded-xl bg-teal-50 text-teal-600 border border-teal-100/80 group-hover:bg-teal-600 group-hover:text-white transition-all duration-200 flex items-center justify-center flex-shrink-0 shadow-2xs">
            <ArrowDownLeft size={26} strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1">
            <span className="font-serif font-bold text-base sm:text-lg text-slate-900 group-hover:text-teal-800 transition-colors block truncate">
              {lang === "hi" ? "पैसा मिला" : "Receive Money"}
            </span>
            <p className="text-xs text-slate-500 font-medium truncate mt-0.5">
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
          className="group p-3 sm:p-3.5 rounded-2xl border border-slate-200/90 bg-white hover:bg-amber-50/30 hover:border-amber-500/60 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 transition-all duration-200 flex items-center gap-3.5 text-left shadow-xs cursor-pointer"
        >
          <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 border border-amber-100/80 group-hover:bg-amber-600 group-hover:text-white transition-all duration-200 flex items-center justify-center flex-shrink-0 shadow-2xs">
            <ArrowUpRight size={26} strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1">
            <span className="font-serif font-bold text-base sm:text-lg text-slate-900 group-hover:text-amber-800 transition-colors block truncate">
              {lang === "hi" ? "पैसा दिया" : "Pay Money"}
            </span>
            <p className="text-xs text-slate-500 font-medium truncate mt-0.5">
              {lang === "hi" ? "सप्लायर को पैसा दिया" : "Payment to supplier"}
            </p>
          </div>
        </button>

        {/* 5. स्टॉक देखो (Stock) */}
        <button
          type="button"
          data-testid="tile-stock"
          onClick={() => onNavigate("Stock")}
          className="group p-3 sm:p-3.5 rounded-2xl border border-slate-200/90 bg-white hover:bg-purple-50/30 hover:border-purple-500/60 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 transition-all duration-200 flex items-center gap-3.5 text-left shadow-xs cursor-pointer"
        >
          <div className="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 border border-purple-100/80 group-hover:bg-purple-600 group-hover:text-white transition-all duration-200 flex items-center justify-center flex-shrink-0 shadow-2xs">
            <DuotoneWarehouse size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <span className="font-serif font-bold text-base sm:text-lg text-slate-900 group-hover:text-purple-800 transition-colors block truncate">
              {lang === "hi" ? "स्टॉक देखो" : "View Stock"}
            </span>
            <p className="text-xs text-slate-500 font-medium truncate mt-0.5">
              {lang === "hi" ? "गोदाम में कितना माल है" : "Check item inventory"}
            </p>
          </div>
        </button>

        {/* 6. किससे कितना लेना है (Len-Den) */}
        <button
          type="button"
          data-testid="tile-lenden"
          onClick={() => onNavigate("Len-Den")}
          className="group p-3 sm:p-3.5 rounded-2xl border border-slate-200/90 bg-white hover:bg-rose-50/30 hover:border-rose-500/60 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 transition-all duration-200 flex items-center gap-3.5 text-left shadow-xs cursor-pointer"
        >
          <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 border border-rose-100/80 group-hover:bg-rose-600 group-hover:text-white transition-all duration-200 flex items-center justify-center flex-shrink-0 shadow-2xs">
            <DuotoneBook size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <span className="font-serif font-bold text-base sm:text-lg text-slate-900 group-hover:text-rose-800 transition-colors block truncate">
              {lang === "hi" ? "किससे कितना लेना है" : "Who Owes What"}
            </span>
            <p className="text-xs text-slate-500 font-medium truncate mt-0.5">
              {lang === "hi" ? "उधारी व बाकी हिसाब" : "Customer balances & khata"}
            </p>
          </div>
        </button>
      </div>

      {/* 3. Four Small Quick Action Buttons in 1 Line */}
      <div className="flex items-center gap-2 sm:gap-2.5 flex-shrink-0">
        <button
          type="button"
          data-testid="btn-add-item"
          onClick={() => {
            if (onOpenAddItem) onOpenAddItem();
            else onNavigate("Items");
          }}
          className="flex-1 py-2 px-3 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-xs shadow-2xs flex items-center justify-center gap-2 transition-all hover:border-slate-300 cursor-pointer"
        >
          <Plus size={14} className="text-emerald-700 font-bold flex-shrink-0" />
          <span className="truncate">{lang === "hi" ? "+ नया सामान जोड़ो" : "+ Add New Item"}</span>
        </button>

        <button
          type="button"
          data-testid="btn-add-party"
          onClick={() => setIsAddPartyOpen(true)}
          className="flex-1 py-2 px-3 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-xs shadow-2xs flex items-center justify-center gap-2 transition-all hover:border-slate-300 cursor-pointer"
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
          className="flex-1 py-2 px-3 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-xs shadow-2xs flex items-center justify-center gap-2 transition-all hover:border-slate-300 cursor-pointer"
        >
          <DuotoneChart size={14} className="text-indigo-700 flex-shrink-0" />
          <span className="truncate">{lang === "hi" ? "रिपोर्ट देखो" : "View Reports"}</span>
        </button>

        {!isStaff && (
          <button
            type="button"
            data-testid="btn-take-backup"
            onClick={() => onNavigate("Backup")}
            className="flex-1 py-2 px-3 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-slate-800 font-semibold text-xs shadow-2xs flex items-center justify-center gap-2 transition-all hover:border-slate-300 cursor-pointer"
          >
            <Database size={14} className="text-amber-700 flex-shrink-0" />
            <span className="truncate">{lang === "hi" ? "बैकअप लो" : "Take Backup"}</span>
          </button>
        )}
      </div>

      {/* 4. Four Compact KPI Cards in 1 Row */}
      <div className="grid grid-cols-4 gap-2 sm:gap-2.5 flex-shrink-0">
        {/* Card 1: आज की बिक्री */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-2.5 sm:p-3 shadow-xs flex flex-col justify-between hover:shadow-sm transition-shadow">
          <div className="flex items-center justify-between gap-1 mb-1">
            <span className="text-[11px] font-bold text-slate-600 truncate">
              {lang === "hi" ? "आज की बिक्री" : "Today's Sales"}
            </span>
            <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
          </div>
          <div className="text-xl sm:text-2xl font-serif font-black text-slate-900 num-tabular tracking-tight my-0.5">
            {formatCurrency(stats.today_sales)}
          </div>
          <div className="text-[10px] text-slate-500 font-semibold truncate">
            {yesterdayComp && yesterdayComp.sales_growth_percent !== 0
              ? `${yesterdayComp.sales_growth_percent > 0 ? "+" : ""}${Math.abs(yesterdayComp.sales_growth_percent).toFixed(0)}% ${lang === "hi" ? "कल से" : "vs yesterday"}`
              : (lang === "hi" ? "नकद व उधार" : "Cash & Credit")}
          </div>
        </div>

        {/* Card 2: आज की खरीदी (माल आया) */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-2.5 sm:p-3 shadow-xs flex flex-col justify-between hover:shadow-sm transition-shadow">
          <div className="flex items-center justify-between gap-1 mb-1">
            <span className="text-[11px] font-bold text-slate-600 truncate">
              {lang === "hi" ? "आज की खरीदी (माल आया)" : "Today's Purchases"}
            </span>
            <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
          </div>
          <div className="text-xl sm:text-2xl font-serif font-black text-slate-900 num-tabular tracking-tight my-0.5">
            {isStaff ? "••••••" : formatCurrency(stats.today_purchases)}
          </div>
          <div className="text-[10px] text-slate-500 font-semibold truncate">
            {isStaff
              ? (lang === "hi" ? "केवल व्यवस्थापक" : "Owner only")
              : (lang === "hi"
                  ? `कल: ${yesterdayComp ? formatCurrency(yesterdayComp.yesterday_purchases) : "₹0"}`
                  : `Yday: ${yesterdayComp ? formatCurrency(yesterdayComp.yesterday_purchases) : "₹0"}`)}
          </div>
        </div>

        {/* Card 3: बाज़ार से लेना है */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-2.5 sm:p-3 shadow-xs flex flex-col justify-between hover:shadow-sm transition-shadow">
          <div className="flex items-center justify-between gap-1 mb-1">
            <span className="text-[11px] font-bold text-slate-600 truncate">
              {lang === "hi" ? "बाज़ार से लेना है" : "To Collect"}
            </span>
            <span className="w-2 h-2 rounded-full bg-rose-500 flex-shrink-0" />
          </div>
          <div className="text-xl sm:text-2xl font-serif font-black text-rose-600 num-tabular tracking-tight my-0.5">
            {formatCurrency(totalReceivable)}
          </div>
          <div className="text-[10px] text-slate-500 font-semibold truncate">
            {topReceivables.length} {lang === "hi" ? "खाते बाकी" : "parties"}
          </div>
        </div>

        {/* Card 4: सप्लायर को देना है */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-2.5 sm:p-3 shadow-xs flex flex-col justify-between hover:shadow-sm transition-shadow">
          <div className="flex items-center justify-between gap-1 mb-1">
            <span className="text-[11px] font-bold text-slate-600 truncate">
              {lang === "hi" ? "सप्लायर को देना है" : "To Pay"}
            </span>
            <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
          </div>
          <div className="text-xl sm:text-2xl font-serif font-black text-amber-700 num-tabular tracking-tight my-0.5">
            {formatCurrency(totalPayable)}
          </div>
          <div className="text-[10px] text-slate-500 font-semibold truncate">
            {lang === "hi" ? "सप्लायर बाकी" : "Supplier due"}
          </div>
        </div>
      </div>

      {/* 5. 'ध्यान दें' (Attention) Section with Tabs & Compact Table */}
      <div className="bg-white border border-slate-200/90 rounded-2xl shadow-xs flex flex-col min-h-0 flex-1 overflow-hidden">
        <div className="p-2.5 px-4 border-b border-slate-100 flex items-center justify-between gap-3 flex-shrink-0 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <span className="font-serif font-bold text-xs text-slate-900 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              {lang === "hi" ? "ध्यान दें" : "Attention"}
            </span>
            <div className="flex items-center bg-slate-200/70 p-0.5 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setActiveListTab("receivables");
                  setPage(1);
                }}
                className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                  activeListTab === "receivables"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
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
                className={`px-3 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer ${
                  activeListTab === "low_stock"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
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
            className="text-xs px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-600 w-36 sm:w-44 shadow-2xs"
          />
        </div>

        {/* Table container with data-scroll="true" */}
        <div className="flex-1 min-h-0 overflow-y-auto" data-scroll="true">
          {activeListTab === "receivables" ? (
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-50/90 sticky top-0 border-b border-slate-200 text-slate-600 font-bold">
                <tr>
                  <th className="py-2 px-3.5">{lang === "hi" ? "पार्टी" : "Party"}</th>
                  <th className="py-2 px-3">{lang === "hi" ? "गांव / फोन" : "Village/Phone"}</th>
                  <th className="py-2 px-3.5 text-right">{lang === "hi" ? "बाकी रकम" : "Balance"}</th>
                  <th className="py-2 px-3 text-center">{lang === "hi" ? "स्थिति" : "Status"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedList.length > 0 ? (
                  paginatedList.map((row: any) => (
                    <tr key={row.party_id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-2 px-3.5 font-bold text-slate-900">
                        {row.name}
                      </td>
                      <td className="py-2 px-3 text-slate-500">
                        {row.village || row.phone || "-"}
                      </td>
                      <td className="py-2 px-3.5 text-right font-bold text-rose-600 num-tabular">
                        {formatCurrency(row.receivable_paise)}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
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
                    <td colSpan={4} className="py-5 text-center text-slate-400">
                      {lang === "hi" ? "कोई उधारी बाकी नहीं है" : "No pending receivables"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-50/90 sticky top-0 border-b border-slate-200 text-slate-600 font-bold">
                <tr>
                  <th className="py-2 px-3.5">{lang === "hi" ? "सामान" : "Item"}</th>
                  <th className="py-2 px-3">{lang === "hi" ? "गोदाम" : "Godown"}</th>
                  <th className="py-2 px-3.5 text-right">{lang === "hi" ? "उपलब्ध" : "Stock"}</th>
                  <th className="py-2 px-3 text-center">{lang === "hi" ? "स्थिति" : "Status"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedList.length > 0 ? (
                  paginatedList.map((row: any) => (
                    <tr key={row.item_id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-2 px-3.5 font-bold text-slate-900">
                        {row.name}
                      </td>
                      <td className="py-2 px-3 text-slate-500">
                        {row.godown_name}
                      </td>
                      <td className="py-2 px-3.5 text-right font-bold text-amber-700 num-tabular">
                        {(row.current_stock_milli / 1000).toFixed(1)} {row.base_unit}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                          {lang === "hi" ? "कम स्टॉक" : "Low Stock"}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-5 text-center text-slate-400">
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
