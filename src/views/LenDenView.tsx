import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PartyBalance } from "../types";
import { Translations, Language } from "../i18n";
import { Search, X, ArrowDownLeft, ArrowUpRight, BookOpen, Wallet } from "../components/icons";
import { EmptyTableMessage } from "../components/FeedbackBanner";
import { StatementModal } from "../components/StatementModal";
import { Pagination } from "../components/Pagination";
import { formatCurrency } from "../utils/formatters";

interface LenDenViewProps {
  refreshTrigger: number;
  t: Translations;
  lang: Language;
  shopName?: string;
  onOpenPayment?: (partyId?: number, type?: "receipt" | "payment") => void;
}

type BalanceFilter = "all" | "receivable" | "payable" | "settled";

export function LenDenView({ refreshTrigger, t, lang, shopName = "श्री राम कृषि केंद्र", onOpenPayment }: LenDenViewProps) {
  const [balances, setBalances] = useState<PartyBalance[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState<BalanceFilter>("all");
  const [selectedPartyId, setSelectedPartyId] = useState<number | null>(null);
  const [isStatementOpen, setIsStatementOpen] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 6;

  const loadBalances = async () => {
    try {
      const res = await invoke<PartyBalance[]>("get_party_balances_cmd");
      setBalances(res);
    } catch (e) {
      console.error("get_party_balances_cmd error:", e);
    }
  };

  useEffect(() => {
    loadBalances();
  }, [refreshTrigger]);

  const filteredBalances = balances.filter((b) => {
    const term = searchTerm.toLowerCase().trim();
    const matchesSearch =
      !term ||
      b.party_name.toLowerCase().includes(term) ||
      (b.village && b.village.toLowerCase().includes(term)) ||
      (b.phone && b.phone.includes(term));

    if (!matchesSearch) return false;

    if (activeFilter === "receivable") return b.net_balance > 0;
    if (activeFilter === "payable") return b.net_balance < 0;
    if (activeFilter === "settled") return b.net_balance === 0;
    return true;
  });

  const paginatedBalances = filteredBalances.slice((page - 1) * pageSize, page * pageSize);

  const totalReceivable = balances
    .filter((b) => b.net_balance > 0)
    .reduce((sum, b) => sum + b.net_balance, 0);

  const totalPayable = balances
    .filter((b) => b.net_balance < 0)
    .reduce((sum, b) => sum + Math.abs(b.net_balance), 0);

  return (
    <div className="h-full flex flex-col min-h-0 space-y-2.5 overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-2 border-b border-slate-100 flex-shrink-0">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">
            {t.lenDen.title}
          </h2>
          <p className="text-xs text-slate-500">
            {t.lenDen.subtitle} • {lang === "hi" ? "पार्टी पर क्लिक करके खाता देखें" : "Click party to view ledger"}
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* Quick Payment Action Button */}
          {onOpenPayment && (
            <button
              type="button"
              onClick={() => onOpenPayment(undefined, "receipt")}
              className="btn-primary py-1.5 px-2.5 text-xs flex items-center gap-1.5 whitespace-nowrap shadow-xs"
            >
              <Wallet size={14} strokeWidth={2} />
              <span>{lang === "hi" ? "पैसा मिला / दिया" : "Payment / Receipt"}</span>
            </button>
          )}

          {/* Search */}
          <div className="relative w-full sm:w-60">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
              <Search size={14} strokeWidth={1.75} />
            </span>
            <input
              type="text"
              className="w-full pl-8 pr-7 py-1.5 border border-slate-200 rounded-lg text-xs bg-slate-50/50 hover:bg-white focus:bg-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-colors"
              placeholder={lang === "hi" ? "पार्टी या गांव खोजें..." : "Search party or village..."}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm("");
                  setPage(1);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
              >
                <X size={12} strokeWidth={2} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 flex-shrink-0">
        {/* Receivable */}
        <div className="bg-white border border-slate-200/80 p-3 rounded-lg shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500 block">
              {t.lenDen.receivableTotal}
            </span>
            <span className="text-xl font-bold font-mono text-emerald-800 mt-0.5 block">
              {formatCurrency(totalReceivable)}
            </span>
          </div>
          <span className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
            <ArrowDownLeft size={20} strokeWidth={1.75} />
          </span>
        </div>

        {/* Payable */}
        <div className="bg-white border border-slate-200/80 p-3 rounded-lg shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500 block">
              {t.lenDen.payableTotal}
            </span>
            <span className="text-xl font-bold font-mono text-rose-800 mt-0.5 block">
              {formatCurrency(totalPayable)}
            </span>
          </div>
          <span className="p-2 bg-rose-50 text-rose-600 rounded-lg">
            <ArrowUpRight size={20} strokeWidth={1.75} />
          </span>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 border-b border-slate-200 text-xs flex-shrink-0">
        {[
          { key: "all", label: t.lenDen.filterAll },
          { key: "receivable", label: t.lenDen.filterReceivable },
          { key: "payable", label: t.lenDen.filterPayable },
          { key: "settled", label: t.lenDen.filterSettled },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setActiveFilter(tab.key as BalanceFilter);
              setPage(1);
            }}
            className={`pb-1.5 px-3 font-semibold transition-colors border-b-2 -mb-px text-xs ${
              activeFilter === tab.key
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table Container */}
      <div className="flex-1 min-h-0 border border-slate-200/80 rounded-xl overflow-hidden bg-white shadow-2xs flex flex-col">
        <div className="flex-1 min-h-0 overflow-y-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50/75 text-slate-600 font-semibold border-b border-slate-200 text-xs">
                <th className="py-3 px-4">{t.lenDen.partyName}</th>
                <th className="py-3 px-4">{t.common.category}</th>
                <th className="py-3 px-4">{t.common.village}</th>
                <th className="py-3 px-4">{t.common.phone}</th>
                <th className="py-3 px-4 text-right text-emerald-800 font-semibold">
                  {lang === "hi" ? "लेना है" : "Debit (₹)"}
                </th>
                <th className="py-3 px-4 text-right text-rose-800 font-semibold">
                  {lang === "hi" ? "देना है" : "Credit (₹)"}
                </th>
                <th className="py-3 px-4 text-center">{t.lenDen.status}</th>
                <th className="py-3 px-4 text-center">{t.common.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedBalances.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyTableMessage message={t.common.emptyMessage} />
                  </td>
                </tr>
              ) : (
                paginatedBalances.map((b) => {
                  const typeLabel =
                    b.party_type === "customer"
                      ? t.common.customer
                      : b.party_type === "supplier"
                      ? t.common.supplier
                      : lang === "hi"
                      ? "दोनों"
                      : "Both";

                  return (
                    <tr
                      key={b.party_id}
                      onClick={() => {
                        setSelectedPartyId(b.party_id);
                        setIsStatementOpen(true);
                      }}
                      className="hover:bg-emerald-50/40 transition-colors cursor-pointer group"
                      title={lang === "hi" ? "क्लिक करके पूरा खाता विवरण देखें" : "Click to view full transaction ledger"}
                    >
                      <td className="py-3 px-4 font-semibold text-slate-900 group-hover:text-emerald-800 transition-colors">
                        <div className="flex items-center gap-1.5">
                          <span>{b.party_name}</span>
                          <span className="opacity-0 group-hover:opacity-100 text-emerald-600 transition-opacity">
                            <BookOpen size={13} />
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs font-medium">
                          {typeLabel}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-600 text-xs">{b.village || "-"}</td>
                      <td className="py-3 px-4 font-mono text-slate-600 text-xs">{b.phone || "-"}</td>
                      <td className="py-3 px-4 font-mono text-emerald-700 font-semibold text-right text-xs">
                        {formatCurrency(b.total_debit)}
                      </td>
                      <td className="py-3 px-4 font-mono text-rose-700 font-semibold text-right text-xs">
                        {formatCurrency(b.total_credit)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {b.net_balance > 0 && (
                          <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200/80 font-medium px-2.5 py-1 rounded-md text-xs">
                            <ArrowDownLeft size={12} strokeWidth={2} />
                            {lang === "hi"
                              ? `${b.party_name} से ${formatCurrency(b.net_balance)} लेना है`
                              : `${formatCurrency(b.net_balance)} ${t.lenDen.takeText} ${b.party_name}`}
                          </span>
                        )}
                        {b.net_balance < 0 && (
                          <span className="inline-flex items-center gap-1 bg-rose-50 text-rose-700 border border-rose-200/80 font-medium px-2.5 py-1 rounded-md text-xs">
                            <ArrowUpRight size={12} strokeWidth={2} />
                            {lang === "hi"
                              ? `${b.party_name} को ${formatCurrency(Math.abs(b.net_balance))} देना है`
                              : `${formatCurrency(Math.abs(b.net_balance))} ${t.lenDen.giveText} ${b.party_name}`}
                          </span>
                        )}
                        {b.net_balance === 0 && (
                          <span className="inline-flex items-center px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-xs font-medium">
                            {t.lenDen.settledText}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedPartyId(b.party_id);
                              setIsStatementOpen(true);
                            }}
                            className="px-2 py-1 text-xs border border-slate-200 rounded-md hover:bg-slate-100 text-slate-700 font-medium flex items-center gap-1 transition-colors"
                            title={t.lenDen.viewStatement}
                          >
                            <BookOpen size={12} />
                            <span className="hidden sm:inline">{lang === "hi" ? "खाता" : "Ledger"}</span>
                          </button>

                          {onOpenPayment && (
                            <button
                              type="button"
                              onClick={() => {
                                onOpenPayment(
                                  b.party_id,
                                  b.net_balance >= 0 ? "receipt" : "payment"
                                );
                              }}
                              className={`px-2 py-1 text-xs rounded-md font-semibold border transition-colors flex items-center gap-1 ${
                                b.net_balance > 0
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                                  : b.net_balance < 0
                                  ? "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100"
                                  : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                              }`}
                              title={b.net_balance > 0 ? "पैसा मिला दर्ज करें" : "पैसा दिया दर्ज करें"}
                            >
                              <Wallet size={12} />
                              <span className="hidden sm:inline">
                                {b.net_balance > 0
                                  ? (lang === "hi" ? "पैसा लें" : "Receive")
                                  : b.net_balance < 0
                                  ? (lang === "hi" ? "पैसा दें" : "Pay")
                                  : (lang === "hi" ? "लेन-देन" : "Pay")}
                              </span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-100 flex-shrink-0">
          <Pagination
            currentPage={page}
            totalItems={filteredBalances.length}
            pageSize={pageSize}
            onPageChange={setPage}
            lang={lang}
          />
        </div>
      </div>

      {/* Full Account Statement Modal */}
      <StatementModal
        partyId={selectedPartyId}
        isOpen={isStatementOpen}
        onClose={() => {
          setIsStatementOpen(false);
          setSelectedPartyId(null);
        }}
        t={t}
        lang={lang}
        shopName={shopName}
      />
    </div>
  );
}
