import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Item, Feedback, GstStatus } from "../types";
import { Translations, Language } from "../i18n";
import { FeedbackBanner, EmptyTableMessage } from "../components/FeedbackBanner";
import { Plus, Search, X, getItemCategoryIcon } from "../components/icons";
import { Pagination } from "../components/Pagination";

interface ItemsViewProps {
  refreshTrigger: number;
  onRefresh?: () => void;
  t: Translations;
  lang: Language;
}

export function ItemsView({
  refreshTrigger,
  onRefresh,
  t,
  lang,
}: ItemsViewProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState("");
  const [hsn, setHsn] = useState("");
  const [gstStatus, setGstStatus] = useState<GstStatus>("taxable");
  const [gstRate, setGstRate] = useState("5");
  const [unit, setUnit] = useState("kg");
  const [altUnit, setAltUnit] = useState("");
  const [factor, setFactor] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(7);

  const loadItems = async () => {
    try {
      const res = await invoke<Item[]>("get_items_cmd");
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
  }, [searchQuery]);

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

      {/* Search Input */}
      <div className="relative flex-shrink-0">
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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <EmptyTableMessage
                      message={t.common.emptyMessage}
                      actionText={t.items.addItemBtn}
                      onAction={() => setIsFormOpen(true)}
                    />
                  </td>
                </tr>
              ) : (
                paginatedItems.map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50/70 transition-colors">
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
    </div>
  );
}
