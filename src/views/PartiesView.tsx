import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Party, Feedback } from "../types";
import { Translations, Language } from "../i18n";
import { AddPartyModal } from "../components/AddPartyModal";
import { FeedbackBanner, EmptyTableMessage } from "../components/FeedbackBanner";
import { Plus, Search, X, Trash2 } from "../components/icons";

interface PartiesViewProps {
  refreshTrigger: number;
  onRefresh?: () => void;
  t: Translations;
  lang: Language;
}

export function PartiesView({
  refreshTrigger,
  onRefresh,
  t,
  lang,
}: PartiesViewProps) {
  const [parties, setParties] = useState<Party[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isCleaning, setIsCleaning] = useState(false);

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-100">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            {t.parties.title}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {t.parties.subtitle}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleCleanAccountingParties}
            disabled={isCleaning}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-200 hover:border-rose-300 hover:bg-rose-50 text-slate-600 hover:text-rose-700 rounded-lg text-xs font-medium transition-colors"
            title={t.parties.cleanConfirm}
          >
            <Trash2 size={14} strokeWidth={1.75} />
            <span>{isCleaning ? t.common.saving : t.parties.cleanLedgersBtn}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
          >
            <Plus size={15} strokeWidth={2} />
            <span>{t.parties.addPartyBtn}</span>
          </button>
        </div>
      </div>

      <FeedbackBanner feedback={feedback} />

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative min-w-[260px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <Search size={16} strokeWidth={1.75} />
          </span>
          <input
            type="text"
            className="w-full pl-9 pr-8 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50/50 hover:bg-white focus:bg-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-colors"
            placeholder={lang === "hi" ? "नाम, फोन या गांव से खोजें..." : "Search name, phone or village..."}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
            >
              <X size={14} strokeWidth={2} />
            </button>
          )}
        </div>

        {/* Party Type Filter */}
        <div className="flex items-center gap-1 border border-slate-200 rounded-lg p-0.5 bg-slate-50 text-xs">
          {[
            { key: "all", label: t.parties.allParties },
            { key: "customer", label: t.parties.customers },
            { key: "supplier", label: t.parties.suppliers },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilterType(item.key)}
              className={`px-3 py-1.5 rounded-md font-medium transition-all ${
                filterType === item.key
                  ? "bg-white text-emerald-800 font-semibold shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Modal */}
      <AddPartyModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => {
          loadParties();
          if (onRefresh) onRefresh();
        }}
        t={t}
      />


      {/* Table */}
      <div className="border border-slate-200/80 rounded-xl overflow-hidden bg-white shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50/75 text-slate-600 font-semibold border-b border-slate-200">
                <th className="py-3 px-4 w-16">#</th>
                <th className="py-3 px-4">{t.common.party}</th>
                <th className="py-3 px-4">{t.common.category}</th>
                <th className="py-3 px-4">{t.parties.taxCategory}</th>
                <th className="py-3 px-4">{t.common.gstin}</th>
                <th className="py-3 px-4">{t.common.village}</th>
                <th className="py-3 px-4">{t.common.phone}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredParties.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyTableMessage
                      message={t.common.emptyMessage}
                      actionText={t.parties.addPartyBtn}
                      onAction={() => setIsModalOpen(true)}
                    />
                  </td>
                </tr>
              ) : (
                filteredParties.map((p) => {
                  const typeLabel =
                    p.party_type === "customer"
                      ? t.common.customer
                      : p.party_type === "supplier"
                      ? t.common.supplier
                      : t.parties.both;

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4 font-mono text-slate-400 text-xs">
                        {p.id}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {p.name}
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-xs font-medium">
                          {typeLabel}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium border ${
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
                      <td className="py-3 px-4 font-mono text-slate-600 text-xs">
                        {p.gstin || "-"}
                      </td>
                      <td className="py-3 px-4 text-slate-600 text-xs">{p.village || "-"}</td>
                      <td className="py-3 px-4 font-mono text-slate-700 text-xs">
                        {p.phone || "-"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
