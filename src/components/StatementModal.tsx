import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PartyStatement } from "../types";
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
} from "./icons";
import { EmptyTableMessage } from "./FeedbackBanner";

interface StatementModalProps {
  partyId: number | null;
  isOpen: boolean;
  onClose: () => void;
  t: Translations;
  lang: Language;
  shopName: string;
}

export function StatementModal({
  partyId,
  isOpen,
  onClose,
  t,
  lang,
  shopName,
}: StatementModalProps) {
  const [statement, setStatement] = useState<PartyStatement | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    if (isOpen && partyId) {
      loadStatement(partyId);
    } else {
      setStatement(null);
      setSearchTerm("");
    }
  }, [isOpen, partyId]);

  const loadStatement = async (id: number) => {
    setLoading(true);
    try {
      const res = await invoke<PartyStatement>("get_party_statement_cmd", { partyId: id });
      setStatement(res);
    } catch (e) {
      console.error("get_party_statement_cmd error:", e);
    } finally {
      setLoading(false);
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
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredEntries.length === 0 ? (
                        <tr>
                          <td colSpan={8}>
                            <EmptyTableMessage message={t.statement.emptyStatement} />
                          </td>
                        </tr>
                      ) : (
                        filteredEntries.map((entry) => {
                          const typeLabel = getEntryTypeLabel(entry.entry_type, entry.debit, entry.credit);
                          const badgeColor = getEntryBadgeColor(entry.entry_type, entry.debit, entry.credit);

                          return (
                            <tr key={entry.id} className="hover:bg-slate-50/70 transition-colors">
                              <td className="py-2.5 px-3.5 whitespace-nowrap text-slate-700 font-mono">
                                {formatDate(entry.date)}
                              </td>
                              <td className="py-2.5 px-3.5 whitespace-nowrap">
                                <span
                                  className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium border ${badgeColor}`}
                                >
                                  {typeLabel}
                                </span>
                              </td>
                              <td className="py-2.5 px-3.5 whitespace-nowrap font-mono text-slate-600 font-medium">
                                {entry.ref_id || "-"}
                              </td>
                              <td className="py-2.5 px-3.5 whitespace-nowrap text-right font-mono font-semibold text-emerald-700">
                                {entry.debit > 0 ? formatCurrency(entry.debit) : "-"}
                              </td>
                              <td className="py-2.5 px-3.5 whitespace-nowrap text-right font-mono font-semibold text-rose-700">
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
    </div>
  );
}
