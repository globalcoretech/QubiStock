import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, Item, Godown, Party, Feedback, LastRates, SearchableOption } from "../types";
import { Translations, Language } from "../i18n";
import { formatCurrency } from "../utils/formatters";
import { formatBillNumber } from "../utils/billNumber";
import { localTodayIso } from "../utils/dateUtils";
import { SearchableSelect } from "../components/SearchableSelect";
import { FeedbackBanner } from "../components/FeedbackBanner";
import { AddPartyModal } from "../components/AddPartyModal";
import { Pagination } from "../components/Pagination";
import {
  DuotoneReceipt,
  DuotoneTruck,
  Plus,
  Trash2,
  Printer,
  X,
  AlertCircle,
  Search,
} from "../components/icons";

interface TransactionViewProps {
  type: "purchase" | "sale";
  settings?: AppSettings;
  refreshTrigger: number;
  onRefresh?: () => void;
  onPrintInvoice: (invNo: string, taxMode?: "with_tax" | "without_tax") => void;
  t: Translations;
  lang: Language;
  alteringInvoiceNo?: string | null;
  onCancelAlteration?: () => void;
}

export function TransactionView({
  type,
  settings,
  refreshTrigger,
  onRefresh,
  onPrintInvoice,
  t,
  lang,
  alteringInvoiceNo,
  onCancelAlteration,
}: TransactionViewProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [godowns, setGodowns] = useState<Godown[]>([]);
  const [parties, setParties] = useState<Party[]>([]);

  const [date, setDate] = useState(localTodayIso);
  const [invoiceNo, setInvoiceNo] = useState(() => {
    const prefix = type === "purchase" ? "PUR" : settings?.fyPrefix || "KK";
    return formatBillNumber(1, prefix, new Date());
  });

  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState("");
  const [supplierInvoiceDate, setSupplierInvoiceDate] = useState(localTodayIso);
  const [invoiceNoWarning, setInvoiceNoWarning] = useState("");
  const [invoiceNoError, setInvoiceNoError] = useState("");

  const validateSalesInvoiceNo = (val: string) => {
    const trimmed = val.trim();
    if (!trimmed) {
      setInvoiceNoError(lang === "hi" ? "बिल नंबर आवश्यक है" : "Invoice number required");
      setInvoiceNoWarning("");
      return;
    }
    if (trimmed.length > 16) {
      setInvoiceNoError(lang === "hi" ? "अधिकतम 16 अक्षर (Max 16 chars)" : "Max 16 characters");
      setInvoiceNoWarning("");
      return;
    }
    if (!/^[A-Za-z0-9\/\-]+$/.test(trimmed)) {
      setInvoiceNoError(lang === "hi" ? "केवल A-Z, 0-9, '/', '-' मान्य हैं" : "Only A-Z, 0-9, '/', '-' allowed");
      setInvoiceNoWarning("");
      return;
    }
    setInvoiceNoError("");
    const prefix = settings?.fyPrefix || "KK";
    const pattern = new RegExp(`^${prefix}/\\d{2}-\\d{2}/\\d{4,}$`, "i");
    if (!pattern.test(trimmed)) {
      setInvoiceNoWarning(lang === "hi" ? "मानक प्रारूप से अलग है" : "Non-standard format");
    } else {
      setInvoiceNoWarning("");
    }
  };

  const isSale = type === "sale";
  const isBillBlocked =
    isSale &&
    (!settings?.shopName?.trim() || (settings?.isGstRegistered && !settings?.gstin?.trim()));

  const [partyId, setPartyId] = useState("");
  const [godownId, setGodownId] = useState("1");
  const [paymentMode, setPaymentMode] = useState<"cash" | "credit" | "upi_bank">("cash");
  const [paidAmountRupees, setPaidAmountRupees] = useState("");

  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [lastSavedInvoiceNo, setLastSavedInvoiceNo] = useState("");
  const [pendingTaxMode, setPendingTaxMode] = useState<"with_tax" | "without_tax" | "none">("with_tax");
  const [alterationReason, setAlterationReason] = useState("");
  const [isLoadingAlteration, setIsLoadingAlteration] = useState(false);
  const [lines, setLines] = useState<any[]>([
    {
      itemId: "",
      qty: "",
      unit: "kg",
      rate: "",
      gst: 0,
      availableStock: 0,
      lastRates: null,
    },
  ]);

  // Quick item search filter state
  const [quickItemSearch, setQuickItemSearch] = useState("");
  const [isQuickItemDropdownOpen, setIsQuickItemDropdownOpen] = useState(false);
  const [quickSearchPos, setQuickSearchPos] = useState({ top: 0, left: 0, width: 0 });
  const quickSearchInputRef = useRef<HTMLInputElement>(null);
  const quickSearchDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isQuickItemDropdownOpen && quickSearchInputRef.current) {
      const rect = quickSearchInputRef.current.getBoundingClientRect();
      setQuickSearchPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 240),
      });
    }
  }, [isQuickItemDropdownOpen, quickItemSearch]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        quickSearchDropdownRef.current &&
        !quickSearchDropdownRef.current.contains(target) &&
        quickSearchInputRef.current &&
        !quickSearchInputRef.current.contains(target)
      ) {
        setIsQuickItemDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Pagination for lines if lines > 5
  const [linesPage, setLinesPage] = useState(1);
  const LINES_PER_PAGE = 5;

  const [isPartyModalOpen, setIsPartyModalOpen] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);

  const pType = type === "purchase" ? "supplier" : "customer";
  const selectedParty = parties.find((p) => p.id.toString() === partyId);
  const isCompositionSupplier = type === "purchase" && selectedParty?.category === "composition";

  const refreshNextInvoicePreview = async (dateStr: string) => {
    try {
      const prefix = type === "purchase" ? "PUR" : settings?.fyPrefix || "KK";
      const nextNo = await invoke<string>("get_next_bill_number_cmd", {
        billType: type,
        date: dateStr,
        prefix,
      });
      if (nextNo) {
        setInvoiceNo(nextNo);
      }
    } catch (e) {
      console.error("get_next_bill_number_cmd error:", e);
      const prefix = type === "purchase" ? "PUR" : settings?.fyPrefix || "KK";
      setInvoiceNo(formatBillNumber(1, prefix, dateStr));
    }
  };

  useEffect(() => {
    if (!alteringInvoiceNo) {
      refreshNextInvoicePreview(date);
    }
  }, [type, date, settings?.fyPrefix, refreshTrigger, alteringInvoiceNo]);

  // Load existing invoice for alteration
  useEffect(() => {
    if (!alteringInvoiceNo) {
      setAlterationReason("");
      return;
    }
    let isMounted = true;
    setIsLoadingAlteration(true);
    invoke<any>("get_invoice_details_cmd", { invoiceNo: alteringInvoiceNo })
      .then((details) => {
        if (!isMounted) return;
        if (details.invoice_no) setInvoiceNo(details.invoice_no);
        if (details.date) setDate(details.date);
        if (details.party_id) setPartyId(details.party_id.toString());
        if (details.godown_id) setGodownId(details.godown_id.toString());
        if (details.payment_mode) setPaymentMode(details.payment_mode);
        if (typeof details.paid_amount === "number") {
          setPaidAmountRupees((details.paid_amount / 100).toString());
        }
        if (details.supplier_invoice_no) setSupplierInvoiceNo(details.supplier_invoice_no);
        if (details.supplier_invoice_date) setSupplierInvoiceDate(details.supplier_invoice_date);

        if (details.lines && details.lines.length > 0) {
          const loaded = details.lines.map((l: any) => {
            const taxb = (l.taxable || 0) / 100;
            const tax = ((l.cgst || 0) + (l.sgst || 0) + (l.igst || 0)) / 100;
            const gstPct = taxb > 0 ? Math.round((tax * 100) / taxb) : 0;
            return {
              itemId: (l.item_id || "").toString(),
              qty: ((l.qty || 0) / 1000).toString(),
              unit: l.unit || "kg",
              rate: ((l.rate || 0) / 100).toString(),
              gst: gstPct,
              availableStock: 0,
              lastRates: null,
            };
          });
          setLines(loaded);
          const gId = details.godown_id ? details.godown_id.toString() : "1";
          loaded.forEach((l: any, idx: number) => {
            if (l.itemId) {
              fetchLineInfo(idx, l.itemId, gId);
            }
          });
        }
      })
      .catch((err) => {
        console.error("Failed to load invoice details for alteration:", err);
        setFeedback({
          message:
            lang === "hi"
              ? "संशोधन हेतु बिल लोड करने में विफल: " + String(err)
              : "Failed to load invoice for alteration: " + String(err),
          isError: true,
        });
      })
      .finally(() => {
        if (isMounted) setIsLoadingAlteration(false);
      });

    return () => {
      isMounted = false;
    };
  }, [alteringInvoiceNo]);

  const loadAllData = async () => {
    try {
      const itRes = await invoke<Item[]>("get_items_cmd", { includeInactive: false });
      setItems(itRes);
    } catch (e) {
      console.error("get_items_cmd error:", e);
    }

    try {
      const gdRes = await invoke<Godown[]>("get_godowns_cmd");
      setGodowns(gdRes);
      if (gdRes.length > 0 && (!godownId || godownId === "1")) {
        setGodownId(gdRes[0].id.toString());
      }
    } catch (e) {
      console.error("get_godowns_cmd error:", e);
    }

    try {
      const ptRes = await invoke<Party[]>("get_parties_cmd", { partyType: pType });
      const validParties =
        type === "purchase"
          ? ptRes.filter((p) => p.id !== 1 && !p.name.toLowerCase().includes("walk-in"))
          : ptRes;
      setParties(validParties);
      // Auto-prefill default walk-in cash party for sale ONLY
      if (!partyId) {
        if (type === "sale" && validParties.length > 0) {
          const walkin = validParties.find((p) => p.id === 1) || validParties[0];
          setPartyId(walkin.id.toString());
        } else {
          setPartyId("");
        }
      }
    } catch (e) {
      console.error("get_parties_cmd error:", e);
    }
  };

  useEffect(() => {
    loadAllData();
  }, [type, refreshTrigger]);



  const addLine = (prefillItemId?: string) => {
    const targetItem = prefillItemId ? items.find((i) => i.id.toString() === prefillItemId) : null;
    const newIdx = lines.length;

    setLines((prev) => [
      ...prev,
      {
        itemId: prefillItemId || "",
        qty: "",
        unit: targetItem?.base_unit || "kg",
        rate: "",
        gst: isCompositionSupplier ? 0 : targetItem?.gst_rate ? targetItem.gst_rate / 1000 : 0,
        availableStock: 0,
        lastRates: null,
      },
    ]);

    if (prefillItemId) {
      fetchLineInfo(newIdx, prefillItemId, godownId);
    }

    // Adjust linesPage to view the newly added line
    const targetPage = Math.ceil((lines.length + 1) / LINES_PER_PAGE);
    setLinesPage(targetPage);
  };

  const fetchLineInfo = async (idx: number, itemIdVal: string, gIdVal: string) => {
    if (!itemIdVal || !gIdVal) return;
    try {
      const itId = parseInt(itemIdVal);
      const gdId = parseInt(gIdVal);

      const [stockMilli, rates] = await Promise.all([
        invoke<number>("get_available_stock_cmd", { itemId: itId, godownId: gdId }),
        invoke<LastRates>("get_last_rates_cmd", { itemId: itId }),
      ]);

      setLines((prev) => {
        const newL = [...prev];
        if (newL[idx]) {
          newL[idx].availableStock = stockMilli;
          newL[idx].lastRates = rates;
          if (!newL[idx].rate) {
            if (type === "purchase" && rates.last_purchase) {
              newL[idx].rate = (rates.last_purchase.rate / 100).toString();
            } else if (type === "sale") {
              if (rates.last_sale) {
                newL[idx].rate = (rates.last_sale.rate / 100).toString();
              } else if (rates.last_purchase) {
                newL[idx].rate = (rates.last_purchase.rate / 100).toString();
              }
            }
          }
        }
        return newL;
      });
    } catch (e) {
      console.error("fetchLineInfo error:", e);
    }
  };

  const updateLine = (idx: number, field: string, val: any) => {
    const newL = [...lines];
    newL[idx][field] = val;
    if (field === "itemId") {
      const it = items.find((x) => x.id.toString() === val);
      if (it) {
        newL[idx].unit = it.base_unit;
        newL[idx].gst = isCompositionSupplier ? 0 : it.gst_rate ? it.gst_rate / 1000 : 0;
        fetchLineInfo(idx, val, godownId);
      }
    }
    setLines(newL);
  };

  const handleGodownChange = (newGId: string) => {
    setGodownId(newGId);
    lines.forEach((l, idx) => {
      if (l.itemId) {
        fetchLineInfo(idx, l.itemId, newGId);
      }
    });
  };

  let totalTaxable = 0;
  let totalGst = 0;
  let hasOversell = false;
  let oversoldItemName = "";

  lines.forEach((l) => {
    const q = parseFloat(l.qty || "0");
    const r = parseFloat(l.rate || "0");
    const taxb = q * r;
    const gstPct = isCompositionSupplier ? 0 : l.gst || 0;
    const taxAmt = taxb * (gstPct / 100);
    totalTaxable += taxb;
    totalGst += taxAmt;

    if (type === "sale" && l.itemId) {
      const qMilli = q * 1000;
      if (qMilli > (l.availableStock || 0)) {
        hasOversell = true;
        const it = items.find((x) => x.id.toString() === l.itemId);
        if (it) oversoldItemName = it.name;
      }
    }
  });

  const grandTotalRupees = totalTaxable + totalGst;

  const handleInitiateSaveWithMode = (mode: "with_tax" | "without_tax" | "none" = "with_tax") => {
    setPendingTaxMode(mode);
    setFeedback(null);

    if (isBillBlocked) {
      setFeedback({
        message:
          lang === "hi"
            ? "पहले दुकान की जानकारी भरें (बिल बनाने के लिए दुकान का नाम और GSTIN आवश्यक है)!"
            : "Please fill shop details first (Shop name and GSTIN required to create bills)!",
        isError: true,
      });
      return;
    }

    if (hasOversell) {
      setFeedback({
        message: t.salePurchase.stockError,
        isError: true,
      });
      return;
    }

    if (!isSale && (!partyId || partyId === "1" || selectedParty?.name?.toLowerCase().includes("walk-in"))) {
      setFeedback({ message: "पहले सप्लायर चुनो", isError: true });
      return;
    }

    if (!isSale && !supplierInvoiceNo.trim()) {
      setFeedback({
        message: lang === "hi" ? "सप्लायर का बिल नंबर आवश्यक है (Supplier invoice number required)!" : "Supplier invoice number is required!",
        isError: true,
      });
      return;
    }

    if (isSale) {
      const trimmed = invoiceNo.trim();
      if (!trimmed || trimmed.length > 16 || !/^[A-Za-z0-9\/\-]+$/.test(trimmed)) {
        setFeedback({
          message: invoiceNoError || (lang === "hi" ? "अमान्य बिल नंबर (अधिकतम 16 अक्षर, A-Z, 0-9, /, -)!" : "Invalid invoice number!"),
          isError: true,
        });
        return;
      }
    }

    if (alteringInvoiceNo && !alterationReason.trim()) {
      setFeedback({
        message:
          lang === "hi"
            ? "संशोधन का कारण (Reason for Alteration) भरना अनिवार्य है!"
            : "Reason for alteration is required!",
        isError: true,
      });
      return;
    }

    if (!invoiceNo.trim() || !partyId || !godownId || lines.length === 0) {
      setFeedback({ message: t.salePurchase.validationError, isError: true });
      return;
    }

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l.itemId || !l.qty || parseFloat(l.qty) <= 0 || l.rate === "" || parseFloat(l.rate) < 0) {
        setFeedback({ message: t.salePurchase.validationError, isError: true });
        return;
      }
    }

    setIsConfirmModalOpen(true);
  };

  const handleInitiateSave = (e: React.FormEvent) => {
    e.preventDefault();
    handleInitiateSaveWithMode("with_tax");
  };

  const handleFinalConfirmSave = async (overrideMode?: "with_tax" | "without_tax" | "none") => {
    const modeToUse = overrideMode ?? pendingTaxMode;
    setIsConfirmModalOpen(false);
    setFeedback(null);

    const savedInv = invoiceNo.trim();
    const shopState = settings?.stateCode || "23";
    const partyGstin = selectedParty?.gstin?.trim() || "";
    const partyState = partyGstin.length >= 2 ? partyGstin.substring(0, 2) : shopState;
    const isInterstate = partyState !== shopState;

    const formattedLines = lines.map((l) => {
      const q = parseFloat(l.qty) * 1000;
      const r = parseFloat(l.rate) * 100;
      const taxb = Math.round(parseFloat(l.qty) * parseFloat(l.rate) * 100);
      const effectiveGst = isCompositionSupplier ? 0 : l.gst || 0;
      const totalTax = Math.round(taxb * (effectiveGst / 100));

      let cgst = 0;
      let sgst = 0;
      let igst = 0;

      if (effectiveGst > 0) {
        if (isInterstate) {
          igst = totalTax;
        } else {
          cgst = Math.round(totalTax / 2);
          sgst = totalTax - cgst;
        }
      }

      return {
        item_id: parseInt(l.itemId),
        qty: Math.round(q),
        unit: l.unit,
        rate: Math.round(r),
        taxable: taxb,
        cgst,
        sgst,
        igst,
      };
    });

    const paidPaise =
      paymentMode === "credit"
        ? Math.round(parseFloat(paidAmountRupees || "0") * 100)
        : Math.round(grandTotalRupees * 100);

    const payload = {
      invoice_no: savedInv,
      date,
      party_id: parseInt(partyId),
      godown_id: parseInt(godownId),
      type_: type,
      payment_mode: paymentMode,
      paid_amount: paidPaise,
      shop_state: shopState || null,
      supplier_invoice_no: type === "purchase" ? supplierInvoiceNo.trim() : null,
      supplier_invoice_date: type === "purchase" ? supplierInvoiceDate : null,
      lines: formattedLines,
    };

    try {
      if (alteringInvoiceNo) {
        const finalInvNo = isSale
          ? await invoke<string>("alter_sale_cmd", {
              invoiceNo: alteringInvoiceNo,
              payload,
              reason: alterationReason.trim() || null,
            })
          : await invoke<string>("alter_purchase_cmd", {
              invoiceNo: alteringInvoiceNo,
              payload,
              reason: alterationReason.trim() || null,
            });
        const displayInv = finalInvNo || savedInv;
        setLastSavedInvoiceNo(displayInv);
        setFeedback({
          message:
            lang === "hi"
              ? `बिल सफलतापूर्वक संशोधित हुआ (${displayInv} • ${formatCurrency(Math.round(grandTotalRupees * 100))})`
              : `Invoice altered successfully (${displayInv} • ${formatCurrency(Math.round(grandTotalRupees * 100))})`,
          isError: false,
        });
        setAlterationReason("");
        if (onRefresh) onRefresh();
        if (onCancelAlteration) onCancelAlteration();
        if (isSale && modeToUse !== "none") {
          onPrintInvoice(displayInv, modeToUse);
        }
        return;
      }

      const finalInvNo = await invoke<string>("save_invoice_cmd", { payload });
      const displayInv = finalInvNo || savedInv;
      setLastSavedInvoiceNo(displayInv);
      setFeedback({
        message: `${t.salePurchase.saveSuccess} (${displayInv} • ${formatCurrency(Math.round(grandTotalRupees * 100))})`,
        isError: false,
      });

      // Reset for next bill with sequential FY bill number
      setLines([
        {
          itemId: "",
          qty: "",
          unit: "kg",
          rate: "",
          gst: 0,
          availableStock: 0,
          lastRates: null,
        },
      ]);
      setPaidAmountRupees("");
      setPaymentMode("cash");
      setSupplierInvoiceNo("");
      if (type === "purchase") {
        setPartyId("");
      }
      const today = localTodayIso();
      setDate(today);
      setSupplierInvoiceDate(today);
      await refreshNextInvoicePreview(today);
      if (onRefresh) onRefresh();

      // Automatically open print modal with chosen tax mode!
      if (isSale && modeToUse !== "none") {
        onPrintInvoice(displayInv, modeToUse);
      }
    } catch (err: any) {
      console.error("save_invoice_cmd error:", err);
      const raw = typeof err === "string" ? err : err?.message || String(err || "");
      let hindiMessage = "डेटाबेस में सहेजने में त्रुटि हुई।";

      if (raw.includes("UNIQUE constraint failed: purchases.invoice_no") || raw.includes("UNIQUE constraint failed: sales.invoice_no")) {
        hindiMessage = "इस बिल नंबर का रिकॉर्ड पहले से मौजूद है। कृपया दोबारा सहेजें।";
      } else if (raw.includes("UNIQUE constraint failed")) {
        hindiMessage = "यह रिकॉर्ड पहले से मौजूद है (डुप्लीकेट डेटा)।";
      } else if (raw.includes("FOREIGN KEY constraint failed")) {
        hindiMessage = "चुना गया सप्लायर, ग्राहक या सामान डेटाबेस में नहीं मिला।";
      } else if (raw.includes("पहले सप्लायर चुनो")) {
        hindiMessage = "पहले सप्लायर चुनो";
      } else if (raw.includes("Stock kam hai")) {
        hindiMessage = "गोदाम में पर्याप्त स्टॉक उपलब्ध नहीं है।";
      } else if (raw.includes("locked") || raw.includes("busy")) {
        hindiMessage = "डेटाबेस अभी व्यस्त है, कृपया कुछ सेकंड बाद पुनः प्रयास करें।";
      } else if (raw.includes("NOT NULL constraint failed")) {
        hindiMessage = "कुछ आवश्यक जानकारी अधूरी रह गई है।";
      } else if (raw.trim()) {
        hindiMessage = raw;
      }

      setFeedback({
        message: hindiMessage,
        details: raw !== hindiMessage ? raw : undefined,
        isError: true,
      });
    }
  };

  const filteredParties =
    type === "purchase"
      ? parties.filter((p) => p.id !== 1 && !p.name.toLowerCase().includes("walk-in"))
      : parties;

  const partyOptions: SearchableOption[] = filteredParties.map((p) => ({
    value: p.id.toString(),
    label: p.name,
    subLabel: p.village ? p.village : p.phone || undefined,
    badge: p.category === "regular" ? "GST" : p.category === "composition" ? "Comp" : undefined,
  }));


  const itemOptions: SearchableOption[] = items.map((i) => ({
    value: i.id.toString(),
    label: i.name,
    subLabel: `${i.base_unit}${i.gst_rate ? ` • ${i.gst_rate / 1000}%` : ""}`,
  }));

  // Quick items filtered by search
  const filteredQuickItems = quickItemSearch
    ? items.filter((i) => i.name.toLowerCase().includes(quickItemSearch.toLowerCase()))
    : items.slice(0, 8);

  // Paginated visible lines (5 per page) to guarantee zero vertical page scroll
  const paginatedLines = lines.slice((linesPage - 1) * LINES_PER_PAGE, linesPage * LINES_PER_PAGE);

  const accentColor = isSale ? "border-t-emerald-600" : "border-t-blue-600";

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        addLine();
      } else if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        handleInitiateSaveWithMode("with_tax");
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [lines, items, partyId, godownId, invoiceNo, isBillBlocked, hasOversell]);

  return (
    <div className="h-full max-h-full flex flex-col justify-between overflow-hidden gap-2 text-ink font-body select-none">
      {/* 1. Header with Colorful Module Strip on Top */}
      <div
        className={`bg-surface border border-border border-t-4 ${accentColor} rounded-panel p-2 px-3.5 shadow-2xs flex items-center justify-between gap-3 flex-shrink-0`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
              isSale ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"
            }`}
          >
            {isSale ? <DuotoneReceipt size={20} /> : <DuotoneTruck size={20} />}
          </div>
          <div className="min-w-0 flex items-center gap-2">
            <h2 className="font-serif text-base sm:text-lg font-bold tracking-tight text-ink flex items-center gap-2 truncate">
              <span>{isSale ? "बिल बनाओ (बिक्री)" : "माल आया (खरीदी)"}</span>
            </h2>
            {isSale ? (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className="text-[11px] text-muted font-bold">बिल नं:</span>
                <input
                  type="text"
                  maxLength={16}
                  value={invoiceNo}
                  onChange={(e) => {
                    const val = e.target.value.toUpperCase();
                    setInvoiceNo(val);
                    validateSalesInvoiceNo(val);
                  }}
                  placeholder="KK/26-27/0001"
                  className={`w-36 px-2 py-0.5 text-xs font-mono font-bold bg-paper border rounded focus:outline-none ${
                    invoiceNoError
                      ? "border-red-500 bg-red-50 text-red-900"
                      : invoiceNoWarning
                      ? "border-amber-400 bg-amber-50/60 text-amber-900"
                      : "border-border text-ink"
                  }`}
                  title={invoiceNoError || invoiceNoWarning || "संपादन योग्य बिल नंबर (Editable invoice number)"}
                />
                {invoiceNoWarning && !invoiceNoError && (
                  <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 font-semibold" title={invoiceNoWarning}>
                    ⚠️ {invoiceNoWarning}
                  </span>
                )}
                {invoiceNoError && (
                  <span className="text-[10px] text-red-700 bg-red-50 px-1.5 py-0.5 rounded border border-red-200 font-semibold" title={invoiceNoError}>
                    ❌ {invoiceNoError}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-[11px] font-sans font-semibold bg-paper px-2 py-0.5 rounded text-muted border border-border" title="आंतरिक खरीद नंबर (Internal Purchase ID)">
                {invoiceNo}
              </span>
            )}
          </div>
        </div>

        {/* Header Right: Godown & Date inline */}
        <div className="flex items-center gap-2 flex-shrink-0 text-xs">
          <div className="flex items-center gap-1 bg-paper px-2 py-1 rounded-lg border border-border">
            <span className="text-muted font-medium">{t.common.godown}:</span>
            <select
              value={godownId}
              onChange={(e) => handleGodownChange(e.target.value)}
              className="bg-transparent font-bold text-ink focus:outline-none cursor-pointer"
            >
              {godowns.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          <input
            required
            type="date"
            className="px-2 py-1 bg-paper border border-border rounded-lg text-xs font-mono font-bold text-ink focus:outline-none cursor-pointer"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </div>

      <FeedbackBanner feedback={feedback} />

      {/* Alteration Mode Banner */}
      {alteringInvoiceNo && (
        <div
          data-testid="transaction-alteration-banner"
          className="p-2.5 px-3.5 bg-amber-50 border-2 border-amber-400 rounded-panel flex flex-wrap items-center justify-between gap-2.5 flex-shrink-0 shadow-xs"
        >
          <div className="flex items-center gap-2.5">
            <span className="px-2 py-0.5 bg-amber-300 text-amber-950 font-black rounded text-[11px] uppercase tracking-wide">
              {lang === "hi" ? "संशोधन मोड (Alteration)" : "Alteration Mode"}
            </span>
            <div className="text-xs">
              <span className="font-bold text-slate-900">
                {lang === "hi" ? "बिल संख्या: " : "Invoice: "}
                <span className="font-mono text-amber-900 font-extrabold">{alteringInvoiceNo}</span>
              </span>
              {isLoadingAlteration ? (
                <span className="text-[11px] text-amber-800 ml-2 animate-pulse font-semibold">
                  {lang === "hi" ? "(डेटा लोड हो रहा है...)" : "(Loading details...)"}
                </span>
              ) : (
                <span className="text-[11px] text-amber-800 ml-2 hidden sm:inline">
                  {lang === "hi"
                    ? "(मौजूदा बिल में बदलाव ऑडिट लॉग में दर्ज होंगे)"
                    : "(Changes will be recorded in audit log)"}
                </span>
              )}
            </div>
          </div>
          {onCancelAlteration && (
            <button
              type="button"
              data-testid="cancel-alteration-btn"
              onClick={onCancelAlteration}
              className="px-2.5 py-1 bg-white border border-amber-400 hover:bg-amber-100 text-amber-900 rounded-lg text-xs font-bold flex items-center gap-1 shadow-2xs transition-colors"
            >
              <X size={14} />
              <span>{lang === "hi" ? "संशोधन रद्द करें (Exit)" : "Exit Alteration"}</span>
            </button>
          )}
        </div>
      )}

      {/* WAC Notice for Purchase Alteration */}
      {type === "purchase" && alteringInvoiceNo && (
        <div
          data-testid="purchase-wac-alteration-notice"
          className="p-2.5 px-3 bg-blue-50 border border-blue-300 rounded-panel text-blue-950 text-xs flex items-start gap-2 flex-shrink-0 shadow-2xs"
        >
          <AlertCircle size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="leading-snug">
            <strong className="font-bold">
              {lang === "hi" ? "लागत (WAC) सम्बन्धी महत्वपूर्ण सूचना: " : "Important Cost (WAC) Notice: "}
            </strong>
            {lang === "hi"
              ? "इस खरीद बिल में बदलाव से भविष्य की बिक्री के लिए औसत लागत (WAC) अपडेट होगी, लेकिन पहले से दर्ज बिक्री बिलों की लागत (cost_paise) अपरिवर्तित रहेगी।"
              : "Modifying this purchase bill updates weighted average cost (WAC) for future sales, but historical sales snapshot costs remain unchanged."}
          </div>
        </div>
      )}

      {/* Warning banner when shop details missing for sale */}
      {isBillBlocked && (
        <div
          data-testid="sale-incomplete-shop-alert"
          className="p-3 bg-amber-50 border border-amber-300 rounded-xl text-amber-900 text-sm font-semibold flex items-center gap-2 shadow-xs flex-shrink-0"
        >
          <AlertCircle size={18} className="text-amber-600 flex-shrink-0" />
          <span>
            {lang === "hi"
              ? "पहले दुकान की जानकारी भरें (बिल बनाने के लिए दुकान का नाम और GSTIN आवश्यक है)!"
              : "Please fill shop details first (Shop name and GSTIN required to create bills)!"}
          </span>
        </div>
      )}

      {/* Post-Save Print Prompt */}
      {lastSavedInvoiceNo && (
        <div className="p-2 px-3 bg-emerald-50 border border-emerald-200 rounded-xl flex flex-wrap items-center justify-between gap-2.5 flex-shrink-0">
          <div className="text-xs font-semibold text-emerald-950 truncate">
            {t.dashboard.invoiceNo}: <span className="font-mono font-bold">{lastSavedInvoiceNo}</span> • बिल सुरक्षित हो चुका है।
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="post-save-print-with-tax"
              onClick={() => onPrintInvoice(lastSavedInvoiceNo, "with_tax")}
              className="py-1 px-3 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-colors"
              title="टैक्स इनवॉइस (GST विवरण सहित)"
            >
              <Printer size={14} />
              <span>टैक्स सहित प्रिंट</span>
            </button>
            <button
              type="button"
              data-testid="post-save-print-without-tax"
              onClick={() => onPrintInvoice(lastSavedInvoiceNo, "without_tax")}
              className="py-1 px-3 bg-amber-700 hover:bg-amber-800 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-colors"
              title="सरल खुदरा बिल (बिना टैक्स विवरण)"
            >
              <Printer size={14} />
              <span>बिना टैक्स प्रिंट</span>
            </button>
          </div>
        </div>
      )}

      {hasOversell && (
        <div className="bg-red-50 border border-red-200 text-red-800 p-2 px-3 rounded-xl text-xs font-bold flex items-center gap-2 flex-shrink-0">
          <AlertCircle size={15} className="text-red-600 flex-shrink-0" />
          <span>{t.salePurchase.stockError} ({oversoldItemName})</span>
        </div>
      )}

      {/* 2. Main 2-Column Grid (Zero Vertical Page Scroll, 100% Fit) */}
      <form onSubmit={handleInitiateSave} className="grid grid-cols-12 gap-2.5 flex-1 min-h-0 overflow-hidden">
        {/* Left Column: ग्राहक selection + Quick Item Search + 5-Line Table with Pagination (col-span-8) */}
        <div
          className="col-span-12 lg:col-span-8 h-full flex flex-col justify-between bg-surface border border-border rounded-panel p-3 min-h-0 overflow-hidden shadow-2xs"
          data-scroll="true"
        >
          {/* Top Row: Party Selection + Item Quick Search */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 pb-2.5 border-b border-border/80 flex-shrink-0">
            {/* Party Select */}
            <div className={isSale ? "sm:col-span-6" : "sm:col-span-5"}>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[11px] font-bold text-muted uppercase tracking-wider">
                  {isSale ? "ग्राहक (Customer)" : "सप्लायर (Supplier)"} *
                </label>
                <button
                  type="button"
                  onClick={() => setIsPartyModalOpen(true)}
                  className="text-[11px] text-forest hover:underline font-bold"
                >
                  + {t.common.newParty}
                </button>
              </div>
              <div data-testid="transaction-party-select">
                <SearchableSelect
                  options={partyOptions}
                  value={partyId}
                  onChange={setPartyId}
                  placeholder={t.salePurchase.partySelectPlaceholder}
                />
              </div>
            </div>

            {!isSale && (
              <>
                <div className="sm:col-span-4">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[11px] font-bold text-muted uppercase tracking-wider">
                      सप्लायर बिल नंबर *
                    </label>
                  </div>
                  <input
                    type="text"
                    required
                    maxLength={30}
                    value={supplierInvoiceNo}
                    onChange={(e) => setSupplierInvoiceNo(e.target.value)}
                    placeholder="उदा. SUPP-101"
                    className="w-full px-2.5 py-1.5 text-xs font-mono font-bold bg-paper border border-border rounded-lg focus:outline-none focus:border-forest"
                  />
                </div>
                <div className="sm:col-span-3">
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[11px] font-bold text-muted uppercase tracking-wider">
                      सप्लायर बिल तारीख
                    </label>
                  </div>
                  <input
                    type="date"
                    value={supplierInvoiceDate}
                    onChange={(e) => setSupplierInvoiceDate(e.target.value)}
                    className="w-full px-2 py-1 text-xs font-mono font-bold bg-paper border border-border rounded-lg focus:outline-none focus:border-forest"
                  />
                </div>
              </>
            )}

            {/* Quick Item Search Bar */}
            <div className={isSale ? "sm:col-span-6 relative" : "sm:col-span-12 relative"}>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[11px] font-bold text-muted uppercase tracking-wider">
                  {lang === "hi" ? "सामान खोजें / जोड़ें" : "Search & Add Item"}
                </label>
                <button
                  type="button"
                  data-testid="transaction-add-line-btn"
                  onClick={() => addLine()}
                  className="text-[11px] text-forest font-bold hover:underline"
                >
                  + खाली लाइन
                </button>
              </div>
              <div className="relative">
                <input
                  ref={quickSearchInputRef}
                  type="text"
                  placeholder={lang === "hi" ? "टाइप करके तुरंत जोड़ें (उदा. यूरिया)..." : "Type to filter items..."}
                  value={quickItemSearch}
                  onFocus={() => setIsQuickItemDropdownOpen(true)}
                  onChange={(e) => {
                    setQuickItemSearch(e.target.value);
                    setIsQuickItemDropdownOpen(true);
                  }}
                  className="w-full text-xs px-2.5 py-2 pl-7 bg-paper border border-border rounded-lg text-ink focus:outline-none focus:ring-1 focus:ring-forest"
                />
                <Search size={14} className="absolute left-2 top-2.5 text-muted pointer-events-none" />

                {/* Autocomplete Dropdown - Rendered via Portal directly into document.body */}
                {isQuickItemDropdownOpen &&
                  quickItemSearch.trim() &&
                  createPortal(
                    <div
                      ref={quickSearchDropdownRef}
                      data-testid="item-search-dropdown"
                      data-scroll="true"
                      style={{
                        position: "fixed",
                        top: `${quickSearchPos.top}px`,
                        left: `${quickSearchPos.left}px`,
                        width: `${quickSearchPos.width}px`,
                        zIndex: 9999,
                      }}
                      className="bg-surface border border-border rounded-lg shadow-2xl max-h-48 overflow-y-auto divide-y divide-border/60"
                    >
                      {filteredQuickItems.length > 0 ? (
                        filteredQuickItems.map((fi) => (
                          <div
                            key={fi.id}
                            onClick={() => {
                              addLine(fi.id.toString());
                              setQuickItemSearch("");
                              setIsQuickItemDropdownOpen(false);
                            }}
                            className="px-3 py-1.5 hover:bg-paper cursor-pointer flex items-center justify-between text-xs"
                          >
                            <span className="font-bold text-ink">{fi.name}</span>
                            <span className="text-[10px] text-muted">
                              {fi.base_unit} • + जोड़ें
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="p-2 text-center text-xs text-muted">
                          सामान नहीं मिला
                        </div>
                      )}
                    </div>,
                    document.body
                  )}
              </div>
            </div>
          </div>

          {/* Lines Table: 5 Rows Max, Table Header Fixed, Zero Page Scroll */}
          <div className="flex-1 min-h-0 overflow-y-auto my-1" data-scroll="true">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-paper sticky top-0 border-b border-border text-muted font-bold z-10">
                <tr>
                  <th className="py-2 px-2.5 w-5/12">{t.salePurchase.itemsTableHeader.item}</th>
                  <th className="py-2 px-2 w-20 text-right">{t.salePurchase.itemsTableHeader.qty}</th>
                  <th className="py-2 px-2 w-14 text-center">{t.common.unit}</th>
                  <th className="py-2 px-2 w-24 text-right">{t.salePurchase.itemsTableHeader.rate}</th>
                  <th className="py-2 px-2 w-14 text-center">GST%</th>
                  <th className="py-2 px-2.5 w-24 text-right">{t.common.total}</th>
                  <th className="py-2 px-1 w-8 text-center" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {paginatedLines.map((l, localIdx) => {
                  const globalIdx = (linesPage - 1) * LINES_PER_PAGE + localIdx;
                  const q = parseFloat(l.qty || "0");
                  const r = parseFloat(l.rate || "0");
                  const taxb = q * r;
                  const effectiveGst = isCompositionSupplier ? 0 : l.gst || 0;
                  const lineAmount = taxb + (taxb * effectiveGst) / 100;
                  const availBase = (l.availableStock || 0) / 1000;
                  const isLineOversell = isSale && l.itemId && q * 1000 > (l.availableStock || 0);

                  return (
                    <tr
                      key={globalIdx}
                      className={`hover:bg-paper/40 transition-colors ${
                        isLineOversell ? "bg-red-50/80" : ""
                      }`}
                    >
                      <td className="py-1.5 px-2 align-middle">
                        <SearchableSelect
                          options={itemOptions}
                          value={l.itemId}
                          onChange={(val) => updateLine(globalIdx, "itemId", val)}
                          placeholder={t.salePurchase.itemSelectPlaceholder}
                        />
                        {l.itemId && (
                          <div className="mt-0.5 text-[10px] text-muted flex items-center gap-1.5">
                            <span
                              className={`px-1.5 py-0.2 rounded font-bold ${
                                isLineOversell
                                  ? "bg-red-100 text-red-800"
                                  : "bg-emerald-50 text-emerald-800"
                              }`}
                            >
                              उपलब्ध: {availBase.toFixed(1)} {l.unit}
                            </span>
                            {l.lastRates?.last_purchase && (
                              <span>खरीदी: ₹{(l.lastRates.last_purchase.rate / 100).toFixed(0)}</span>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="py-1.5 px-2 align-middle text-right">
                        <input
                          required
                          type="number"
                          step="0.01"
                          className={`w-full px-2 py-1.5 border rounded-lg text-xs font-mono font-bold text-right ${
                            isLineOversell
                              ? "border-red-500 bg-red-50 text-red-900"
                              : "border-border bg-paper focus:bg-surface focus:outline-none focus:ring-1 focus:ring-forest"
                          }`}
                          placeholder="0.00"
                          value={l.qty}
                          onChange={(e) => updateLine(globalIdx, "qty", e.target.value)}
                        />
                      </td>

                      <td className="py-1.5 px-2 align-middle text-center">
                        <span className="text-xs font-bold text-muted">{l.unit}</span>
                      </td>

                      <td className="py-1.5 px-2 align-middle text-right">
                        <input
                          required
                          type="number"
                          step="0.01"
                          className="w-full px-2 py-1.5 border border-border bg-paper focus:bg-surface rounded-lg text-xs font-mono font-bold text-right focus:outline-none focus:ring-1 focus:ring-forest"
                          placeholder="0.00"
                          value={l.rate}
                          onChange={(e) => updateLine(globalIdx, "rate", e.target.value)}
                        />
                      </td>

                      <td className="py-1.5 px-2 align-middle text-center font-mono text-[11px] font-bold text-muted">
                        {effectiveGst}%
                      </td>

                      <td className="py-1.5 px-2.5 align-middle text-right font-mono font-bold text-ink">
                        {formatCurrency(Math.round(lineAmount * 100))}
                      </td>

                      <td className="py-1.5 px-1 align-middle text-center">
                        {lines.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setLines(lines.filter((_, idx) => idx !== globalIdx))}
                            className="p-1 text-muted hover:text-red-700 transition-colors"
                            title={t.common.delete}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Table Bottom: Add Line + Pagination if lines > 5 */}
          <div className="flex items-center justify-between pt-1 border-t border-border/80 flex-shrink-0">
            <button
              type="button"
              onClick={() => addLine()}
              className="text-xs font-bold text-forest hover:text-emerald-800 flex items-center gap-1 py-1"
            >
              <Plus size={15} />
              <span>+ {t.salePurchase.addItemBtn}</span>
            </button>

            {lines.length > LINES_PER_PAGE && (
              <Pagination
                currentPage={linesPage}
                totalItems={lines.length}
                pageSize={LINES_PER_PAGE}
                onPageChange={setLinesPage}
                lang={lang}
                compact
              />
            )}
          </div>
        </div>

        {/* Right Column: Bill Summary + Settlement + Bada Submit Button (col-span-4) */}
        <div
          className="col-span-12 lg:col-span-4 h-full flex flex-col justify-between bg-surface border border-border rounded-panel p-3 min-h-0 overflow-y-auto shadow-2xs"
          data-scroll="true"
        >
          {/* Top: Rakam Breakdown Card */}
          <div className="bg-gradient-to-br from-emerald-50/80 to-emerald-100/40 border border-emerald-200/90 rounded-xl p-2.5 flex-shrink-0 space-y-1">
            <div className="flex justify-between text-xs text-emerald-950 font-medium">
              <span>कुल सामान (Lines):</span>
              <span className="font-bold font-mono">{lines.length} मद</span>
            </div>
            <div className="flex justify-between text-xs text-emerald-950 font-medium">
              <span>{t.common.taxable}:</span>
              <span className="font-mono font-bold">{formatCurrency(Math.round(totalTaxable * 100))}</span>
            </div>
            <div className="flex justify-between text-xs text-emerald-950 font-medium pb-1 border-b border-emerald-200">
              <span>{t.common.tax} (GST):</span>
              <span className="font-mono font-bold">{formatCurrency(Math.round(totalGst * 100))}</span>
            </div>

            {/* Grand Total Highlight */}
            <div className="pt-0.5">
              <span className="text-[10px] uppercase font-bold text-emerald-900 tracking-wider block">
                {t.salePurchase.grandTotal} (कुल देय रकम)
              </span>
              <div className="text-2xl sm:text-3xl font-serif font-bold text-emerald-950 num-tabular tracking-tight">
                {formatCurrency(Math.round(grandTotalRupees * 100))}
              </div>
            </div>
          </div>

          {/* Middle: Payment Mode Selection (3 Large Buttons) */}
          <div className="py-1.5 flex-shrink-0 space-y-1.5 border-y border-border/80 my-1">
            <label className="block text-[11px] font-bold text-muted uppercase tracking-wider">
              {t.common.paymentMode} *
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => setPaymentMode("cash")}
                className={`py-2 px-1 text-center rounded-lg text-xs font-bold border transition-all ${
                  paymentMode === "cash"
                    ? "bg-emerald-600 border-emerald-700 text-white shadow-xs"
                    : "bg-paper border-border text-ink hover:bg-forest/10"
                }`}
              >
                नकद
              </button>
              <button
                type="button"
                onClick={() => setPaymentMode("credit")}
                className={`py-2 px-1 text-center rounded-lg text-xs font-bold border transition-all ${
                  paymentMode === "credit"
                    ? "bg-amber-600 border-amber-700 text-white shadow-xs"
                    : "bg-paper border-border text-ink hover:bg-forest/10"
                }`}
              >
                उधार
              </button>
              <button
                type="button"
                onClick={() => setPaymentMode("upi_bank")}
                className={`py-2 px-1 text-center rounded-lg text-xs font-bold border transition-all ${
                  paymentMode === "upi_bank"
                    ? "bg-blue-600 border-blue-700 text-white shadow-xs"
                    : "bg-paper border-border text-ink hover:bg-forest/10"
                }`}
              >
                बैंक/UPI
              </button>
            </div>

            {paymentMode === "credit" && (
              <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                <div>
                  <span className="text-[10px] text-muted font-bold uppercase block mb-0.5">
                    प्राप्त रकम (₹)
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full px-2 py-1.5 border border-border bg-paper rounded-lg font-mono font-bold text-ink"
                    placeholder="0.00"
                    value={paidAmountRupees}
                    onChange={(e) => setPaidAmountRupees(e.target.value)}
                  />
                </div>
                <div>
                  <span className="text-[10px] text-muted font-bold uppercase block mb-0.5">
                    बाकी उधारी (₹)
                  </span>
                  <div className="px-2 py-1.5 bg-paper border border-border rounded-lg font-mono font-bold text-rose-700 truncate">
                    {formatCurrency(
                      Math.max(0, Math.round((grandTotalRupees - parseFloat(paidAmountRupees || "0")) * 100))
                    )}
                  </div>
                </div>
              </div>
            )}

            {alteringInvoiceNo && (
              <div className="pt-2 text-xs">
                <label className="block text-[11px] font-bold text-amber-950 mb-0.5">
                  {lang === "hi" ? "संशोधन का कारण (Reason for Alteration) *" : "Reason for Alteration *"}
                </label>
                <input
                  type="text"
                  required
                  data-testid="alteration-reason-input"
                  value={alterationReason}
                  onChange={(e) => setAlterationReason(e.target.value)}
                  placeholder={
                    lang === "hi"
                      ? "उदा. मात्रा में भूल सुधार, रेट संशोधन, पार्टी का अनुरोध..."
                      : "e.g. Corrected quantity, adjusted price, party request..."
                  }
                  className="w-full px-2 py-1.5 border-2 border-amber-400 bg-amber-50/60 rounded-lg font-bold text-amber-950 focus:outline-none focus:ring-1 focus:ring-amber-500 text-xs"
                />
              </div>
            )}
          </div>

          {/* Bottom: Action Buttons */}
          <div className="flex-shrink-0 pt-1 space-y-1.5">
            {isSale ? (
              <div className="space-y-1.5">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    data-testid="transaction-submit-with-tax-btn"
                    onClick={() => handleInitiateSaveWithMode("with_tax")}
                    disabled={lines.length === 0 || hasOversell || isBillBlocked || (alteringInvoiceNo ? !alterationReason.trim() : false)}
                    className={`min-h-[46px] ${
                      isBillBlocked
                        ? "bg-slate-400 cursor-not-allowed opacity-60"
                        : alteringInvoiceNo
                        ? "bg-amber-700 hover:bg-amber-800"
                        : "bg-emerald-700 hover:bg-emerald-800"
                    } disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs sm:text-sm rounded-xl shadow-md flex flex-col items-center justify-center gap-0.5 transition-all hover:scale-[1.01] active:scale-[0.99]`}
                    title="टैक्स विवरण (GST, HSN) सहित पक्का बिल बनाएं व प्रिंट करें"
                  >
                    <div className="flex items-center gap-1.5">
                      <Printer size={16} />
                      <span>{alteringInvoiceNo ? (lang === "hi" ? "संशोधन सहेजें व GST प्रिंट" : "Save & Print GST") : "टैक्स सहित प्रिंट"}</span>
                    </div>
                    <span className="text-[10px] font-normal opacity-90">(GST बिल)</span>
                  </button>

                  <button
                    type="button"
                    data-testid="transaction-submit-without-tax-btn"
                    onClick={() => handleInitiateSaveWithMode("without_tax")}
                    disabled={lines.length === 0 || hasOversell || isBillBlocked || (alteringInvoiceNo ? !alterationReason.trim() : false)}
                    className={`min-h-[46px] ${
                      isBillBlocked
                        ? "bg-slate-400 cursor-not-allowed opacity-60"
                        : "bg-amber-700 hover:bg-amber-800"
                    } disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs sm:text-sm rounded-xl shadow-md flex flex-col items-center justify-center gap-0.5 transition-all hover:scale-[1.01] active:scale-[0.99]`}
                    title="बिना टैक्स विवरण का सरल खुदरा बिल बनाएं व प्रिंट करें"
                  >
                    <div className="flex items-center gap-1.5">
                      <Printer size={16} />
                      <span>{alteringInvoiceNo ? (lang === "hi" ? "संशोधन सहेजें (सरल)" : "Save & Print Simple") : "बिना टैक्स प्रिंट"}</span>
                    </div>
                    <span className="text-[10px] font-normal opacity-90">(सरल खुदरा पर्ची)</span>
                  </button>
                </div>

                <div className="flex items-center justify-between text-[10px] text-muted font-medium px-1">
                  <span>
                    शॉर्टकट: <span className="font-mono font-bold">Ctrl + Enter</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleInitiateSaveWithMode("none")}
                    disabled={lines.length === 0 || hasOversell || isBillBlocked || (alteringInvoiceNo ? !alterationReason.trim() : false)}
                    className="text-forest hover:underline font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {alteringInvoiceNo
                      ? (lang === "hi" ? "सिर्फ संशोधन सहेजें (बिना प्रिंट)" : "Save Alteration Only")
                      : (lang === "hi" ? "सिर्फ सेव करें (बिना प्रिंट)" : "Save Only")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <button
                  type="submit"
                  data-testid="transaction-submit-btn"
                  disabled={
                    lines.length === 0 ||
                    hasOversell ||
                    isBillBlocked ||
                    (!isSale && (!partyId || partyId === "1" || selectedParty?.name?.toLowerCase().includes("walk-in"))) ||
                    (alteringInvoiceNo ? !alterationReason.trim() : false)
                  }
                  title={
                    !isSale && (!partyId || partyId === "1")
                      ? "पहले सप्लायर चुनो"
                      : undefined
                  }
                  className={`w-full min-h-[48px] ${
                    alteringInvoiceNo ? "bg-amber-600 hover:bg-amber-700" : "bg-blue-600 hover:bg-blue-700"
                  } disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-base rounded-xl shadow-md flex items-center justify-center gap-2.5 transition-all hover:scale-[1.01]`}
                >
                  <Printer size={20} className="flex-shrink-0" />
                  <span>
                    {alteringInvoiceNo
                      ? (lang === "hi" ? "खरीद बिल संशोधन सहेजें" : "Save Purchase Alteration")
                      : (lang === "hi" ? "माल दर्ज करो और पर्ची बनाओ" : "Record Purchase & Save")}
                  </span>
                </button>
                <p className="text-[10px] text-muted text-center font-medium">
                  शॉर्टकट: <span className="font-mono font-bold">Ctrl + Enter</span> से तुरंत सुरक्षित करें
                </p>

              </div>
            )}
          </div>
        </div>
      </form>

      {/* Confirmation Modal */}
      {isConfirmModalOpen &&
        createPortal(
          <div
            data-testid="transaction-confirm-modal"
            data-scroll="true"
            className="fixed inset-0 z-[9999] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto no-print"
          >
            <div className="bg-surface rounded-panel p-5 w-full max-w-sm shadow-2xl border border-border space-y-3.5">
              <div className="flex justify-between items-center pb-2 border-b border-border">
                <h3 className="font-serif text-base font-bold text-ink">
                  {t.salePurchase.confirmDialogTitle}
                </h3>
                <button
                  type="button"
                  onClick={() => setIsConfirmModalOpen(false)}
                  className="p-1 text-muted hover:text-ink rounded"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-1.5 text-xs text-ink/80 bg-paper p-3 rounded-xl border border-border">
                <div className="flex justify-between">
                  <span className="text-muted">{t.salePurchase.confirmParty}:</span>
                  <span className="font-bold text-ink">{selectedParty?.name || "-"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">{lang === "hi" ? "कुल सामान:" : "Total Items:"}</span>
                  <span className="font-bold font-mono">{lines.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">{t.common.paymentMode}:</span>
                  <span className="font-bold">{paymentMode.toUpperCase()}</span>
                </div>
                <div className="flex justify-between text-sm font-bold text-ink pt-1 border-t border-border">
                  <span>{t.salePurchase.confirmTotal}:</span>
                  <span className="text-forest font-mono">{formatCurrency(Math.round(grandTotalRupees * 100))}</span>
                </div>
              </div>

              {isSale ? (
                <div className="space-y-2 pt-1 border-t border-border">
                  <div className="text-[11px] font-bold text-muted uppercase tracking-wider text-center">
                    {lang === "hi" ? "प्रिंट का प्रकार चुनें" : "Select Print Option"}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      data-testid="confirm-save-with-tax"
                      onClick={() => handleFinalConfirmSave("with_tax")}
                      className={`p-2.5 rounded-xl text-xs font-bold flex flex-col items-center justify-center gap-1 shadow-sm transition-all hover:scale-[1.02] ${
                        pendingTaxMode === "with_tax"
                          ? "bg-emerald-700 text-white ring-2 ring-emerald-400"
                          : "bg-emerald-800 text-white"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <Printer size={15} />
                        <span>टैक्स सहित प्रिंट</span>
                      </div>
                      <span className="text-[10px] font-normal opacity-90">(GST Tax Invoice)</span>
                    </button>
                    <button
                      type="button"
                      data-testid="confirm-save-without-tax"
                      onClick={() => handleFinalConfirmSave("without_tax")}
                      className={`p-2.5 rounded-xl text-xs font-bold flex flex-col items-center justify-center gap-1 shadow-sm transition-all hover:scale-[1.02] ${
                        pendingTaxMode === "without_tax"
                          ? "bg-amber-700 text-white ring-2 ring-amber-400"
                          : "bg-amber-800 text-white"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <Printer size={15} />
                        <span>बिना टैक्स प्रिंट</span>
                      </div>
                      <span className="text-[10px] font-normal opacity-90">(सरल खुदरा पर्ची)</span>
                    </button>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-border/60">
                    <button
                      type="button"
                      onClick={() => setIsConfirmModalOpen(false)}
                      className="btn-secondary py-1.5 px-3 text-xs font-bold"
                    >
                      {t.common.cancel}
                    </button>
                    <button
                      type="button"
                      data-testid="confirm-save-only"
                      onClick={() => handleFinalConfirmSave("none")}
                      className="text-xs text-forest hover:underline font-bold px-2 py-1"
                    >
                      {lang === "hi" ? "सिर्फ सुरक्षित करें (बिना प्रिंट)" : "Save Only"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsConfirmModalOpen(false)}
                    className="btn-secondary flex-1 py-2 text-xs font-bold"
                  >
                    {t.common.cancel}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFinalConfirmSave("none")}
                    className="btn-primary flex-1 py-2 text-xs font-bold"
                  >
                    {t.common.save}
                  </button>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}

      {/* Add New Party Modal */}
      <AddPartyModal
        isOpen={isPartyModalOpen}
        defaultType={pType}
        onClose={() => setIsPartyModalOpen(false)}
        onSuccess={(newPartyId: number) => {
          loadAllData();
          setPartyId(newPartyId.toString());
          setIsPartyModalOpen(false);
        }}
        t={t}
      />
    </div>
  );
}
