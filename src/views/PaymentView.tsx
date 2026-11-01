import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Party, PartyBalance, PendingBill, SearchableOption, Feedback } from "../types";
import { Translations, Language } from "../i18n";
import { formatCurrency, formatRupeesCompact, formatDate } from "../utils/formatters";
import { localTodayIso } from "../utils/dateUtils";
import { SearchableSelect } from "../components/SearchableSelect";
import { FeedbackBanner } from "../components/FeedbackBanner";
import { AddPartyModal } from "../components/AddPartyModal";
import {
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Landmark,
  Plus,
  X,
} from "../components/icons";

export const isWalkInParty = (p: { name: string; id?: number }) => {
  const n = (p.name || "").toLowerCase();
  return (
    n.includes("walk-in") ||
    n.includes("cash sale") ||
    n.includes("नकद बिक्री") ||
    (p.id === 1 && n.includes("cash"))
  );
};

export interface PaymentViewProps {
  refreshTrigger: number;
  onRefresh?: () => void;
  t: Translations;
  lang: Language;
  initialPartyId?: number | null;
  initialType?: "receipt" | "payment";
  initialParties?: Party[];
  initialBalances?: PartyBalance[];
  initialPendingBills?: PendingBill[];
  initialAmount?: string;
  initialMatchedInvoiceNo?: string;
}

export function PaymentView({
  refreshTrigger,
  onRefresh,
  t,
  lang,
  initialPartyId,
  initialType = "receipt",
  initialParties,
  initialBalances,
  initialPendingBills,
  initialAmount,
  initialMatchedInvoiceNo,
}: PaymentViewProps) {
  const [paymentType, setPaymentType] = useState<"receipt" | "payment">(initialType);
  const [partyId, setPartyId] = useState<string>(() => {
    if (initialPartyId) {
      return initialPartyId.toString();
    }
    return "";
  });
  const [amountRupees, setAmountRupees] = useState(initialAmount || "");
  const [paymentMode, setPaymentMode] = useState<"cash" | "upi_bank" | "bank">("cash");
  const [date, setDate] = useState(() => localTodayIso());
  const [remark, setRemark] = useState("");
  const [customRefId, setCustomRefId] = useState(initialMatchedInvoiceNo || "");
  const [matchedInvoiceNo, setMatchedInvoiceNo] = useState(initialMatchedInvoiceNo || "");

  const [parties, setParties] = useState<Party[]>(initialParties || []);
  const [balances, setBalances] = useState<PartyBalance[]>(initialBalances || []);
  const [pendingBills, setPendingBills] = useState<PendingBill[]>(initialPendingBills || []);
  const [loadingBills, setLoadingBills] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isPartyModalOpen, setIsPartyModalOpen] = useState(false);

  // Load parties and party balances with partyType filter based on tab
  const loadPartiesAndBalances = async (targetType?: "customer" | "supplier") => {
    try {
      const activeFilter = targetType || (paymentType === "receipt" ? "customer" : "supplier");
      const [ptList, balList] = await Promise.all([
        invoke<Party[]>("get_parties_cmd", { partyType: activeFilter }),
        invoke<PartyBalance[]>("get_party_balances_cmd"),
      ]);
      setParties(ptList);
      setBalances(balList);
    } catch (e) {
      console.error("loadPartiesAndBalances error:", e);
    }
  };

  useEffect(() => {
    const targetType = paymentType === "receipt" ? "customer" : "supplier";
    loadPartiesAndBalances(targetType);
  }, [paymentType, refreshTrigger]);

  useEffect(() => {
    if (initialType) {
      setPaymentType(initialType);
    }
  }, [initialType]);

  useEffect(() => {
    if (initialPartyId !== undefined) {
      setPartyId(initialPartyId ? initialPartyId.toString() : "");
      setMatchedInvoiceNo("");
      setCustomRefId("");
    }
  }, [initialPartyId]);

  // Load pending bills when partyId changes
  useEffect(() => {
    setMatchedInvoiceNo("");
    setCustomRefId("");

    if (!partyId) {
      setPendingBills(initialPendingBills || []);
      return;
    }

    const pId = parseInt(partyId);
    if (isNaN(pId)) return;

    setLoadingBills(true);
    invoke<PendingBill[]>("get_pending_bills_cmd", { partyId: pId })
      .then((bills) => {
        const withParty = (bills || []).map((b) => ({
          ...b,
          party_id: b.party_id || pId,
        }));
        setPendingBills(withParty);
      })
      .catch((e) => {
        console.error("get_pending_bills_cmd error:", e);
        if (!initialPendingBills) {
          setPendingBills([]);
        }
      })
      .finally(() => {
        setLoadingBills(false);
      });
  }, [partyId]);

  // Filter out Cash Sale (Walk-in) parties
  const selectableParties = parties.filter((p) => !isWalkInParty(p));

  const selectedParty = selectableParties.find((p) => p.id.toString() === partyId);
  const selectedBalance = balances.find((b) => b.party_id.toString() === partyId);
  const currentNetBalance = selectedBalance ? selectedBalance.net_balance : 0;

  // Filter pending bills according to current tab
  // "पैसा मिला": customer's sale bills
  // "पैसा दिया": supplier's purchase bills
  const filteredPendingBills = pendingBills.filter((bill) => {
    if (paymentType === "receipt") {
      return bill.bill_type === "sale";
    } else {
      return bill.bill_type === "purchase";
    }
  });

  const matchedBill = pendingBills.find((b) => b.invoice_no === matchedInvoiceNo);
  const maxAllowedPaise = matchedBill ? matchedBill.pending_amount : null;

  // Calculate parsed amount in paise
  const parsedAmountPaise = Math.round((parseFloat(amountRupees || "0") || 0) * 100);
  const isAmountExceeded = maxAllowedPaise !== null && parsedAmountPaise > maxAllowedPaise;

  // Calculate projected new balance after this entry
  const projectedBalance =
    paymentType === "receipt"
      ? currentNetBalance - parsedAmountPaise
      : currentNetBalance + parsedAmountPaise;

  const partyOptions: SearchableOption[] = selectableParties.map((p) => {
    const bal = balances.find((b) => b.party_id === p.id);
    let balLabel = "";
    if (bal) {
      if (bal.net_balance > 0) {
        balLabel = ` (लेना: ${formatCurrency(bal.net_balance)})`;
      } else if (bal.net_balance < 0) {
        balLabel = ` (देना: ${formatCurrency(Math.abs(bal.net_balance))})`;
      }
    }
    return {
      value: p.id.toString(),
      label: p.name + balLabel,
      subLabel: p.village ? p.village : p.phone || undefined,
      badge:
        p.party_type === "customer"
          ? t.common.customer
          : p.party_type === "supplier"
          ? t.common.supplier
          : undefined,
    };
  });

  const handlePartyChange = (newPartyId: string) => {
    if (newPartyId !== partyId) {
      setPartyId(newPartyId);
      setMatchedInvoiceNo("");
      setCustomRefId("");
    }
  };

  const handleSelectPendingBill = (bill: PendingBill) => {
    if (matchedInvoiceNo === bill.invoice_no) {
      // Unselect
      setMatchedInvoiceNo("");
      setCustomRefId("");
    } else {
      // Bill chunne par uski party apne aap chun jaye
      if (bill.party_id && bill.party_id.toString() !== partyId) {
        setPartyId(bill.party_id.toString());
      }
      setMatchedInvoiceNo(bill.invoice_no);
      setCustomRefId(bill.invoice_no);
      // Amount bakaya rakam se bhar jaye
      setAmountRupees((bill.pending_amount / 100).toFixed(2));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!partyId) {
      setFeedback({ message: "पहले पार्टी चुनो", isError: true });
      return;
    }

    const amt = parseFloat(amountRupees);
    if (isNaN(amt) || amt <= 0) {
      setFeedback({ message: t.payment.validationAmount, isError: true });
      return;
    }

    const amountPaise = Math.round(amt * 100);

    // Bakaya se zyada na ho
    if (matchedBill && amountPaise > matchedBill.pending_amount) {
      setFeedback({
        message:
          lang === "hi"
            ? `रकम बकाया राशि (${formatCurrency(matchedBill.pending_amount)}) से ज़्यादा नहीं हो सकती!`
            : `Amount cannot exceed pending bill (${formatCurrency(matchedBill.pending_amount)})!`,
        isError: true,
      });
      return;
    }

    setSaving(true);
    const effectiveRefId = matchedInvoiceNo || customRefId.trim() || undefined;

    const payload = {
      party_id: parseInt(partyId),
      payment_type: paymentType,
      amount_paise: amountPaise,
      payment_mode: paymentMode,
      date,
      remark: remark.trim() || undefined,
      ref_id: effectiveRefId,
    };

    try {
      await invoke<string>("record_payment_cmd", { payload });
      const partyName = selectedParty?.name || "";

      // Fetch fresh balances and filtered parties from Rust
      const currentTargetType = paymentType === "receipt" ? "customer" : "supplier";
      const [ptList, balList] = await Promise.all([
        invoke<Party[]>("get_parties_cmd", { partyType: currentTargetType }),
        invoke<PartyBalance[]>("get_party_balances_cmd"),
      ]);
      setParties(ptList);
      setBalances(balList);

      const updatedBal = balList.find((b) => b.party_id.toString() === partyId);
      const remainingPaise = updatedBal ? Math.abs(updatedBal.net_balance) : 0;
      const formattedRemaining = formatRupeesCompact(remainingPaise);
      const formattedAmount = formatRupeesCompact(amountPaise);

      // "₹500 सुरेश से मिले. अब बाकी: ₹1,500"
      const successMsg =
        lang === "hi"
          ? paymentType === "receipt"
            ? `${formattedAmount} ${partyName} से मिले. अब बाकी: ${formattedRemaining}`
            : `${formattedAmount} ${partyName} को दिए. अब बाकी: ${formattedRemaining}`
          : paymentType === "receipt"
          ? `${formattedAmount} received from ${partyName}. Remaining: ${formattedRemaining}`
          : `${formattedAmount} paid to ${partyName}. Remaining: ${formattedRemaining}`;

      setFeedback({ message: successMsg, isError: false });

      // Form khali ho
      setPartyId("");
      setAmountRupees("");
      setRemark("");
      setCustomRefId("");
      setMatchedInvoiceNo("");
      setPendingBills([]);

      if (onRefresh) onRefresh();
    } catch (err: any) {
      console.error("record_payment_cmd error:", err);
      setFeedback({ message: String(err), isError: true });
    } finally {
      setSaving(false);
    }
  };

  const partyDisplayName = selectedParty ? selectedParty.name : "पार्टी";
  const amountDisplay =
    amountRupees && parseFloat(amountRupees) > 0
      ? formatRupeesCompact(Math.round(parseFloat(amountRupees) * 100))
      : "₹0";

  return (
    <div className="h-full flex flex-col min-h-0 space-y-2 overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-2 border-b border-slate-200 flex-shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <Wallet size={16} strokeWidth={2} />
            </div>
            <h2 className="text-lg font-bold tracking-tight text-slate-900">
              {t.payment.title}
            </h2>
          </div>
          <p className="text-xs text-slate-500">
            {t.payment.subtitle}
          </p>
        </div>

        {/* Voucher Type Tabs ("पैसा मिला (ग्राहक से)" vs "पैसा दिया (सप्लायर को)") */}
        <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200/80 text-xs">
          <button
            type="button"
            data-testid="payment-tab-receipt"
            onClick={() => {
              setPaymentType("receipt");
              setPartyId("");
              setMatchedInvoiceNo("");
              setCustomRefId("");
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
              paymentType === "receipt"
                ? "bg-white text-emerald-700 shadow-2xs border border-emerald-200/60"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <ArrowDownLeft size={14} strokeWidth={2.5} className="text-emerald-600" />
            <span>{t.payment.receiptTab}</span>
          </button>
          <button
            type="button"
            data-testid="payment-tab-payment"
            onClick={() => {
              setPaymentType("payment");
              setPartyId("");
              setMatchedInvoiceNo("");
              setCustomRefId("");
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
              paymentType === "payment"
                ? "bg-white text-rose-700 shadow-2xs border border-rose-200/60"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <ArrowUpRight size={14} strokeWidth={2.5} className="text-rose-600" />
            <span>{t.payment.paymentTab}</span>
          </button>
        </div>
      </div>

      <FeedbackBanner feedback={feedback} />

      {/* Main Entry Form Grid */}
      <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div
          data-scroll="true"
          className="flex-1 min-h-0 overflow-y-auto bg-white border border-slate-200 rounded-xl p-4 shadow-2xs space-y-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {/* 1. Party Selector */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  {t.payment.partyLabel} *
                </label>
                <button
                  type="button"
                  onClick={() => setIsPartyModalOpen(true)}
                  className="text-xs text-emerald-700 hover:text-emerald-900 font-semibold flex items-center gap-1"
                >
                  <Plus size={13} strokeWidth={2} />
                  <span>{t.common.newParty}</span>
                </button>
              </div>
              <div data-testid="payment-party-select">
                <SearchableSelect
                  options={partyOptions}
                  value={partyId}
                  onChange={handlePartyChange}
                  placeholder={t.payment.partyPlaceholder}
                />
              </div>
            </div>

            {/* 2. Amount Input (₹) */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  {t.payment.amountLabel} *
                </label>
                {matchedBill && (
                  <span className="text-[11px] font-medium text-slate-500">
                    {lang === "hi" ? "बकाया:" : "Pending:"}{" "}
                    <strong className="text-rose-700 font-mono">
                      {formatCurrency(matchedBill.pending_amount)}
                    </strong>
                  </span>
                )}
              </div>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-base">
                  ₹
                </span>
                <input
                  required
                  data-testid="payment-amount-input"
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  className={`w-full pl-8 pr-4 py-2.5 border rounded-xl text-base font-mono font-bold text-slate-900 bg-white focus:outline-none min-h-[46px] ${
                    isAmountExceeded
                      ? "border-rose-500 ring-1 ring-rose-500"
                      : "border-slate-300 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                  }`}
                  value={amountRupees}
                  onChange={(e) => setAmountRupees(e.target.value)}
                />
              </div>
              {isAmountExceeded && maxAllowedPaise !== null && (
                <p
                  className="text-xs text-rose-600 font-semibold mt-1"
                  data-testid="payment-amount-error"
                >
                  {lang === "hi"
                    ? `रकम बकाया राशि (${formatCurrency(maxAllowedPaise)}) से ज़्यादा नहीं हो सकती`
                    : `Amount cannot exceed pending bill (${formatCurrency(maxAllowedPaise)})`}
                </p>
              )}
            </div>

            {/* 3. Date */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">
                {t.payment.dateLabel} *
              </label>
              <input
                required
                type="date"
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm font-mono text-slate-900 bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 min-h-[46px]"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

          {/* Party Balance Status Cards (If party is chosen) */}
          {selectedParty && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-slate-50/80 border border-slate-200/80">
              {/* Current Outstanding */}
              <div>
                <span className="text-xs text-slate-500 font-medium block">
                  {t.payment.currentBalance} ({selectedParty.name})
                </span>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className={`text-xl font-bold font-mono ${
                      currentNetBalance > 0
                        ? "text-emerald-700"
                        : currentNetBalance < 0
                        ? "text-rose-700"
                        : "text-slate-700"
                    }`}
                  >
                    {formatCurrency(Math.abs(currentNetBalance))}
                  </span>
                  <span className="text-xs font-medium text-slate-500">
                    {currentNetBalance > 0
                      ? lang === "hi"
                        ? "लेना है"
                        : "Receivable"
                      : currentNetBalance < 0
                      ? lang === "hi"
                        ? "देना है"
                        : "Payable"
                      : t.lenDen.settledText}
                  </span>
                </div>
              </div>

              {/* Projected Balance */}
              <div>
                <span className="text-xs text-slate-500 font-medium block">
                  {t.payment.newBalance} ({lang === "hi" ? "इस एंट्री के बाद" : "After this entry"})
                </span>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className={`text-xl font-bold font-mono ${
                      projectedBalance > 0
                        ? "text-emerald-700"
                        : projectedBalance < 0
                        ? "text-rose-700"
                        : "text-slate-700"
                    }`}
                  >
                    {formatCurrency(Math.abs(projectedBalance))}
                  </span>
                  <span className="text-xs font-medium text-slate-500">
                    {projectedBalance > 0
                      ? lang === "hi"
                        ? "लेना रहेगा"
                        : "Remaining Receivable"
                      : projectedBalance < 0
                      ? lang === "hi"
                        ? "देना रहेगा"
                        : "Remaining Payable"
                      : t.lenDen.settledText}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Payment Mode Selector ("नकद / UPI / बैंक") */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">
              {t.payment.modeLabel} *
            </label>
            <div className="grid grid-cols-3 gap-3 max-w-lg">
              <button
                type="button"
                data-testid="payment-mode-cash"
                onClick={() => setPaymentMode("cash")}
                className={`py-3 px-4 rounded-xl text-sm font-semibold border flex items-center justify-center gap-2 transition-all ${
                  paymentMode === "cash"
                    ? "bg-emerald-50 border-emerald-600 text-emerald-800 ring-2 ring-emerald-600/20 shadow-sm"
                    : "border-slate-300 hover:bg-slate-50 text-slate-700 bg-white"
                }`}
              >
                <Wallet
                  size={16}
                  className={paymentMode === "cash" ? "text-emerald-600" : "text-slate-400"}
                />
                <span>{lang === "hi" ? "नकद" : "Cash"}</span>
              </button>

              <button
                type="button"
                data-testid="payment-mode-upi"
                onClick={() => setPaymentMode("upi_bank")}
                className={`py-3 px-4 rounded-xl text-sm font-semibold border flex items-center justify-center gap-2 transition-all ${
                  paymentMode === "upi_bank"
                    ? "bg-emerald-50 border-emerald-600 text-emerald-800 ring-2 ring-emerald-600/20 shadow-sm"
                    : "border-slate-300 hover:bg-slate-50 text-slate-700 bg-white"
                }`}
              >
                <span className="font-bold text-sm">UPI</span>
              </button>

              <button
                type="button"
                data-testid="payment-mode-bank"
                onClick={() => setPaymentMode("bank")}
                className={`py-3 px-4 rounded-xl text-sm font-semibold border flex items-center justify-center gap-2 transition-all ${
                  paymentMode === "bank"
                    ? "bg-emerald-50 border-emerald-600 text-emerald-800 ring-2 ring-emerald-600/20 shadow-sm"
                    : "border-slate-300 hover:bg-slate-50 text-slate-700 bg-white"
                }`}
              >
                <Landmark
                  size={16}
                  className={paymentMode === "bank" ? "text-emerald-600" : "text-slate-400"}
                />
                <span>{lang === "hi" ? "बैंक" : "Bank"}</span>
              </button>
            </div>
          </div>

          {/* Remark and Ref ID (टिप्पणी और बिल नंबर) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">
                {t.payment.remarkLabel}
              </label>
              <input
                type="text"
                placeholder={t.payment.remarkPlaceholder}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm text-slate-900 bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 min-h-[46px]"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">
                {t.payment.refIdLabel}
              </label>
              <input
                type="text"
                placeholder={
                  matchedInvoiceNo
                    ? `${matchedInvoiceNo} (${lang === "hi" ? "बकाया बिल" : "Matched Bill"})`
                    : t.payment.refIdPlaceholder
                }
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm font-mono text-slate-900 bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 min-h-[46px]"
                value={customRefId}
                onChange={(e) => {
                  setCustomRefId(e.target.value);
                  setMatchedInvoiceNo("");
                }}
              />
            </div>
          </div>

          {/* Pending Bills Matching Section ("बकाया बिल से जोड़ो (ज़रूरी नहीं)") */}
          <div className="pt-2 border-t border-slate-100 space-y-3" data-testid="pending-bills-section">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-900">
                  {t.payment.pendingBillSection}
                </h4>
                <p className="text-xs text-slate-500">
                  {t.payment.pendingBillHelp}
                </p>
              </div>
              {matchedInvoiceNo && (
                <button
                  type="button"
                  data-testid="clear-matched-bill-btn"
                  onClick={() => {
                    setMatchedInvoiceNo("");
                    setCustomRefId("");
                  }}
                  className="text-xs text-rose-600 hover:text-rose-800 flex items-center gap-1 font-semibold"
                >
                  <X size={14} />
                  <span>{lang === "hi" ? "चुनाव हटाओ" : "Clear selection"}</span>
                </button>
              )}
            </div>

            {!partyId ? (
              <div
                data-testid="pending-bills-no-party"
                className="p-4 bg-slate-50 rounded-xl text-xs text-slate-500 text-center border border-slate-200/60 font-medium"
              >
                {lang === "hi" ? "पहले पार्टी चुनो" : "Please select a party first"}
              </div>
            ) : loadingBills ? (
              <div className="py-4 text-center text-xs text-slate-400">
                {t.common.loading}
              </div>
            ) : filteredPendingBills.length === 0 ? (
              <div
                data-testid="pending-bills-empty"
                className="p-3 bg-slate-50 rounded-xl text-xs text-slate-500 text-center border border-slate-200/60"
              >
                {t.payment.noPendingBills}
              </div>
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                      <th className="py-2.5 px-3">{lang === "hi" ? "चुनें" : "Select"}</th>
                      <th className="py-2.5 px-3">{lang === "hi" ? "बिल नंबर" : "Bill No"}</th>
                      <th className="py-2.5 px-3">{t.common.date}</th>
                      <th className="py-2.5 px-3">{lang === "hi" ? "प्रकार" : "Type"}</th>
                      <th className="py-2.5 px-3 text-right">{t.common.total}</th>
                      <th className="py-2.5 px-3 text-right">{lang === "hi" ? "जमा" : "Paid"}</th>
                      <th className="py-2.5 px-3 text-right text-rose-700 font-bold">
                        {lang === "hi" ? "बकाया" : "Pending"}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredPendingBills.map((bill) => {
                      const isSelected = matchedInvoiceNo === bill.invoice_no;
                      return (
                        <tr
                          key={bill.invoice_no}
                          data-testid={`pending-bill-row-${bill.invoice_no}`}
                          onClick={() => handleSelectPendingBill(bill)}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? "bg-emerald-50/80 font-semibold"
                              : "hover:bg-slate-50/70"
                          }`}
                        >
                          <td className="py-2.5 px-3 text-center">
                            <input
                              type="radio"
                              name="matchedBill"
                              checked={isSelected}
                              onChange={() => handleSelectPendingBill(bill)}
                              className="text-emerald-600 focus:ring-emerald-500"
                            />
                          </td>
                          <td className="py-2.5 px-3 font-mono font-medium text-slate-900">
                            {bill.invoice_no}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-600">
                            {formatDate(bill.date)}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                bill.bill_type === "sale"
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : "bg-slate-100 text-slate-700 border border-slate-200"
                              }`}
                            >
                              {bill.bill_type === "sale"
                                ? lang === "hi"
                                  ? "बिक्री"
                                  : "Sale"
                                : lang === "hi"
                                ? "खरीदी"
                                : "Purchase"}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-700">
                            {formatCurrency(bill.total_amount)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-emerald-700">
                            {formatCurrency(bill.paid_amount)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-rose-700 font-bold">
                            {formatCurrency(bill.pending_amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Bottom Live Summary & Submit Button */}
          <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="text-sm font-semibold" data-testid="payment-live-summary">
              {!partyId ? (
                <span className="text-slate-500 font-medium">
                  {lang === "hi" ? "पहले पार्टी चुनो" : "Please select a party first"}
                </span>
              ) : paymentType === "receipt" ? (
                <span className="text-emerald-800 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200 inline-block">
                  {lang === "hi"
                    ? `${partyDisplayName} से ${amountDisplay} मिले, उनका लेना ${amountDisplay} कम होगा`
                    : `Received ${amountDisplay} from ${partyDisplayName}, outstanding will decrease by ${amountDisplay}`}
                </span>
              ) : (
                <span className="text-rose-800 bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-200 inline-block">
                  {lang === "hi"
                    ? `${partyDisplayName} को ${amountDisplay} दिए, आपका देना ${amountDisplay} कम होगा`
                    : `Paid ${amountDisplay} to ${partyDisplayName}, liability will decrease by ${amountDisplay}`}
                </span>
              )}
            </div>

            <button
              type="submit"
              data-testid="payment-submit-btn"
              disabled={saving || !partyId || !amountRupees || parsedAmountPaise <= 0 || isAmountExceeded}
              title={
                !partyId
                  ? "पहले पार्टी चुनो"
                  : isAmountExceeded
                  ? lang === "hi"
                    ? "रकम बकाया बिल से ज़्यादा है"
                    : "Amount exceeds pending bill"
                  : undefined
              }
              className={`w-full sm:w-auto px-8 py-3 rounded-xl font-bold text-sm text-white shadow-sm transition-all flex items-center justify-center gap-2 ${
                paymentType === "receipt"
                  ? "bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500"
                  : "bg-slate-800 hover:bg-slate-900 focus:ring-slate-500"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {saving ? (
                <span>{t.payment.savingBtn}</span>
              ) : !partyId ? (
                <span>पहले पार्टी चुनो</span>
              ) : (
                <>
                  <CheckCircle2 size={16} strokeWidth={2} />
                  <span>
                    {paymentType === "receipt"
                      ? lang === "hi"
                        ? "पैसा मिला दर्ज करें"
                        : "Record Receipt"
                      : lang === "hi"
                      ? "पैसा दिया दर्ज करें"
                      : "Record Payment"}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Add Party Modal */}
      <AddPartyModal
        isOpen={isPartyModalOpen}
        onClose={() => setIsPartyModalOpen(false)}
        onSuccess={() => {
          loadPartiesAndBalances();
          if (onRefresh) onRefresh();
        }}
        t={t}
      />
    </div>
  );
}
