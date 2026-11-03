import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PartyStatement, PartyStatementItem, SessionUser } from "../types";
import { Translations, Language } from "../i18n";
import { formatCurrency, formatDate, formatPaymentMode } from "../utils/formatters";
import {
  X,
  Printer,
  Search,
  BookOpen,
  ArrowDownLeft,
  ArrowUpRight,
  Phone,
  MapPin,
  FileText,
  Edit,
} from "./icons";
import { EmptyTableMessage } from "./FeedbackBanner";

interface StatementModalProps {
  partyId: number | null;
  isOpen: boolean;
  onClose: () => void;
  t: Translations;
  lang: Language;
  shopName: string;
  onRefresh?: () => void;
  booksLockedUntil?: string | null;
  currentUser?: SessionUser | null;
}

export function StatementModal({
  partyId,
  isOpen,
  onClose,
  t,
  lang,
  shopName,
  onRefresh,
  booksLockedUntil,
  currentUser,
}: StatementModalProps) {
  const isStaff = currentUser?.role === "staff";
  const [statement, setStatement] = useState<PartyStatement | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  // Payment Alteration and Cancellation States
  const [alterModalOpen, setAlterModalOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [activePaymentEntry, setActivePaymentEntry] = useState<PartyStatementItem | null>(null);

  const [alterDate, setAlterDate] = useState("");
  const [alterAmountRupees, setAlterAmountRupees] = useState("");
  const [alterPaymentMode, setAlterPaymentMode] = useState("cash");
  const [alterRemark, setAlterRemark] = useState("");
  const [alterReason, setAlterReason] = useState("");

  const [cancelReason, setCancelReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ message: string; isError: boolean } | null>(null);

  useEffect(() => {
    if (isOpen && partyId) {
      loadStatement(partyId);
      setActionFeedback(null);
    } else {
      setStatement(null);
      setSearchTerm("");
      setAlterModalOpen(false);
      setCancelModalOpen(false);
      setActivePaymentEntry(null);
      setActionFeedback(null);
    }
  }, [isOpen, partyId]);

  const loadStatement = async (id: number) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const res = await invoke<PartyStatement>("get_party_statement_cmd", { partyId: id });
      setStatement(res);
    } catch (e: any) {
      console.error("get_party_statement_cmd error:", e);
      setErrorMessage(typeof e === "string" ? e : (e?.message || "विवरण लोड नहीं हो सका / Error loading statement"));
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAlter = (entry: PartyStatementItem) => {
    setActivePaymentEntry(entry);
    setAlterDate(entry.date);
    const amount = entry.credit > 0 ? entry.credit : entry.debit;
    setAlterAmountRupees((amount / 100).toFixed(2));
    setAlterPaymentMode(entry.payment_mode || "cash");
    setAlterRemark(entry.remark || "");
    setAlterReason("");
    setActionFeedback(null);
    setAlterModalOpen(true);
  };

  const handleOpenCancel = (entry: PartyStatementItem) => {
    setActivePaymentEntry(entry);
    setCancelReason("");
    setActionFeedback(null);
    setCancelModalOpen(true);
  };

  const handleConfirmAlter = async () => {
    if (!activePaymentEntry) return;
    const amountVal = parseFloat(alterAmountRupees);
    if (isNaN(amountVal) || amountVal <= 0) {
      setActionFeedback({
        message: lang === "hi" ? "कृपया मान्य राशि दर्ज करें" : "Please enter a valid amount",
        isError: true,
      });
      return;
    }
    if (!alterReason.trim()) {
      setActionFeedback({
        message: lang === "hi" ? "संशोधन का कारण लिखना अनिवार्य है" : "Reason for alteration is required",
        isError: true,
      });
      return;
    }

    if (booksLockedUntil && (activePaymentEntry.date <= booksLockedUntil || alterDate <= booksLockedUntil)) {
      setActionFeedback({
        message:
          lang === "hi"
            ? `अवधि बंद है (${booksLockedUntil} तक)। इस भुगतान को संशोधित नहीं किया जा सकता।`
            : `Books are locked until ${booksLockedUntil}. Cannot alter this payment.`,
        isError: true,
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await invoke("alter_payment_cmd", {
        payload: {
          ledgerId: activePaymentEntry.id,
          date: alterDate,
          amountPaise: Math.round(amountVal * 100),
          paymentMode: alterPaymentMode,
          remark: alterRemark.trim() || null,
          refId: activePaymentEntry.ref_id,
          reason: alterReason.trim() || null,
        },
      });

      setActionFeedback({
        message:
          lang === "hi"
            ? `भुगतान सफलता से संशोधित हुआ (₹${amountVal.toFixed(2)})`
            : `Payment altered successfully (₹${amountVal.toFixed(2)})`,
        isError: false,
      });
      setAlterModalOpen(false);
      setActivePaymentEntry(null);
      if (partyId) await loadStatement(partyId);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      console.error("alter_payment_cmd error:", err);
      const raw = typeof err === "string" ? err : err?.message || String(err || "");
      setActionFeedback({
        message: lang === "hi" ? `भुगतान संशोधन में त्रुटि: ${raw}` : `Error altering payment: ${raw}`,
        isError: true,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (!activePaymentEntry) return;
    if (!cancelReason.trim()) {
      setActionFeedback({
        message: lang === "hi" ? "रद्द करने का कारण लिखना अनिवार्य है" : "Cancellation reason is required",
        isError: true,
      });
      return;
    }

    if (booksLockedUntil && activePaymentEntry.date <= booksLockedUntil) {
      setActionFeedback({
        message:
          lang === "hi"
            ? `अवधि बंद है (${booksLockedUntil} तक)। इस भुगतान को रद्द नहीं किया जा सकता।`
            : `Books are locked until ${booksLockedUntil}. Cannot cancel this payment.`,
        isError: true,
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await invoke("cancel_payment_cmd", {
        ledgerId: activePaymentEntry.id,
        reason: cancelReason.trim(),
      });

      setActionFeedback({
        message:
          lang === "hi"
            ? `भुगतान सफलतापूर्वक रद्द (Cancelled) किया गया।`
            : `Payment cancelled successfully.`,
        isError: false,
      });
      setCancelModalOpen(false);
      setActivePaymentEntry(null);
      if (partyId) await loadStatement(partyId);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      console.error("cancel_payment_cmd error:", err);
      const raw = typeof err === "string" ? err : err?.message || String(err || "");
      setActionFeedback({
        message: lang === "hi" ? `भुगतान रद्द करने में त्रुटि: ${raw}` : `Error cancelling payment: ${raw}`,
        isError: true,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !partyId) return null;

  const filteredEntries = (statement?.entries || []).filter((e) => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return true;
    return (
      e.date.includes(term) ||
      (e.ref_id && e.ref_id.toLowerCase().includes(term)) ||
      (e.remark && e.remark.toLowerCase().includes(term)) ||
      e.entry_type.toLowerCase().includes(term)
    );
  });

  const getEntryTypeLabel = (entryType: string, debit: number, credit: number) => {
    if (entryType === "sale") return t.statement.typeSale;
    if (entryType === "purchase") return t.statement.typePurchase;
    if (entryType === "payment") {
      if (credit > 0) return t.statement.typeReceipt;
      if (debit > 0) return t.statement.typePayment;
      return t.statement.typePayment;
    }
    return entryType;
  };

  const getEntryBadgeColor = (entryType: string, debit: number, credit: number) => {
    if (entryType === "sale") return "bg-sky-50 text-sky-700 border-sky-200";
    if (entryType === "purchase") return "bg-amber-50 text-amber-700 border-amber-200";
    if (credit > 0) return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (debit > 0) return "bg-rose-50 text-rose-700 border-rose-200";
    return "bg-slate-100 text-slate-700 border-slate-200";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center border border-emerald-100">
              <BookOpen size={20} strokeWidth={1.75} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-slate-900 tracking-tight">
                  {statement ? statement.party_name : t.statement.title}
                </h3>
                {statement?.category && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">
                    {statement.category}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-500 mt-0.5">
                {statement?.village && (
                  <span className="flex items-center gap-1">
                    <MapPin size={12} className="text-slate-400" />
                    {statement.village}
                  </span>
                )}
                {statement?.phone && (
                  <span className="flex items-center gap-1 font-mono">
                    <Phone size={12} className="text-slate-400" />
                    {statement.phone}
                  </span>
                )}
                {statement?.gstin && (
                  <span className="font-mono text-slate-400">GSTIN: {statement.gstin}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors flex items-center gap-1.5 no-print"
            >
              <Printer size={14} strokeWidth={1.75} />
              <span>{t.statement.printStatement}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <X size={18} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loading ? (
            <div className="py-16 text-center text-slate-400 text-sm">
              <div className="animate-spin w-6 h-6 border-2 border-emerald-600 border-t-transparent rounded-full mx-auto mb-2" />
              {t.common.loading}
            </div>
          ) : errorMessage ? (
            <div className="py-16 text-center text-amber-700 text-sm max-w-md mx-auto space-y-2">
              <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto text-xl">
                🔒
              </div>
              <p className="font-semibold text-slate-800">{errorMessage}</p>
              <p className="text-xs text-slate-500">
                {lang === "hi"
                  ? "सप्लायर का खाता विवरण केवल व्यवस्थापक (Owner) देख सकते हैं।"
                  : "Supplier statements are restricted to Owner."}
              </p>
            </div>
          ) : !statement ? (
            <div className="py-16 text-center text-slate-400 text-sm">
              {t.statement.emptyStatement}
            </div>
          ) : (
            <>
              {/* Printable Header Details (Visible when printing) */}
              <div className="hidden print:block pb-4 mb-4 border-b border-slate-200">
                <div className="text-center">
                  <h1 className="text-xl font-bold">{shopName}</h1>
                  <p className="text-xs text-slate-500">खाता विवरण (Party Account Statement)</p>
                </div>
                <div className="mt-3 flex justify-between text-xs">
                  <div>
                    <p className="font-bold">{statement.party_name}</p>
                    <p>{statement.village || ""} {statement.phone ? `• ${statement.phone}` : ""}</p>
                  </div>
                  <div className="text-right">
                    <p>तारीख: {new Date().toLocaleDateString("en-IN")}</p>
                  </div>
                </div>
              </div>

              {/* Action feedback message */}
              {actionFeedback && (
                <div
                  className={`p-3 rounded-xl border text-xs font-medium flex items-center justify-between ${
                    actionFeedback.isError
                      ? "bg-rose-50 border-rose-200 text-rose-800"
                      : "bg-emerald-50 border-emerald-200 text-emerald-800"
                  }`}
                >
                  <span>{actionFeedback.message}</span>
                  <button
                    type="button"
                    onClick={() => setActionFeedback(null)}
                    className="p-1 hover:bg-black/5 rounded"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* 3 Summary KPI Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Total Debit */}
                <div className="p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/50">
                  <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                    <span>{lang === "hi" ? "कुल नामे (डेबिट)" : "Total Debit"}</span>
                    <span className="p-1 rounded bg-emerald-50 text-emerald-600">
                      <ArrowDownLeft size={16} strokeWidth={2} />
                    </span>
                  </div>
                  <div className="text-xl font-bold font-mono text-emerald-700 mt-1">
                    {formatCurrency(statement.total_debit)}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {lang === "hi" ? "बिक्री / भुगतान दिया" : "Sales / Paid to party"}
                  </div>
                </div>

                {/* Total Credit */}
                <div className="p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/50">
                  <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                    <span>{lang === "hi" ? "कुल जमा (क्रेडिट)" : "Total Credit"}</span>
                    <span className="p-1 rounded bg-rose-50 text-rose-600">
                      <ArrowUpRight size={16} strokeWidth={2} />
                    </span>
                  </div>
                  <div className="text-xl font-bold font-mono text-rose-700 mt-1">
                    {formatCurrency(statement.total_credit)}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {lang === "hi" ? "खरीदी / पैसा मिला" : "Purchases / Received"}
                  </div>
                </div>

                {/* Net Closing Balance */}
                <div className="p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/50">
                  <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                    <span>{lang === "hi" ? "अंतिम बकाया (Net Status)" : "Net Balance"}</span>
                    <span className="p-1 rounded bg-slate-100 text-slate-600">
                      <FileText size={16} strokeWidth={2} />
                    </span>
                  </div>
                  <div
                    className={`text-xl font-bold font-mono mt-1 ${
                      statement.closing_balance > 0
                        ? "text-emerald-700"
                        : statement.closing_balance < 0
                        ? "text-rose-700"
                        : "text-slate-700"
                    }`}
                  >
                    {formatCurrency(Math.abs(statement.closing_balance))}
                  </div>
                  <div className="text-[11px] font-semibold mt-0.5">
                    {statement.closing_balance > 0 && (
                      <span className="text-emerald-700">
                        {lang === "hi" ? "पार्टी से लेना है" : "Receivable from party"}
                      </span>
                    )}
                    {statement.closing_balance < 0 && (
                      <span className="text-rose-700">
                        {lang === "hi" ? "पार्टी को देना है" : "Payable to party"}
                      </span>
                    )}
                    {statement.closing_balance === 0 && (
                      <span className="text-slate-500">{t.lenDen.settledText}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Search within ledger */}
              <div className="flex items-center justify-between gap-3 pt-1 no-print">
                <div className="relative w-full sm:w-72">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <Search size={15} strokeWidth={1.75} />
                  </span>
                  <input
                    type="text"
                    className="w-full pl-9 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-slate-50/50 focus:bg-white focus:ring-1 focus:ring-emerald-500 outline-none"
                    placeholder={lang === "hi" ? "तारीख, बिल नं या विवरण खोजें..." : "Filter by date, ref or remark..."}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <div className="text-xs text-slate-500">
                  {lang === "hi" ? "कुल प्रविष्टियां" : "Total Entries"}:{" "}
                  <span className="font-semibold text-slate-800">{filteredEntries.length}</span>
                </div>
              </div>

              {/* Ledger Statement Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50/80 text-slate-600 font-semibold border-b border-slate-200">
                        <th className="py-2.5 px-3.5 whitespace-nowrap">{t.statement.date}</th>
                        <th className="py-2.5 px-3.5 whitespace-nowrap">{t.statement.type}</th>
                        <th className="py-2.5 px-3.5 whitespace-nowrap">{t.statement.refNo}</th>
                        <th className="py-2.5 px-3.5 text-right text-emerald-800 font-semibold whitespace-nowrap">
                          {t.statement.debit}
                        </th>
                        <th className="py-2.5 px-3.5 text-right text-rose-800 font-semibold whitespace-nowrap">
                          {t.statement.credit}
                        </th>
                        <th className="py-2.5 px-3.5 whitespace-nowrap">{t.statement.mode}</th>
                        <th className="py-2.5 px-3.5 min-w-[140px]">{t.statement.remark}</th>
                        <th className="py-2.5 px-3.5 text-right font-semibold whitespace-nowrap">
                          {t.statement.balance}
                        </th>
                        <th className="py-2.5 px-3.5 text-center font-semibold whitespace-nowrap no-print">
                          {lang === "hi" ? "कार्रवाई" : "Actions"}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredEntries.length === 0 ? (
                        <tr>
                          <td colSpan={9}>
                            <EmptyTableMessage message={t.statement.emptyStatement} />
                          </td>
                        </tr>
                      ) : (
                        filteredEntries.map((entry) => {
                          const typeLabel = getEntryTypeLabel(entry.entry_type, entry.debit, entry.credit);
                          const badgeColor = getEntryBadgeColor(entry.entry_type, entry.debit, entry.credit);
                          const isLocked = Boolean(
                            booksLockedUntil && entry.date <= booksLockedUntil
                          );

                          const isCancelled = Boolean(entry.is_cancelled);
                          const isRealActivePayment = entry.entry_type === "payment" && !isCancelled;

                          return (
                            <tr
                              key={entry.id}
                              className={`transition-colors ${
                                isCancelled
                                  ? "bg-slate-50/80 opacity-75 hover:bg-slate-100/80"
                                  : "hover:bg-slate-50/70"
                              }`}
                            >
                              <td className="py-2.5 px-3.5 whitespace-nowrap text-slate-700 font-mono">
                                {formatDate(entry.date)}
                              </td>
                              <td className="py-2.5 px-3.5 whitespace-nowrap">
                                <span
                                  className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium border ${
                                    isCancelled
                                      ? "bg-slate-100 text-slate-500 border-slate-300 line-through"
                                      : badgeColor
                                  }`}
                                >
                                  {typeLabel}
                                  {isCancelled ? ` (${lang === "hi" ? "रद्द" : "Cancelled"})` : ""}
                                </span>
                              </td>
                              <td className={`py-2.5 px-3.5 whitespace-nowrap font-mono text-slate-600 font-medium ${isCancelled ? "line-through text-slate-400" : ""}`}>
                                {entry.ref_id || "-"}
                              </td>
                              <td className={`py-2.5 px-3.5 whitespace-nowrap text-right font-mono font-semibold ${isCancelled ? "line-through text-slate-400" : "text-emerald-700"}`}>
                                {entry.debit > 0 ? formatCurrency(entry.debit) : "-"}
                              </td>
                              <td className={`py-2.5 px-3.5 whitespace-nowrap text-right font-mono font-semibold ${isCancelled ? "line-through text-slate-400" : "text-rose-700"}`}>
                                {entry.credit > 0 ? formatCurrency(entry.credit) : "-"}
                              </td>
                              <td className="py-2.5 px-3.5 whitespace-nowrap text-slate-600">
                                {formatPaymentMode(entry.payment_mode, lang)}
                              </td>
                              <td className="py-2.5 px-3.5 text-slate-500 max-w-xs truncate">
                                {entry.remark || "-"}
                              </td>
                              <td className="py-2.5 px-3.5 whitespace-nowrap text-right font-mono font-semibold">
                                <span
                                  className={
                                    entry.running_balance > 0
                                      ? "text-emerald-700"
                                      : entry.running_balance < 0
                                      ? "text-rose-700"
                                      : "text-slate-500"
                                  }
                                >
                                  {formatCurrency(Math.abs(entry.running_balance))}
                                  <span className="text-[10px] ml-1 font-sans text-slate-400">
                                    {entry.running_balance > 0
                                      ? "(लेना)"
                                      : entry.running_balance < 0
                                      ? "(देना)"
                                      : ""}
                                  </span>
                                </span>
                              </td>
                              <td className="py-2.5 px-3.5 whitespace-nowrap text-center no-print">
                                {isRealActivePayment && !isStaff ? (
                                  <div className="inline-flex items-center gap-1.5 justify-center">
                                    <button
                                      type="button"
                                      disabled={isLocked}
                                      onClick={() => handleOpenAlter(entry)}
                                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${
                                        isLocked
                                          ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                                          : "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 transition-colors"
                                      }`}
                                      title={
                                        isLocked
                                          ? lang === "hi"
                                            ? `अवधि बंद (${booksLockedUntil})`
                                            : `Books locked until ${booksLockedUntil}`
                                          : lang === "hi"
                                          ? "भुगतान संशोधित करें"
                                          : "Alter Payment"
                                      }
                                    >
                                      <Edit size={12} strokeWidth={2} />
                                      <span>{lang === "hi" ? "संशोधित" : "Alter"}</span>
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isLocked}
                                      onClick={() => handleOpenCancel(entry)}
                                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${
                                        isLocked
                                          ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                                          : "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100 transition-colors"
                                      }`}
                                      title={
                                        isLocked
                                          ? lang === "hi"
                                            ? `अवधि बंद (${booksLockedUntil})`
                                            : `Books locked until ${booksLockedUntil}`
                                          : lang === "hi"
                                          ? "भुगतान रद्द करें"
                                          : "Cancel Payment"
                                      }
                                    >
                                      <X size={12} strokeWidth={2} />
                                      <span>{lang === "hi" ? "रद्द" : "Cancel"}</span>
                                    </button>
                                  </div>
                                ) : isCancelled ? (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                                    {lang === "hi" ? "रद्द (Cancelled)" : "Cancelled"}
                                  </span>
                                ) : (
                                  <span className="text-slate-300">-</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3 no-print">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200/80 rounded-lg transition-colors border border-slate-200"
          >
            {t.statement.closeBtn}
          </button>
        </div>
      </div>

      {/* Alter Payment Modal */}
      {alterModalOpen && activePaymentEntry && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b pb-3 border-slate-100">
              <h4 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <Edit size={16} className="text-blue-600" />
                <span>{lang === "hi" ? "भुगतान संशोधन (Alter Payment)" : "Alter Payment"}</span>
              </h4>
              <button
                type="button"
                onClick={() => setAlterModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-600 font-medium mb-1">
                  {lang === "hi" ? "तारीख (Date)" : "Date"}
                </label>
                <input
                  type="date"
                  value={alterDate}
                  onChange={(e) => setAlterDate(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">
                  {lang === "hi" ? "राशि (Amount ₹)" : "Amount (₹)"}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={alterAmountRupees}
                  onChange={(e) => setAlterAmountRupees(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">
                  {lang === "hi" ? "भुगतान माध्यम (Payment Mode)" : "Payment Mode"}
                </label>
                <select
                  value={alterPaymentMode}
                  onChange={(e) => setAlterPaymentMode(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                >
                  <option value="cash">{lang === "hi" ? "नकद (Cash)" : "Cash"}</option>
                  <option value="bank">{lang === "hi" ? "बैंक (Bank)" : "Bank"}</option>
                  <option value="upi">{lang === "hi" ? "यूपीआई (UPI)" : "UPI"}</option>
                  <option value="cheque">{lang === "hi" ? "चेक (Cheque)" : "Cheque"}</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">
                  {lang === "hi" ? "टिप्पणी (Remark)" : "Remark"}
                </label>
                <input
                  type="text"
                  value={alterRemark}
                  onChange={(e) => setAlterRemark(e.target.value)}
                  placeholder={lang === "hi" ? "वैकल्पिक टिप्पणी" : "Optional remark"}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  {lang === "hi" ? "संशोधन का कारण (Reason) *" : "Reason for Alteration *"}
                </label>
                <textarea
                  rows={2}
                  required
                  value={alterReason}
                  onChange={(e) => setAlterReason(e.target.value)}
                  placeholder={
                    lang === "hi"
                      ? "संशोधन का कारण लिखना अनिवार्य है..."
                      : "Reason for alteration is mandatory..."
                  }
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {booksLockedUntil && (alterDate <= booksLockedUntil || activePaymentEntry.date <= booksLockedUntil) && (
                <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-[11px]">
                  ⚠️ {lang === "hi" ? `अवधि बंद है (${booksLockedUntil} तक)। इस तारीख पर संशोधन वर्जित है।` : `Period is locked until ${booksLockedUntil}.`}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setAlterModalOpen(false)}
                className="px-3 py-1.5 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 text-xs font-medium"
              >
                {lang === "hi" ? "रद्द करें" : "Cancel"}
              </button>
              <button
                type="button"
                disabled={
                  isSubmitting ||
                  !alterReason.trim() ||
                  Boolean(
                    booksLockedUntil &&
                      (alterDate <= booksLockedUntil || activePaymentEntry.date <= booksLockedUntil)
                  )
                }
                onClick={handleConfirmAlter}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-xs"
              >
                {isSubmitting ? (lang === "hi" ? "सहेज रहे हैं..." : "Saving...") : (lang === "hi" ? "संशोधन सहेजें" : "Save Changes")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Payment Modal */}
      {cancelModalOpen && activePaymentEntry && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl border border-rose-200 w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between border-b pb-3 border-slate-100">
              <h4 className="font-bold text-rose-800 text-sm flex items-center gap-2">
                <X size={16} className="text-rose-600" />
                <span>{lang === "hi" ? "भुगतान रद्द करें (Cancel Payment)" : "Cancel Payment"}</span>
              </h4>
              <button
                type="button"
                onClick={() => setCancelModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-slate-700">
                {lang === "hi"
                  ? `क्या आप वाकई ${formatDate(activePaymentEntry.date)} का यह भुगतान (${formatCurrency(
                      activePaymentEntry.credit > 0 ? activePaymentEntry.credit : activePaymentEntry.debit
                    )}) रद्द करना चाहते हैं?`
                  : `Are you sure you want to cancel this payment of ${formatCurrency(
                      activePaymentEntry.credit > 0 ? activePaymentEntry.credit : activePaymentEntry.debit
                    )} on ${formatDate(activePaymentEntry.date)}?`}
              </p>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  {lang === "hi" ? "रद्द करने का कारण (Reason) *" : "Cancellation Reason *"}
                </label>
                <textarea
                  rows={2}
                  required
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder={
                    lang === "hi"
                      ? "रद्द करने का कारण लिखना अनिवार्य है..."
                      : "Reason for cancellation is mandatory..."
                  }
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg outline-none focus:ring-1 focus:ring-rose-500"
                />
              </div>

              {booksLockedUntil && activePaymentEntry.date <= booksLockedUntil && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-[11px]">
                  ⚠️ {lang === "hi" ? `अवधि बंद है (${booksLockedUntil} तक)। इस भुगतान को रद्द नहीं किया जा सकता।` : `Period is locked until ${booksLockedUntil}.`}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setCancelModalOpen(false)}
                className="px-3 py-1.5 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 text-xs font-medium"
              >
                {lang === "hi" ? "पीछे हटें" : "Go Back"}
              </button>
              <button
                type="button"
                disabled={
                  isSubmitting ||
                  !cancelReason.trim() ||
                  Boolean(booksLockedUntil && activePaymentEntry.date <= booksLockedUntil)
                }
                onClick={handleConfirmCancel}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-xs"
              >
                {isSubmitting ? (lang === "hi" ? "रद्द कर रहे हैं..." : "Cancelling...") : (lang === "hi" ? "हाँ, रद्द करें" : "Yes, Cancel Payment")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
