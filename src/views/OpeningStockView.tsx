import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Item, Godown, Feedback, LastRates, SearchableOption } from "../types";
import { Translations, Language } from "../i18n";
import { SearchableSelect } from "../components/SearchableSelect";
import { FeedbackBanner } from "../components/FeedbackBanner";
import { Plus } from "../components/icons";
import { formatCurrency } from "../utils/formatters";

interface OpeningStockViewProps {
  refreshTrigger: number;
  onRefresh?: () => void;
  t: Translations;
  lang: Language;
}

export function OpeningStockView({
  refreshTrigger,
  onRefresh,
  t,
  lang,
}: OpeningStockViewProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [godowns, setGodowns] = useState<Godown[]>([]);

  const [itemId, setItemId] = useState("");
  const [godownId, setGodownId] = useState("1");
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [unit, setUnit] = useState("kg");
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

  const handleItemSelect = async (id: string) => {
    setItemId(id);
    const selected = items.find((i) => i.id.toString() === id);
    if (selected) {
      setUnit(selected.base_unit);
      try {
        const rates = await invoke<LastRates>("get_last_rates_cmd", {
          itemId: selected.id,
        });
        if (rates.last_purchase && !rate) {
          setRate((rates.last_purchase.rate / 100).toString());
        }
      } catch (err) {
        console.error("error fetching last rate:", err);
      }
    }
  };

  const calculatedStockValuePaise =
    Math.round((parseFloat(qty || "0") * parseFloat(rate || "0")) * 100) || 0;

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
      const qtyMilli = Math.round(parseFloat(qty) * 1000);
      await invoke("add_opening_stock_cmd", {
        itemId: parseInt(itemId),
        godownId: parseInt(godownId),
        qty: qtyMilli,
        unit,
        date,
      });
      setFeedback({
        message: t.openingStock.successMsg,
        isError: false,
      });
      setItemId("");
      setQty("");
      setRate("");
      if (onRefresh) onRefresh();
    } catch (err: any) {
      console.error("add_opening_stock_cmd error:", err);
      setFeedback({ message: String(err), isError: true });
    }
  };

  const itemOptions: SearchableOption[] = items.map((i) => ({
    value: i.id.toString(),
    label: i.name,
    subLabel: `${lang === "hi" ? "इकाई" : "Unit"}: ${i.base_unit}${
      i.gst_rate ? ` | GST: ${i.gst_rate / 1000}%` : ""
    }`,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-4 border-b border-slate-100">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">
          {t.openingStock.title}
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          {t.openingStock.subtitle}
        </p>
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
              {t.openingStock.selectItem} *
            </label>
            <SearchableSelect
              options={itemOptions}
              value={itemId}
              onChange={handleItemSelect}
              placeholder={lang === "hi" ? "सामान खोजें या चुनें..." : "Search or select item..."}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {t.openingStock.costRate}
              </label>
              <input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono bg-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
              />
            </div>
          </div>

          {calculatedStockValuePaise > 0 && (
            <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-lg flex items-center justify-between">
              <span className="text-xs font-medium text-slate-600">
                {lang === "hi" ? "अनुमानित कुल स्टॉक मूल्य:" : "Estimated Total Value:"}
              </span>
              <span className="text-base font-bold font-mono text-emerald-800">
                {formatCurrency(calculatedStockValuePaise)}
              </span>
            </div>
          )}

          <div className="pt-2">
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors"
            >
              <Plus size={16} strokeWidth={2} />
              <span>{t.openingStock.addBtn}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
