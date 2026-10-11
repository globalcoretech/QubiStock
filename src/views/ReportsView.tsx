import React, { useState, useEffect } from "react";
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
import {
  ReceiptText,
  Landmark,
  Tag,
  TrendingUp,
  Download,
  Printer,
  Search,
  X,
} from "../components/icons";
import { formatCurrency, formatDate, formatPaymentMode } from "../utils/formatters";

type ReportTab = "purchase_reg" | "sales_reg" | "gst_summary" | "hsn_summary" | "profit_report";

interface ReportsViewProps {
  settings: AppSettings;
  refreshTrigger: number;
  t: Translations;
  lang: Language;
}

// CSV Export Helper with UTF-8 BOM for Excel
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
  t,
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
  const [withGst, setWithGst] = useState<boolean>(true);
  const [searchFilter, setSearchFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const [purchaseReg, setPurchaseReg] = useState<RegisterReport | null>(null);
  const [salesReg, setSalesReg] = useState<RegisterReport | null>(null);
  const [gstSummary, setGstSummary] = useState<GstSummaryReport | null>(null);
  const [hsnSummary, setHsnSummary] = useState<HsnSummaryReport | null>(null);
  const [profitReport, setProfitReport] = useState<ProfitReport | null>(null);

  const setThisMonth = () => {
    const now = new Date();
    setFromDate(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0]);
    setToDate(now.toISOString().split("T")[0]);
  };

  const setLast30Days = () => {
    const now = new Date();
    const past = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    setFromDate(past.toISOString().split("T")[0]);
    setToDate(now.toISOString().split("T")[0]);
  };

  const setThisFiscalYear = () => {
    const now = new Date();
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    setFromDate(`${year}-04-01`);
    setToDate(now.toISOString().split("T")[0]);
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
    if (activeTab === "purchase_reg") {
      const headers = [
        lang === "hi" ? "तारीख" : "Date",
        lang === "hi" ? "बिल नं" : "Invoice No",
        lang === "hi" ? "सप्लायर का नाम" : "Supplier Name",
        "GSTIN",
        lang === "hi" ? "राज्य प्रकार" : "State Type",
        lang === "hi" ? "कर योग्य मूल्य (₹)" : "Taxable (₹)",
        ...(withGst ? ["CGST (₹)", "SGST (₹)", "IGST (₹)"] : []),
        lang === "hi" ? "कुल बिल राशि (₹)" : "Total Bill (₹)",
        lang === "hi" ? "भुगतान माध्यम" : "Payment Mode",
        lang === "hi" ? "चुकाई गई राशि (₹)" : "Paid Amount (₹)",
      ];
      const rows = (purchaseReg?.entries || []).map((e) => [
        formatDate(e.date),
        e.invoice_no,
        e.party_name,
        e.party_gstin || (lang === "hi" ? "अपंजीकृत" : "Unregistered"),
        e.state_type === "interstate" ? "IGST" : "CGST+SGST",
        (e.taxable / 100).toFixed(2),
        ...(withGst
          ? [
              (e.cgst / 100).toFixed(2),
              (e.sgst / 100).toFixed(2),
              (e.igst / 100).toFixed(2),
            ]
          : []),
        (e.total / 100).toFixed(2),
        formatPaymentMode(e.payment_mode, lang),
        (e.paid_amount / 100).toFixed(2),
      ]);
      rows.push([
        lang === "hi" ? "कुल योग" : "TOTAL",
        "",
        "",
        "",
        "",
        ((purchaseReg?.total_taxable || 0) / 100).toFixed(2),
        ...(withGst
          ? [
              ((purchaseReg?.total_cgst || 0) / 100).toFixed(2),
              ((purchaseReg?.total_sgst || 0) / 100).toFixed(2),
              ((purchaseReg?.total_igst || 0) / 100).toFixed(2),
            ]
          : []),
        ((purchaseReg?.grand_total || 0) / 100).toFixed(2),
        "",
        "",
      ]);
      exportToCsv(`Purchase_Register_${fromDate}_to_${toDate}_${gstSuffix}.csv`, headers, rows);
    } else if (activeTab === "sales_reg") {
      const headers = [
        lang === "hi" ? "तारीख" : "Date",
        lang === "hi" ? "बिल नं" : "Invoice No",
        lang === "hi" ? "ग्राहक / किसान" : "Customer Name",
        "GSTIN",
        lang === "hi" ? "राज्य प्रकार" : "State Type",
        lang === "hi" ? "कर योग्य बिक्री (₹)" : "Taxable Sales (₹)",
        ...(withGst ? ["CGST (₹)", "SGST (₹)", "IGST (₹)"] : []),
        lang === "hi" ? "कुल बिल राशि (₹)" : "Total Bill (₹)",
        lang === "hi" ? "भुगतान माध्यम" : "Payment Mode",
        lang === "hi" ? "प्राप्त राशि (₹)" : "Received Amount (₹)",
      ];
      const rows = (salesReg?.entries || []).map((e) => [
        formatDate(e.date),
        e.invoice_no,
        e.party_name,
        e.party_gstin || (lang === "hi" ? "अपंजीकृत" : "Unregistered"),
        e.state_type === "interstate" ? "IGST" : "CGST+SGST",
        (e.taxable / 100).toFixed(2),
        ...(withGst
          ? [
              (e.cgst / 100).toFixed(2),
              (e.sgst / 100).toFixed(2),
              (e.igst / 100).toFixed(2),
            ]
          : []),
        (e.total / 100).toFixed(2),
        formatPaymentMode(e.payment_mode, lang),
        (e.paid_amount / 100).toFixed(2),
      ]);
      rows.push([
        lang === "hi" ? "कुल योग" : "TOTAL",
        "",
        "",
        "",
        "",
        ((salesReg?.total_taxable || 0) / 100).toFixed(2),
        ...(withGst
          ? [
              ((salesReg?.total_cgst || 0) / 100).toFixed(2),
              ((salesReg?.total_sgst || 0) / 100).toFixed(2),
              ((salesReg?.total_igst || 0) / 100).toFixed(2),
            ]
          : []),
        ((salesReg?.grand_total || 0) / 100).toFixed(2),
        "",
        "",
      ]);
      exportToCsv(`Sales_Register_${fromDate}_to_${toDate}_${gstSuffix}.csv`, headers, rows);
    } else if (activeTab === "gst_summary") {
      const headers = [
        lang === "hi" ? "विवरण" : "Description",
        lang === "hi" ? "कर योग्य मूल्य (₹)" : "Taxable (₹)",
        "CGST (₹)",
        "SGST (₹)",
        "IGST (₹)",
        lang === "hi" ? "कुल जीएसटी (₹)" : "Total GST (₹)",
      ];
      const rows = [
        [
          lang === "hi" ? "1. आउटपुट जीएसटी (बिक्री कर দেনदारी)" : "1. Output GST (Sales Tax)",
          ((gstSummary?.output_taxable || 0) / 100).toFixed(2),
          ((gstSummary?.output_cgst || 0) / 100).toFixed(2),
          ((gstSummary?.output_sgst || 0) / 100).toFixed(2),
          ((gstSummary?.output_igst || 0) / 100).toFixed(2),
          ((gstSummary?.output_total_gst || 0) / 100).toFixed(2),
        ],
        [
          lang === "hi" ? "2. इनपुट जीएसटी (पात्र खरीदी - ITC)" : "2. Input GST (Eligible ITC)",
          ((gstSummary?.input_taxable_eligible || 0) / 100).toFixed(2),
          ((gstSummary?.input_cgst || 0) / 100).toFixed(2),
          ((gstSummary?.input_sgst || 0) / 100).toFixed(2),
          ((gstSummary?.input_igst || 0) / 100).toFixed(2),
          ((gstSummary?.input_total_gst || 0) / 100).toFixed(2),
        ],
        [
          lang === "hi" ? "3. कम्पोजिशन / अपंजीकृत खरीदी (अपात्र ITC)" : "3. Ineligible Purchases (No ITC)",
          ((gstSummary?.input_taxable_ineligible || 0) / 100).toFixed(2),
          "0.00",
          "0.00",
          "0.00",
          "0.00",
        ],
        [
          lang === "hi" ? "4. शुद्ध देय जीएसटी / (आईटीसी शेष)" : "4. Net Payable / (ITC Balance)",
          "",
          ((gstSummary?.net_cgst_payable || 0) / 100).toFixed(2),
          ((gstSummary?.net_sgst_payable || 0) / 100).toFixed(2),
          ((gstSummary?.net_igst_payable || 0) / 100).toFixed(2),
          ((gstSummary?.net_total_payable || 0) / 100).toFixed(2),
        ],
      ];
      exportToCsv(`GST_Summary_${fromDate}_to_${toDate}.csv`, headers, rows);
    } else if (activeTab === "hsn_summary") {
      const headers = [
        "HSN",
        lang === "hi" ? "सामान का विवरण" : "Item Description",
        lang === "hi" ? "कुल मात्रा" : "Total Qty",
        lang === "hi" ? "इकाई" : "Unit",
        lang === "hi" ? "कर योग्य मूल्य (₹)" : "Taxable (₹)",
        ...(withGst ? ["CGST (₹)", "SGST (₹)", "IGST (₹)", lang === "hi" ? "कुल कर (₹)" : "Total Tax (₹)"] : []),
        lang === "hi" ? "कुल मूल्य (₹)" : "Total Value (₹)",
      ];
      const rows = (hsnSummary?.items || []).map((h) => [
        h.hsn,
        h.item_names,
        (h.total_qty / 1000).toFixed(2),
        h.base_unit,
        (h.taxable_value / 100).toFixed(2),
        ...(withGst
          ? [
              (h.cgst / 100).toFixed(2),
              (h.sgst / 100).toFixed(2),
              (h.igst / 100).toFixed(2),
              (h.total_tax / 100).toFixed(2),
            ]
          : []),
        (h.total_value / 100).toFixed(2),
      ]);
      rows.push([
        lang === "hi" ? "कुल योग" : "TOTAL",
        "",
        "",
        "",
        ((hsnSummary?.total_taxable || 0) / 100).toFixed(2),
        ...(withGst ? ["", "", "", ((hsnSummary?.total_tax || 0) / 100).toFixed(2)] : []),
        ((hsnSummary?.grand_total || 0) / 100).toFixed(2),
      ]);
      exportToCsv(`HSN_Summary_${fromDate}_to_${toDate}_${gstSuffix}.csv`, headers, rows);
    } else if (activeTab === "profit_report") {
      const headers = withGst
        ? [
            lang === "hi" ? "सामान का नाम" : "Item Name",
            lang === "hi" ? "बेची गई मात्रा" : "Sold Qty",
            lang === "hi" ? "इकाई" : "Unit",
            lang === "hi" ? "कर योग्य बिक्री (₹)" : "Taxable Sale (₹)",
            lang === "hi" ? "सकल बिक्री (₹)" : "Gross Sale (₹)",
            lang === "hi" ? "खरीदी लागत (WAC ₹)" : "Cost (WAC ₹)",
            lang === "hi" ? "सकल लाभ (₹)" : "Gross Profit (₹)",
            lang === "hi" ? "प्रति इकाई भाव" : "Unit Price",
            lang === "hi" ? "प्रति इकाई लागत" : "Unit Cost",
            lang === "hi" ? "मार्जिन (%)" : "Margin (%)",
          ]
        : [
            lang === "hi" ? "सामान का नाम" : "Item Name",
            lang === "hi" ? "बेची गई मात्रा" : "Sold Qty",
            lang === "hi" ? "इकाई" : "Unit",
            lang === "hi" ? "बिक्री मूल्य (₹)" : "Sale Value (₹)",
            lang === "hi" ? "खरीदी लागत (WAC ₹)" : "Cost (WAC ₹)",
            lang === "hi" ? "शुद्ध लाभ (₹)" : "Net Profit (₹)",
            lang === "hi" ? "प्रति इकाई भाव" : "Unit Price",
            lang === "hi" ? "प्रति इकाई लागत" : "Unit Cost",
            lang === "hi" ? "प्रति इकाई लाभ" : "Unit Profit",
            lang === "hi" ? "मार्जिन (%)" : "Margin (%)",
          ];
      const rows = (profitReport?.items || []).map((p) =>
        withGst
          ? [
              p.item_name,
              (p.qty_sold / 1000).toFixed(2),
              p.base_unit,
              (p.taxable_sale / 100).toFixed(2),
              (p.gross_sale / 100).toFixed(2),
              (p.cost_amount / 100).toFixed(2),
              (p.gross_profit / 100).toFixed(2),
              (p.unit_sale_price / 100).toFixed(2),
              (p.unit_cost / 100).toFixed(2),
              p.margin_percent.toFixed(2) + "%",
            ]
          : [
              p.item_name,
              (p.qty_sold / 1000).toFixed(2),
              p.base_unit,
              (p.taxable_sale / 100).toFixed(2),
              (p.cost_amount / 100).toFixed(2),
              (p.profit_without_gst / 100).toFixed(2),
              (p.unit_sale_price / 100).toFixed(2),
              (p.unit_cost / 100).toFixed(2),
              (p.unit_profit / 100).toFixed(2),
              p.margin_percent.toFixed(2) + "%",
            ]
      );
      exportToCsv(`Profit_Report_${fromDate}_to_${toDate}_${gstSuffix}.csv`, headers, rows);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const tabs: { id: ReportTab; title: string; icon: React.ReactNode }[] = [
    {
      id: "purchase_reg",
      title: t.reports.tabs.purchaseReg,
      icon: <ReceiptText size={16} strokeWidth={1.75} />,
    },
    {
      id: "sales_reg",
      title: t.reports.tabs.salesReg,
      icon: <ReceiptText size={16} strokeWidth={1.75} />,
    },
    {
      id: "gst_summary",
      title: t.reports.tabs.gstSummary,
      icon: <Landmark size={16} strokeWidth={1.75} />,
    },
    {
      id: "hsn_summary",
      title: t.reports.tabs.hsnSummary,
      icon: <Tag size={16} strokeWidth={1.75} />,
    },
    {
      id: "profit_report",
      title: t.reports.tabs.profitReport,
      icon: <TrendingUp size={16} strokeWidth={1.75} />,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header (no-print) */}
      <div className="pb-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            {t.reports.title}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {t.reports.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold shadow-xs transition-colors"
          >
            <Download size={14} strokeWidth={1.75} />
            <span>{t.common.exportExcel}</span>
          </button>

          <button
            onClick={handlePrint}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
          >
            <Printer size={14} strokeWidth={1.75} />
            <span>{t.common.exportPdf}</span>
          </button>
        </div>
      </div>

      <FeedbackBanner feedback={feedback} />

      {/* Tabs Bar */}
      <div className="flex border-b border-slate-200 overflow-x-auto gap-1 no-print">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              data-testid={`report-tab-${tab.id}`}
              onClick={() => {
                setActiveTab(tab.id);
                setSearchFilter("");
              }}
              className={`pb-2.5 px-3.5 text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-2 border-b-2 -mb-px ${
                isActive
                  ? "border-emerald-600 text-emerald-800"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.title}</span>
            </button>
          );
        })}
      </div>

      {/* Filter and Controls Toolbar (no-print) */}
      <div className="bg-slate-50/70 p-4 rounded-xl border border-slate-200/80 space-y-3 no-print">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Date Pickers with DD/MM/YYYY formatting */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <label className="text-xs font-semibold text-slate-600">
                {t.reports.fromDate}:
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-mono bg-white outline-none"
                />
              </div>
              <span className="text-xs font-mono text-slate-500 bg-white px-2 py-1 rounded border border-slate-200">
                {formatDate(fromDate)}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <label className="text-xs font-semibold text-slate-600">
                {t.reports.toDate}:
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-mono bg-white outline-none"
                />
              </div>
              <span className="text-xs font-mono text-slate-500 bg-white px-2 py-1 rounded border border-slate-200">
                {formatDate(toDate)}
              </span>
            </div>

            {/* Quick Presets */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={setThisMonth}
                className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded text-xs font-medium text-slate-600 transition"
              >
                {t.reports.presetThisMonth}
              </button>
              <button
                type="button"
                onClick={setLast30Days}
                className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded text-xs font-medium text-slate-600 transition"
              >
                {t.reports.presetLast30Days}
              </button>
              <button
                type="button"
                onClick={setThisFiscalYear}
                className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded text-xs font-medium text-slate-600 transition"
              >
                {t.reports.presetFiscalYear}
              </button>
            </div>
          </div>

          {/* GST Toggle Pill */}
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-white text-xs">
            <button
              type="button"
              data-testid="report-toggle-no-gst"
              onClick={() => setWithGst(false)}
              className={`px-3 py-1 rounded-md transition-all font-medium ${
                !withGst
                  ? "bg-slate-800 text-white font-semibold shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {t.reports.viewWithoutGst}
            </button>
            <button
              type="button"
              data-testid="report-toggle-with-gst"
              onClick={() => setWithGst(true)}
              className={`px-3 py-1 rounded-md transition-all font-medium ${
                withGst
                  ? "bg-emerald-600 text-white font-semibold shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {t.reports.viewWithGst}
            </button>
          </div>
        </div>

        {/* Search Input for Current Tab */}
        {(activeTab === "purchase_reg" ||
          activeTab === "sales_reg" ||
          activeTab === "hsn_summary" ||
          activeTab === "profit_report") && (
          <div className="relative max-w-sm">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <Search size={14} strokeWidth={1.75} />
            </span>
            <input
              type="text"
              placeholder={t.common.search}
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 border border-slate-200 rounded-lg text-xs bg-white outline-none"
            />
            {searchFilter && (
              <button
                type="button"
                onClick={() => setSearchFilter("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X size={12} strokeWidth={2} />
              </button>
            )}
          </div>
        )}
      </div>

      {loading && (
        <div className="py-12 text-center text-slate-400 text-xs">
          {t.common.loading}
        </div>
      )}

      {/* 1. PURCHASE REGISTER */}
      {!loading && activeTab === "purchase_reg" && purchaseReg && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 no-print">
            <div className="bg-white border border-slate-200/80 p-3.5 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
              <span className="text-xs text-slate-500 font-medium">{lang === "hi" ? "बिल संख्या" : "Invoices"}</span>
              <span className="text-xl font-bold font-mono text-slate-900 mt-1 block">
                {purchaseReg.entries.length}
              </span>
            </div>
            <div className="bg-white border border-slate-200/80 p-3.5 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
              <span className="text-xs text-slate-500 font-medium">{t.common.taxable}</span>
              <span className="text-xl font-bold font-mono text-slate-800 mt-1 block">
                {formatCurrency(purchaseReg.total_taxable)}
              </span>
            </div>
            {withGst && (
              <div className="bg-white border border-slate-200/80 p-3.5 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
                <span className="text-xs text-slate-500 font-medium">CGST + SGST + IGST</span>
                <span className="text-xl font-bold font-mono text-slate-800 mt-1 block">
                  {formatCurrency(purchaseReg.total_cgst + purchaseReg.total_sgst + purchaseReg.total_igst)}
                </span>
              </div>
            )}
            <div className="bg-white border border-slate-200/80 p-3.5 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
              <span className="text-xs text-slate-500 font-medium">{t.common.total}</span>
              <span className="text-xl font-bold font-mono text-emerald-800 mt-1 block">
                {formatCurrency(purchaseReg.grand_total)}
              </span>
            </div>
          </div>

          <div className="border border-slate-200/80 rounded-xl overflow-hidden bg-white shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/75 text-slate-600 font-semibold border-b border-slate-200">
                    <th className="py-2.5 px-3">{t.common.date}</th>
                    <th className="py-2.5 px-3">{t.dashboard.invoiceNo}</th>
                    <th className="py-2.5 px-3">{t.common.supplier}</th>
                    <th className="py-2.5 px-3">{t.common.gstin}</th>
                    <th className="py-2.5 px-3 text-right">{t.common.taxable}</th>
                    {withGst && (
                      <>
                        <th className="py-2.5 px-3 text-right">CGST</th>
                        <th className="py-2.5 px-3 text-right">SGST</th>
                        <th className="py-2.5 px-3 text-right">IGST</th>
                      </>
                    )}
                    <th className="py-2.5 px-3 text-right font-bold text-slate-900">{t.common.total}</th>
                    <th className="py-2.5 px-3">{t.common.paymentMode}</th>
                    <th className="py-2.5 px-3 text-right">{t.common.paid}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {purchaseReg.entries
                    .filter((e) => {
                      if (!searchFilter.trim()) return true;
                      const term = searchFilter.toLowerCase();
                      return (
                        e.party_name.toLowerCase().includes(term) ||
                        e.invoice_no.toLowerCase().includes(term)
                      );
                    })
                    .map((e, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-3 font-mono text-slate-600">{formatDate(e.date)}</td>
                        <td className="py-2.5 px-3 font-mono font-medium text-slate-800">{e.invoice_no}</td>
                        <td className="py-2.5 px-3 font-medium text-slate-900">{e.party_name}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-500">{e.party_gstin || "-"}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-700">{formatCurrency(e.taxable)}</td>
                        {withGst && (
                          <>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-600">{formatCurrency(e.cgst)}</td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-600">{formatCurrency(e.sgst)}</td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-600">{formatCurrency(e.igst)}</td>
                          </>
                        )}
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">{formatCurrency(e.total)}</td>
                        <td className="py-2.5 px-3 text-slate-600">{formatPaymentMode(e.payment_mode, lang)}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-700">{formatCurrency(e.paid_amount)}</td>
                      </tr>
                    ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold border-t border-slate-200">
                    <td colSpan={4} className="py-2.5 px-3 text-slate-700">{lang === "hi" ? "कुल योग" : "TOTAL"}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-900">{formatCurrency(purchaseReg.total_taxable)}</td>
                    {withGst && (
                      <>
                        <td className="py-2.5 px-3 text-right font-mono">{formatCurrency(purchaseReg.total_cgst)}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{formatCurrency(purchaseReg.total_sgst)}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{formatCurrency(purchaseReg.total_igst)}</td>
                      </>
                    )}
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-800">{formatCurrency(purchaseReg.grand_total)}</td>
                    <td colSpan={2} className="py-2.5 px-3"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 2. SALES REGISTER */}
      {!loading && activeTab === "sales_reg" && salesReg && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 no-print">
            <div className="bg-white border border-slate-200/80 p-3.5 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
              <span className="text-xs text-slate-500 font-medium">{lang === "hi" ? "बिल संख्या" : "Invoices"}</span>
              <span className="text-xl font-bold font-mono text-slate-900 mt-1 block">
                {salesReg.entries.length}
              </span>
            </div>
            <div className="bg-white border border-slate-200/80 p-3.5 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
              <span className="text-xs text-slate-500 font-medium">{t.common.taxable}</span>
              <span className="text-xl font-bold font-mono text-slate-800 mt-1 block">
                {formatCurrency(salesReg.total_taxable)}
              </span>
            </div>
            {withGst && (
              <div className="bg-white border border-slate-200/80 p-3.5 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
                <span className="text-xs text-slate-500 font-medium">CGST + SGST + IGST</span>
                <span className="text-xl font-bold font-mono text-slate-800 mt-1 block">
                  {formatCurrency(salesReg.total_cgst + salesReg.total_sgst + salesReg.total_igst)}
                </span>
              </div>
            )}
            <div className="bg-white border border-slate-200/80 p-3.5 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
              <span className="text-xs text-slate-500 font-medium">{t.common.total}</span>
              <span className="text-xl font-bold font-mono text-emerald-800 mt-1 block">
                {formatCurrency(salesReg.grand_total)}
              </span>
            </div>
          </div>

          <div className="border border-slate-200/80 rounded-xl overflow-hidden bg-white shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/75 text-slate-600 font-semibold border-b border-slate-200">
                    <th className="py-2.5 px-3">{t.common.date}</th>
                    <th className="py-2.5 px-3">{t.dashboard.invoiceNo}</th>
                    <th className="py-2.5 px-3">{t.common.customer}</th>
                    <th className="py-2.5 px-3">{t.common.gstin}</th>
                    <th className="py-2.5 px-3 text-right">{t.common.taxable}</th>
                    {withGst && (
                      <>
                        <th className="py-2.5 px-3 text-right">CGST</th>
                        <th className="py-2.5 px-3 text-right">SGST</th>
                        <th className="py-2.5 px-3 text-right">IGST</th>
                      </>
                    )}
                    <th className="py-2.5 px-3 text-right font-bold text-slate-900">{t.common.total}</th>
                    <th className="py-2.5 px-3">{t.common.paymentMode}</th>
                    <th className="py-2.5 px-3 text-right">{t.common.paid}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {salesReg.entries
                    .filter((e) => {
                      if (!searchFilter.trim()) return true;
                      const term = searchFilter.toLowerCase();
                      return (
                        e.party_name.toLowerCase().includes(term) ||
                        e.invoice_no.toLowerCase().includes(term)
                      );
                    })
                    .map((e, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-3 font-mono text-slate-600">{formatDate(e.date)}</td>
                        <td className="py-2.5 px-3 font-mono font-medium text-slate-800">{e.invoice_no}</td>
                        <td className="py-2.5 px-3 font-medium text-slate-900">{e.party_name}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-500">{e.party_gstin || "-"}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-700">{formatCurrency(e.taxable)}</td>
                        {withGst && (
                          <>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-600">{formatCurrency(e.cgst)}</td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-600">{formatCurrency(e.sgst)}</td>
                            <td className="py-2.5 px-3 text-right font-mono text-slate-600">{formatCurrency(e.igst)}</td>
                          </>
                        )}
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">{formatCurrency(e.total)}</td>
                        <td className="py-2.5 px-3 text-slate-600">{formatPaymentMode(e.payment_mode, lang)}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-700">{formatCurrency(e.paid_amount)}</td>
                      </tr>
                    ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold border-t border-slate-200">
                    <td colSpan={4} className="py-2.5 px-3 text-slate-700">{lang === "hi" ? "कुल योग" : "TOTAL"}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-900">{formatCurrency(salesReg.total_taxable)}</td>
                    {withGst && (
                      <>
                        <td className="py-2.5 px-3 text-right font-mono">{formatCurrency(salesReg.total_cgst)}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{formatCurrency(salesReg.total_sgst)}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{formatCurrency(salesReg.total_igst)}</td>
                      </>
                    )}
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-800">{formatCurrency(salesReg.grand_total)}</td>
                    <td colSpan={2} className="py-2.5 px-3"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 3. GST SUMMARY */}
      {!loading && activeTab === "gst_summary" && gstSummary && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 no-print">
            <div className="bg-white border border-slate-200/80 p-5 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
              <span className="text-xs font-medium text-slate-500">
                {lang === "hi" ? "आउटपुट जीएसटी (बिक्री कर)" : "Output GST (Sales)"}
              </span>
              <span className="text-2xl font-bold font-mono text-slate-900 mt-2 block">
                {formatCurrency(gstSummary.output_total_gst)}
              </span>
              <span className="text-xs text-slate-500 mt-1 block">
                {lang === "hi" ? "कर योग्य बिक्री: " : "Taxable Sales: "}
                {formatCurrency(gstSummary.output_taxable)}
              </span>
            </div>

            <div className="bg-white border border-slate-200/80 p-5 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
              <span className="text-xs font-medium text-slate-500">
                {lang === "hi" ? "इनपुट जीएसटी (ITC - खरीदी)" : "Input GST (Eligible ITC)"}
              </span>
              <span className="text-2xl font-bold font-mono text-slate-900 mt-2 block">
                {formatCurrency(gstSummary.input_total_gst)}
              </span>
              <span className="text-xs text-slate-500 mt-1 block">
                {lang === "hi" ? "पात्र खरीदी: " : "Eligible Purchases: "}
                {formatCurrency(gstSummary.input_taxable_eligible)}
              </span>
            </div>

            <div className="bg-white border border-slate-200/80 p-5 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
              <span className="text-xs font-medium text-slate-500">
                {gstSummary.net_total_payable >= 0
                  ? (lang === "hi" ? "शुद्ध देय जीएसटी" : "Net Payable GST")
                  : (lang === "hi" ? "आईटीसी शेष (क्रेडिट)" : "ITC Credit Balance")}
              </span>
              <span
                className={`text-2xl font-bold font-mono mt-2 block ${
                  gstSummary.net_total_payable >= 0 ? "text-rose-700" : "text-emerald-700"
                }`}
              >
                {formatCurrency(Math.abs(gstSummary.net_total_payable))}
              </span>
              <span className="text-xs text-slate-500 mt-1 block">
                {gstSummary.net_total_payable >= 0
                  ? (lang === "hi" ? "आउटपुट जीएसटी > इनपुट आईटीसी" : "Output GST > Input ITC")
                  : (lang === "hi" ? "इनपुट आईटीसी > आउटपुट जीएसटी" : "Input ITC > Output GST")}
              </span>
            </div>
          </div>

          <div className="border border-slate-200/80 rounded-xl overflow-hidden bg-white shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/75 text-slate-600 font-semibold border-b border-slate-200">
                    <th className="py-3 px-4">{lang === "hi" ? "कर विवरण" : "Description"}</th>
                    <th className="py-3 px-4 text-right">{t.common.taxable}</th>
                    <th className="py-3 px-4 text-right">CGST</th>
                    <th className="py-3 px-4 text-right">SGST</th>
                    <th className="py-3 px-4 text-right">IGST</th>
                    <th className="py-3 px-4 text-right font-bold text-slate-900">{t.common.tax}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      1. {lang === "hi" ? "आउटपुट जीएसटी (बिक्री দেনदारी)" : "Output GST (Sales Tax Liability)"}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-700">{formatCurrency(gstSummary.output_taxable)}</td>
                    <td className="py-3 px-4 text-right font-mono text-slate-600">{formatCurrency(gstSummary.output_cgst)}</td>
                    <td className="py-3 px-4 text-right font-mono text-slate-600">{formatCurrency(gstSummary.output_sgst)}</td>
                    <td className="py-3 px-4 text-right font-mono text-slate-600">{formatCurrency(gstSummary.output_igst)}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">{formatCurrency(gstSummary.output_total_gst)}</td>
                  </tr>

                  <tr className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      2. {lang === "hi" ? "इनपुट जीएसटी (पात्र खरीदी - ITC)" : "Input GST (Eligible Purchases - ITC)"}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-700">{formatCurrency(gstSummary.input_taxable_eligible)}</td>
                    <td className="py-3 px-4 text-right font-mono text-slate-600">{formatCurrency(gstSummary.input_cgst)}</td>
                    <td className="py-3 px-4 text-right font-mono text-slate-600">{formatCurrency(gstSummary.input_sgst)}</td>
                    <td className="py-3 px-4 text-right font-mono text-slate-600">{formatCurrency(gstSummary.input_igst)}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">{formatCurrency(gstSummary.input_total_gst)}</td>
                  </tr>

                  <tr className="hover:bg-slate-50/70 bg-slate-50/40">
                    <td className="py-3 px-4 text-slate-600">
                      3. {lang === "hi" ? "कम्पोजिशन / अपंजीकृत खरीदी (अपात्र ITC)" : "Ineligible / Composition Purchases (No ITC)"}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-600">{formatCurrency(gstSummary.input_taxable_ineligible)}</td>
                    <td className="py-3 px-4 text-right font-mono text-slate-400">₹0.00</td>
                    <td className="py-3 px-4 text-right font-mono text-slate-400">₹0.00</td>
                    <td className="py-3 px-4 text-right font-mono text-slate-400">₹0.00</td>
                    <td className="py-3 px-4 text-right font-mono text-slate-400">₹0.00</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold border-t border-slate-200">
                    <td className="py-3 px-4 text-slate-900">
                      4. {lang === "hi" ? "शुद्ध देय जीएसटी / (आईटीसी शेष)" : "Net Payable / (Credit Balance)"}
                    </td>
                    <td className="py-3 px-4"></td>
                    <td className="py-3 px-4 text-right font-mono">{formatCurrency(gstSummary.net_cgst_payable)}</td>
                    <td className="py-3 px-4 text-right font-mono">{formatCurrency(gstSummary.net_sgst_payable)}</td>
                    <td className="py-3 px-4 text-right font-mono">{formatCurrency(gstSummary.net_igst_payable)}</td>
                    <td
                      className={`py-3 px-4 text-right font-mono font-bold ${
                        gstSummary.net_total_payable >= 0 ? "text-rose-700" : "text-emerald-700"
                      }`}
                    >
                      {formatCurrency(gstSummary.net_total_payable)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 4. HSN SUMMARY */}
      {!loading && activeTab === "hsn_summary" && hsnSummary && (
        <div className="border border-slate-200/80 rounded-xl overflow-hidden bg-white shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/75 text-slate-600 font-semibold border-b border-slate-200">
                  <th className="py-2.5 px-3">HSN</th>
                  <th className="py-2.5 px-3">{lang === "hi" ? "सामान का नाम" : "Items"}</th>
                  <th className="py-2.5 px-3 text-right">{t.common.qty}</th>
                  <th className="py-2.5 px-3">{t.common.unit}</th>
                  <th className="py-2.5 px-3 text-right">{t.common.taxable}</th>
                  {withGst && (
                    <>
                      <th className="py-2.5 px-3 text-right">CGST</th>
                      <th className="py-2.5 px-3 text-right">SGST</th>
                      <th className="py-2.5 px-3 text-right">IGST</th>
                      <th className="py-2.5 px-3 text-right">{t.common.tax}</th>
                    </>
                  )}
                  <th className="py-2.5 px-3 text-right font-bold text-slate-900">{t.common.total}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {hsnSummary.items
                  .filter((h) => {
                    if (!searchFilter.trim()) return true;
                    const term = searchFilter.toLowerCase();
                    return h.hsn.toLowerCase().includes(term) || h.item_names.toLowerCase().includes(term);
                  })
                  .map((h, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-800">{h.hsn}</td>
                      <td className="py-2.5 px-3 font-medium text-slate-900">{h.item_names}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">{(h.total_qty / 1000).toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-slate-500">{h.base_unit}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700">{formatCurrency(h.taxable_value)}</td>
                      {withGst && (
                        <>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-600">{formatCurrency(h.cgst)}</td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-600">{formatCurrency(h.sgst)}</td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-600">{formatCurrency(h.igst)}</td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-700">{formatCurrency(h.total_tax)}</td>
                        </>
                      )}
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">{formatCurrency(h.total_value)}</td>
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-bold border-t border-slate-200">
                  <td colSpan={4} className="py-2.5 px-3 text-slate-700">{lang === "hi" ? "कुल योग" : "TOTAL"}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-slate-900">{formatCurrency(hsnSummary.total_taxable)}</td>
                  {withGst && (
                    <>
                      <td colSpan={3} className="py-2.5 px-3"></td>
                      <td className="py-2.5 px-3 text-right font-mono">{formatCurrency(hsnSummary.total_tax)}</td>
                    </>
                  )}
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-800">{formatCurrency(hsnSummary.grand_total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* 5. PROFIT REPORT */}
      {!loading && activeTab === "profit_report" && profitReport && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 no-print">
            <div className="bg-white border border-slate-200/80 p-3.5 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
              <span className="text-xs text-slate-500 font-medium">
                {withGst ? (lang === "hi" ? "कुल बिक्री (सकल)" : "Gross Sales") : (lang === "hi" ? "कर योग्य बिक्री" : "Taxable Sales")}
              </span>
              <span className="text-xl font-bold font-mono text-slate-900 mt-1 block">
                {formatCurrency(withGst ? profitReport.total_gross_sale : profitReport.total_taxable_sale)}
              </span>
            </div>
            <div className="bg-white border border-slate-200/80 p-3.5 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
              <span className="text-xs text-slate-500 font-medium">{lang === "hi" ? "खरीदी लागत (WAC)" : "Cost (WAC)"}</span>
              <span className="text-xl font-bold font-mono text-slate-800 mt-1 block">
                {formatCurrency(profitReport.total_cost)}
              </span>
            </div>
            <div className="bg-white border border-slate-200/80 p-3.5 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
              <span className="text-xs text-slate-500 font-medium">{lang === "hi" ? "कुल लाभ" : "Total Profit"}</span>
              <span className="text-xl font-bold font-mono text-emerald-800 mt-1 block">
                {formatCurrency(withGst ? profitReport.total_gross_profit : profitReport.total_profit_without_gst)}
              </span>
            </div>
            <div className="bg-white border border-slate-200/80 p-3.5 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
              <span className="text-xs text-slate-500 font-medium">{lang === "hi" ? "औसत मार्जिन" : "Average Margin"}</span>
              <span className="text-xl font-bold font-mono text-slate-900 mt-1 block">
                {profitReport.total_taxable_sale > 0
                  ? ((profitReport.total_profit_without_gst * 100) / profitReport.total_taxable_sale).toFixed(2)
                  : "0.00"}%
              </span>
            </div>
          </div>

          <div className="border border-slate-200/80 rounded-xl overflow-hidden bg-white shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/75 text-slate-600 font-semibold border-b border-slate-200">
                    <th className="py-2.5 px-3">{t.common.item}</th>
                    <th className="py-2.5 px-3 text-right">{t.common.qty}</th>
                    <th className="py-2.5 px-3 text-right">{withGst ? (lang === "hi" ? "सकल बिक्री" : "Gross Sale") : (lang === "hi" ? "बिक्री मूल्य" : "Sale Value")}</th>
                    <th className="py-2.5 px-3 text-right">{lang === "hi" ? "लागत (WAC)" : "Cost (WAC)"}</th>
                    <th className="py-2.5 px-3 text-right font-bold text-slate-900">{lang === "hi" ? "लाभ" : "Profit"}</th>
                    <th className="py-2.5 px-3 text-right">{lang === "hi" ? "प्रति इकाई बिक्री" : "Unit Price"}</th>
                    <th className="py-2.5 px-3 text-right">{lang === "hi" ? "प्रति इकाई लागत" : "Unit Cost"}</th>
                    <th className="py-2.5 px-3 text-right">{lang === "hi" ? "प्रति इकाई लाभ" : "Unit Profit"}</th>
                    <th className="py-2.5 px-3 text-right">{lang === "hi" ? "मार्जिन (%)" : "Margin (%)"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {profitReport.items
                    .filter((p) => {
                      if (!searchFilter.trim()) return true;
                      return p.item_name.toLowerCase().includes(searchFilter.toLowerCase());
                    })
                    .map((p, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-3 font-semibold text-slate-900">{p.item_name}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                          {(p.qty_sold / 1000).toFixed(2)} {p.base_unit}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                          {formatCurrency(withGst ? p.gross_sale : p.taxable_sale)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                          {formatCurrency(p.cost_amount)}
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-mono font-bold ${
                            (withGst ? p.gross_profit : p.profit_without_gst) >= 0
                              ? "text-emerald-700"
                              : "text-rose-700"
                          }`}
                        >
                          {formatCurrency(withGst ? p.gross_profit : p.profit_without_gst)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                          {formatCurrency(p.unit_sale_price)}/{p.base_unit}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-600">
                          {formatCurrency(p.unit_cost)}/{p.base_unit}
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-mono font-semibold ${
                            p.unit_profit >= 0 ? "text-emerald-700" : "text-rose-700"
                          }`}
                        >
                          {formatCurrency(p.unit_profit)}/{p.base_unit}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${
                              p.margin_percent >= 15
                                ? "bg-emerald-50 text-emerald-700"
                                : p.margin_percent >= 5
                                ? "bg-amber-50 text-amber-700"
                                : "bg-rose-50 text-rose-700"
                            }`}
                          >
                            {p.margin_percent.toFixed(2)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
