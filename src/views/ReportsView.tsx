import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AppSettings,
  RegisterReport,
  GstSummaryReport,
  HsnSummaryReport,
  ProfitReport,
  Feedback,
} from "../types";
import { Translations, Language } from "../i18n";
import { FeedbackBanner } from "../components/FeedbackBanner";
import { Pagination } from "../components/Pagination";
import {
  DuotoneChart,
  Download,
  Printer,
  Search,
} from "../components/icons";
import { formatCurrency, formatDate } from "../utils/formatters";

type ReportTab = "purchase_reg" | "sales_reg" | "gst_summary" | "hsn_summary" | "profit_report";

interface ReportsViewProps {
  settings: AppSettings;
  refreshTrigger: number;
  t: Translations;
  lang: Language;
}

// CSV Export Helper with UTF-8 BOM
function exportToCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const csvContent = [
    headers.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(","),
    ...rows.map((row) =>
      row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\r\n");

  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function ReportsView({
  settings,
  refreshTrigger,
  t: _t,
  lang,
}: ReportsViewProps) {
  const [activeTab, setActiveTab] = useState<ReportTab>("sales_reg");

  const getInitialDates = () => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const to = now.toISOString().split("T")[0];
    return { from, to };
  };

  const initial = getInitialDates();
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);
  const [activeDatePreset, setActiveDatePreset] = useState<string>("this_month");
  const [withGst, setWithGst] = useState<boolean>(true);
  const [searchFilter, setSearchFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);

  const [purchaseReg, setPurchaseReg] = useState<RegisterReport | null>(null);
  const [salesReg, setSalesReg] = useState<RegisterReport | null>(null);
  const [gstSummary, setGstSummary] = useState<GstSummaryReport | null>(null);
  const [hsnSummary, setHsnSummary] = useState<HsnSummaryReport | null>(null);
  const [profitReport, setProfitReport] = useState<ProfitReport | null>(null);

  const setToday = () => {
    const today = new Date().toISOString().split("T")[0];
    setFromDate(today);
    setToDate(today);
    setActiveDatePreset("today");
    setPage(1);
  };

  const setLast7Days = () => {
    const now = new Date();
    const past = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    setFromDate(past.toISOString().split("T")[0]);
    setToDate(now.toISOString().split("T")[0]);
    setActiveDatePreset("7_days");
    setPage(1);
  };

  const setThisMonth = () => {
    const now = new Date();
    setFromDate(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0]);
    setToDate(now.toISOString().split("T")[0]);
    setActiveDatePreset("this_month");
    setPage(1);
  };

  const setThisFiscalYear = () => {
    const now = new Date();
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    setFromDate(`${year}-04-01`);
    setToDate(now.toISOString().split("T")[0]);
    setActiveDatePreset("fiscal_year");
    setPage(1);
  };

  const fetchReportData = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const state = settings.stateCode || "23";
      if (activeTab === "purchase_reg") {
        const res = await invoke<RegisterReport>("get_purchase_register_cmd", {
          fromDate,
          toDate,
          shopState: state,
        });
        setPurchaseReg(res);
      } else if (activeTab === "sales_reg") {
        const res = await invoke<RegisterReport>("get_sales_register_cmd", {
          fromDate,
          toDate,
          shopState: state,
        });
        setSalesReg(res);
      } else if (activeTab === "gst_summary") {
        const res = await invoke<GstSummaryReport>("get_gst_summary_cmd", {
          fromDate,
          toDate,
          shopState: state,
        });
        setGstSummary(res);
      } else if (activeTab === "hsn_summary") {
        const res = await invoke<HsnSummaryReport>("get_hsn_summary_cmd", {
          fromDate,
          toDate,
          shopState: state,
        });
        setHsnSummary(res);
      } else if (activeTab === "profit_report") {
        const res = await invoke<ProfitReport>("get_profit_report_cmd", {
          fromDate,
          toDate,
        });
        setProfitReport(res);
      }
    } catch (err) {
      console.error("fetchReportData error:", err);
      setFeedback({
        message: `${lang === "hi" ? "रिपोर्ट लोड करने में त्रुटि: " : "Error loading report: "}${err}`,
        isError: true,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReportData();
  }, [activeTab, fromDate, toDate, refreshTrigger, settings.stateCode]);

  const handleExportCsv = () => {
    const gstSuffix = withGst ? "GST" : "NoGST";
    if (activeTab === "sales_reg") {
      const headers = [
        "तारीख",
        "बिल नं",
        "ग्राहक का नाम",
        "GSTIN",
        "कर योग्य (₹)",
        ...(withGst ? ["टैक्स (₹)"] : []),
        "कुल बिल राशि (₹)",
        "माध्यम",
      ];
      const rows = (salesReg?.entries || []).map((e) => [
        formatDate(e.date),
        e.invoice_no,
        e.party_name,
        e.party_gstin || "अपंजीकृत",
        (e.taxable / 100).toFixed(2),
        ...(withGst ? [((e.cgst + e.sgst + e.igst) / 100).toFixed(2)] : []),
        (e.total / 100).toFixed(2),
        e.payment_mode,
      ]);
      exportToCsv(`Sales_Register_${fromDate}_to_${toDate}_${gstSuffix}.csv`, headers, rows);
    } else if (activeTab === "purchase_reg") {
      const headers = [
        "तारीख",
        "बिल नं",
        "सप्लायर का नाम",
        "GSTIN",
        "कर योग्य (₹)",
        ...(withGst ? ["टैक्स (₹)"] : []),
        "कुल राशि (₹)",
      ];
      const rows = (purchaseReg?.entries || []).map((e) => [
        formatDate(e.date),
        e.invoice_no,
        e.party_name,
        e.party_gstin || "-",
        (e.taxable / 100).toFixed(2),
        ...(withGst ? [((e.cgst + e.sgst + e.igst) / 100).toFixed(2)] : []),
        (e.total / 100).toFixed(2),
      ]);
      exportToCsv(`Purchase_Register_${fromDate}_to_${toDate}_${gstSuffix}.csv`, headers, rows);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const tabs: { id: ReportTab; title: string; testId: string }[] = [
    { id: "sales_reg", title: "बिक्री", testId: "report-tab-sales_reg" },
    { id: "purchase_reg", title: "खरीदी", testId: "report-tab-purchase_reg" },
    { id: "gst_summary", title: "GST", testId: "report-tab-gst_summary" },
    { id: "hsn_summary", title: "HSN", testId: "report-tab-hsn_summary" },
    { id: "profit_report", title: "लाभ", testId: "report-tab-profit_report" },
  ];

  const gstRows = gstSummary
    ? [
        {
          invoice_no: "GST-OUT",
          party_name: "बिक्री (Output Taxable)",
          taxable: gstSummary.output_taxable,
          total_tax: gstSummary.output_total_gst,
          total_amount: gstSummary.output_taxable + gstSummary.output_total_gst,
          payment_mode: "output",
        },
        {
          invoice_no: "GST-IN",
          party_name: "खरीदी (Input Eligible)",
          taxable: gstSummary.input_taxable_eligible,
          total_tax: gstSummary.input_total_gst,
          total_amount: gstSummary.input_taxable_eligible + gstSummary.input_total_gst,
          payment_mode: "input",
        },
        {
          invoice_no: "GST-NET",
          party_name: "शुद्ध देयता (Net GST Payable)",
          taxable: 0,
          total_tax: gstSummary.net_total_payable,
          total_amount: gstSummary.net_total_payable,
          payment_mode: "payable",
        },
      ]
    : [];

  // Current active dataset for table & chart
  let activeDataEntries: any[] = [];
  if (activeTab === "sales_reg") activeDataEntries = salesReg?.entries || [];
  else if (activeTab === "purchase_reg") activeDataEntries = purchaseReg?.entries || [];
  else if (activeTab === "gst_summary") activeDataEntries = gstRows;
  else if (activeTab === "hsn_summary") activeDataEntries = hsnSummary?.items || [];
  else if (activeTab === "profit_report") activeDataEntries = profitReport?.items || [];

  const filteredEntries = activeDataEntries.filter((item) => {
    if (!searchFilter.trim()) return true;
    const s = searchFilter.toLowerCase();
    return (
      (item.party_name && item.party_name.toLowerCase().includes(s)) ||
      (item.invoice_no && item.invoice_no.toLowerCase().includes(s)) ||
      (item.item_name && item.item_name.toLowerCase().includes(s)) ||
      (item.hsn && item.hsn.toLowerCase().includes(s))
    );
  });

  const totalEntries = filteredEntries.length;
  const paginatedEntries = filteredEntries.slice((page - 1) * pageSize, page * pageSize);

  // Totals for KPI cards
  const currentTotal = activeTab === "sales_reg" ? salesReg?.grand_total || 0 : purchaseReg?.grand_total || 0;
  const currentTaxable = activeTab === "sales_reg" ? salesReg?.total_taxable || 0 : purchaseReg?.total_taxable || 0;
  const currentTax =
    activeTab === "sales_reg"
      ? (salesReg?.total_cgst || 0) + (salesReg?.total_sgst || 0) + (salesReg?.total_igst || 0)
      : (purchaseReg?.total_cgst || 0) + (purchaseReg?.total_sgst || 0) + (purchaseReg?.total_igst || 0);

  return (
    <div className="h-full max-h-full flex flex-col justify-between overflow-hidden gap-2 text-ink font-body select-none">
      {/* 1. Header with Indigo Color Strip + Tabs on One Line + Export Buttons */}
      <div className="bg-surface border border-border border-t-4 border-t-indigo-600 rounded-panel p-2 px-3.5 shadow-2xs flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-800 flex items-center justify-center flex-shrink-0">
            <DuotoneChart size={20} />
          </div>
          <h2 className="font-serif text-base sm:text-lg font-bold tracking-tight text-ink whitespace-nowrap">
            {lang === "hi" ? "व्यापार रिपोर्ट्स" : "Reports"}
          </h2>

          {/* 5 Tabs on One Line */}
          <div className="flex items-center gap-1 bg-paper border border-border p-0.5 rounded-lg ml-2 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                data-testid={tab.testId}
                onClick={() => {
                  setActiveTab(tab.id);
                  setPage(1);
                }}
                className={`px-3 py-1 text-xs font-bold rounded-md transition-all whitespace-nowrap ${
                  activeTab === tab.id
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "text-muted hover:text-ink hover:bg-forest/5"
                }`}
              >
                {tab.title}
              </button>
            ))}
          </div>
        </div>

        {/* Export Buttons on Top Right */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            type="button"
            data-testid="report-csv-btn"
            onClick={handleExportCsv}
            disabled={loading}
            className="px-2.5 py-1.5 rounded-lg border border-border bg-paper hover:bg-forest/10 text-ink text-xs font-bold flex items-center gap-1 shadow-2xs transition-colors"
          >
            <Download size={14} />
            <span className="hidden sm:inline">CSV</span>
          </button>
          <button
            type="button"
            data-testid="report-print-btn"
            onClick={handlePrint}
            className="px-2.5 py-1.5 rounded-lg border border-border bg-paper hover:bg-forest/10 text-ink text-xs font-bold flex items-center gap-1 shadow-2xs transition-colors"
          >
            <Printer size={14} />
            <span className="hidden sm:inline">प्रिंट</span>
          </button>
        </div>
      </div>

      <FeedbackBanner feedback={feedback} />

      {/* 2. One-Line Filter Strip: Date chips + Custom range + GST toggle */}
      <div className="bg-surface border border-border rounded-panel p-2 px-3 shadow-2xs flex flex-wrap items-center justify-between gap-2 flex-shrink-0 text-xs">
        {/* Left: Date Chips */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={setToday}
            className={`px-2.5 py-1 rounded-lg font-bold border transition-all ${
              activeDatePreset === "today"
                ? "bg-forest text-white border-forest shadow-xs"
                : "bg-paper border-border text-muted hover:text-ink"
            }`}
          >
            आज
          </button>
          <button
            type="button"
            onClick={setLast7Days}
            className={`px-2.5 py-1 rounded-lg font-bold border transition-all ${
              activeDatePreset === "7_days"
                ? "bg-forest text-white border-forest shadow-xs"
                : "bg-paper border-border text-muted hover:text-ink"
            }`}
          >
            7 दिन
          </button>
          <button
            type="button"
            onClick={setThisMonth}
            className={`px-2.5 py-1 rounded-lg font-bold border transition-all ${
              activeDatePreset === "this_month"
                ? "bg-forest text-white border-forest shadow-xs"
                : "bg-paper border-border text-muted hover:text-ink"
            }`}
          >
            इस महीने
          </button>
          <button
            type="button"
            onClick={setThisFiscalYear}
            className={`px-2.5 py-1 rounded-lg font-bold border transition-all ${
              activeDatePreset === "fiscal_year"
                ? "bg-forest text-white border-forest shadow-xs"
                : "bg-paper border-border text-muted hover:text-ink"
            }`}
          >
            वित्तीय वर्ष
          </button>
        </div>

        {/* Center: Custom Date Range */}
        <div className="flex items-center gap-1.5 font-mono">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setActiveDatePreset("custom");
              setPage(1);
            }}
            className="px-2 py-0.5 border border-border bg-paper rounded text-xs font-bold"
          />
          <span className="text-muted font-sans text-xs">से</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setActiveDatePreset("custom");
              setPage(1);
            }}
            className="px-2 py-0.5 border border-border bg-paper rounded text-xs font-bold"
          />
        </div>

        {/* Right: GST Toggle Buttons */}
        <div className="flex items-center bg-paper border border-border rounded-lg p-0.5">
          <button
            type="button"
            data-testid="report-toggle-with-gst"
            onClick={() => setWithGst(true)}
            className={`px-2.5 py-0.5 rounded text-xs font-bold transition-all ${
              withGst ? "bg-emerald-600 text-white shadow-2xs" : "text-muted hover:text-ink"
            }`}
          >
            GST के साथ
          </button>
          <button
            type="button"
            data-testid="report-toggle-no-gst"
            onClick={() => setWithGst(false)}
            className={`px-2.5 py-0.5 rounded text-xs font-bold transition-all ${
              !withGst ? "bg-emerald-600 text-white shadow-2xs" : "text-muted hover:text-ink"
            }`}
          >
            बिना GST
          </button>
        </div>
      </div>

      {/* 3. KPI Strip: 4 Vibrant Cards with Light Gradient */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-shrink-0">
        <div className="bg-gradient-to-br from-indigo-50/90 to-indigo-100/50 border border-indigo-200/90 rounded-panel p-2.5 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-900 block">
            कुल बिल राशि
          </span>
          <div className="text-xl sm:text-2xl font-serif font-bold text-indigo-950 num-tabular mt-0.5">
            {formatCurrency(currentTotal)}
          </div>
        </div>

        <div className="bg-gradient-to-br from-blue-50/90 to-blue-100/50 border border-blue-200/90 rounded-panel p-2.5 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-900 block">
            कर योग्य मूल्य
          </span>
          <div className="text-xl sm:text-2xl font-serif font-bold text-blue-950 num-tabular mt-0.5">
            {formatCurrency(currentTaxable)}
          </div>
        </div>

        <div className="bg-gradient-to-br from-emerald-50/90 to-emerald-100/50 border border-emerald-200/90 rounded-panel p-2.5 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-900 block">
            कुल जीएसटी (टैक्स)
          </span>
          <div className="text-xl sm:text-2xl font-serif font-bold text-emerald-950 num-tabular mt-0.5">
            {formatCurrency(currentTax)}
          </div>
        </div>

        <div className="bg-gradient-to-br from-amber-50/90 to-amber-100/50 border border-amber-200/90 rounded-panel p-2.5 shadow-2xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900 block">
            कुल प्रविष्टियां
          </span>
          <div className="text-xl sm:text-2xl font-serif font-bold text-amber-950 num-tabular mt-0.5">
            {activeDataEntries.length} बिल / मद
          </div>
        </div>
      </div>

      {/* 4. Lower Area: Left Chart + Right Paginated Table (Zero Page Scroll) */}
      <div className="grid grid-cols-12 gap-2.5 flex-1 min-h-0 overflow-hidden">
        {/* Left Column: Visual Summary Chart (col-span-4) */}
        <div className="col-span-12 lg:col-span-4 bg-surface border border-border rounded-panel p-3 flex flex-col justify-between overflow-y-auto shadow-2xs" data-scroll="true">
          <div className="flex items-center justify-between pb-1.5 border-b border-border/70 flex-shrink-0">
            <span className="font-serif font-bold text-xs text-ink">
              {lang === "hi" ? "व्यापार सारांश ग्राफ" : "Summary Chart"}
            </span>
            <span className="text-[10px] font-bold bg-indigo-100 text-indigo-800 px-1.5 py-0.5 rounded">
              {withGst ? "GST सहित" : "बिना GST"}
            </span>
          </div>

          {/* SVG Ratio / Bar Graphic */}
          <div className="flex-1 min-h-0 flex flex-col justify-center items-center py-2">
            <div className="w-full space-y-2.5 px-2">
              <div>
                <div className="flex justify-between text-[11px] font-bold text-muted mb-0.5">
                  <span>कर योग्य मूल्य</span>
                  <span className="font-mono text-ink">{formatCurrency(currentTaxable)}</span>
                </div>
                <div className="h-3 w-full bg-border/50 rounded-full overflow-hidden">
                  <div
                    style={{
                      width: `${currentTotal > 0 ? Math.min(100, (currentTaxable / currentTotal) * 100) : 0}%`,
                    }}
                    className="h-full bg-blue-600 rounded-full"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[11px] font-bold text-muted mb-0.5">
                  <span>टैक्स (GST)</span>
                  <span className="font-mono text-ink">{formatCurrency(currentTax)}</span>
                </div>
                <div className="h-3 w-full bg-border/50 rounded-full overflow-hidden">
                  <div
                    style={{
                      width: `${currentTotal > 0 ? Math.min(100, (currentTax / currentTotal) * 100) : 0}%`,
                    }}
                    className="h-full bg-emerald-600 rounded-full"
                  />
                </div>
              </div>

              <div className="p-2.5 bg-paper rounded-xl border border-border/70 text-center">
                <span className="text-[10px] font-bold text-muted uppercase block">औसत बिल राशि</span>
                <span className="text-lg font-serif font-bold text-indigo-950 font-mono">
                  {formatCurrency(
                    activeDataEntries.length > 0 ? Math.round(currentTotal / activeDataEntries.length) : 0
                  )}
                </span>
              </div>
            </div>
          </div>

          <div className="text-[10px] text-muted text-center border-t border-border/60 pt-1.5 flex-shrink-0">
            {fromDate} से {toDate} का रिकॉर्ड
          </div>
        </div>

        {/* Right Column: Table with Search & Pagination (col-span-8) */}
        <div
          className="col-span-12 lg:col-span-8 bg-surface border border-border rounded-panel flex flex-col justify-between min-h-0 overflow-hidden shadow-2xs"
          data-scroll="true"
        >
          {/* Search Bar on Top */}
          <div className="p-2 border-b border-border/80 flex items-center justify-between gap-2 flex-shrink-0 bg-paper/40">
            <span className="text-xs font-bold text-ink truncate">
              {tabs.find((t) => t.id === activeTab)?.title} प्रविष्टियां ({filteredEntries.length})
            </span>
            <div className="relative">
              <input
                type="text"
                placeholder={lang === "hi" ? "तालिका में खोजें..." : "Search..."}
                value={searchFilter}
                onChange={(e) => {
                  setSearchFilter(e.target.value);
                  setPage(1);
                }}
                className="text-xs px-2.5 py-1 pl-6 bg-surface border border-border rounded-lg text-ink focus:outline-none focus:ring-1 focus:ring-forest w-36 sm:w-48"
              />
              <Search size={12} className="absolute left-2 top-2 text-muted pointer-events-none" />
            </div>
          </div>

          {/* Table Body (Fixed Header, Fits available height) */}
          <div className="flex-1 min-h-0 overflow-y-auto" data-scroll="true">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-paper sticky top-0 border-b border-border text-muted font-bold z-10">
                <tr>
                  <th className="py-2 px-2.5">तारीख / नं</th>
                  <th className="py-2 px-2">पार्टी / सामान</th>
                  <th className="py-2 px-2 text-right">कर योग्य</th>
                  {withGst && <th className="py-2 px-2 text-right">टैक्स</th>}
                  <th className="py-2 px-2.5 text-right">कुल रकम</th>
                  <th className="py-2 px-2 text-center">माध्यम/स्थिति</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {paginatedEntries.length > 0 ? (
                  paginatedEntries.map((row, idx) => {
                    const rowDate = row.date ? formatDate(row.date) : row.hsn || "-";
                    const rowName = row.party_name || row.item_name || row.rate_label || "-";
                    const rowTaxable = row.taxable ?? row.taxable_value ?? row.taxable_sale ?? 0;
                    const rowTax = (row.cgst || 0) + (row.sgst || 0) + (row.igst || 0) || row.total_tax || 0;
                    const rowTotal = row.total_amount ?? row.total_value ?? row.gross_sale ?? rowTaxable + rowTax;

                    return (
                      <tr key={idx} className="hover:bg-paper/40 transition-colors">
                        <td className="py-1.5 px-2.5 font-mono text-muted whitespace-nowrap">
                          <span className="font-bold text-ink block">{row.invoice_no || rowDate}</span>
                          <span className="text-[10px]">{rowDate}</span>
                        </td>
                        <td className="py-1.5 px-2 font-bold text-ink truncate max-w-[140px]">
                          {rowName}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-ink">
                          {formatCurrency(rowTaxable)}
                        </td>
                        {withGst && (
                          <td className="py-1.5 px-2 text-right font-mono text-emerald-700">
                            {formatCurrency(rowTax)}
                          </td>
                        )}
                        <td className="py-1.5 px-2.5 text-right font-mono font-bold text-ink">
                          {formatCurrency(rowTotal)}
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              row.payment_mode === "credit"
                                ? "bg-amber-100 text-amber-800 border border-amber-300"
                                : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                            }`}
                          >
                            {row.payment_mode === "credit" ? "उधार" : "नकद"}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-muted">
                      {loading ? "डेटा लोड हो रहा है..." : "कोई रिकॉर्ड नहीं मिला"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination at bottom */}
          <Pagination
            currentPage={page}
            totalItems={totalEntries}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            pageSizeOptions={[6, 10, 20]}
            lang={lang}
            compact
          />
        </div>
      </div>
    </div>
  );
}
