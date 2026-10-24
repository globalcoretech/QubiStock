import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AppSettings,
  DashboardStats,
  View,
  DailyTrend,
  YesterdayComparison,
  TopReceivableParty,
  LowStockItem,
} from "../types";
import { Translations, Language } from "../i18n";
import { formatCurrency } from "../utils/formatters";
import {
  BahiLogoMark,
  TrendingUp,
  TrendingDown,
  DuotoneReceipt,
  DuotoneTruck,
} from "../components/icons";
import { Pagination } from "../components/Pagination";

interface DashboardViewProps {
  settings: AppSettings;
  refreshTrigger: number;
  onNavigate: (v: View) => void;
  onPrintInvoice?: (invNo: string) => void;
  t: Translations;
  lang: Language;
}

export function DashboardView({
  settings,
  refreshTrigger,
  onNavigate,
  lang,
}: DashboardViewProps) {
  const [stats, setStats] = useState<DashboardStats>({
    today_sales: 0,
    today_purchases: 0,
    total_receivable: 0,
    total_payable: 0,
  });
  const [yesterdayComp, setYesterdayComp] = useState<YesterdayComparison | null>(null);
  const [sevenDayTrend, setSevenDayTrend] = useState<DailyTrend[]>([]);
  const [topReceivables, setTopReceivables] = useState<TopReceivableParty[]>([]);
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([]);

  // Right column tab & pagination
  const [activeListTab, setActiveListTab] = useState<"receivables" | "low_stock">("receivables");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [listSearch, setListSearch] = useState("");

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
      const trend = await invoke<DailyTrend[]>("get_7_day_trend_cmd", {
        todayDate: todayIso,
      });
      setSevenDayTrend(trend);
    } catch (e) {
      console.error("get_7_day_trend_cmd error:", e);
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
  };

  useEffect(() => {
    loadAllData();
  }, [refreshTrigger]);

  // Keyboard shortcut F1 (Sale), F2 (Purchase), F3 (Payment)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F1") {
        e.preventDefault();
        onNavigate("Sale");
      } else if (e.key === "F2") {
        e.preventDefault();
        onNavigate("Purchase");
      } else if (e.key === "F3") {
        e.preventDefault();
        onNavigate("Payment");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onNavigate]);

  // Formatted date string
  const todayFormattedString = (() => {
    const now = new Date();
    const dateNum = now.getDate();
    const year = now.getFullYear();
    if (lang === "hi") {
      const hindiDays = ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"];
      const hindiMonths = [
        "जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून",
        "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"
      ];
      return `${hindiDays[now.getDay()]}, ${dateNum} ${hindiMonths[now.getMonth()]} ${year}`;
    } else {
      const enDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const enMonths = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];
      return `${enDays[now.getDay()]}, ${dateNum} ${enMonths[now.getMonth()]} ${year}`;
    }
  })();

  // Proportional bar calculation (लेना है vs देना है)
  const totalReceivable = stats.total_receivable;
  const totalPayable = stats.total_payable;
  const balanceTotal = totalReceivable + totalPayable;
  const receivableRatio = balanceTotal > 0 ? Math.round((totalReceivable / balanceTotal) * 100) : 50;
  const payableRatio = balanceTotal > 0 ? 100 - receivableRatio : 50;

  // Filtered and paginated list items
  const filteredReceivables = topReceivables.filter((p) =>
    p.name.toLowerCase().includes(listSearch.toLowerCase())
  );
  const filteredLowStock = lowStockItems.filter((i) =>
    i.name.toLowerCase().includes(listSearch.toLowerCase())
  );

  const currentList = activeListTab === "receivables" ? filteredReceivables : filteredLowStock;
  const totalItems = currentList.length;
  const paginatedList = currentList.slice((page - 1) * pageSize, page * pageSize);

  // Maximum value for 7-day trend chart scaling
  const maxTrendVal = Math.max(
    ...sevenDayTrend.map((d) => Math.max(d.sales_paise, d.purchases_paise)),
    100000
  );

  return (
    <div className="h-full max-h-full flex flex-col justify-between overflow-hidden gap-2.5 text-ink font-body select-none">
      {/* 1. Header with Teal Color Strip on Top */}
      <div className="bg-surface border border-border border-t-4 border-t-teal-600 rounded-panel p-2.5 px-4 shadow-[0_1px_2px_rgba(28,43,36,0.04)] flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <BahiLogoMark size={36} className="flex-shrink-0 shadow-2xs" />
          <div className="min-w-0">
            <h2 className="font-serif text-lg font-bold tracking-tight text-ink flex items-center gap-2 truncate">
              <span>{settings.shopName}</span>
              <span className="text-[11px] font-sans font-semibold bg-teal-100 text-teal-800 border border-teal-300 px-2 py-0.5 rounded-full">
                {lang === "hi" ? "घर (डैशबोर्ड)" : "Home (Dashboard)"}
              </span>
            </h2>
            <p className="text-xs font-semibold text-muted tracking-wide truncate">
              {todayFormattedString}
              <span className="mx-1.5 opacity-40">•</span>
              <span className="text-forest font-serif font-bold">
                {lang === "hi" ? "डिजिटल बही-खाता" : "Digital Bahi-Khata"}
              </span>
            </p>
          </div>
        </div>

        {/* Big Action Buttons (48px+ min-height, 16px font) */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <button
            type="button"
            data-testid="dashboard-new-bill-btn"
            onClick={() => onNavigate("Sale")}
            className="min-h-[46px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm sm:text-base flex items-center gap-2 shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <DuotoneReceipt size={20} className="text-emerald-100" />
            <span>{lang === "hi" ? "नया बिल बनाओ" : "New Bill"}</span>
            <span className="text-[11px] bg-emerald-800/60 px-1.5 py-0.5 rounded text-emerald-200 font-mono">
              F1
            </span>
          </button>

          <button
            type="button"
            data-testid="dashboard-stock-in-btn"
            onClick={() => onNavigate("Purchase")}
            className="min-h-[46px] px-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm sm:text-base flex items-center gap-2 shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <DuotoneTruck size={20} className="text-blue-100" />
            <span>{lang === "hi" ? "माल दर्ज करो" : "Stock In"}</span>
            <span className="text-[11px] bg-blue-800/60 px-1.5 py-0.5 rounded text-blue-200 font-mono">
              F2
            </span>
          </button>
        </div>
      </div>

      {/* 2. KPI Strip: 4 Vibrant Cards with Light Gradients & Large Numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 flex-shrink-0">
        {/* Card 1: बिक्री (हरा - Emerald) */}
        <div className="bg-gradient-to-br from-emerald-50/90 to-emerald-100/50 border border-emerald-200/90 rounded-panel p-3 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-serif font-bold text-emerald-900">
            <span>{lang === "hi" ? "आज की बिक्री" : "Today's Sales"}</span>
            <span className="w-2 h-2 rounded-full bg-emerald-600" />
          </div>
          <div className="text-2xl sm:text-3xl font-serif font-bold text-emerald-950 num-tabular tracking-tight my-1">
            {formatCurrency(stats.today_sales)}
          </div>
          <div className="flex items-center justify-between text-[11px]">
            {yesterdayComp ? (
              <span
                className={`inline-flex items-center gap-1 font-bold num-tabular px-1.5 py-0.5 rounded ${
                  yesterdayComp.sales_growth_percent > 0
                    ? "bg-emerald-200/80 text-emerald-900"
                    : yesterdayComp.sales_growth_percent < 0
                    ? "bg-rose-200/80 text-rose-900"
                    : "bg-surface text-muted"
                }`}
              >
                {yesterdayComp.sales_growth_percent > 0 ? (
                  <>
                    <TrendingUp size={12} />
                    <span>+{Math.abs(yesterdayComp.sales_growth_percent).toFixed(0)}% कल से</span>
                  </>
                ) : (
                  <>
                    <TrendingDown size={12} />
                    <span>-{Math.abs(yesterdayComp.sales_growth_percent).toFixed(0)}% कल से</span>
                  </>
                )}
              </span>
            ) : (
              <span className="text-muted">-</span>
            )}
            <span className="text-emerald-800/70 text-[10px] font-semibold">नकद/उधार</span>
          </div>
        </div>

        {/* Card 2: खरीदी / माल आया (नीला - Blue) */}
        <div className="bg-gradient-to-br from-blue-50/90 to-blue-100/50 border border-blue-200/90 rounded-panel p-3 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-serif font-bold text-blue-900">
            <span>{lang === "hi" ? "आज माल आया (खरीदी)" : "Stock Inward"}</span>
            <span className="w-2 h-2 rounded-full bg-blue-600" />
          </div>
          <div className="text-2xl sm:text-3xl font-serif font-bold text-blue-950 num-tabular tracking-tight my-1">
            {formatCurrency(stats.today_purchases)}
          </div>
          <div className="flex items-center justify-between text-[11px] text-blue-900/80">
            <span className="font-medium">
              कल: {yesterdayComp ? formatCurrency(yesterdayComp.yesterday_purchases) : "₹0"}
            </span>
            <button
              type="button"
              onClick={() => onNavigate("Purchase")}
              className="font-bold underline text-blue-700 hover:text-blue-900"
            >
              देखें →
            </button>
          </div>
        </div>

        {/* Card 3: लेना है (गुलाबी - Rose) */}
        <div className="bg-gradient-to-br from-rose-50/90 to-rose-100/50 border border-rose-200/90 rounded-panel p-3 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-serif font-bold text-rose-900">
            <span>{lang === "hi" ? "बाज़ार से लेना है" : "To Collect"}</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-200/80 text-rose-900">
              {receivableRatio}%
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-serif font-bold text-rose-950 num-tabular tracking-tight my-1">
            {formatCurrency(totalReceivable)}
          </div>
          <div className="flex items-center justify-between text-[11px] text-rose-900/80">
            <span className="font-semibold text-rose-800">
              {topReceivables.length} {lang === "hi" ? "खाते बाकी" : "parties"}
            </span>
            <button
              type="button"
              onClick={() => onNavigate("Len-Den")}
              className="font-bold underline text-rose-700 hover:text-rose-900"
            >
              खाता →
            </button>
          </div>
        </div>

        {/* Card 4: देना है (नारंगी - Amber/Orange) */}
        <div className="bg-gradient-to-br from-amber-50/90 to-amber-100/50 border border-amber-200/90 rounded-panel p-3 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-serif font-bold text-amber-900">
            <span>{lang === "hi" ? "सप्लायर को देना है" : "To Pay"}</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-200/80 text-amber-900">
              {payableRatio}%
            </span>
          </div>
          <div className="text-2xl sm:text-3xl font-serif font-bold text-amber-950 num-tabular tracking-tight my-1">
            {formatCurrency(totalPayable)}
          </div>
          <div className="flex items-center justify-between text-[11px] text-amber-900/80">
            <span className="font-medium text-amber-800">सप्लायर देयता</span>
            <button
              type="button"
              onClick={() => onNavigate("Payment")}
              className="font-bold underline text-amber-700 hover:text-amber-900"
            >
              भुगतान →
            </button>
          </div>
        </div>
      </div>

      {/* 3. Lower Area: 2 Columns Grid (Fixed Height, No Page Overflow) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 flex-1 min-h-0 overflow-hidden">
        {/* Left Column: 7-Day Trend Chart & Proportional Bar (col-span-6) */}
        <div className="lg:col-span-6 bg-surface border border-border rounded-panel p-3 shadow-2xs flex flex-col justify-between overflow-y-auto" data-scroll="true">
          <div className="flex items-center justify-between border-b border-border/70 pb-2 flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-teal-600" />
              <h3 className="font-serif font-bold text-sm sm:text-base text-ink">
                {lang === "hi" ? "7 दिन का व्यापार व संतुलन" : "7-Day Sales & Ratio"}
              </h3>
            </div>
            <span className="text-xs text-muted font-medium num-tabular">
              {todayFormattedString}
            </span>
          </div>

          {/* SVG 7-Day Bar Chart */}
          <div className="flex-1 min-h-0 flex flex-col justify-center py-2">
            <div className="h-32 w-full flex items-end justify-between gap-2 px-2 pt-4">
              {sevenDayTrend.length > 0 ? (
                sevenDayTrend.map((d) => {
                  const sHeight = Math.max(6, Math.round((d.sales_paise / maxTrendVal) * 90));
                  const pHeight = Math.max(4, Math.round((d.purchases_paise / maxTrendVal) * 90));
                  const dateShort = d.date.slice(5);

                  return (
                    <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group">
                      <div className="w-full flex items-end justify-center gap-1 h-24">
                        {/* Sales Bar (Green) */}
                        <div
                          style={{ height: `${sHeight}px` }}
                          title={`बिक्री: ${formatCurrency(d.sales_paise)}`}
                          className="w-3 sm:w-4 bg-emerald-600 hover:bg-emerald-500 rounded-t transition-all"
                        />
                        {/* Purchase Bar (Blue) */}
                        <div
                          style={{ height: `${pHeight}px` }}
                          title={`खरीदी: ${formatCurrency(d.purchases_paise)}`}
                          className="w-3 sm:w-4 bg-blue-500 hover:bg-blue-400 rounded-t transition-all"
                        />
                      </div>
                      <span className="text-[10px] font-mono text-muted group-hover:text-ink font-bold">
                        {dateShort}
                      </span>
                    </div>
                  );
                })
              ) : (
                <div className="w-full text-center text-xs text-muted py-6">
                  {lang === "hi" ? "7 दिन का कोई डेटा नहीं है" : "No trend data yet"}
                </div>
              )}
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center gap-4 text-xs font-semibold text-muted pt-2 border-t border-border/50">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-emerald-600" />
                <span>{lang === "hi" ? "बिक्री (हरा)" : "Sales"}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-blue-500" />
                <span>{lang === "hi" ? "खरीदी (नीला)" : "Purchases"}</span>
              </span>
            </div>
          </div>

          {/* Proportional Bar: लेना है vs देना है */}
          <div className="bg-paper border border-border/80 rounded-xl p-2.5 flex-shrink-0 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-bold font-serif">
              <span className="text-rose-800">
                {lang === "hi" ? "लेना है" : "To Collect"}: {formatCurrency(totalReceivable)}
              </span>
              <span className="text-amber-800">
                {lang === "hi" ? "देना है" : "To Pay"}: {formatCurrency(totalPayable)}
              </span>
            </div>

            <div className="h-3 w-full bg-border rounded-full overflow-hidden flex shadow-inner">
              <div
                style={{ width: `${receivableRatio}%` }}
                title={`लेना है: ${receivableRatio}%`}
                className="bg-rose-500 h-full transition-all duration-300"
              />
              <div
                style={{ width: `${payableRatio}%` }}
                title={`देना है: ${payableRatio}%`}
                className="bg-amber-500 h-full transition-all duration-300"
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-muted num-tabular font-semibold">
              <span>{receivableRatio}% बाज़ार उधारी</span>
              <span>{payableRatio}% सप्लायर देयता</span>
            </div>
          </div>
        </div>

        {/* Right Column: Attention / Recent Items Table with Pagination (col-span-6) */}
        <div
          className="lg:col-span-6 bg-surface border border-border rounded-panel flex flex-col justify-between min-h-0 overflow-hidden shadow-2xs"
          data-scroll="true"
        >
          {/* Header Tabs & Search */}
          <div className="p-2.5 border-b border-border/80 flex items-center justify-between gap-2 flex-shrink-0 bg-paper/50">
            <div className="flex items-center gap-1 bg-border/60 p-0.5 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setActiveListTab("receivables");
                  setPage(1);
                }}
                className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
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
                className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                  activeListTab === "low_stock"
                    ? "bg-surface text-ink shadow-2xs"
                    : "text-muted hover:text-ink"
                }`}
              >
                {lang === "hi" ? "कम स्टॉक" : "Low Stock"} ({filteredLowStock.length})
              </button>
            </div>

            <input
              type="text"
              placeholder={lang === "hi" ? "सूची में खोजें..." : "Filter..."}
              value={listSearch}
              onChange={(e) => {
                setListSearch(e.target.value);
                setPage(1);
              }}
              className="text-xs px-2.5 py-1 bg-surface border border-border rounded-lg text-ink focus:outline-none focus:ring-1 focus:ring-forest w-36 sm:w-44"
            />
          </div>

          {/* Table Body (Fixed Header, Fits available height) */}
          <div className="flex-1 min-h-0 overflow-y-auto" data-scroll="true">
            {activeListTab === "receivables" ? (
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-paper/80 sticky top-0 border-b border-border text-muted font-bold">
                  <tr>
                    <th className="py-2 px-3">{lang === "hi" ? "पार्टी" : "Party"}</th>
                    <th className="py-2 px-2">{lang === "hi" ? "गांव / फोन" : "Village/Phone"}</th>
                    <th className="py-2 px-3 text-right">{lang === "hi" ? "बाकी रकम" : "Balance"}</th>
                    <th className="py-2 px-2 text-center">{lang === "hi" ? "स्थिति" : "Status"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {paginatedList.length > 0 ? (
                    paginatedList.map((row: any) => (
                      <tr key={row.party_id} className="hover:bg-paper/40 transition-colors">
                        <td className="py-2 px-3 font-bold text-ink">
                          {row.name}
                        </td>
                        <td className="py-2 px-2 text-muted">
                          {row.village || row.phone || "-"}
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-rose-700 num-tabular">
                          {formatCurrency(row.receivable_paise)}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              row.oldest_debt_days >= 30
                                ? "bg-rose-100 text-rose-800 border border-rose-300"
                                : "bg-amber-100 text-amber-800 border border-amber-300"
                            }`}
                          >
                            {row.oldest_debt_days >= 30
                              ? lang === "hi"
                                ? "देरी (30+ दिन)"
                                : "Overdue"
                              : `${row.oldest_debt_days} दिन`}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-muted">
                        {lang === "hi" ? "कोई उधारी नहीं है" : "No pending receivables"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-paper/80 sticky top-0 border-b border-border text-muted font-bold">
                  <tr>
                    <th className="py-2 px-3">{lang === "hi" ? "सामान" : "Item"}</th>
                    <th className="py-2 px-2">{lang === "hi" ? "गोदाम" : "Godown"}</th>
                    <th className="py-2 px-3 text-right">{lang === "hi" ? "उपलब्ध" : "Stock"}</th>
                    <th className="py-2 px-2 text-center">{lang === "hi" ? "स्थिति" : "Status"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {paginatedList.length > 0 ? (
                    paginatedList.map((row: any) => (
                      <tr key={row.item_id} className="hover:bg-paper/40 transition-colors">
                        <td className="py-2 px-3 font-bold text-ink">
                          {row.name}
                        </td>
                        <td className="py-2 px-2 text-muted">
                          {row.godown_name}
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-amber-700 num-tabular">
                          {(row.current_stock_milli / 1000).toFixed(1)} {row.base_unit}
                        </td>
                        <td className="py-2 px-2 text-center">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                            {lang === "hi" ? "कम स्टॉक" : "Low Stock"}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-muted">
                        {lang === "hi" ? "सभी सामान पर्याप्त हैं" : "Stock is healthy"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination Component at bottom */}
          <Pagination
            currentPage={page}
            totalItems={totalItems}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            pageSizeOptions={[5, 10, 20]}
            lang={lang}
            compact
          />
        </div>
      </div>
    </div>
  );
}
