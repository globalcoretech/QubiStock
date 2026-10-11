import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, Item, Godown, Party, Feedback, LastRates, SearchableOption } from "../types";
import { Translations, Language } from "../i18n";
import { formatCurrency, formatPaymentMode } from "../utils/formatters";
import { SearchableSelect } from "../components/SearchableSelect";
import { FeedbackBanner } from "../components/FeedbackBanner";
import { AddPartyModal } from "../components/AddPartyModal";
import {
  ShoppingCart,
  PackagePlus,
  Plus,
  Trash2,
  Printer,
  X,
  AlertCircle,
} from "../components/icons";

interface TransactionViewProps {
  type: "purchase" | "sale";
  settings?: AppSettings;
  refreshTrigger: number;
  onRefresh?: () => void;
  onPrintInvoice: (invNo: string) => void;
  t: Translations;
  lang: Language;
}

export function TransactionView({
  type,
  settings,
  refreshTrigger,
  onRefresh,
  onPrintInvoice,
  t,
  lang,
}: TransactionViewProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [godowns, setGodowns] = useState<Godown[]>([]);
  const [parties, setParties] = useState<Party[]>([]);

  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [partyId, setPartyId] = useState("");
  const [godownId, setGodownId] = useState("1");
  const [paymentMode, setPaymentMode] = useState<"cash" | "credit" | "upi_bank">("cash");
  const [paidAmountRupees, setPaidAmountRupees] = useState("");

  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [lastSavedInvoiceNo, setLastSavedInvoiceNo] = useState("");
  const [lines, setLines] = useState<any[]>([]);

  const [isPartyModalOpen, setIsPartyModalOpen] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);

  const pType = type === "purchase" ? "supplier" : "customer";
  const selectedParty = parties.find((p) => p.id.toString() === partyId);
  const isCompositionSupplier = type === "purchase" && selectedParty?.category === "composition";

  const loadAllData = async () => {
    try {
      const itRes = await invoke<Item[]>("get_items_cmd");
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
      setParties(ptRes);
    } catch (e) {
      console.error("get_parties_cmd error:", e);
    }
  };

  useEffect(() => {
    loadAllData();
  }, [type, refreshTrigger]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.altKey && (e.key === "a" || e.key === "A")) || (e.ctrlKey && e.key === "Enter")) {
        e.preventDefault();
        addLine();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [lines, items]);

  const addLine = () => {
    setLines((prev) => [
      ...prev,
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

  const handleInitiateSave = (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (hasOversell) {
      setFeedback({
        message: t.salePurchase.stockError,
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

  const handleFinalConfirmSave = async () => {
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
      const taxb = Math.round((q / 1000) * r);
      const effectiveGst = isCompositionSupplier ? 0 : l.gst || 0;
      const taxAmt = Math.round(taxb * (effectiveGst / 100));
      const cgst = isInterstate ? 0 : Math.round(taxAmt / 2);
      const sgst = isInterstate ? 0 : taxAmt - cgst;
      const igst = isInterstate ? taxAmt : 0;
      return {
        item_id: parseInt(l.itemId),
        itemId: parseInt(l.itemId),
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
      invoiceNo: savedInv,
      date,
      party_id: parseInt(partyId),
      partyId: parseInt(partyId),
      godown_id: parseInt(godownId),
      godownId: parseInt(godownId),
      type_: type,
      type: type,
      paymentMode,
      payment_mode: paymentMode,
      paidAmount: paidPaise,
      paid_amount: paidPaise,
      shopState: shopState,
      shop_state: shopState,
      lines: formattedLines,
    };

    try {
      await invoke("save_invoice_cmd", { payload });
      setLastSavedInvoiceNo(savedInv);
      setFeedback({
        message: `${t.salePurchase.saveSuccess} (${savedInv} • ${formatCurrency(Math.round(grandTotalRupees * 100))})`,
        isError: false,
      });
      setLines([]);
      setInvoiceNo("");
      setPartyId("");
      setPaidAmountRupees("");
      setPaymentMode("cash");
      setDate(new Date().toISOString().split("T")[0]);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      console.error("save_invoice_cmd error:", err);
      setFeedback({ message: String(err), isError: true });
    }
  };

  const partyOptions: SearchableOption[] = parties.map((p) => ({
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

  return (
    <div className="space-y-6">
      {/* Screen Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            {type === "sale" ? (
              <ShoppingCart size={20} className="text-emerald-600" />
            ) : (
              <PackagePlus size={20} className="text-slate-700" />
            )}
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">
              {type === "sale" ? t.salePurchase.saleTitle : t.salePurchase.purchaseTitle}
            </h2>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            {type === "sale" ? t.salePurchase.saleSubtitle : t.salePurchase.purchaseSubtitle}
          </p>
        </div>

        <div className="text-xs text-slate-500 font-medium">
          {t.salePurchase.shortcutHint}
        </div>
      </div>

      <FeedbackBanner feedback={feedback} />

      {/* Post-Save Print Prompt */}
      {lastSavedInvoiceNo && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between gap-4">
          <div>
            <div className="font-semibold text-emerald-950 text-sm">
              {t.dashboard.invoiceNo}: {lastSavedInvoiceNo}
            </div>
            <div className="text-emerald-700 text-xs mt-0.5">
              {lang === "hi"
                ? "बिल सुरक्षित हो चुका है। क्या आप बिल प्रिंट करना चाहते हैं?"
                : "Invoice saved. Would you like to print or export as PDF?"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onPrintInvoice(lastSavedInvoiceNo)}
            className="btn-primary py-2 px-4 text-sm"
          >
            <Printer size={15} />
            <span>{t.salePurchase.printBillNow}</span>
          </button>
        </div>
      )}

      {isCompositionSupplier && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 p-3.5 rounded-xl text-sm font-medium flex items-center gap-2">
          <AlertCircle size={16} className="text-amber-700 flex-shrink-0" />
          <span>
            {lang === "hi"
              ? "कंपोज़िशन सप्लायर: इस बिल पर इनपुट जीएसटी क्रेडिट (ITC) दावा नहीं किया जा सकता।"
              : "Composition supplier: Input tax credit (ITC) cannot be claimed on this purchase."}
          </span>
        </div>
      )}

      {hasOversell && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3.5 rounded-xl text-sm font-medium flex items-center gap-2">
          <AlertCircle size={16} className="text-red-600 flex-shrink-0" />
          <span>
            {t.salePurchase.stockError} ({oversoldItemName})
          </span>
        </div>
      )}

      <form onSubmit={handleInitiateSave} className="space-y-6">
        {/* Invoice Primary Metadata Grid */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <div>
            <label className="block mb-1 text-xs font-medium text-slate-500 uppercase tracking-wider">
              {t.common.date} *
            </label>
            <input
              required
              type="date"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 min-h-[44px] font-mono"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div>
            <label className="block mb-1 text-xs font-medium text-slate-500 uppercase tracking-wider">
              {t.salePurchase.invoiceNo} *
            </label>
            <input
              required
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 min-h-[44px]"
              placeholder={type === "purchase" ? "PUR-001" : "BILL-101"}
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
            />
          </div>

          <div>
            <label className="block mb-1 text-xs font-medium text-slate-500 uppercase tracking-wider">
              {t.common.godown} *
            </label>
            <select
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 min-h-[44px]"
              value={godownId}
              onChange={(e) => handleGodownChange(e.target.value)}
            >
              {godowns.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                {type === "purchase" ? t.common.supplier : t.common.customer} *
              </label>
              <button
                type="button"
                onClick={() => setIsPartyModalOpen(true)}
                className="text-xs text-emerald-700 hover:text-emerald-900 font-semibold"
              >
                {t.common.newParty}
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
        </div>

        {/* Items Table */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="flex justify-between items-center pb-2 border-b border-slate-100">
            <h3 className="text-base font-semibold text-slate-900">
              {t.common.item}
            </h3>
            <button
              type="button"
              data-testid="transaction-add-line-btn"
              onClick={addLine}
              className="btn-secondary text-sm py-2 px-3 min-h-[38px]"
            >
              <Plus size={15} />
              <span>{t.salePurchase.addItemBtn}</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 uppercase tracking-wider">
                  <th className="py-2.5 px-3 w-5/12">{t.salePurchase.itemsTableHeader.item}</th>
                  <th className="py-2.5 px-3 w-28 text-right">{t.salePurchase.itemsTableHeader.qty}</th>
                  <th className="py-2.5 px-3 w-20">{t.salePurchase.itemsTableHeader.unit}</th>
                  <th className="py-2.5 px-3 w-32 text-right">{t.salePurchase.itemsTableHeader.rate}</th>
                  <th className="py-2.5 px-3 w-20 text-center">{t.common.tax}</th>
                  <th className="py-2.5 px-3 w-36 text-right">{t.salePurchase.itemsTableHeader.total}</th>
                  <th className="py-2.5 px-3 w-14 text-center">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400 text-sm">
                      {lang === "hi"
                        ? "बिल में अभी तक कोई सामान नहीं जोड़ा गया है। ऊपर '+ सामान लाइन जोड़ें' दबाएं।"
                        : "No items added yet. Click '+ Add Item Line' above."}
                    </td>
                  </tr>
                ) : (
                  lines.map((l, i) => {
                    const q = parseFloat(l.qty || "0");
                    const r = parseFloat(l.rate || "0");
                    const taxb = q * r;
                    const effectiveGst = isCompositionSupplier ? 0 : l.gst || 0;
                    const lineAmount = taxb + (taxb * effectiveGst) / 100;
                    const availBase = (l.availableStock || 0) / 1000;
                    const isLineOversell =
                      type === "sale" && l.itemId && q * 1000 > (l.availableStock || 0);

                    const lp = l.lastRates?.last_purchase;
                    const ls = l.lastRates?.last_sale;

                    return (
                      <tr
                        key={i}
                        className={`transition-colors ${
                          isLineOversell ? "bg-red-50/70" : "hover:bg-slate-50/70"
                        }`}
                      >
                        <td className="py-3 px-3 align-top">
                          <SearchableSelect
                            options={itemOptions}
                            value={l.itemId}
                            onChange={(val) => updateLine(i, "itemId", val)}
                            placeholder={t.salePurchase.itemSelectPlaceholder}
                          />

                          {l.itemId && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                              <span
                                className={`px-2 py-0.5 rounded font-medium ${
                                  isLineOversell
                                    ? "bg-red-100 text-red-800"
                                    : "bg-emerald-50 text-emerald-700 border border-emerald-200/60"
                                }`}
                              >
                                {t.salePurchase.stockBadge}: {availBase.toFixed(2)} {l.unit}
                              </span>

                              {lp && (
                                <span className="text-slate-500">
                                  {t.salePurchase.lastPurchaseBadge}: {formatCurrency(lp.rate)}
                                </span>
                              )}
                              {ls && (
                                <span className="text-slate-500">
                                  {t.salePurchase.lastSaleBadge}: {formatCurrency(ls.rate)}
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3 align-top text-right">
                          <input
                            required
                            type="number"
                            step="0.01"
                            className={`w-full px-2.5 py-2 border rounded-lg text-sm font-mono text-right min-h-[44px] ${
                              isLineOversell
                                ? "border-red-500 bg-red-50 text-red-900"
                                : "border-slate-300 bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                            }`}
                            placeholder="0.00"
                            value={l.qty}
                            onChange={(e) => updateLine(i, "qty", e.target.value)}
                          />
                        </td>

                        <td className="py-3 px-3 align-top">
                          <input
                            className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-700 min-h-[44px]"
                            value={l.unit}
                            onChange={(e) => updateLine(i, "unit", e.target.value)}
                          />
                        </td>

                        <td className="py-3 px-3 align-top text-right">
                          <input
                            required
                            type="number"
                            step="0.01"
                            className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm font-mono text-right bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 min-h-[44px]"
                            placeholder="0.00"
                            value={l.rate}
                            onChange={(e) => updateLine(i, "rate", e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey && i === lines.length - 1) {
                                e.preventDefault();
                                addLine();
                              }
                            }}
                          />
                        </td>

                        <td className="py-3 px-3 align-top text-center">
                          <div className="py-2 text-xs text-slate-600 font-mono">
                            {effectiveGst}%
                          </div>
                        </td>

                        <td className="py-3 px-3 align-top text-right">
                          <div className="py-2 font-mono font-semibold text-slate-900">
                            {formatCurrency(Math.round(lineAmount * 100))}
                          </div>
                        </td>

                        <td className="py-3 px-3 align-top text-center">
                          <button
                            type="button"
                            onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                            className="p-2 text-slate-400 hover:text-red-600 rounded-lg transition-colors"
                            title={t.common.delete}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Settlement & Grand Total Bar */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 lg:grid-cols-3 gap-6 items-center shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          {/* Payment Mode Selector */}
          <div>
            <label className="block mb-1.5 text-xs font-medium text-slate-500 uppercase tracking-wider">
              {t.common.paymentMode} *
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPaymentMode("cash")}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                  paymentMode === "cash"
                    ? "bg-emerald-50 border-emerald-600 text-emerald-800 font-semibold"
                    : "border-slate-300 hover:bg-slate-50 text-slate-700"
                }`}
              >
                {t.common.cash}
              </button>
              <button
                type="button"
                onClick={() => setPaymentMode("credit")}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                  paymentMode === "credit"
                    ? "bg-emerald-50 border-emerald-600 text-emerald-800 font-semibold"
                    : "border-slate-300 hover:bg-slate-50 text-slate-700"
                }`}
              >
                {t.common.credit}
              </button>
              <button
                type="button"
                onClick={() => setPaymentMode("upi_bank")}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                  paymentMode === "upi_bank"
                    ? "bg-emerald-50 border-emerald-600 text-emerald-800 font-semibold"
                    : "border-slate-300 hover:bg-slate-50 text-slate-700"
                }`}
              >
                {t.common.bankUpi}
              </button>
            </div>
          </div>

          {/* If Credit: Paid & Balance fields */}
          {paymentMode === "credit" ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block mb-1 text-xs font-medium text-slate-500 uppercase tracking-wider">
                  {type === "sale" ? t.salePurchase.receivedAmount : t.salePurchase.paidAmount}
                </label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 min-h-[44px]"
                  placeholder="0.00"
                  value={paidAmountRupees}
                  onChange={(e) => setPaidAmountRupees(e.target.value)}
                />
              </div>
              <div>
                <label className="block mb-1 text-xs font-medium text-slate-500 uppercase tracking-wider">
                  {t.common.balance}
                </label>
                <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono font-semibold text-slate-900 min-h-[44px] flex items-center">
                  {formatCurrency(
                    Math.round(
                      (grandTotalRupees - parseFloat(paidAmountRupees || "0")) * 100
                    )
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-400">
              {paymentMode === "cash"
                ? (lang === "hi" ? "पूरा भुगतान नकद प्राप्त होगा।" : "Full settlement via cash.")
                : (lang === "hi" ? "पूरा भुगतान बैंक / UPI खाते में होगा।" : "Full settlement via UPI / Bank.")}
            </div>
          )}

          {/* Grand Total & Save Button */}
          <div className="flex flex-col sm:flex-row lg:flex-col items-end justify-between gap-3">
            <div className="text-right">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wider block">
                {t.salePurchase.grandTotal}
              </span>
              <span className="text-3xl font-semibold tracking-tight text-slate-900 font-mono">
                {formatCurrency(Math.round(grandTotalRupees * 100))}
              </span>
            </div>

            <button
              type="submit"
              disabled={lines.length === 0 || hasOversell}
              className="btn-primary w-full sm:w-auto lg:w-full py-3 text-base shadow-sm"
            >
              <span>{t.salePurchase.saveInvoiceBtn}</span>
            </button>
          </div>
        </div>
      </form>

      {/* Confirmation Modal */}
      {isConfirmModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto no-print">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl border border-slate-200 space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-900">
                {t.salePurchase.confirmDialogTitle}
              </h3>
              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2 text-sm text-slate-700 bg-slate-50 p-4 rounded-lg border border-slate-200">
              <div className="flex justify-between">
                <span className="text-slate-500">{t.salePurchase.confirmParty}:</span>
                <span className="font-semibold text-slate-900">{selectedParty?.name || "-"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t.salePurchase.confirmMode}:</span>
                <span className="font-medium">{formatPaymentMode(paymentMode, lang)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2">
                <span className="text-slate-700 font-semibold">{t.salePurchase.confirmTotal}:</span>
                <span className="font-mono font-bold text-slate-900 text-lg">
                  {formatCurrency(Math.round(grandTotalRupees * 100))}
                </span>
              </div>
              {paymentMode === "credit" && (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t.salePurchase.confirmPaid}:</span>
                    <span className="font-mono text-emerald-700">
                      {formatCurrency(Math.round(parseFloat(paidAmountRupees || "0") * 100))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t.salePurchase.confirmBalance}:</span>
                    <span className="font-mono text-red-600 font-semibold">
                      {formatCurrency(
                        Math.round(
                          (grandTotalRupees - parseFloat(paidAmountRupees || "0")) * 100
                        )
                      )}
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(false)}
                className="btn-secondary flex-1"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={handleFinalConfirmSave}
                className="btn-primary flex-1"
              >
                {t.common.confirm}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Party Modal */}
      <AddPartyModal
        isOpen={isPartyModalOpen}
        onClose={() => setIsPartyModalOpen(false)}
        onSuccess={(newId) => {
          loadAllData();
          setPartyId(newId.toString());
        }}
        defaultType={pType as any}
        t={t}
      />
    </div>
  );
}
