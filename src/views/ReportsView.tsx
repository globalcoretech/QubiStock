import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AppSettings,
  RegisterReport,
  GstSummaryReport,
  HsnSummaryReport,
  ProfitReport,
  Feedback,
  Item,
  Party,
  SearchableOption,
  SalesGstModeReport,
  SalesGstModeGroupSummary,
  SalesGstModeInvoiceItem,
  ItemPartiesReport,
  ItemPartySummary,
  PartyItemsReport,
  PartyItemSummary,
} from "../types";
import { Translations, Language } from "../i18n";
import { FeedbackBanner } from "../components/FeedbackBanner";
import { Pagination } from "../components/Pagination";
import { SearchableSelect } from "../components/SearchableSelect";
import {
  DuotoneChart,
  Download,
  Printer,
  Search,
  ChevronDown,
  ChevronRight,
  X,
} from "../components/icons";
import { formatCurrency, formatDate } from "../utils/formatters";
import {
  prepareSalesGstModeCsv,
  prepareGroupInvoicesCsv,
  prepareItemPartiesCsv,
  preparePartyItemsCsv,
} from "../utils/reportsHelper";
import { EditInvoiceNoModal } from "../components/EditInvoiceNoModal";
import { AlterationHistoryModal } from "../components/AlterationHistoryModal";

type ReportTab =
  | "sales_reg"
  | "purchase_reg"
  | "gst_summary"
  | "hsn_summary"
  | "profit_report"
  | "sales_gst_mode"
  | "item_parties"
  | "party_items";

interface ReportsViewProps {
  settings: AppSettings;
  refreshTrigger: number;
  onPrintInvoice?: (invNo: string, taxMode?: "with_tax" | "without_tax") => void;
  t: Translations;
  lang: Language;
}

// CSV Export Helper with UTF-8 BOM (\uFEFF)
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
  onPrintInvoice,
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
  const [activeDatePreset, setActiveDatePreset] = useState<string>("this_month");
  const [withGst, setWithGst] = useState<boolean>(true);
  const [searchFilter, setSearchFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // Pagination state (for standard register reports)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);

  // Existing report datasets
  const [purchaseReg, setPurchaseReg] = useState<RegisterReport | null>(null);
  const [salesReg, setSalesReg] = useState<RegisterReport | null>(null);
  const [gstSummary, setGstSummary] = useState<GstSummaryReport | null>(null);
  const [hsnSummary, setHsnSummary] = useState<HsnSummaryReport | null>(null);
  const [profitReport, setProfitReport] = useState<ProfitReport | null>(null);

  // Report 1: Sales & Profit: With GST vs Without GST
  const [salesGstModeReport, setSalesGstModeReport] = useState<SalesGstModeReport | null>(null);
  const [drillDownGroup, setDrillDownGroup] = useState<SalesGstModeGroupSummary | null>(null);
  const [drillDownSearch, setDrillDownSearch] = useState("");

  // Report 2 & 3: Master Items and Parties
  const [itemsList, setItemsList] = useState<Item[]>([]);
  const [partyList, setPartyList] = useState<Party[]>([]);

  // Report 2: Item-wise which parties
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [itemDirection, setItemDirection] = useState<"purchased" | "sold">("purchased");
  const [itemPartiesReport, setItemPartiesReport] = useState<ItemPartiesReport | null>(null);
  const [expandedParties, setExpandedParties] = useState<Set<number>>(new Set());

  // Report 3: Party-wise which items
  const [selectedPartyId, setSelectedPartyId] = useState<number | null>(null);
  const [partyDirection, setPartyDirection] = useState<"purchased" | "sold">("purchased");
  const [partyItemsReport, setPartyItemsReport] = useState<PartyItemsReport | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

  // Sorting state for Reports 2 & 3
  const [sortField, setSortField] = useState<string>("total_amount");
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  // Alteration / Invoice No modal states
  const [editInvoiceNoModalOpen, setEditInvoiceNoModalOpen] = useState(false);
  const [selectedInvoiceForEdit, setSelectedInvoiceForEdit] = useState<{ no: string; type: "sale" | "purchase"; suppDate?: string } | null>(null);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [auditEntity, setAuditEntity] = useState<{ type: string; id: string } | null>(null);

  // Load items and parties once
  useEffect(() => {
    invoke<Item[]>("get_items_cmd")
      .then((res) => {
        setItemsList(res);
        if (res.length > 0 && selectedItemId === null) {
          setSelectedItemId(res[0].id);
        }
      })
      .catch((err) => console.error("get_items_cmd error:", err));

    invoke<Party[]>("get_parties_cmd", { partyType: "all" })
      .then((res) => {
        setPartyList(res);
        if (res.length > 0 && selectedPartyId === null) {
          setSelectedPartyId(res[0].id);
        }
      })
      .catch((err) => console.error("get_parties_cmd error:", err));
  }, [refreshTrigger]);

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
      } else if (activeTab === "sales_gst_mode") {
        const res = await invoke<SalesGstModeReport>("get_sales_gst_mode_profit_report_cmd", {
          fromDate,
          toDate,
        });
        setSalesGstModeReport(res);
      } else if (activeTab === "item_parties") {
        if (selectedItemId !== null) {
          const res = await invoke<ItemPartiesReport>("get_item_parties_report_cmd", {
            itemId: selectedItemId,
            fromDate,
            toDate,
            direction: itemDirection,
          });
          setItemPartiesReport(res);
        } else {
          setItemPartiesReport(null);
        }
      } else if (activeTab === "party_items") {
        if (selectedPartyId !== null) {
          const res = await invoke<PartyItemsReport>("get_party_items_report_cmd", {
            partyId: selectedPartyId,
            fromDate,
            toDate,
            direction: partyDirection,
          });
          setPartyItemsReport(res);
        } else {
          setPartyItemsReport(null);
        }
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
  }, [
    activeTab,
    fromDate,
    toDate,
    refreshTrigger,
    settings.stateCode,
    selectedItemId,
    itemDirection,
    selectedPartyId,
    partyDirection,
  ]);

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
    } else if (activeTab === "sales_gst_mode" && salesGstModeReport) {
      const { headers, rows } = prepareSalesGstModeCsv(salesGstModeReport);
      exportToCsv(`Sales_Profit_GST_Mode_${fromDate}_to_${toDate}.csv`, headers, rows);
    } else if (activeTab === "item_parties" && itemPartiesReport) {
      const { headers, rows } = prepareItemPartiesCsv(itemPartiesReport);
      const safeName = (itemPartiesReport.item_name || "item").replace(/[^a-zA-Z0-9_\u0900-\u097F]/g, "_");
      exportToCsv(`Item_Parties_${safeName}_${itemPartiesReport.direction}_${fromDate}_to_${toDate}.csv`, headers, rows);
    } else if (activeTab === "party_items" && partyItemsReport) {
      const { headers, rows } = preparePartyItemsCsv(partyItemsReport);
      const safeName = (partyItemsReport.party_name || "party").replace(/[^a-zA-Z0-9_\u0900-\u097F]/g, "_");
      exportToCsv(`Party_Items_${safeName}_${partyItemsReport.direction}_${fromDate}_to_${toDate}.csv`, headers, rows);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const tabs: { id: ReportTab; title: string; testId: string }[] = [
    { id: "sales_reg", title: lang === "hi" ? "बिक्री" : "Sales", testId: "report-tab-sales_reg" },
    { id: "purchase_reg", title: lang === "hi" ? "खरीदी" : "Purchase", testId: "report-tab-purchase_reg" },
    { id: "gst_summary", title: "GST", testId: "report-tab-gst_summary" },
    { id: "hsn_summary", title: "HSN", testId: "report-tab-hsn_summary" },
    { id: "profit_report", title: lang === "hi" ? "लाभ" : "Profit", testId: "report-tab-profit_report" },
    {
      id: "sales_gst_mode",
      title: lang === "hi" ? "GST बनाम बिना GST" : "With vs Without GST",
      testId: "report-tab-sales_gst_mode",
    },
    {
      id: "item_parties",
      title: lang === "hi" ? "मद अनुसार पार्टियां" : "Item-wise Parties",
      testId: "report-tab-item_parties",
    },
    {
      id: "party_items",
      title: lang === "hi" ? "पार्टी अनुसार मदें" : "Party-wise Items",
      testId: "report-tab-party_items",
    },
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

  // Active dataset for table & chart for standard 5 tabs
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

  // Totals for KPI cards on standard tabs
  const currentTotal =
    activeTab === "sales_reg" ? salesReg?.grand_total || 0 : purchaseReg?.grand_total || 0;
  const currentTaxable =
    activeTab === "sales_reg" ? salesReg?.total_taxable || 0 : purchaseReg?.total_taxable || 0;
  const currentTax =
    activeTab === "sales_reg"
      ? (salesReg?.total_cgst || 0) + (salesReg?.total_sgst || 0) + (salesReg?.total_igst || 0)
      : (purchaseReg?.total_cgst || 0) + (purchaseReg?.total_sgst || 0) + (purchaseReg?.total_igst || 0);

  // Options for Item select
  const itemOptions: SearchableOption[] = useMemo(
    () =>
      itemsList.map((i) => ({
        value: i.id.toString(),
        label: i.name,
        subLabel: i.hsn ? `HSN: ${i.hsn}` : undefined,
        badge: i.base_unit,
      })),
    [itemsList]
  );

  // Options for Party select
  const partyOptions: SearchableOption[] = useMemo(
    () =>
      partyList.map((p) => ({
        value: p.id.toString(),
        label: p.name,
        subLabel: p.village || p.phone || undefined,
        badge:
          p.party_type === "supplier"
            ? "सप्लायर"
            : p.party_type === "customer"
            ? "ग्राहक"
            : "दोनों",
      })),
    [partyList]
  );

  // Helper toggle row expansions
  const togglePartyExpand = (partyId: number) => {
    setExpandedParties((prev) => {
      const next = new Set(prev);
      if (next.has(partyId)) next.delete(partyId);
      else next.add(partyId);
      return next;
    });
  };

  const toggleItemExpand = (itemId: number) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  // Sort helper for Reports 2 & 3
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false); // default desc for amounts/counts
    }
  };

  const sortedItemParties: ItemPartySummary[] = useMemo(() => {
    if (!itemPartiesReport?.parties) return [];
    return [...itemPartiesReport.parties].sort((a, b) => {
      let av: any = (a as any)[sortField];
      let bv: any = (b as any)[sortField];
      if (typeof av === "string") {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortAsc ? (av || 0) - (bv || 0) : (bv || 0) - (av || 0);
    });
  }, [itemPartiesReport, sortField, sortAsc]);

  const sortedPartyItems: PartyItemSummary[] = useMemo(() => {
    if (!partyItemsReport?.items) return [];
    return [...partyItemsReport.items].sort((a, b) => {
      let av: any = (a as any)[sortField];
      let bv: any = (b as any)[sortField];
      if (typeof av === "string") {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortAsc ? (av || 0) - (bv || 0) : (bv || 0) - (av || 0);
    });
  }, [partyItemsReport, sortField, sortAsc]);

  // Filtered drill-down invoices
  const filteredDrillDownInvoices = useMemo(() => {
    if (!drillDownGroup?.invoices) return [];
    if (!drillDownSearch.trim()) return drillDownGroup.invoices;
    const term = drillDownSearch.toLowerCase().trim();
    return drillDownGroup.invoices.filter(
      (inv) =>
        inv.invoice_no.toLowerCase().includes(term) ||
        inv.party_name.toLowerCase().includes(term)
    );
  }, [drillDownGroup, drillDownSearch]);

  const getGroupNameLabel = (groupName: string) => {
    if (groupName === "WITH_GST") return lang === "hi" ? "GST सहित (WITH_GST)" : "With GST";
    if (groupName === "WITHOUT_GST") return lang === "hi" ? "बिना GST (WITHOUT_GST)" : "Without GST";
    if (groupName === "NOT_PRINTED") return lang === "hi" ? "प्रिंट नहीं हुआ (NOT PRINTED)" : "Not Printed";
    if (groupName === "TOTAL") return lang === "hi" ? "कुल योग (TOTAL)" : "Total";
    return groupName;
  };

  return (
    <div className="h-full max-h-full flex flex-col justify-between overflow-hidden gap-2 text-ink font-body select-none">
      {/* 1. Header with Indigo Color Strip + Tabs on One Line + Export Buttons */}
      <div className="bg-surface border border-border border-t-4 border-t-indigo-600 rounded-panel p-2 px-3.5 shadow-2xs flex items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-800 flex items-center justify-center flex-shrink-0">
            <DuotoneChart size={20} />
          </div>
          <h2 className="font-serif text-base sm:text-lg font-bold tracking-tight text-ink whitespace-nowrap">
            {lang === "hi" ? "व्यापार रिपोर्ट्स" : "Reports"}
          </h2>

          {/* All 8 Tabs in a Single Scrollable Strip */}
          <div className="flex items-center gap-1 bg-paper border border-border p-0.5 rounded-lg ml-2 overflow-x-auto max-w-[calc(100vw-360px)]">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                data-testid={tab.testId}
                onClick={() => {
                  setActiveTab(tab.id);
                  setPage(1);
                  setSearchFilter("");
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
            <span className="hidden sm:inline">{lang === "hi" ? "प्रिंट" : "Print"}</span>
          </button>
        </div>
      </div>

      <FeedbackBanner feedback={feedback} />

      {/* 2. One-Line Filter Strip: Date chips + Custom range + contextual controls */}
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
            {lang === "hi" ? "आज" : "Today"}
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
            {lang === "hi" ? "7 दिन" : "7 Days"}
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
            {lang === "hi" ? "इस महीने" : "This Month"}
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
            {lang === "hi" ? "वित्तीय वर्ष" : "This FY"}
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
            className="px-2 py-0.5 border border-border bg-paper rounded text-xs font-bold text-ink"
          />
          <span className="text-muted font-sans text-xs">{lang === "hi" ? "से" : "to"}</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setActiveDatePreset("custom");
              setPage(1);
            }}
            className="px-2 py-0.5 border border-border bg-paper rounded text-xs font-bold text-ink"
          />
        </div>

        {/* Right contextual controls */}
        {activeTab === "sales_reg" || activeTab === "purchase_reg" ? (
          <div className="flex items-center bg-paper border border-border rounded-lg p-0.5">
            <button
              type="button"
              data-testid="report-toggle-with-gst"
              onClick={() => setWithGst(true)}
              className={`px-2.5 py-0.5 rounded text-xs font-bold transition-all ${
                withGst ? "bg-emerald-600 text-white shadow-2xs" : "text-muted hover:text-ink"
              }`}
            >
              {lang === "hi" ? "GST के साथ" : "With GST"}
            </button>
            <button
              type="button"
              data-testid="report-toggle-no-gst"
              onClick={() => setWithGst(false)}
              className={`px-2.5 py-0.5 rounded text-xs font-bold transition-all ${
                !withGst ? "bg-emerald-600 text-white shadow-2xs" : "text-muted hover:text-ink"
              }`}
            >
              {lang === "hi" ? "बिना GST" : "Without GST"}
            </button>
          </div>
        ) : activeTab === "item_parties" ? (
          <div className="flex items-center gap-2">
            <span className="text-muted font-bold">{lang === "hi" ? "प्रकार:" : "Direction:"}</span>
            <div className="flex items-center bg-paper border border-border rounded-lg p-0.5">
              <button
                type="button"
                data-testid="item-parties-toggle-purchased"
                onClick={() => setItemDirection("purchased")}
                className={`px-2.5 py-0.5 rounded text-xs font-bold transition-all ${
                  itemDirection === "purchased"
                    ? "bg-indigo-600 text-white shadow-2xs"
                    : "text-muted hover:text-ink"
                }`}
              >
                {t.reports.directionPurchasedFrom}
              </button>
              <button
                type="button"
                data-testid="item-parties-toggle-sold"
                onClick={() => setItemDirection("sold")}
                className={`px-2.5 py-0.5 rounded text-xs font-bold transition-all ${
                  itemDirection === "sold"
                    ? "bg-indigo-600 text-white shadow-2xs"
                    : "text-muted hover:text-ink"
                }`}
              >
                {t.reports.directionSoldTo}
              </button>
            </div>
          </div>
        ) : activeTab === "party_items" ? (
          <div className="flex items-center gap-2">
            <span className="text-muted font-bold">{lang === "hi" ? "प्रकार:" : "Direction:"}</span>
            <div className="flex items-center bg-paper border border-border rounded-lg p-0.5">
              <button
                type="button"
                data-testid="party-items-toggle-purchased"
                onClick={() => setPartyDirection("purchased")}
                className={`px-2.5 py-0.5 rounded text-xs font-bold transition-all ${
                  partyDirection === "purchased"
                    ? "bg-indigo-600 text-white shadow-2xs"
                    : "text-muted hover:text-ink"
                }`}
              >
                {t.reports.directionPurchasedFromParty}
              </button>
              <button
                type="button"
                data-testid="party-items-toggle-sold"
                onClick={() => setPartyDirection("sold")}
                className={`px-2.5 py-0.5 rounded text-xs font-bold transition-all ${
                  partyDirection === "sold"
                    ? "bg-indigo-600 text-white shadow-2xs"
                    : "text-muted hover:text-ink"
                }`}
              >
                {t.reports.directionSoldToParty}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* =========================================================================
          REPORT 1: Sales & Profit: With GST vs Without GST
          ========================================================================= */}
      {activeTab === "sales_gst_mode" && (
        <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
          {/* Info Banner Note */}
          <div
            data-testid="sales-gst-mode-info-note"
            className="bg-amber-50/90 border border-amber-300/80 rounded-panel p-2 px-3 text-xs text-amber-950 flex items-center gap-2 shadow-2xs flex-shrink-0"
          >
            <span className="text-base flex-shrink-0">ℹ️</span>
            <span className="font-medium">{t.reports.infoNote}</span>
          </div>

          {/* KPI Strip for GST Mode */}
          {salesGstModeReport && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-shrink-0">
              <div className="bg-gradient-to-br from-indigo-50/90 to-indigo-100/50 border border-indigo-200/90 rounded-panel p-2.5 shadow-2xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-900 block">
                  {lang === "hi" ? "कुल बिल राशि (बिक्री)" : "Total Bill Sales"}
                </span>
                <div className="text-xl sm:text-2xl font-serif font-bold text-indigo-950 num-tabular mt-0.5">
                  {formatCurrency(salesGstModeReport.total_bill_amount)}
                </div>
                <div className="text-[11px] text-indigo-800 mt-0.5">
                  {salesGstModeReport.total_bills_count} {lang === "hi" ? "बिल" : "bills"}
                </div>
              </div>

              <div className="bg-gradient-to-br from-blue-50/90 to-blue-100/50 border border-blue-200/90 rounded-panel p-2.5 shadow-2xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-900 block">
                  {lang === "hi" ? "कर योग्य बिक्री (Taxable)" : "Taxable Sales"}
                </span>
                <div className="text-xl sm:text-2xl font-serif font-bold text-blue-950 num-tabular mt-0.5">
                  {formatCurrency(salesGstModeReport.total_taxable_sales)}
                </div>
                <div className="text-[11px] text-blue-800 mt-0.5">
                  GST: {formatCurrency(salesGstModeReport.total_gst_collected)}
                </div>
              </div>

              <div className="bg-gradient-to-br from-emerald-50/90 to-emerald-100/50 border border-emerald-200/90 rounded-panel p-2.5 shadow-2xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-900 block">
                  {lang === "hi" ? "कुल शुद्ध लाभ (Profit)" : "Total Profit"}
                </span>
                <div className="text-xl sm:text-2xl font-serif font-bold text-emerald-950 num-tabular mt-0.5">
                  {formatCurrency(salesGstModeReport.total_profit)}
                </div>
                <div className="text-[11px] text-emerald-800 font-bold mt-0.5">
                  {lang === "hi" ? "मार्जिन" : "Margin"}: {salesGstModeReport.total_profit_margin_pct.toFixed(2)}%
                </div>
              </div>

              <div className="bg-gradient-to-br from-amber-50/90 to-amber-100/50 border border-amber-200/90 rounded-panel p-2.5 shadow-2xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900 block">
                  {lang === "hi" ? "बिना GST प्रिंट अंतर" : "Without GST Print Diff"}
                </span>
                <div className="text-xl sm:text-2xl font-serif font-bold text-amber-950 num-tabular mt-0.5">
                  {formatCurrency(salesGstModeReport.total_diff_vs_printed_total)}
                </div>
                <div className="text-[11px] text-amber-800 mt-0.5">
                  {lang === "hi" ? "टैक्स जो प्रिंट नहीं हुआ" : "Unprinted Tax difference"}
                </div>
              </div>
            </div>
          )}

          {/* Groups Summary Table */}
          <div className="flex-1 min-h-0 bg-surface border border-border rounded-panel flex flex-col overflow-hidden shadow-2xs">
            <div className="p-2.5 border-b border-border/80 flex items-center justify-between bg-paper/40 flex-shrink-0">
              <span className="text-xs font-bold text-ink">
                {lang === "hi"
                  ? "प्रिंट मोड अनुसार बिक्री व लाभ सारांश (3 समूह)"
                  : "Sales & Profit Summary by Print Mode (3 Groups)"}
              </span>
              <span className="text-[11px] text-muted">
                {lang === "hi" ? "समूह पर क्लिक करके बिलों की विस्तृत सूची देखें" : "Click group row to drill down into invoices"}
              </span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto" data-scroll="true">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-paper sticky top-0 border-b border-border text-muted font-bold z-10">
                  <tr>
                    <th className="py-2.5 px-3">{lang === "hi" ? "प्रिंट मोड समूह" : "Print Mode Group"}</th>
                    <th className="py-2.5 px-2.5 text-center">{lang === "hi" ? "बिल संख्या" : "Bills"}</th>
                    <th className="py-2.5 px-2.5 text-right">{lang === "hi" ? "कर योग्य बिक्री (₹)" : "Taxable Sales (₹)"}</th>
                    <th className="py-2.5 px-2.5 text-right">{lang === "hi" ? "एकत्रित GST (₹)" : "GST Collected (₹)"}</th>
                    <th className="py-2.5 px-2.5 text-right">{lang === "hi" ? "कुल बिल राशि (₹)" : "Bill Total (₹)"}</th>
                    <th className="py-2.5 px-2.5 text-right">{lang === "hi" ? "लागत (₹)" : "Cost (₹)"}</th>
                    <th className="py-2.5 px-2.5 text-right">{lang === "hi" ? "लाभ (₹)" : "Profit (₹)"}</th>
                    <th className="py-2.5 px-2.5 text-right">{lang === "hi" ? "मार्जिन %" : "Margin %"}</th>
                    <th className="py-2.5 px-2.5 text-right">{lang === "hi" ? "प्रिंटेड कुल में अंतर (₹)" : "Diff vs Printed (₹)"}</th>
                    <th className="py-2.5 px-3 text-center">{lang === "hi" ? "विस्तृत विवरण" : "Details"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {salesGstModeReport?.groups.map((group) => {
                    const isWithoutGst = group.group_key === "WITHOUT_GST";
                    return (
                      <tr
                        key={group.group_key}
                        onClick={() => {
                          setDrillDownGroup(group);
                          setDrillDownSearch("");
                        }}
                        className="hover:bg-indigo-50/50 cursor-pointer transition-colors"
                      >
                        <td className="py-2 px-3 font-bold text-ink">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                group.group_key === "WITH_GST"
                                  ? "bg-emerald-600"
                                  : group.group_key === "WITHOUT_GST"
                                  ? "bg-amber-600"
                                  : "bg-slate-400"
                              }`}
                            />
                            <span>{getGroupNameLabel(group.group_name || group.group_key)}</span>
                          </div>
                        </td>
                        <td className="py-2 px-2.5 text-center font-mono font-bold text-ink">
                          {group.bills_count}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono text-ink">
                          {formatCurrency(group.taxable_sales)}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono text-emerald-700">
                          {formatCurrency(group.gst_collected)}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono font-bold text-ink">
                          {formatCurrency(group.bill_total)}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono text-slate-700">
                          {formatCurrency(group.cost)}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono font-bold text-emerald-700">
                          {formatCurrency(group.profit)}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono font-bold text-ink">
                          {group.profit_margin_pct.toFixed(2)}%
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono font-bold text-amber-700">
                          {isWithoutGst ? formatCurrency(group.diff_vs_printed_total) : "-"}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDrillDownGroup(group);
                              setDrillDownSearch("");
                            }}
                            className="px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded font-bold text-[11px] shadow-2xs"
                          >
                            {lang === "hi" ? "बिल देखें" : "View Invoices"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {salesGstModeReport && (
                  <tfoot className="bg-paper font-bold border-t-2 border-border text-ink">
                    <tr>
                      <td className="py-2.5 px-3">
                        {lang === "hi" ? "कुल योग (Total)" : "Total"}
                      </td>
                      <td className="py-2.5 px-2.5 text-center font-mono">
                        {salesGstModeReport.total_bills_count}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono">
                        {formatCurrency(salesGstModeReport.total_taxable_sales)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono text-emerald-700">
                        {formatCurrency(salesGstModeReport.total_gst_collected)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono">
                        {formatCurrency(salesGstModeReport.total_bill_amount)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono text-slate-700">
                        {formatCurrency(salesGstModeReport.total_cost)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono text-emerald-700">
                        {formatCurrency(salesGstModeReport.total_profit)}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono">
                        {salesGstModeReport.total_profit_margin_pct.toFixed(2)}%
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono text-amber-700">
                        {formatCurrency(salesGstModeReport.total_diff_vs_printed_total)}
                      </td>
                      <td className="py-2.5 px-3 text-center">-</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* Drill-Down Modal for Group Invoices */}
          {drillDownGroup && (
            <div className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-surface border border-border rounded-panel shadow-xl w-full max-w-5xl max-h-[88vh] flex flex-col overflow-hidden">
                {/* Modal Header */}
                <div className="p-3 border-b border-border flex items-center justify-between bg-paper/60 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-ink">
                      {getGroupNameLabel(drillDownGroup.group_name || drillDownGroup.group_key)}{" "}
                      {lang === "hi" ? "बिल विवरण" : "Invoice List"}
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-xs font-bold">
                      {filteredDrillDownInvoices.length} {lang === "hi" ? "बिल" : "bills"}
                    </span>
                    <span className="text-xs text-muted">
                      ({fromDate} {lang === "hi" ? "से" : "to"} {toDate})
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <input
                        type="text"
                        placeholder={lang === "hi" ? "बिल नं या पार्टी खोजें..." : "Search invoice/party..."}
                        value={drillDownSearch}
                        onChange={(e) => setDrillDownSearch(e.target.value)}
                        className="text-xs px-2.5 py-1 pl-6 bg-surface border border-border rounded-lg text-ink focus:outline-none focus:ring-1 focus:ring-forest w-44"
                      />
                      <Search size={12} className="absolute left-2 top-2 text-muted pointer-events-none" />
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const { headers, rows } = prepareGroupInvoicesCsv(drillDownGroup);
                        exportToCsv(`Invoices_${drillDownGroup.group_key}_${fromDate}_to_${toDate}.csv`, headers, rows);
                      }}
                      className="px-2.5 py-1 rounded-lg border border-border bg-paper hover:bg-forest/10 text-xs font-bold flex items-center gap-1 shadow-2xs"
                    >
                      <Download size={13} />
                      <span>CSV</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDrillDownGroup(null)}
                      className="p-1 rounded-lg hover:bg-forest/10 text-muted hover:text-ink transition-colors"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>

                {/* Modal Body: Invoices Table */}
                <div className="flex-1 min-h-0 overflow-y-auto" data-scroll="true">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead className="bg-paper sticky top-0 border-b border-border text-muted font-bold z-10">
                      <tr>
                        <th className="py-2 px-3">{lang === "hi" ? "बिल नं" : "Invoice No"}</th>
                        <th className="py-2 px-2.5">{lang === "hi" ? "तारीख" : "Date"}</th>
                        <th className="py-2 px-2.5">{lang === "hi" ? "पार्टी का नाम" : "Party Name"}</th>
                        <th className="py-2 px-2.5 text-right">{lang === "hi" ? "कर योग्य (₹)" : "Taxable (₹)"}</th>
                        <th className="py-2 px-2.5 text-right">{lang === "hi" ? "टैक्स (₹)" : "GST (₹)"}</th>
                        <th className="py-2 px-2.5 text-right">{lang === "hi" ? "कुल बिल (₹)" : "Total (₹)"}</th>
                        <th className="py-2 px-2.5 text-right">{lang === "hi" ? "लागत (₹)" : "Cost (₹)"}</th>
                        <th className="py-2 px-2.5 text-right">{lang === "hi" ? "लाभ (₹)" : "Profit (₹)"}</th>
                        <th className="py-2 px-2.5 text-center">{lang === "hi" ? "प्रिंट मोड" : "Print Mode"}</th>
                        <th className="py-2 px-3 text-right">{lang === "hi" ? "प्रिंट समय" : "Printed At"}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {filteredDrillDownInvoices.length > 0 ? (
                        filteredDrillDownInvoices.map((inv: SalesGstModeInvoiceItem) => (
                          <tr key={inv.invoice_no} className="hover:bg-paper/40 transition-colors">
                            <td className="py-1.5 px-3 font-mono font-bold text-ink whitespace-nowrap">
                              {inv.invoice_no}
                            </td>
                            <td className="py-1.5 px-2.5 font-mono text-muted whitespace-nowrap">
                              {formatDate(inv.date)}
                            </td>
                            <td className="py-1.5 px-2.5 font-bold text-ink truncate max-w-[150px]">
                              {inv.party_name}
                            </td>
                            <td className="py-1.5 px-2.5 text-right font-mono text-ink">
                              {formatCurrency(inv.taxable)}
                            </td>
                            <td className="py-1.5 px-2.5 text-right font-mono text-emerald-700">
                              {formatCurrency(inv.gst)}
                            </td>
                            <td className="py-1.5 px-2.5 text-right font-mono font-bold text-ink">
                              {formatCurrency(inv.total)}
                            </td>
                            <td className="py-1.5 px-2.5 text-right font-mono text-slate-700">
                              {formatCurrency(inv.cost)}
                            </td>
                            <td className="py-1.5 px-2.5 text-right font-mono font-bold text-emerald-700">
                              {formatCurrency(inv.profit)}
                            </td>
                            <td className="py-1.5 px-2.5 text-center whitespace-nowrap">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  inv.printed_mode === "WITH_GST"
                                    ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                    : inv.printed_mode === "WITHOUT_GST"
                                    ? "bg-amber-100 text-amber-800 border border-amber-300"
                                    : "bg-slate-100 text-slate-700 border border-slate-300"
                                }`}
                              >
                                {inv.printed_mode || "NOT_PRINTED"}
                              </span>
                            </td>
                            <td className="py-1.5 px-3 text-right font-mono text-muted text-[11px] whitespace-nowrap">
                              {inv.last_printed_time ? inv.last_printed_time.replace("T", " ").slice(0, 19) : "-"}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={10} className="py-8 text-center text-muted">
                            {lang === "hi" ? "कोई बिल नहीं मिला" : "No invoices found"}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Modal Footer */}
                <div className="p-2.5 border-t border-border bg-paper/60 flex items-center justify-between flex-shrink-0">
                  <span className="text-xs text-muted">
                    {lang === "hi" ? "कुल बिल राशि:" : "Total Amount:"}{" "}
                    <span className="font-bold font-mono text-ink">
                      {formatCurrency(drillDownGroup.bill_total)}
                    </span>
                    {" | "}
                    {lang === "hi" ? "कुल लाभ:" : "Total Profit:"}{" "}
                    <span className="font-bold font-mono text-emerald-700">
                      {formatCurrency(drillDownGroup.profit)}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setDrillDownGroup(null)}
                    className="px-3 py-1 bg-surface border border-border hover:bg-forest/10 rounded-lg text-xs font-bold text-ink"
                  >
                    {lang === "hi" ? "बंद करें" : "Close"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          REPORT 2: Item-wise which parties
          ========================================================================= */}
      {activeTab === "item_parties" && (
        <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
          {/* Item Selector & Direction Ribbon */}
          <div className="bg-surface border border-border rounded-panel p-2.5 px-3 flex flex-wrap items-center justify-between gap-3 shadow-2xs flex-shrink-0">
            <div className="flex items-center gap-2 flex-1 min-w-[260px] max-w-md">
              <span className="text-xs font-bold text-muted whitespace-nowrap">
                {lang === "hi" ? "मद (सामान):" : "Item:"}
              </span>
              <div className="flex-1">
                <SearchableSelect
                  options={itemOptions}
                  value={selectedItemId?.toString() || ""}
                  onChange={(val) => setSelectedItemId(Number(val))}
                  placeholder={lang === "hi" ? "सामान चुनें या खोजें..." : "Select or search item..."}
                />
              </div>
            </div>

            {itemPartiesReport && (
              <div className="flex items-center gap-4 text-xs font-bold text-ink">
                <span>
                  {lang === "hi" ? "कुल पार्टियां:" : "Total Parties:"}{" "}
                  <span className="font-mono text-indigo-700">{itemPartiesReport.parties.length}</span>
                </span>
                <span>
                  {lang === "hi" ? "कुल मात्रा:" : "Total Qty:"}{" "}
                  <span className="font-mono text-blue-700">
                    {(
                      itemPartiesReport.parties.reduce((acc, p) => acc + p.total_qty, 0) / 1000
                    ).toFixed(2)}{" "}
                    {itemPartiesReport.base_unit || ""}
                  </span>
                </span>
                <span>
                  {lang === "hi"
                    ? itemDirection === "purchased" ? "कर योग्य खरीदी:" : "कर योग्य बिक्री:"
                    : itemDirection === "purchased" ? "Taxable Purchase:" : "Taxable Sales:"}{" "}
                  <span className="font-mono text-ink">
                    {formatCurrency(
                      itemPartiesReport.parties.reduce((acc, p) => acc + (p.total_taxable ?? p.total_amount), 0)
                    )}
                  </span>
                </span>
                <span>
                  {lang === "hi" ? "कुल राशि (GST सहित):" : "Total (incl. GST):"}{" "}
                  <span className="font-mono text-emerald-700">
                    {formatCurrency(
                      itemPartiesReport.parties.reduce((acc, p) => acc + p.total_amount, 0)
                    )}
                  </span>
                </span>
              </div>
            )}
          </div>

          {/* Parties Table */}
          <div className="flex-1 min-h-0 bg-surface border border-border rounded-panel flex flex-col overflow-hidden shadow-2xs">
            <div className="p-2.5 border-b border-border/80 flex items-center justify-between bg-paper/40 flex-shrink-0">
              <span className="text-xs font-bold text-ink">
                {itemPartiesReport?.item_name || (lang === "hi" ? "सामान" : "Item")} —{" "}
                {itemDirection === "purchased" ? t.reports.directionPurchasedFrom : t.reports.directionSoldTo} (
                {sortedItemParties.length})
              </span>
              <span className="text-[11px] text-muted">
                {lang === "hi"
                  ? "कॉलम शीर्ष पर क्लिक करके क्रम बदलें (Sort)। रो पर क्लिक करके बिल देखें।"
                  : "Click header to sort. Click row to expand bills."}
              </span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto" data-scroll="true">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-paper sticky top-0 border-b border-border text-muted font-bold z-10">
                  <tr>
                    <th className="w-8 py-2 px-2 text-center">#</th>
                    <th
                      onClick={() => handleSort("party_name")}
                      className="py-2 px-3 cursor-pointer hover:text-ink select-none"
                    >
                      {lang === "hi" ? "पार्टी का नाम" : "Party Name"} {sortField === "party_name" && (sortAsc ? "▲" : "▼")}
                    </th>
                    <th
                      onClick={() => handleSort("bills_count")}
                      className="w-14 py-2 px-2 text-center cursor-pointer hover:text-ink select-none"
                    >
                      {lang === "hi" ? "बिल" : "Bills"} {sortField === "bills_count" && (sortAsc ? "▲" : "▼")}
                    </th>
                    <th
                      onClick={() => handleSort("total_qty")}
                      className="w-24 py-2 px-2 text-right cursor-pointer hover:text-ink select-none"
                    >
                      {lang === "hi" ? "कुल मात्रा" : "Total Qty"} {sortField === "total_qty" && (sortAsc ? "▲" : "▼")}
                    </th>
                    <th
                      onClick={() => handleSort("total_taxable")}
                      className="w-24 py-2 px-2 text-right cursor-pointer hover:text-ink select-none"
                    >
                      {lang === "hi" ? "कर योग्य (₹)" : "Taxable (₹)"} {sortField === "total_taxable" && (sortAsc ? "▲" : "▼")}
                    </th>
                    <th
                      onClick={() => handleSort("total_amount")}
                      className="w-28 py-2 px-2.5 text-right cursor-pointer hover:text-ink select-none"
                    >
                      {lang === "hi" ? "कुल (GST सहित) (₹)" : "Total (incl. GST) (₹)"} {sortField === "total_amount" && (sortAsc ? "▲" : "▼")}
                    </th>
                    <th className="w-24 py-2 px-2 text-right">
                      {lang === "hi" ? `न्यूनतम दर (₹/${itemPartiesReport?.base_unit || "यूनिट"})` : `Min Rate (₹/${itemPartiesReport?.base_unit || "unit"})`}
                    </th>
                    <th className="w-24 py-2 px-2 text-right">
                      {lang === "hi" ? `अधिकतम दर (₹/${itemPartiesReport?.base_unit || "यूनिट"})` : `Max Rate (₹/${itemPartiesReport?.base_unit || "unit"})`}
                    </th>
                    <th className="w-24 py-2 px-2 text-right">
                      {lang === "hi" ? `औसत दर (₹/${itemPartiesReport?.base_unit || "यूनिट"})` : `Avg Rate (₹/${itemPartiesReport?.base_unit || "unit"})`}
                    </th>
                    <th className="w-24 py-2 px-2 text-right">
                      {lang === "hi" ? `अंतिम दर (₹/${itemPartiesReport?.base_unit || "यूनिट"})` : `Last Rate (₹/${itemPartiesReport?.base_unit || "unit"})`}
                    </th>
                    <th
                      onClick={() => handleSort("last_date")}
                      className="w-24 py-2 px-3 text-right cursor-pointer hover:text-ink select-none"
                    >
                      {lang === "hi" ? "अंतिम तारीख" : "Last Date"} {sortField === "last_date" && (sortAsc ? "▲" : "▼")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {sortedItemParties.length > 0 ? (
                    sortedItemParties.map((p) => {
                      const isExpanded = expandedParties.has(p.party_id);
                      return (
                        <tr key={p.party_id} className="hover:bg-indigo-50/40 transition-colors">
                          <td colSpan={11} className="p-0">
                            <div
                              onClick={() => togglePartyExpand(p.party_id)}
                              className="flex items-center w-full py-2 cursor-pointer hover:bg-indigo-50/50"
                            >
                              <div className="w-8 text-center text-muted flex-shrink-0">
                                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              </div>
                              <div className="flex-1 font-bold text-ink px-3 truncate">
                                {p.party_name}
                              </div>
                              <div className="w-14 text-center font-mono font-bold text-ink px-2 flex-shrink-0">
                                {p.bills_count}
                              </div>
                              <div className="w-24 text-right font-mono text-ink px-2 flex-shrink-0">
                                {(p.total_qty / 1000).toFixed(2)} {p.unit}
                              </div>
                              <div className="w-24 text-right font-mono text-ink px-2 flex-shrink-0">
                                {formatCurrency(p.total_taxable ?? p.total_amount)}
                              </div>
                              <div className="w-28 text-right font-mono font-bold text-emerald-700 px-2.5 flex-shrink-0">
                                {formatCurrency(p.total_amount)}
                              </div>
                              <div className="w-24 text-right font-mono text-muted px-2 flex-shrink-0" title={`प्रति ${p.unit}`}>
                                {(p.min_rate / 100).toFixed(2)}/{p.unit}
                              </div>
                              <div className="w-24 text-right font-mono text-muted px-2 flex-shrink-0" title={`प्रति ${p.unit}`}>
                                {(p.max_rate / 100).toFixed(2)}/{p.unit}
                              </div>
                              <div className="w-24 text-right font-mono text-muted px-2 flex-shrink-0" title={`प्रति ${p.unit}`}>
                                {(p.average_rate / 100).toFixed(2)}/{p.unit}
                              </div>
                              <div className="w-24 text-right font-mono font-bold text-indigo-700 px-2 flex-shrink-0" title={`प्रति ${p.unit}`}>
                                {(p.last_rate / 100).toFixed(2)}/{p.unit}
                              </div>
                              <div className="w-24 text-right font-mono text-muted px-3 flex-shrink-0 whitespace-nowrap">
                                {formatDate(p.last_date)}
                              </div>
                            </div>

                            {/* Expanded Bills Sub-table */}
                            {isExpanded && (
                              <div className="p-2.5 pl-8 bg-paper/70 border-t border-border/60">
                                <div className="border border-border rounded-lg bg-surface overflow-hidden shadow-2xs">
                                  <table className="w-full text-[11px] text-left border-collapse">
                                    <thead className="bg-paper text-muted font-bold border-b border-border">
                                      <tr>
                                        <th className="py-1.5 px-2.5">{lang === "hi" ? "बिल नं" : "Invoice No"}</th>
                                        <th className="py-1.5 px-2">{lang === "hi" ? "तारीख" : "Date"}</th>
                                        <th className="py-1.5 px-2 text-right">{lang === "hi" ? "मात्रा" : "Qty"}</th>
                                        <th className="py-1.5 px-2 text-right">{lang === "hi" ? `दर (₹/${p.unit})` : `Rate (₹/${p.unit})`}</th>
                                        <th className="py-1.5 px-2 text-right">{lang === "hi" ? "कर योग्य (₹)" : "Taxable (₹)"}</th>
                                        <th className="py-1.5 px-2 text-right">{lang === "hi" ? "टैक्स (₹)" : "GST (₹)"}</th>
                                        <th className="py-1.5 px-2.5 text-right">{lang === "hi" ? "कुल (GST सहित) (₹)" : "Total (incl. GST) (₹)"}</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/60">
                                      {p.bills.map((b) => (
                                        <tr key={b.invoice_no} className="hover:bg-paper/30">
                                          <td className="py-1.5 px-2.5 font-mono font-bold text-ink">
                                            {b.invoice_no}
                                          </td>
                                          <td className="py-1.5 px-2 font-mono text-muted">
                                            {formatDate(b.date)}
                                          </td>
                                          <td className="py-1.5 px-2 text-right font-mono">
                                            {(b.qty / 1000).toFixed(2)} {b.unit}
                                          </td>
                                          <td className="py-1.5 px-2 text-right font-mono">
                                            {(b.rate / 100).toFixed(2)}/{b.unit}
                                          </td>
                                          <td className="py-1.5 px-2 text-right font-mono">
                                            {formatCurrency(b.taxable)}
                                          </td>
                                          <td className="py-1.5 px-2 text-right font-mono text-emerald-700">
                                            {formatCurrency(b.tax_amount)}
                                          </td>
                                          <td className="py-1.5 px-2.5 text-right font-mono font-bold text-ink">
                                            {formatCurrency(b.total_amount)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-muted">
                        {loading
                          ? lang === "hi"
                            ? "डेटा लोड हो रहा है..."
                            : "Loading data..."
                          : lang === "hi"
                          ? "इस मद के लिए कोई रिकॉर्ड नहीं मिला"
                          : "No records found for this item"}
                      </td>
                    </tr>
                  )}
                </tbody>
                {sortedItemParties.length > 0 && (
                  <tfoot className="bg-paper font-bold border-t-2 border-border text-ink">
                    <tr>
                      <td className="py-2.5 px-2"></td>
                      <td className="py-2.5 px-3">{lang === "hi" ? "कुल योग" : "Total"}</td>
                      <td className="py-2.5 px-2 text-center font-mono">
                        {sortedItemParties.reduce((acc, p) => acc + p.bills_count, 0)}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono">
                        {(
                          sortedItemParties.reduce((acc, p) => acc + p.total_qty, 0) / 1000
                        ).toFixed(2)}{" "}
                        {itemPartiesReport?.base_unit || ""}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono">
                        {formatCurrency(
                          sortedItemParties.reduce((acc, p) => acc + (p.total_taxable ?? p.total_amount), 0)
                        )}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono text-emerald-700">
                        {formatCurrency(
                          sortedItemParties.reduce((acc, p) => acc + p.total_amount, 0)
                        )}
                      </td>
                      <td colSpan={5} className="py-2.5 px-3"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          REPORT 3: Party-wise which items
          ========================================================================= */}
      {activeTab === "party_items" && (
        <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
          {/* Party Selector & Direction Ribbon */}
          <div className="bg-surface border border-border rounded-panel p-2.5 px-3 flex flex-wrap items-center justify-between gap-3 shadow-2xs flex-shrink-0">
            <div className="flex items-center gap-2 flex-1 min-w-[260px] max-w-md">
              <span className="text-xs font-bold text-muted whitespace-nowrap">
                {lang === "hi" ? "पार्टी:" : "Party:"}
              </span>
              <div className="flex-1">
                <SearchableSelect
                  options={partyOptions}
                  value={selectedPartyId?.toString() || ""}
                  onChange={(val) => setSelectedPartyId(Number(val))}
                  placeholder={lang === "hi" ? "पार्टी चुनें या खोजें..." : "Select or search party..."}
                />
              </div>
            </div>

            {partyItemsReport && (
              <div className="flex items-center gap-4 text-xs font-bold text-ink">
                <span>
                  {lang === "hi" ? "कुल मदें:" : "Total Items:"}{" "}
                  <span className="font-mono text-indigo-700">{partyItemsReport.items.length}</span>
                </span>
                <span>
                  {lang === "hi" ? "कुल बिल संख्या:" : "Total Bills:"}{" "}
                  <span className="font-mono text-blue-700">
                    {partyItemsReport.items.reduce((acc, it) => acc + it.bills_count, 0)}
                  </span>
                </span>
                <span>
                  {lang === "hi" ? "कर योग्य राशि:" : "Taxable Amount:"}{" "}
                  <span className="font-mono text-ink">
                    {formatCurrency(
                      partyItemsReport.items.reduce((acc, it) => acc + (it.total_taxable ?? it.total_amount), 0)
                    )}
                  </span>
                </span>
                <span>
                  {lang === "hi" ? "कुल राशि (GST सहित):" : "Total (incl. GST):"}{" "}
                  <span className="font-mono text-emerald-700">
                    {formatCurrency(
                      partyItemsReport.items.reduce((acc, it) => acc + it.total_amount, 0)
                    )}
                  </span>
                </span>
              </div>
            )}
          </div>

          {/* Items Table */}
          <div className="flex-1 min-h-0 bg-surface border border-border rounded-panel flex flex-col overflow-hidden shadow-2xs">
            <div className="p-2.5 border-b border-border/80 flex items-center justify-between bg-paper/40 flex-shrink-0">
              <span className="text-xs font-bold text-ink">
                {partyItemsReport?.party_name || (lang === "hi" ? "पार्टी" : "Party")} —{" "}
                {partyDirection === "purchased" ? t.reports.directionPurchasedFromParty : t.reports.directionSoldToParty} (
                {sortedPartyItems.length})
              </span>
              <span className="text-[11px] text-muted">
                {lang === "hi"
                  ? "कॉलम शीर्ष पर क्लिक करके क्रम बदलें (Sort)। रो पर क्लिक करके बिल देखें।"
                  : "Click header to sort. Click row to expand bills."}
              </span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto" data-scroll="true">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-paper sticky top-0 border-b border-border text-muted font-bold z-10">
                  <tr>
                    <th className="w-8 py-2 px-2 text-center">#</th>
                    <th
                      onClick={() => handleSort("item_name")}
                      className="py-2 px-3 cursor-pointer hover:text-ink select-none"
                    >
                      {lang === "hi" ? "सामान का नाम" : "Item Name"} {sortField === "item_name" && (sortAsc ? "▲" : "▼")}
                    </th>
                    <th
                      onClick={() => handleSort("bills_count")}
                      className="w-14 py-2 px-2 text-center cursor-pointer hover:text-ink select-none"
                    >
                      {lang === "hi" ? "बिल" : "Bills"} {sortField === "bills_count" && (sortAsc ? "▲" : "▼")}
                    </th>
                    <th
                      onClick={() => handleSort("total_qty")}
                      className="w-24 py-2 px-2 text-right cursor-pointer hover:text-ink select-none"
                    >
                      {lang === "hi" ? "कुल मात्रा" : "Total Qty"} {sortField === "total_qty" && (sortAsc ? "▲" : "▼")}
                    </th>
                    <th
                      onClick={() => handleSort("total_taxable")}
                      className="w-24 py-2 px-2 text-right cursor-pointer hover:text-ink select-none"
                    >
                      {lang === "hi" ? "कर योग्य (₹)" : "Taxable (₹)"} {sortField === "total_taxable" && (sortAsc ? "▲" : "▼")}
                    </th>
                    <th
                      onClick={() => handleSort("total_amount")}
                      className="w-28 py-2 px-2.5 text-right cursor-pointer hover:text-ink select-none"
                    >
                      {lang === "hi" ? "कुल (GST सहित) (₹)" : "Total (incl. GST) (₹)"} {sortField === "total_amount" && (sortAsc ? "▲" : "▼")}
                    </th>
                    <th className="w-24 py-2 px-2 text-right">{lang === "hi" ? "न्यूनतम दर (₹/यूनिट)" : "Min Rate (₹/unit)"}</th>
                    <th className="w-24 py-2 px-2 text-right">{lang === "hi" ? "अधिकतम दर (₹/यूनिट)" : "Max Rate (₹/unit)"}</th>
                    <th className="w-24 py-2 px-2 text-right">{lang === "hi" ? "औसत दर (₹/यूनिट)" : "Avg Rate (₹/unit)"}</th>
                    <th className="w-24 py-2 px-2 text-right">{lang === "hi" ? "अंतिम दर (₹/यूनिट)" : "Last Rate (₹/unit)"}</th>
                    <th
                      onClick={() => handleSort("last_date")}
                      className="w-24 py-2 px-3 text-right cursor-pointer hover:text-ink select-none"
                    >
                      {lang === "hi" ? "अंतिम तारीख" : "Last Date"} {sortField === "last_date" && (sortAsc ? "▲" : "▼")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {sortedPartyItems.length > 0 ? (
                    sortedPartyItems.map((it) => {
                      const isExpanded = expandedItems.has(it.item_id);
                      return (
                        <tr key={it.item_id} className="hover:bg-indigo-50/40 transition-colors">
                          <td colSpan={11} className="p-0">
                            <div
                              onClick={() => toggleItemExpand(it.item_id)}
                              className="flex items-center w-full py-2 cursor-pointer hover:bg-indigo-50/50"
                            >
                              <div className="w-8 text-center text-muted flex-shrink-0">
                                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              </div>
                              <div className="flex-1 font-bold text-ink px-3 truncate">
                                {it.item_name}
                              </div>
                              <div className="w-14 text-center font-mono font-bold text-ink px-2 flex-shrink-0">
                                {it.bills_count}
                              </div>
                              <div className="w-24 text-right font-mono text-ink px-2 flex-shrink-0">
                                {(it.total_qty / 1000).toFixed(2)} {it.base_unit}
                              </div>
                              <div className="w-24 text-right font-mono text-ink px-2 flex-shrink-0">
                                {formatCurrency(it.total_taxable ?? it.total_amount)}
                              </div>
                              <div className="w-28 text-right font-mono font-bold text-emerald-700 px-2.5 flex-shrink-0">
                                {formatCurrency(it.total_amount)}
                              </div>
                              <div className="w-24 text-right font-mono text-muted px-2 flex-shrink-0" title={`प्रति ${it.base_unit}`}>
                                {(it.min_rate / 100).toFixed(2)}/{it.base_unit}
                              </div>
                              <div className="w-24 text-right font-mono text-muted px-2 flex-shrink-0" title={`प्रति ${it.base_unit}`}>
                                {(it.max_rate / 100).toFixed(2)}/{it.base_unit}
                              </div>
                              <div className="w-24 text-right font-mono text-muted px-2 flex-shrink-0" title={`प्रति ${it.base_unit}`}>
                                {(it.average_rate / 100).toFixed(2)}/{it.base_unit}
                              </div>
                              <div className="w-24 text-right font-mono font-bold text-indigo-700 px-2 flex-shrink-0" title={`प्रति ${it.base_unit}`}>
                                {(it.last_rate / 100).toFixed(2)}/{it.base_unit}
                              </div>
                              <div className="w-24 text-right font-mono text-muted px-3 flex-shrink-0 whitespace-nowrap">
                                {formatDate(it.last_date)}
                              </div>
                            </div>

                            {/* Expanded Bills Sub-table */}
                            {isExpanded && (
                              <div className="p-2.5 pl-8 bg-paper/70 border-t border-border/60">
                                <div className="border border-border rounded-lg bg-surface overflow-hidden shadow-2xs">
                                  <table className="w-full text-[11px] text-left border-collapse">
                                    <thead className="bg-paper text-muted font-bold border-b border-border">
                                      <tr>
                                        <th className="py-1.5 px-2.5">{lang === "hi" ? "बिल नं" : "Invoice No"}</th>
                                        <th className="py-1.5 px-2">{lang === "hi" ? "तारीख" : "Date"}</th>
                                        <th className="py-1.5 px-2 text-right">{lang === "hi" ? "मात्रा" : "Qty"}</th>
                                        <th className="py-1.5 px-2 text-right">{lang === "hi" ? `दर (₹/${it.base_unit})` : `Rate (₹/${it.base_unit})`}</th>
                                        <th className="py-1.5 px-2 text-right">{lang === "hi" ? "कर योग्य (₹)" : "Taxable (₹)"}</th>
                                        <th className="py-1.5 px-2 text-right">{lang === "hi" ? "टैक्स (₹)" : "GST (₹)"}</th>
                                        <th className="py-1.5 px-2.5 text-right">{lang === "hi" ? "कुल (GST सहित) (₹)" : "Total (incl. GST) (₹)"}</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/60">
                                      {it.bills.map((b) => (
                                        <tr key={b.invoice_no} className="hover:bg-paper/30">
                                          <td className="py-1.5 px-2.5 font-mono font-bold text-ink">
                                            {b.invoice_no}
                                          </td>
                                          <td className="py-1.5 px-2 font-mono text-muted">
                                            {formatDate(b.date)}
                                          </td>
                                          <td className="py-1.5 px-2 text-right font-mono">
                                            {(b.qty / 1000).toFixed(2)} {b.unit}
                                          </td>
                                          <td className="py-1.5 px-2 text-right font-mono">
                                            {(b.rate / 100).toFixed(2)}/{b.unit}
                                          </td>
                                          <td className="py-1.5 px-2 text-right font-mono">
                                            {formatCurrency(b.taxable)}
                                          </td>
                                          <td className="py-1.5 px-2 text-right font-mono text-emerald-700">
                                            {formatCurrency(b.tax_amount)}
                                          </td>
                                          <td className="py-1.5 px-2.5 text-right font-mono font-bold text-ink">
                                            {formatCurrency(b.total_amount)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-muted">
                        {loading
                          ? lang === "hi"
                            ? "डेटा लोड हो रहा है..."
                            : "Loading data..."
                          : lang === "hi"
                          ? "इस पार्टी के लिए कोई रिकॉर्ड नहीं मिला"
                          : "No records found for this party"}
                      </td>
                    </tr>
                  )}
                </tbody>
                {sortedPartyItems.length > 0 && (
                  <tfoot className="bg-paper font-bold border-t-2 border-border text-ink">
                    <tr>
                      <td className="py-2.5 px-2"></td>
                      <td className="py-2.5 px-3">{lang === "hi" ? "कुल योग" : "Total"}</td>
                      <td className="py-2.5 px-2 text-center font-mono">
                        {sortedPartyItems.reduce((acc, it) => acc + it.bills_count, 0)}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono">-</td>
                      <td className="py-2.5 px-2 text-right font-mono">
                        {formatCurrency(
                          sortedPartyItems.reduce((acc, it) => acc + (it.total_taxable ?? it.total_amount), 0)
                        )}
                      </td>
                      <td className="py-2.5 px-2.5 text-right font-mono text-emerald-700">
                        {formatCurrency(
                          sortedPartyItems.reduce((acc, it) => acc + it.total_amount, 0)
                        )}
                      </td>
                      <td colSpan={5} className="py-2.5 px-3"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          ORIGINAL 5 TABS: sales_reg, purchase_reg, gst_summary, hsn_summary, profit_report
          ========================================================================= */}
      {activeTab !== "sales_gst_mode" &&
        activeTab !== "item_parties" &&
        activeTab !== "party_items" && (
          <>
            {/* 3. KPI Strip: 4 Vibrant Cards with Light Gradient */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-shrink-0">
              <div className="bg-gradient-to-br from-indigo-50/90 to-indigo-100/50 border border-indigo-200/90 rounded-panel p-2.5 shadow-2xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-900 block">
                  {lang === "hi" ? "कुल बिल राशि" : "Total Amount"}
                </span>
                <div className="text-xl sm:text-2xl font-serif font-bold text-indigo-950 num-tabular mt-0.5">
                  {formatCurrency(currentTotal)}
                </div>
              </div>

              <div className="bg-gradient-to-br from-blue-50/90 to-blue-100/50 border border-blue-200/90 rounded-panel p-2.5 shadow-2xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-900 block">
                  {lang === "hi" ? "कर योग्य मूल्य" : "Taxable Value"}
                </span>
                <div className="text-xl sm:text-2xl font-serif font-bold text-blue-950 num-tabular mt-0.5">
                  {formatCurrency(currentTaxable)}
                </div>
              </div>

              <div className="bg-gradient-to-br from-emerald-50/90 to-emerald-100/50 border border-emerald-200/90 rounded-panel p-2.5 shadow-2xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-900 block">
                  {lang === "hi" ? "कुल जीएसटी (टैक्स)" : "Total GST"}
                </span>
                <div className="text-xl sm:text-2xl font-serif font-bold text-emerald-950 num-tabular mt-0.5">
                  {formatCurrency(currentTax)}
                </div>
              </div>

              <div className="bg-gradient-to-br from-amber-50/90 to-amber-100/50 border border-amber-200/90 rounded-panel p-2.5 shadow-2xs">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900 block">
                  {lang === "hi" ? "कुल प्रविष्टियां" : "Total Entries"}
                </span>
                <div className="text-xl sm:text-2xl font-serif font-bold text-amber-950 num-tabular mt-0.5">
                  {activeDataEntries.length} {lang === "hi" ? "बिल / मद" : "entries"}
                </div>
              </div>
            </div>

            {/* 4. Lower Area: Left Chart + Right Paginated Table */}
            <div className="grid grid-cols-12 gap-2.5 flex-1 min-h-0 overflow-hidden">
              {/* Left Column: Visual Summary Chart (col-span-4) */}
              <div
                className="col-span-12 lg:col-span-4 bg-surface border border-border rounded-panel p-3 flex flex-col justify-between overflow-y-auto shadow-2xs"
                data-scroll="true"
              >
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
                            width: `${
                              currentTotal > 0 ? Math.min(100, (currentTaxable / currentTotal) * 100) : 0
                            }%`,
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
                            width: `${
                              currentTotal > 0 ? Math.min(100, (currentTax / currentTotal) * 100) : 0
                            }%`,
                          }}
                          className="h-full bg-emerald-600 rounded-full"
                        />
                      </div>
                    </div>

                    <div className="p-2.5 bg-paper rounded-xl border border-border/70 text-center">
                      <span className="text-[10px] font-bold text-muted uppercase block">
                        औसत बिल राशि
                      </span>
                      <span className="text-lg font-serif font-bold text-indigo-950 font-mono">
                        {formatCurrency(
                          activeDataEntries.length > 0
                            ? Math.round(currentTotal / activeDataEntries.length)
                            : 0
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="text-[10px] text-muted text-center border-t border-border/60 pt-1.5 flex-shrink-0">
                  {fromDate} से {toDate} का रिकॉर्ड
                </div>
              </div>

              {/* Right Column: Table with Search & Pagination */}
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

                {/* Table Body */}
                <div className="flex-1 min-h-0 overflow-y-auto" data-scroll="true">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead className="bg-paper sticky top-0 border-b border-border text-muted font-bold z-10">
                      <tr>
                        <th className="py-2 px-2.5">तारीख / नं</th>
                        <th className="py-2 px-2">पार्टी / सामान</th>
                        <th className="py-2 px-2 text-right">कर योग्य</th>
                        {withGst && <th className="py-2 px-2 text-right">टैक्स</th>}
                        <th className="py-2 px-2.5 text-right">कुल रकम</th>
                        <th className="py-2 px-2 text-center">माध्यम / प्रिंट</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {paginatedEntries.length > 0 ? (
                        paginatedEntries.map((row, idx) => {
                          const rowDate = row.date ? formatDate(row.date) : row.hsn || "-";
                          const rowName = row.party_name || row.item_name || row.rate_label || "-";
                          const rowTaxable =
                            row.taxable ?? row.taxable_value ?? row.taxable_sale ?? 0;
                          const rowTax =
                            (row.cgst || 0) + (row.sgst || 0) + (row.igst || 0) ||
                            row.total_tax ||
                            0;
                          const rowTotal =
                            row.total_amount ??
                            row.total_value ??
                            row.gross_sale ??
                            rowTaxable + rowTax;

                          return (
                            <tr key={idx} className="hover:bg-paper/40 transition-colors">
                              <td className="py-1.5 px-2.5 font-mono text-muted whitespace-nowrap">
                                <span className="font-bold text-ink block">
                                  {row.invoice_no || rowDate}
                                </span>
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
                              <td className="py-1.5 px-2 text-center whitespace-nowrap">
                                <div className="flex items-center justify-center gap-1.5">
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                      row.payment_mode === "credit"
                                        ? "bg-amber-100 text-amber-800 border border-amber-300"
                                        : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                    }`}
                                  >
                                    {row.payment_mode === "credit" ? "उधार" : "नकद"}
                                  </span>
                                  {row.invoice_no && (
                                    <div className="inline-flex items-center gap-1">
                                      {(activeTab === "sales_reg" || activeTab === "purchase_reg") && (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setSelectedInvoiceForEdit({
                                                no: row.invoice_no,
                                                type: activeTab === "sales_reg" ? "sale" : "purchase",
                                              });
                                              setEditInvoiceNoModalOpen(true);
                                            }}
                                            title={activeTab === "sales_reg" ? "बिल नंबर बदलें (Change invoice no)" : "सप्लायर बिल नंबर संपादित करें (Edit supplier invoice no)"}
                                            className="px-1.5 py-0.5 bg-forest/10 hover:bg-forest/20 text-forest rounded text-[10px] font-bold border border-forest/30 shadow-2xs transition-transform active:scale-95"
                                          >
                                            ✏️ नं
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setAuditEntity({
                                                type: activeTab === "sales_reg" ? "sale" : "purchase",
                                                id: row.invoice_no,
                                              });
                                              setIsAuditModalOpen(true);
                                            }}
                                            title="ऑडिट इतिहास (Alteration History)"
                                            className="px-1.5 py-0.5 bg-paper hover:bg-border text-muted rounded text-[10px] font-bold border border-border shadow-2xs transition-transform active:scale-95"
                                          >
                                            🕒
                                          </button>
                                        </>
                                      )}
                                      {onPrintInvoice && (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => onPrintInvoice(row.invoice_no, "with_tax")}
                                            title="टैक्स सहित प्रिंट (GST Invoice)"
                                            className="px-1.5 py-0.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded text-[10px] font-bold shadow-2xs transition-transform active:scale-95"
                                          >
                                            🧾 GST
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => onPrintInvoice(row.invoice_no, "without_tax")}
                                            title="बिना टैक्स प्रिंट (सरल बिल)"
                                            className="px-1.5 py-0.5 bg-amber-700 hover:bg-amber-800 text-white rounded text-[10px] font-bold shadow-2xs transition-transform active:scale-95"
                                          >
                                            📄 सरल
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
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
          </>
        )}

      {/* Edit Invoice No Modal */}
      {selectedInvoiceForEdit && (
        <EditInvoiceNoModal
          isOpen={editInvoiceNoModalOpen}
          onClose={() => {
            setEditInvoiceNoModalOpen(false);
            setSelectedInvoiceForEdit(null);
          }}
          onSuccess={() => {
            fetchReportData();
          }}
          billType={selectedInvoiceForEdit.type}
          currentInvoiceNo={selectedInvoiceForEdit.no}
          supplierInvoiceDate={selectedInvoiceForEdit.suppDate}
          lang={lang}
        />
      )}

      {/* Alteration History Modal */}
      {auditEntity && (
        <AlterationHistoryModal
          isOpen={isAuditModalOpen}
          onClose={() => {
            setIsAuditModalOpen(false);
            setAuditEntity(null);
          }}
          entityType={auditEntity.type}
          entityId={auditEntity.id}
          lang={lang}
        />
      )}
    </div>
  );
}
