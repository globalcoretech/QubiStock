import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Party, Feedback, SessionUser } from "../types";
import { Translations, Language } from "../i18n";
import { AddPartyModal } from "../components/AddPartyModal";
import { EditPartyModal } from "../components/EditPartyModal";
import { AlterationHistoryModal } from "../components/AlterationHistoryModal";
import { FeedbackBanner, EmptyTableMessage } from "../components/FeedbackBanner";
import { Plus, Search, X, Trash2, Edit, History } from "../components/icons";
import { Pagination } from "../components/Pagination";

interface PartiesViewProps {
  refreshTrigger: number;
  onRefresh?: () => void;
  t: Translations;
  lang: Language;
  currentUser?: SessionUser | null;
}

export function PartiesView({
  refreshTrigger,
  onRefresh,
  t,
  lang,
  currentUser,
}: PartiesViewProps) {
  const isStaff = currentUser?.role === "staff";
  const [parties, setParties] = useState<Party[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingParty, setEditingParty] = useState<Party | null>(null);
  const [historyParty, setHistoryParty] = useState<Party | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isCleaning, setIsCleaning] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(7);

  const loadParties = async () => {
    try {
      const res = await invoke<Party[]>("get_parties_cmd", { partyType: "all" });
      setParties(res);
    } catch (e) {
      console.error("get_parties_cmd error:", e);
    }
  };

  useEffect(() => {
    loadParties();
  }, [refreshTrigger]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filterType]);

  const handleCleanAccountingParties = async () => {
    const ok = window.confirm(t.parties.cleanConfirm);
    if (!ok) return;

    setIsCleaning(true);
    setFeedback(null);
    try {
      const deletedCount = await invoke<number>("cleanup_accounting_parties_cmd");
      setFeedback({
        message: `${t.parties.cleanSuccess} (${deletedCount} ${lang === "hi" ? "पार्टियां हटाई गईं" : "parties removed"})`,
        isError: false,
      });
      loadParties();
      if (onRefresh) onRefresh();
    } catch (err: any) {
      console.error("cleanup_accounting_parties_cmd error:", err);
      setFeedback({ message: String(err), isError: true });
    } finally {
      setIsCleaning(false);
    }
  };

  const filteredParties = parties.filter((p) => {
    const matchesType = filterType === "all" || p.party_type === filterType;
    const term = searchTerm.toLowerCase().trim();
    const matchesSearch =
      !term ||
      p.name.toLowerCase().includes(term) ||
      (p.village && p.village.toLowerCase().includes(term)) ||
      (p.phone && p.phone.includes(term)) ||
      (p.gstin && p.gstin.toLowerCase().includes(term));
    return matchesType && matchesSearch;
  });

  const totalItems = filteredParties.length;
  const paginatedParties = filteredParties.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  return (
    <div className="h-full flex flex-col min-h-0 space-y-2.5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-2 border-b border-slate-100 flex-shrink-0">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">
            {t.parties.title}
          </h2>
          <p className="text-xs text-slate-500">
            {t.parties.subtitle}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isStaff && (
            <button
              type="button"
              onClick={handleCleanAccountingParties}
              disabled={isCleaning}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-slate-200 hover:border-rose-300 hover:bg-rose-50 text-slate-600 hover:text-rose-700 rounded-lg text-xs font-medium transition-colors"
              title={t.parties.cleanConfirm}
            >
              <Trash2 size={13} strokeWidth={1.75} />
              <span>{isCleaning ? t.common.saving : t.parties.cleanLedgersBtn}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
          >
            <Plus size={14} strokeWidth={2} />
            <span>{t.parties.addPartyBtn}</span>
          </button>
        </div>
      </div>

      <FeedbackBanner feedback={feedback} />

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 flex-shrink-0">
        <div className="relative min-w-[240px] flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <Search size={14} strokeWidth={1.75} />
          </span>
          <input
            type="text"
            placeholder={lang === "hi" ? "पार्टी या गांव खोजें..." : "Search party or village..."}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-7 py-1.5 border border-slate-200 rounded-lg text-xs bg-slate-50/50 hover:bg-white focus:bg-white focus:ring-1 focus:ring-emerald-500 outline-none transition-colors"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
            >
              <X size={12} strokeWidth={2} />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs font-medium self-start sm:self-auto">
          {[
            { id: "all", label: t.parties.allParties },
            { id: "customer", label: t.parties.customers },
            { id: "supplier", label: t.parties.suppliers },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterType(tab.id)}
              className={`px-3 py-1 rounded-md transition-all text-[11px] ${
                filterType === tab.id
                  ? "bg-white text-slate-900 font-bold shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Paginated Parties Table Card */}
      <div className="flex-1 min-h-0 flex flex-col border border-slate-200/80 rounded-xl overflow-hidden bg-white shadow-2xs">
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-50/90 backdrop-blur-xs text-slate-600 font-semibold border-b border-slate-200 z-10">
              <tr>
                <th className="py-2 px-3 w-12">#</th>
                <th className="py-2 px-3">{t.common.party}</th>
                <th className="py-2 px-3">{lang === "hi" ? "प्रकार" : "Type"}</th>
                <th className="py-2 px-3">{t.common.category}</th>
                <th className="py-2 px-3">GSTIN</th>
                <th className="py-2 px-3">{t.common.village}</th>
                <th className="py-2 px-3">{t.common.phone}</th>
                {!isStaff && <th className="py-2 px-3 text-right">{lang === "hi" ? "कार्रवाई" : "Actions"}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedParties.length === 0 ? (
                <tr>
                  <td colSpan={isStaff ? 7 : 8}>
                    <EmptyTableMessage
                      message={t.common.emptyMessage}
                      actionText={t.parties.addPartyBtn}
                      onAction={() => setIsModalOpen(true)}
                    />
                  </td>
                </tr>
              ) : (
                paginatedParties.map((p) => {
                  const typeLabel =
                    p.party_type === "customer"
                      ? t.common.customer
                      : p.party_type === "supplier"
                      ? t.common.supplier
                      : t.parties.both;

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2 px-3 font-mono text-slate-400 text-[11px]">
                        {p.id}
                      </td>
                      <td className="py-2 px-3 font-semibold text-slate-900 truncate max-w-[180px]">
                        {p.name}
                      </td>
                      <td className="py-2 px-3">
                        <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-medium">
                          {typeLabel}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                            p.category === "regular"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : p.category === "composition"
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-slate-50 text-slate-600 border-slate-200"
                          }`}
                        >
                          {p.category === "regular"
                            ? t.common.regular
                            : p.category === "composition"
                            ? t.common.composition
                            : t.common.unregistered}
                        </span>
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-600 text-[11px]">
                        {p.gstin || "-"}
                      </td>
                      <td className="py-2 px-3 text-slate-600 text-[11px] truncate max-w-[110px]">
                        {p.village || "-"}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-700 text-[11px]">
                        {p.phone || "-"}
                      </td>
                      {!isStaff && (
                        <td className="py-2 px-3 text-right">
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            <button
                              type="button"
                              onClick={() => setEditingParty(p)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 rounded border border-slate-200 hover:border-emerald-200 transition-colors text-[11px] font-medium"
                              title={lang === "hi" ? "संपादित करें" : "Edit"}
                            >
                              <Edit size={13} strokeWidth={1.75} />
                              <span>{lang === "hi" ? "संपादित" : "Edit"}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setHistoryParty(p)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-slate-600 hover:text-blue-700 hover:bg-blue-50 rounded border border-slate-200 hover:border-blue-200 transition-colors text-[11px] font-medium"
                              title={lang === "hi" ? "संशोधन इतिहास देखें" : "View History"}
                            >
                              <History size={13} strokeWidth={1.75} />
                              <span>{lang === "hi" ? "इतिहास" : "History"}</span>
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination at bottom */}
        <Pagination
          currentPage={currentPage}
          totalItems={totalItems}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
          pageSizeOptions={[5, 7, 10, 20]}
          lang={lang}
          compact={false}
        />
      </div>

      <AddPartyModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => {
          loadParties();
          if (onRefresh) onRefresh();
        }}
        t={t}
      />

      <EditPartyModal
        party={editingParty}
        isOpen={!!editingParty}
        onClose={() => setEditingParty(null)}
        onSuccess={() => {
          loadParties();
          if (onRefresh) onRefresh();
        }}
        t={t}
        lang={lang}
      />

      {historyParty && (
        <AlterationHistoryModal
          isOpen={!!historyParty}
          onClose={() => setHistoryParty(null)}
          entityType="party"
          entityId={historyParty.id.toString()}
          title={historyParty.name}
          lang={lang}
        />
      )}
    </div>
  );
}
