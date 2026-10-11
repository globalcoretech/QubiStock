import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Item, Godown, Feedback, SearchableOption } from "../types";
import { Translations, Language } from "../i18n";
import { SearchableSelect } from "../components/SearchableSelect";
import { FeedbackBanner } from "../components/FeedbackBanner";
import { SlidersHorizontal, ArrowDownLeft, ArrowUpRight } from "../components/icons";

interface StockAdjustmentViewProps {
  refreshTrigger: number;
  onRefresh?: () => void;
  t: Translations;
  lang: Language;
}

export function StockAdjustmentView({
  refreshTrigger,
  onRefresh,
  t,
  lang,
}: StockAdjustmentViewProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [godowns, setGodowns] = useState<Godown[]>([]);

  const [itemId, setItemId] = useState("");
  const [godownId, setGodownId] = useState("1");
  const [adjType, setAdjType] = useState<"add" | "reduce">("add");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("kg");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    invoke<Item[]>("get_items_cmd").then(setItems).catch(console.error);
    invoke<Godown[]>("get_godowns_cmd")
      .then((gd) => {
        setGodowns(gd);
        if (gd.length > 0) setGodownId(gd[0].id.toString());
      })
      .catch(console.error);
  }, [refreshTrigger]);

  const handleItemSelect = (id: string) => {
    setItemId(id);
    const selected = items.find((i) => i.id.toString() === id);
    if (selected) setUnit(selected.base_unit);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!itemId) {
      setFeedback({
        message: lang === "hi" ? "कृपया एक सामान चुनें!" : "Please select an item!",
        isError: true,
      });
      return;
    }
    if (!qty || parseFloat(qty) <= 0) {
      setFeedback({
        message: lang === "hi" ? "कृपया सही मात्रा दर्ज करें!" : "Please enter a valid quantity!",
        isError: true,
      });
      return;
    }

    try {
      const rawQtyMilli = Math.round(parseFloat(qty) * 1000);
      const qtyChange = adjType === "add" ? rawQtyMilli : -rawQtyMilli;
      await invoke("add_stock_adjustment_cmd", {
        itemId: parseInt(itemId),
        godownId: parseInt(godownId),
        qtyChange,
        unit,
        reason: reason.trim() || null,
        date,
      });
      setFeedback({
        message: t.stockAdjustment.successMsg,
        isError: false,
      });
      setItemId("");
      setQty("");
      setReason("");
      if (onRefresh) onRefresh();
    } catch (err: any) {
      console.error("add_stock_adjustment_cmd error:", err);
      setFeedback({ message: String(err), isError: true });
    }
  };

  const itemOptions: SearchableOption[] = items.map((i) => ({
    value: i.id.toString(),
    label: i.name,
    subLabel: `${lang === "hi" ? "इकाई" : "Unit"}: ${i.base_unit}`,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <SlidersHorizontal size={20} strokeWidth={1.75} className="text-slate-600" />
            <span>{t.stockAdjustment.title}</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {t.stockAdjustment.subtitle}
          </p>
        </div>
      </div>

      <FeedbackBanner feedback={feedback} />

      {/* Form Card */}
      <div className="max-w-2xl bg-white border border-slate-200/80 rounded-xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
        <form onSubmit={handleSave} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {t.common.date} *
              </label>
              <input
                required
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {t.common.godown} *
              </label>
              <select
                value={godownId}
                onChange={(e) => setGodownId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white font-medium text-slate-700 focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
              >
                {godowns.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              {t.common.item} *
            </label>
            <SearchableSelect
              options={itemOptions}
              value={itemId}
              onChange={handleItemSelect}
              placeholder={lang === "hi" ? "सामान खोजें या चुनें..." : "Search or select item..."}
            />
          </div>

          {/* Adjustment Direction Toggle */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              {t.stockAdjustment.adjustmentType} *
            </label>
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50 text-xs font-medium">
              <button
                type="button"
                onClick={() => setAdjType("add")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
                  adjType === "add"
                    ? "bg-white text-emerald-700 font-semibold shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <ArrowDownLeft size={14} strokeWidth={2} />
                <span>{t.stockAdjustment.addStock}</span>
              </button>
              <button
                type="button"
                onClick={() => setAdjType("reduce")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
                  adjType === "reduce"
                    ? "bg-white text-rose-700 font-semibold shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <ArrowUpRight size={14} strokeWidth={2} />
                <span>{t.stockAdjustment.reduceStock}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {t.common.qty} *
              </label>
              <input
                required
                type="number"
                step="0.01"
                placeholder="0.00"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono bg-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {t.common.unit}
              </label>
              <input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-600 font-medium"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              {t.stockAdjustment.reason}
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t.stockAdjustment.reasonPlaceholder}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors"
            >
              <SlidersHorizontal size={16} strokeWidth={1.75} />
              <span>{t.stockAdjustment.saveBtn}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
