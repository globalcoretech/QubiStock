import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Item, Feedback, GstStatus } from "../types";
import { Translations, Language } from "../i18n";
import { FeedbackBanner, EmptyTableMessage } from "../components/FeedbackBanner";
import { Plus, Search, X, getItemCategoryIcon, Edit, History } from "../components/icons";
import { Pagination } from "../components/Pagination";
import { EditItemModal } from "../components/EditItemModal";
import { AlterationHistoryModal } from "../components/AlterationHistoryModal";

interface ItemsViewProps {
  refreshTrigger: number;
  onRefresh?: () => void;
  t: Translations;
  lang: Language;
  initialOpenForm?: boolean;
}

export function ItemsView({
  refreshTrigger,
  onRefresh,
  t,
  lang,
  initialOpenForm = false,
}: ItemsViewProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [hsn, setHsn] = useState("");
  const [gstStatus, setGstStatus] = useState<GstStatus>("taxable");
  const [gstRate, setGstRate] = useState("5");
  const [unit, setUnit] = useState("kg");
  const [altUnit, setAltUnit] = useState("");
  const [factor, setFactor] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [isFormOpen, setIsFormOpen] = useState(initialOpenForm);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // Alteration modals state
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [historyItem, setHistoryItem] = useState<Item | null>(null);

  useEffect(() => {
    if (initialOpenForm) {
      setIsFormOpen(true);
      setTimeout(() => {
        nameInputRef.current?.focus();
      }, 60);
    }
  }, [initialOpenForm]);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(7);

  const loadItems = async () => {
    try {
      const res = await invoke<Item[]>("get_items_cmd", { includeInactive: true });
      setItems(res);
    } catch (e) {
      console.error("get_items_cmd error:", e);
    }
  };

  useEffect(() => {
    loadItems();
  }, [refreshTrigger]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (!name.trim()) {
      setFeedback({
        message: lang === "hi" ? "कृपया सामान का नाम लिखें!" : "Please enter an item name!",
        isError: true,
      });
      return;
    }
    try {
      let g: number | null = null;
      if (gstStatus === "taxable") {
        g = gstRate ? Math.round(parseFloat(gstRate) * 1000) : 5000;
      } else if (gstStatus === "nil_rated" || gstStatus === "exempt") {
        g = 0;
      } else {
        g = null;
      }

      const id = await invoke<number>("add_item_cmd", {
        name: name.trim(),
        category: null,
        hsn: hsn.trim() || null,
        gstRate: g,
        baseUnit: unit,
        gstStatus: gstStatus,
      });
      if (altUnit.trim() && factor) {
        await invoke("add_item_unit_cmd", {
          itemId: id,
          unitName: altUnit.trim(),
          factorToBase: Math.round(parseFloat(factor) * 1000),
        });
      }
      setName("");
      setHsn("");
      setGstStatus("taxable");
      setGstRate("5");
      setAltUnit("");
      setFactor("");
      setIsFormOpen(false);
      setFeedback({
        message: lang === "hi" ? "नया सामान सफलतापूर्वक जोड़ा गया!" : "Item created successfully!",
        isError: false,
      });
      await loadItems();
      if (onRefresh) onRefresh();
    } catch (e: any) {
      console.error("add_item_cmd error:", e);
      setFeedback({ message: String(e), isError: true });
    }
  };

  const filteredItems = items.filter((it) => {
    if (statusFilter === "active" && it.is_active === 0) return false;
    if (statusFilter === "inactive" && it.is_active !== 0) return false;

    const term = searchQuery.toLowerCase().trim();
    if (!term) return true;
    return (
      it.name.toLowerCase().includes(term) ||
      (it.hsn && it.hsn.toLowerCase().includes(term))
    );
  });

  const totalItems = filteredItems.length;
  const paginatedItems = filteredItems.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  return (
    <div className="h-full flex flex-col min-h-0 space-y-2.5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-2 border-b border-slate-100 flex-shrink-0">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">
            {t.items.title}
          </h2>
          <p className="text-xs text-slate-500">
            {t.items.subtitle}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsFormOpen((prev) => !prev)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
        >
          <Plus size={14} strokeWidth={2} />
          <span>{t.items.addItemBtn}</span>
        </button>
      </div>

      <FeedbackBanner feedback={feedback} />

      {/* Collapsible Form Card */}
      {isFormOpen && (
        <div className="bg-white border border-slate-200/80 rounded-xl p-4 shadow-sm flex-shrink-0">
          <form onSubmit={handleAdd} className="space-y-3">
            <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <Plus size={14} strokeWidth={2} className="text-emerald-600" />
              <span>{t.items.addItemBtn}</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  {lang === "hi" ? "सामान का नाम" : "Item Name"} *
                </label>
                <input
                  ref={nameInputRef}
                  required
                  placeholder={lang === "hi" ? "उदा. यूरिया / डीएपी / कीटनाशक" : "e.g. Urea / DAP / Pesticide"}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  {t.items.hsnCode}
                </label>
                <input
                  placeholder="3102"
                  value={hsn}
                  onChange={(e) => setHsn(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-mono bg-white focus:ring-1 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  {lang === "hi" ? "GST प्रकार (Status)" : "GST Status"}
                </label>
                <select
                  value={gstStatus}
                  onChange={(e) => setGstStatus(e.target.value as GstStatus)}
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-emerald-500 outline-none"
                >
                  <option value="taxable">{lang === "hi" ? "कर योग्य (Taxable)" : "Taxable"}</option>
                  <option value="nil_rated">{lang === "hi" ? "शून्य दर (Nil-Rated 0% - बीज)" : "Nil Rated (0%)"}</option>
                  <option value="exempt">{lang === "hi" ? "छूट प्राप्त (Exempt 0%)" : "Exempt"}</option>
                  <option value="not_set">{lang === "hi" ? "अनिर्धारित (Not Set)" : "Not Set"}</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  {t.items.gstRate} (%)
                </label>
                <input
                  type="number"
                  step="0.01"
                  disabled={gstStatus !== "taxable"}
                  placeholder={gstStatus === "taxable" ? "5 or 18" : "0"}
                  value={gstStatus === "taxable" ? gstRate : "0"}
                  onChange={(e) => setGstRate(e.target.value)}
                  className={`w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-mono outline-none ${
                    gstStatus === "taxable" ? "bg-white focus:ring-1 focus:ring-emerald-500" : "bg-slate-100 text-slate-400"
                  }`}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-0.5">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  {t.items.baseUnit}
                </label>
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-emerald-500 outline-none"
                >
                  <option value="kg">{lang === "hi" ? "किलोग्राम (kg)" : "Kilogram (kg)"}</option>
                  <option value="liter">{lang === "hi" ? "लीटर (liter)" : "Liter (liter)"}</option>
                  <option value="bag">{lang === "hi" ? "बोरी (bag)" : "Bag (bag)"}</option>
                  <option value="bottle">{lang === "hi" ? "बोतल (bottle)" : "Bottle (bottle)"}</option>
                  <option value="packet">{lang === "hi" ? "पैकेट (packet)" : "Packet (packet)"}</option>
                  <option value="piece">{lang === "hi" ? "नग (piece)" : "Piece (piece)"}</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  {lang === "hi" ? "वैकल्पिक इकाई (Alt Unit)" : "Alternate Unit"}
                </label>
                <input
                  placeholder={lang === "hi" ? "उदा. बोरी (Bag)" : "e.g. Bag"}
                  value={altUnit}
                  onChange={(e) => setAltUnit(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white focus:ring-1 focus:ring-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  {lang === "hi" ? "कन्वर्ज़न अनुपात" : "Conversion Factor"}
                </label>
                <input
                  type="number"
                  step="0.001"
                  placeholder="उदा. 50 (1 बोरी = 50 kg)"
                  value={factor}
                  onChange={(e) => setFactor(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-mono bg-white focus:ring-1 focus:ring-emerald-500 outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="px-3 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg text-xs font-semibold"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs"
              >
                {t.common.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 flex-shrink-0">
        <div className="relative min-w-[240px] flex-1">
          <Search
            size={14}
            strokeWidth={2}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            placeholder={t.items.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-7 py-1.5 border border-slate-200 rounded-lg text-xs bg-slate-50/50 hover:bg-white focus:bg-white focus:ring-1 focus:ring-emerald-500 outline-none transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
            >
              <X size={12} strokeWidth={2} />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs font-medium self-start sm:self-auto">
          {[
            { id: "all", label: lang === "hi" ? "सभी सामान" : "All Items" },
            { id: "active", label: lang === "hi" ? "सक्रिय (Active)" : "Active" },
            { id: "inactive", label: lang === "hi" ? "अक्रिय (Inactive)" : "Inactive" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id as any)}
              className={`px-3 py-1 rounded-md transition-all text-[11px] ${
                statusFilter === tab.id
                  ? "bg-white text-slate-900 font-bold shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Paginated Items Table Card */}
      <div className="flex-1 min-h-0 flex flex-col border border-slate-200/80 rounded-xl overflow-hidden bg-white shadow-2xs">
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-50/90 backdrop-blur-xs text-slate-600 font-semibold border-b border-slate-200 z-10">
              <tr>
                <th className="py-2 px-3 w-12">#</th>
                <th className="py-2 px-3">{t.common.item}</th>
                <th className="py-2 px-3">{t.items.hsnCode}</th>
                <th className="py-2 px-3">{t.items.gstRate}</th>
                <th className="py-2 px-3">{t.items.baseUnit}</th>
                <th className="py-2 px-3">{lang === "hi" ? "स्थिति" : "Status"}</th>
                <th className="py-2 px-3 text-right">{lang === "hi" ? "कार्रवाई" : "Actions"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyTableMessage
                      message={t.common.emptyMessage}
                      actionText={t.items.addItemBtn}
                      onAction={() => setIsFormOpen(true)}
                    />
                  </td>
                </tr>
              ) : (
                paginatedItems.map((it) => (
                  <tr key={it.id} className={`hover:bg-slate-50/70 transition-colors ${it.is_active === 0 ? "bg-slate-50/40 text-slate-400" : ""}`}>
                    <td className="py-2 px-3 font-mono text-slate-400 text-[11px]">
                      {it.id}
                    </td>
                    <td className="py-2 px-3 font-semibold text-slate-900 flex items-center gap-2">
                      <span className="flex-shrink-0">
                        {getItemCategoryIcon(it.name, 16)}
                      </span>
                      <span className="truncate">{it.name}</span>
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-600 text-[11px]">
                      {it.hsn || "-"}
                    </td>
                    <td className="py-2 px-3">
                      {it.gst_status === "nil_rated" ? (
                        <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 font-medium rounded text-[10px]">
                          Nil (0%)
                        </span>
                      ) : it.gst_status === "exempt" ? (
                        <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium rounded text-[10px]">
                          Exempt (0%)
                        </span>
                      ) : it.gst_status === "not_set" || (!it.gst_status && it.gst_rate === null) ? (
                        <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 font-medium rounded text-[10px]">
                          Not Set
                        </span>
                      ) : it.gst_rate !== null && it.gst_rate !== undefined ? (
                        <span className="px-1.5 py-0.5 bg-slate-100 text-slate-700 font-medium rounded text-[10px]">
                          {it.gst_rate / 1000}%
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[11px]">-</span>
                      )}
                    </td>
                    <td className="py-2 px-3 font-medium text-slate-600 text-[11px]">
                      {it.base_unit}
                    </td>
                    <td className="py-2 px-3">
                      {it.is_active === 0 ? (
                        <span className="px-1.5 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 font-medium rounded text-[10px]">
                          {lang === "hi" ? "अक्रिय (Inactive)" : "Inactive"}
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium rounded text-[10px]">
                          {lang === "hi" ? "सक्रिय (Active)" : "Active"}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        <button
                          type="button"
                          onClick={() => setEditingItem(it)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 rounded border border-slate-200 hover:border-emerald-200 transition-colors text-[11px] font-medium"
                          title={lang === "hi" ? "संपादित करें" : "Edit"}
                        >
                          <Edit size={13} strokeWidth={1.75} />
                          <span>{lang === "hi" ? "संपादित" : "Edit"}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setHistoryItem(it)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-slate-600 hover:text-blue-700 hover:bg-blue-50 rounded border border-slate-200 hover:border-blue-200 transition-colors text-[11px] font-medium"
                          title={lang === "hi" ? "संशोधन इतिहास देखें" : "View History"}
                        >
                          <History size={13} strokeWidth={1.75} />
                          <span>{lang === "hi" ? "इतिहास" : "History"}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
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

      {/* Edit Item Modal */}
      <EditItemModal
        item={editingItem}
        isOpen={!!editingItem}
        onClose={() => setEditingItem(null)}
        onSuccess={() => {
          loadItems();
          if (onRefresh) onRefresh();
        }}
        t={t}
        lang={lang}
      />

      {/* Alteration History Modal */}
      {historyItem && (
        <AlterationHistoryModal
          isOpen={!!historyItem}
          onClose={() => setHistoryItem(null)}
          entityType="item"
          entityId={historyItem.id.toString()}
          title={historyItem.name}
          lang={lang}
        />
      )}
    </div>
  );
}
