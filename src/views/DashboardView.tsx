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
  Item,
  Party,
  StockItem,
} from "../types";
import { Translations, Language } from "../i18n";
import { formatCurrency } from "../utils/formatters";
import {
  BahiLogoMark,
  ShoppingCart,
  PackagePlus,
  TrendingUp,
  TrendingDown,
  Wallet,
  ArrowRight,
  BarChart3,
  Check,
  AnkurDrawing,
  GehunDrawing,
} from "../components/icons";

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
  const [sevenDayTrend, setSevenDayTrend] = useState<DailyTrend[]>([]);
  const [topReceivables, setTopReceivables] = useState<TopReceivableParty[]>([]);
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([]);

  // Onboarding counts check
  const [itemsCount, setItemsCount] = useState<number | null>(null);
  const [partiesCount, setPartiesCount] = useState<number | null>(null);
  const [stockCount, setStockCount] = useState<number | null>(null);

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
        limit: 5,
        asOfDate: todayIso,
      });
      setTopReceivables(rec);
    } catch (e) {
      console.error("get_top_receivables_cmd error:", e);
    }

    try {
      const low = await invoke<LowStockItem[]>("get_low_stock_items_cmd", {
        thresholdMilli: settings.lowStockThreshold * 1000,
      });
      // Bug fix (Requirement 7): Filter out items with 0 stock that never had stock
      // Only keep items that had real stock (current_stock_milli > 0)
      setLowStockItems(low.filter((item) => item.current_stock_milli > 0));
    } catch (e) {
      console.error("get_low_stock_items_cmd error:", e);
    }

    // Check onboarding counts
    try {
      const [itList, ptList, stList] = await Promise.all([
        invoke<Item[]>("get_items_cmd"),
        invoke<Party[]>("get_parties_cmd", { partyType: null }),
        invoke<StockItem[]>("get_stock_list_cmd"),
      ]);
      setItemsCount(itList.length);
      // Filter out walk-in default party (id: 1)
      setPartiesCount(ptList.filter((p) => p.id !== 1).length);
      setStockCount(stList.length);
    } catch (e) {
      console.error("Onboarding check error:", e);
    }
  };

  useEffect(() => {
    loadAllData();
  }, [refreshTrigger, todayIso, settings.lowStockThreshold]);

  // Global Keyboard Shortcuts [F1: Sale, F2: Purchase, F3: Payment]
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

  // Formatted date (Hindi: रविवार, 11 अक्टूबर 2026)
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

  // 30+ days overdue debts for attention list
  const overdueDebts = topReceivables.filter((p) => p.oldest_debt_days >= 30);

  // Attention items combined (low stock + 30+ days old debt)
  const hasAttentionItems = lowStockItems.length > 0 || overdueDebts.length > 0;

  // Onboarding needed check (if items === 0 or parties === 0 or stock === 0)
  const showOnboarding =
    itemsCount !== null &&
    partiesCount !== null &&
    stockCount !== null &&
    (itemsCount === 0 || partiesCount === 0 || stockCount === 0);

  // 7-day trend maximum amount for SVG chart scaling
  const maxTrendVal = Math.max(
    ...sevenDayTrend.map((d) => Math.max(d.sales_paise, d.purchases_paise)),
    100000 // minimum scale ₹1,000 (100,000 paise)
  );

  const totalSevenDaySales = sevenDayTrend.reduce((sum, d) => sum + d.sales_paise, 0);

  // Proportional bar calculation (लेना है vs देना है)
  const totalReceivable = stats.total_receivable;
  const totalPayable = stats.total_payable;
  const balanceTotal = totalReceivable + totalPayable;
  const receivableRatio = balanceTotal > 0 ? Math.round((totalReceivable / balanceTotal) * 100) : 50;
  const payableRatio = balanceTotal > 0 ? 100 - receivableRatio : 50;

  // Mini sparkline points calculation for 7-day sales
  const sparklinePoints = (() => {
    if (sevenDayTrend.length === 0) return "";
    const width = 160;
    const height = 40;
    const padding = 4;
    const maxVal = Math.max(...sevenDayTrend.map((d) => d.sales_paise), 10000);
    return sevenDayTrend
      .map((d, i) => {
        const x = padding + (i / (sevenDayTrend.length - 1 || 1)) * (width - 2 * padding);
        const y = height - padding - (d.sales_paise / maxVal) * (height - 2 * padding);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  })();

  return (
    <div className="space-y-4 max-w-full text-ink font-body">
      {/* 1. Header Bar: Logo Mark + Shop Name, Hindi Date (रविवार, 11 अक्टूबर 2026) */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-3 border-b border-border">
        <div className="flex items-center gap-3">
          <BahiLogoMark size={42} className="flex-shrink-0 shadow-2xs" />
          <div>
            <h2 className="font-serif text-2xl font-bold tracking-tight text-ink flex items-center gap-2">
              <span>{settings.shopName}</span>
            </h2>
            <p className="text-xs font-semibold text-muted tracking-wide mt-0.5">
              {todayFormattedString}
              <span className="mx-1.5 opacity-40">•</span>
              <span className="text-forest font-serif">{lang === "hi" ? "डिजिटल बही-खाता" : "Digital Bahi-Khata"}</span>
            </p>
          </div>
        </div>
      </div>

      {/* 2. "आज का हिसाब" Bada Panel (56px Sales, Sparkline, Mal Aaya, Lena vs Dena Proportional Bar) */}
      <div className="bg-surface border border-border rounded-panel p-5 shadow-[0_1px_2px_rgba(28,43,36,0.04)]">
        <div className="flex items-center justify-between pb-3 border-b border-border/70 mb-4">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-marigold animate-pulse" />
            <h3 className="font-serif font-bold text-lg text-ink">
              {t.dashboard.aajKaHisaab}
            </h3>
          </div>
          <span className="text-xs text-muted font-medium num-tabular">
            {todayFormattedString}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* Left Column: आज की बिक्री (Huge 56px Serif Tabular Number + Kal Comparison + Sparkline) */}
          <div className="lg:col-span-6 border-b lg:border-b-0 lg:border-r border-border/80 pb-5 lg:pb-0 lg:pr-6">
            <div className="text-xs font-serif font-bold uppercase tracking-wider text-muted">
              {lang === "hi" ? "आज की बिक्री" : "Today's Sales"}
            </div>

            <div className="text-[46px] sm:text-[56px] font-serif font-bold tracking-tight text-ink leading-tight mt-1 mb-2 num-tabular">
              {formatCurrency(stats.today_sales)}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs">
              {yesterdayComp ? (
                <span
                  className={`inline-flex items-center gap-1 font-bold num-tabular px-2 py-0.5 rounded ${
                    yesterdayComp.sales_growth_percent > 0
                      ? "bg-leaf/10 text-leaf"
                      : yesterdayComp.sales_growth_percent < 0
                      ? "bg-terracotta/10 text-terracotta"
                      : "bg-surface-muted text-muted"
                  }`}
                >
                  {yesterdayComp.sales_growth_percent > 0 ? (
                    <>
                      <TrendingUp size={13} strokeWidth={2.5} />
                      <span>+{Math.abs(yesterdayComp.sales_growth_percent).toFixed(0)}% {t.dashboard.compMoreThanYesterday}</span>
                    </>
                  ) : yesterdayComp.sales_growth_percent < 0 ? (
                    <>
                      <TrendingDown size={13} strokeWidth={2.5} />
                      <span>-{Math.abs(yesterdayComp.sales_growth_percent).toFixed(0)}% {t.dashboard.compLessThanYesterday}</span>
                    </>
                  ) : (
                    <span>{t.dashboard.compSameAsYesterday}</span>
                  )}
                </span>
              ) : (
                <span className="text-muted">-</span>
              )}
              <span className="text-muted text-xs num-tabular">
                {yesterdayComp ? `(कल: ${formatCurrency(yesterdayComp.yesterday_sales)})` : ""}
              </span>
            </div>

            {/* 7-Day Sales Mini Sparkline */}
            {sevenDayTrend.length > 1 && totalSevenDaySales > 0 && (
              <div className="mt-3 pt-3 border-t border-border/50 flex items-center gap-3">
                <span className="text-[11px] text-muted font-medium whitespace-nowrap">
                  {lang === "hi" ? "7 दिन का रुझान:" : "7-day momentum:"}
                </span>
                <svg width="160" height="36" className="overflow-visible flex-shrink-0">
                  <polyline
                    fill="none"
                    stroke="#2F7D4F"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={sparklinePoints}
                  />
                </svg>
              </div>
            )}
          </div>

          {/* Right Column: माल आया + लेना है vs देना है Proportional Stacked Bar */}
          <div className="lg:col-span-6 space-y-4">
            {/* आज माल आया */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-muted/60 border border-border/70">
              <div>
                <span className="text-xs font-serif font-bold text-muted block uppercase tracking-wider">
                  {lang === "hi" ? "आज माल आया (खरीदी)" : "Stock Inward Today"}
                </span>
                <span className="text-2xl font-serif font-bold text-ink num-tabular block mt-0.5">
                  {formatCurrency(stats.today_purchases)}
                </span>
              </div>
              <div className="text-right">
                {yesterdayComp && yesterdayComp.yesterday_purchases > 0 && (
                  <span className="text-xs font-semibold text-muted num-tabular block">
                    कल: {formatCurrency(yesterdayComp.yesterday_purchases)}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onNavigate("Purchase")}
                  className="text-xs font-bold text-forest hover:text-leaf transition-colors underline mt-1 block"
                >
                  {lang === "hi" ? "खरीदी पर्ची देखें →" : "View Purchases →"}
                </button>
              </div>
            </div>

            {/* लेना है / देना है Proportional Stacked Bar */}
            <div className="p-3.5 rounded-lg bg-surface-muted/40 border border-border/70 space-y-2">
              <div className="flex items-center justify-between text-xs font-serif font-bold">
                <span className="text-leaf flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-leaf" />
                  <span>{lang === "hi" ? "लेना है" : "To Collect"}: {formatCurrency(totalReceivable)}</span>
                </span>
                <span className="text-terracotta flex items-center gap-1.5">
                  <span>{lang === "hi" ? "देना है" : "To Pay"}: {formatCurrency(totalPayable)}</span>
                  <span className="w-2 h-2 rounded-full bg-terracotta" />
                </span>
              </div>

              {/* Visual Proportional Bar */}
              <div className="h-3 w-full bg-border/60 rounded-full overflow-hidden flex shadow-inner">
                <div
                  style={{ width: `${receivableRatio}%` }}
                  title={`लेना है: ${receivableRatio}%`}
                  className="bg-leaf h-full transition-all duration-500 rounded-l-full"
                />
                <div
                  style={{ width: `${payableRatio}%` }}
                  title={`देना है: ${payableRatio}%`}
                  className="bg-terracotta h-full transition-all duration-500 rounded-r-full"
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-muted num-tabular pt-0.5">
                <span>{receivableRatio}% बाज़ार उधारी</span>
                <button
                  type="button"
                  onClick={() => onNavigate("Len-Den")}
                  className="font-bold text-forest hover:text-leaf underline transition-colors"
                >
                  {lang === "hi" ? "पूरा बही-खाता →" : "View Ledger →"}
                </button>
                <span>{payableRatio}% सप्लायर देयता</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Three Large Kaam-Tiles with Shortcut Keys [F1: नया बिल, F2: माल आया, F3: पैसा मिला/दिया] */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        {/* Tile 1: नया बिल (बिक्री) [F1] */}
        <button
          type="button"
          onClick={() => onNavigate("Sale")}
          className="group bg-surface hover:bg-[#FDF9F0] active:bg-[#F5EDDC] border border-border hover:border-leaf rounded-panel p-4 text-left transition-all shadow-[0_1px_2px_rgba(28,43,36,0.03)] flex items-center justify-between min-h-[74px]"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-lg bg-leaf/15 text-leaf flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
              <ShoppingCart size={22} strokeWidth={2} />
            </div>
            <div>
              <div className="font-serif font-bold text-lg text-ink group-hover:text-leaf transition-colors leading-tight">
                {t.dashboard.actionSale}
              </div>
              <div className="text-xs text-muted mt-0.5">
                {lang === "hi" ? "नकद या उधार बिक्री पर्ची" : "Issue sale invoice"}
              </div>
            </div>
          </div>
          <span className="px-2 py-1 bg-surface-muted border border-border rounded text-[11px] font-mono font-bold text-muted group-hover:text-leaf group-hover:border-leaf/50 transition-colors">
            F1
          </span>
        </button>

        {/* Tile 2: माल आया (खरीदी) [F2] */}
        <button
          type="button"
          onClick={() => onNavigate("Purchase")}
          className="group bg-surface hover:bg-[#FDF9F0] active:bg-[#F5EDDC] border border-border hover:border-forest-2 rounded-panel p-4 text-left transition-all shadow-[0_1px_2px_rgba(28,43,36,0.03)] flex items-center justify-between min-h-[74px]"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-lg bg-forest/15 text-forest flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
              <PackagePlus size={22} strokeWidth={2} />
            </div>
            <div>
              <div className="font-serif font-bold text-lg text-ink group-hover:text-forest transition-colors leading-tight">
                {t.dashboard.actionPurchase}
              </div>
              <div className="text-xs text-muted mt-0.5">
                {lang === "hi" ? "सप्लायर का बिल व नया स्टॉक" : "Record purchase invoice"}
              </div>
            </div>
          </div>
          <span className="px-2 py-1 bg-surface-muted border border-border rounded text-[11px] font-mono font-bold text-muted group-hover:text-forest group-hover:border-forest/50 transition-colors">
            F2
          </span>
        </button>

        {/* Tile 3: पैसा मिला / दिया [F3] */}
        <button
          type="button"
          onClick={() => onNavigate("Payment")}
          className="group bg-surface hover:bg-[#FDF9F0] active:bg-[#F5EDDC] border border-border hover:border-marigold rounded-panel p-4 text-left transition-all shadow-[0_1px_2px_rgba(28,43,36,0.03)] flex items-center justify-between min-h-[74px]"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-lg bg-marigold/20 text-marigold-dark flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
              <Wallet size={22} strokeWidth={2} />
            </div>
            <div>
              <div className="font-serif font-bold text-lg text-ink group-hover:text-marigold-dark transition-colors leading-tight">
                {t.dashboard.actionPayment}
              </div>
              <div className="text-xs text-muted mt-0.5">
                {lang === "hi" ? "उधारी वसूली या भुगतान" : "Receipt or payment entry"}
              </div>
            </div>
          </div>
          <span className="px-2 py-1 bg-surface-muted border border-border rounded text-[11px] font-mono font-bold text-muted group-hover:text-marigold group-hover:border-marigold/50 transition-colors">
            F3
          </span>
        </button>
      </div>

      {/* 4. Onboarding 4-Step Checklist (Shown when items=0 OR parties=0 OR stock=0) */}
      {showOnboarding && (
        <div className="bg-surface border-2 border-marigold/60 rounded-panel p-4 shadow-xs">
          <div className="flex items-center gap-2 pb-2 border-b border-border mb-3">
            <BahiLogoMark size={24} />
            <h3 className="font-serif font-bold text-base text-ink">
              {t.dashboard.onboardingTitle}
            </h3>
            <span className="text-xs text-muted font-medium hidden sm:inline">
              • {t.dashboard.onboardingSubtitle}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {/* Step 1: Shop Settings */}
            <div
              onClick={() => onNavigate("Settings")}
              className="bg-surface-muted/50 p-3 rounded-input border border-border hover:border-forest cursor-pointer transition-colors flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-leaf text-surface flex items-center justify-center">
                  <Check size={12} strokeWidth={3} />
                </span>
                <span className="text-xs font-semibold text-ink">
                  {t.dashboard.onboardingStepSettings}
                </span>
              </div>
              <span className="text-[11px] text-leaf font-bold">
                {t.dashboard.onboardingCompletedBadge}
              </span>
            </div>

            {/* Step 2: Add Items */}
            <div
              onClick={() => onNavigate("Items")}
              className={`p-3 rounded-input border cursor-pointer transition-colors flex items-center justify-between ${
                itemsCount && itemsCount > 0
                  ? "bg-surface-muted/50 border-border"
                  : "bg-surface border-marigold/80 hover:border-forest shadow-xs"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${
                    itemsCount && itemsCount > 0
                      ? "bg-leaf text-surface"
                      : "bg-marigold text-ink"
                  }`}
                >
                  {itemsCount && itemsCount > 0 ? <Check size={12} strokeWidth={3} /> : "2"}
                </span>
                <span className="text-xs font-semibold text-ink">
                  {t.dashboard.onboardingStepItems}
                </span>
              </div>
              <span
                className={`text-[11px] font-bold ${
                  itemsCount && itemsCount > 0 ? "text-leaf" : "text-marigold-dark underline"
                }`}
              >
                {itemsCount && itemsCount > 0 ? t.dashboard.onboardingCompletedBadge : t.dashboard.onboardingStartBadge}
              </span>
            </div>

            {/* Step 3: Add Parties */}
            <div
              onClick={() => onNavigate("Parties")}
              className={`p-3 rounded-input border cursor-pointer transition-colors flex items-center justify-between ${
                partiesCount && partiesCount > 0
                  ? "bg-surface-muted/50 border-border"
                  : "bg-surface border-marigold/80 hover:border-forest shadow-xs"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${
                    partiesCount && partiesCount > 0
                      ? "bg-leaf text-surface"
                      : "bg-marigold text-ink"
                  }`}
                >
                  {partiesCount && partiesCount > 0 ? <Check size={12} strokeWidth={3} /> : "3"}
                </span>
                <span className="text-xs font-semibold text-ink">
                  {t.dashboard.onboardingStepParties}
                </span>
              </div>
              <span
                className={`text-[11px] font-bold ${
                  partiesCount && partiesCount > 0 ? "text-leaf" : "text-marigold-dark underline"
                }`}
              >
                {partiesCount && partiesCount > 0 ? t.dashboard.onboardingCompletedBadge : t.dashboard.onboardingStartBadge}
              </span>
            </div>

            {/* Step 4: Record Opening Stock */}
            <div
              onClick={() => onNavigate("Opening Stock")}
              className={`p-3 rounded-input border cursor-pointer transition-colors flex items-center justify-between ${
                stockCount && stockCount > 0
                  ? "bg-surface-muted/50 border-border"
                  : "bg-surface border-marigold/80 hover:border-forest shadow-xs"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${
                    stockCount && stockCount > 0
                      ? "bg-leaf text-surface"
                      : "bg-marigold text-ink"
                  }`}
                >
                  {stockCount && stockCount > 0 ? <Check size={12} strokeWidth={3} /> : "4"}
                </span>
                <span className="text-xs font-semibold text-ink">
                  {t.dashboard.onboardingStepStock}
                </span>
              </div>
              <span
                className={`text-[11px] font-bold ${
                  stockCount && stockCount > 0 ? "text-leaf" : "text-marigold-dark underline"
                }`}
              >
                {stockCount && stockCount > 0 ? t.dashboard.onboardingCompletedBadge : t.dashboard.onboardingStartBadge}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 5. Split Section: "ध्यान दें" (Alert Rows with Colored Stripe) + 7-Day Chart + Top 5 Ruled Bahi Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* Box 1: "ध्यान दें" (Alert Rows with Left Stripe & Clean Text-Action Buttons) */}
        <div className="bg-surface border border-border rounded-panel p-4 shadow-[0_1px_2px_rgba(28,43,36,0.04)] space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-terracotta" />
              <h3 className="font-serif font-bold text-base text-ink">
                {t.dashboard.attentionTitle}
              </h3>
            </div>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-bold num-tabular ${
                hasAttentionItems
                  ? "bg-terracotta/15 text-terracotta"
                  : "bg-leaf/15 text-leaf"
              }`}
            >
              {hasAttentionItems ? `${lowStockItems.length + overdueDebts.length}` : "0"}
            </span>
          </div>

          {!hasAttentionItems ? (
            <div className="py-7 px-3 text-center bg-surface-muted/40 rounded-panel border border-dashed border-border/80 flex flex-col items-center">
              <GehunDrawing size={52} className="mb-2" />
              <span className="font-serif font-bold text-ink text-sm block mb-1">
                {t.dashboard.attentionEmpty}
              </span>
              <span className="text-xs text-muted">
                {lang === "hi"
                  ? "स्टॉक पर्याप्त है और कोई 30+ दिन पुराना उधार नहीं है।"
                  : "Stock levels are healthy and no 30+ day overdue credits."}
              </span>
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[230px] overflow-y-auto pr-1">
              {/* Low Stock Items (Left Stripe: Marigold/Amber) */}
              {lowStockItems.slice(0, 3).map((item) => (
                <div
                  key={`low-${item.item_id}`}
                  className="p-3 bg-surface rounded-lg border-y border-r border-border border-l-4 border-l-marigold flex items-center justify-between gap-2.5 shadow-2xs"
                >
                  <div className="overflow-hidden min-w-0">
                    <span className="text-xs font-bold text-ink block truncate">
                      {item.name}
                    </span>
                    <span className="text-[11px] text-marigold-dark font-semibold num-tabular block mt-0.5">
                      {lang === "hi"
                        ? `सिर्फ ${(item.current_stock_milli / 1000).toFixed(1)} ${item.base_unit} बचा है`
                        : `Only ${(item.current_stock_milli / 1000).toFixed(1)} ${item.base_unit} left`}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => onNavigate("Purchase")}
                    className="text-xs font-bold text-forest hover:text-leaf transition-colors flex items-center gap-1 flex-shrink-0 underline hover:no-underline"
                  >
                    <span>{t.dashboard.orderStockBtn}</span>
                    <ArrowRight size={12} strokeWidth={2} />
                  </button>
                </div>
              ))}

              {/* 30+ Days Overdue Debts (Left Stripe: Terracotta) */}
              {overdueDebts.slice(0, 3).map((party) => (
                <div
                  key={`debt-${party.party_id}`}
                  className="p-3 bg-surface rounded-lg border-y border-r border-border border-l-4 border-l-terracotta flex items-center justify-between gap-2.5 shadow-2xs"
                >
                  <div className="overflow-hidden min-w-0">
                    <span className="text-xs font-bold text-ink block truncate">
                      {party.name}
                    </span>
                    <span className="text-[11px] text-terracotta font-semibold num-tabular block mt-0.5">
                      {formatCurrency(party.receivable_paise)} • {party.phone || (lang === "hi" ? "फोन नहीं" : "No phone")} • {party.oldest_debt_days} दिन पुराना
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => onNavigate("Payment")}
                    className="text-xs font-bold text-terracotta hover:text-ink transition-colors flex items-center gap-1 flex-shrink-0 underline hover:no-underline"
                  >
                    <span>{t.dashboard.askPaymentBtn}</span>
                    <ArrowRight size={12} strokeWidth={2} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Box 2: 7 दिन का सादा बार चार्ट (Pure Offline SVG, Bahi Palette) */}
        <div className="bg-surface border border-border rounded-panel p-4 shadow-[0_1px_2px_rgba(28,43,36,0.04)] space-y-2">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <div className="flex items-center gap-2">
              <BarChart3 size={17} strokeWidth={2} className="text-forest" />
              <h3 className="font-serif font-bold text-base text-ink">
                {t.dashboard.trendTitle}
              </h3>
            </div>

            <div className="flex items-center gap-3 text-xs font-semibold">
              <span className="flex items-center gap-1.5 text-ink">
                <span className="w-2.5 h-2.5 rounded-sm bg-leaf" />
                <span>{t.dashboard.last7DaysSales}</span>
              </span>
              <span className="flex items-center gap-1.5 text-muted">
                <span className="w-2.5 h-2.5 rounded-sm bg-border" />
                <span>{t.dashboard.last7DaysPurchases}</span>
              </span>
            </div>
          </div>

          {/* Clean Pure Offline SVG Bar Chart */}
          <div className="pt-2">
            {totalSevenDaySales === 0 ? (
              <div className="h-36 flex flex-col items-center justify-center text-center p-3">
                <AnkurDrawing size={48} className="mb-2" />
                <span className="text-xs font-serif font-bold text-muted">
                  {t.dashboard.noSalesYet}
                </span>
              </div>
            ) : (
              <div className="flex items-end justify-between gap-1.5 h-36 px-1 border-b border-border/80 pb-1">
                {sevenDayTrend.map((d, idx) => {
                  const sHeight = Math.max(Math.round((d.sales_paise / maxTrendVal) * 110), 4);
                  const pHeight = Math.max(Math.round((d.purchases_paise / maxTrendVal) * 110), 4);
                  const isToday = d.date === todayIso;

                  return (
                    <div key={idx} className="flex-1 flex flex-col items-center justify-end h-full group">
                      <div className="w-full flex items-end justify-center gap-1">
                        {/* Sales Bar */}
                        <div
                          style={{ height: `${sHeight}px` }}
                          title={`${d.date} बिक्री: ${formatCurrency(d.sales_paise)}`}
                          className={`w-2.5 sm:w-3.5 rounded-t transition-all ${
                            isToday ? "bg-leaf ring-2 ring-marigold/60" : "bg-leaf/90 group-hover:bg-leaf"
                          }`}
                        />
                        {/* Purchases Bar */}
                        <div
                          style={{ height: `${pHeight}px` }}
                          title={`${d.date} खरीदी: ${formatCurrency(d.purchases_paise)}`}
                          className="w-2.5 sm:w-3.5 rounded-t bg-border group-hover:bg-[#C4B89F] transition-all"
                        />
                      </div>
                      <span
                        className={`text-[10px] num-tabular mt-1.5 truncate ${
                          isToday ? "font-bold text-forest" : "text-muted"
                        }`}
                      >
                        {d.date.substring(5)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex justify-between items-center pt-2 text-xs font-semibold text-muted">
              <span>{lang === "hi" ? "7 दिन की कुल बिक्री:" : "7-Day Total Sales:"}</span>
              <span className="text-forest font-serif font-bold text-sm num-tabular">
                {formatCurrency(totalSevenDaySales)}
              </span>
            </div>
          </div>
        </div>

        {/* Box 3: "किससे लेना है" (Top 5 Ruled Bahi Table) */}
        <div className="bg-surface border border-border rounded-panel p-4 shadow-[0_1px_2px_rgba(28,43,36,0.04)] space-y-2">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-leaf" />
              <h3 className="font-serif font-bold text-base text-ink">
                {t.dashboard.topReceivablesHeading}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigate("Len-Den")}
              className="text-xs font-bold text-forest hover:text-leaf underline transition-colors"
            >
              {lang === "hi" ? "पूरा खाता देखें" : "All Ledgers"} →
            </button>
          </div>

          {topReceivables.length === 0 ? (
            <div className="py-7 px-3 text-center bg-surface-muted/40 rounded-panel border border-dashed border-border/80 flex flex-col items-center">
              <AnkurDrawing size={52} className="mb-2" />
              <span className="font-serif font-bold text-ink text-sm block mb-1">
                {t.dashboard.topReceivablesEmpty}
              </span>
              <span className="text-xs text-muted">
                {lang === "hi"
                  ? "दुकान का पूरा मार्केट हिसाब चुकता है।"
                  : "All customer accounts are fully settled."}
              </span>
            </div>
          ) : (
            <div className="max-h-[230px] overflow-y-auto pr-1">
              <table className="w-full text-left text-sm table-bahi">
                <thead>
                  <tr className="text-[10px] font-serif font-bold uppercase tracking-wider text-muted border-b border-border">
                    <th className="py-1.5 px-1.5 w-6">#</th>
                    <th className="py-1.5 px-1.5">{lang === "hi" ? "ग्राहक व गांव" : "Party"}</th>
                    <th className="py-1.5 px-1.5 text-right">{lang === "hi" ? "बकाया रकम" : "Due"}</th>
                    <th className="py-1.5 px-1.5 text-right w-16">{lang === "hi" ? "अवधि" : "Days"}</th>
                  </tr>
                </thead>
                <tbody>
                  {topReceivables.map((p, idx) => (
                    <tr
                      key={p.party_id}
                      onClick={() => onNavigate("Len-Den")}
                      className="cursor-pointer transition-colors hover:bg-surface-muted/60"
                    >
                      <td className="py-2 px-1.5 text-xs text-muted num-tabular font-bold">
                        {idx + 1}
                      </td>
                      <td className="py-2 px-1.5 overflow-hidden">
                        <span className="text-xs font-bold text-ink block truncate">
                          {p.name}
                        </span>
                        <span className="text-[11px] text-muted block truncate num-tabular">
                          {p.village ? `${p.village} • ` : ""}
                          {p.phone || (lang === "hi" ? "बिना फोन" : "No phone")}
                        </span>
                      </td>
                      <td className="py-2 px-1.5 text-right font-serif font-bold text-leaf text-xs num-tabular whitespace-nowrap">
                        {formatCurrency(p.receivable_paise)}
                      </td>
                      <td className="py-2 px-1.5 text-right text-[10px] text-muted num-tabular whitespace-nowrap">
                        {p.oldest_debt_days} दिन
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
