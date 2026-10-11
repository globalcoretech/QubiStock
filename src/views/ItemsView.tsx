import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Item, Feedback } from "../types";
import { Translations, Language } from "../i18n";
import { FeedbackBanner, EmptyTableMessage } from "../components/FeedbackBanner";
import { Plus, Search, X, getItemCategoryIcon } from "../components/icons";

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
  const [gstRate, setGstRate] = useState("");
  const [unit, setUnit] = useState("kg");
  const [altUnit, setAltUnit] = useState("");
  const [factor, setFactor] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

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
      const g = gstRate ? Math.round(parseFloat(gstRate) * 1000) : null;
      const id = await invoke<number>("add_item_cmd", {
        name: name.trim(),
        category: null,
        hsn: hsn.trim() || null,
        gstRate: g,
        baseUnit: unit,
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
      setGstRate("");
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-100">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            {t.items.title}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {t.items.subtitle}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsFormOpen((prev) => !prev)}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
        >
          <Plus size={15} strokeWidth={2} />
          <span>{t.items.addItemBtn}</span>
        </button>
      </div>

      <FeedbackBanner feedback={feedback} />

      {/* Collapsible Form Card */}
      {isFormOpen && (
        <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          <form onSubmit={handleAdd} className="space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Plus size={16} strokeWidth={2} className="text-emerald-600" />
              <span>{t.items.addItemBtn}</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  {lang === "hi" ? "सामान का नाम" : "Item Name"} *
                </label>
                <input
                  required
                  placeholder={lang === "hi" ? "उदा. यूरिया / डीएपी / क्लोरोपाइरीफॉस" : "e.g. Urea / DAP / Chlorpyrifos"}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  {t.items.hsnCode}
                </label>
                <input
                  placeholder="3102"
                  value={hsn}
                  onChange={(e) => setHsn(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono bg-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  {t.items.gstRate} (%)
                </label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="5 or 18"
                  value={gstRate}
                  onChange={(e) => setGstRate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono bg-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  {t.items.baseUnit}
                </label>
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white font-medium text-slate-700 focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                >
                  <option value="kg">kg ({lang === "hi" ? "किलोग्राम" : "Kilogram"})</option>
                  <option value="ltr">ltr ({lang === "hi" ? "लीटर" : "Litre"})</option>
                  <option value="pcs">pcs ({lang === "hi" ? "नग / पीस" : "Pieces"})</option>
                  <option value="bag">bag ({lang === "hi" ? "बोरी / बैग" : "Bag"})</option>
                  <option value="pkt">pkt ({lang === "hi" ? "पैकेट" : "Packet"})</option>
                </select>
              </div>

              <div className="sm:col-span-2 flex items-center gap-2 pt-6">
                <span className="text-xs font-semibold text-slate-600 whitespace-nowrap">
                  {t.items.alternateUnits}:
                </span>
                <input
                  placeholder={lang === "hi" ? "उदा. बोरी / बैग" : "e.g. Bag / Box"}
                  value={altUnit}
                  onChange={(e) => setAltUnit(e.target.value)}
                  className="w-24 px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white outline-none"
                />
                <span className="text-sm font-bold text-slate-400">=</span>
                <input
                  type="number"
                  step="0.01"
                  placeholder="50"
                  value={factor}
                  onChange={(e) => setFactor(e.target.value)}
                  className="w-20 px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-mono bg-white outline-none"
                />
                <span className="text-xs font-semibold text-slate-700">{unit}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
              >
                <Plus size={14} strokeWidth={2} />
                <span>{t.common.save}</span>
              </button>
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="px-3 py-2 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg text-xs font-medium transition-colors"
              >
                {t.common.cancel}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Search Bar */}
      <div className="relative max-w-sm">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          <Search size={16} strokeWidth={1.75} />
        </span>
        <input
          type="text"
          placeholder={t.items.searchPlaceholder}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-8 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50/50 hover:bg-white focus:bg-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-colors"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
          >
            <X size={14} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Items Table */}
      <div className="border border-slate-200/80 rounded-xl overflow-hidden bg-white shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50/75 text-slate-600 font-semibold border-b border-slate-200">
                <th className="py-3 px-4 w-16">#</th>
                <th className="py-3 px-4">{t.common.item}</th>
                <th className="py-3 px-4">{t.items.hsnCode}</th>
                <th className="py-3 px-4">{t.items.gstRate}</th>
                <th className="py-3 px-4">{t.items.baseUnit}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.length === 0 ? (
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
                filteredItems.map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-mono text-slate-400 text-xs">
                      {it.id}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-900 flex items-center gap-2.5">
                      <span className="flex-shrink-0">
                        {getItemCategoryIcon(it.name, 18)}
                      </span>
                      <span>{it.name}</span>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600 text-xs">
                      {it.hsn || "-"}
                    </td>
                    <td className="py-3 px-4">
                      {it.gst_rate ? (
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-700 font-medium rounded text-xs">
                          {it.gst_rate / 1000}%
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-600 text-xs">
                      {it.base_unit}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
