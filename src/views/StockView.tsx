import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, StockItem, Godown, Movement } from "../types";
import { Translations, Language } from "../i18n";
import { 
  Search, 
  X, 
  AlertCircle, 
  Package, 
  getItemCategoryIcon,
  Clock,
  ArrowDownLeft,
  ArrowUpRight
} from "../components/icons";
import { EmptyTableMessage } from "../components/FeedbackBanner";
import { formatCurrency, formatDate } from "../utils/formatters";

interface StockViewProps {
  settings: AppSettings;
  refreshTrigger: number;
  t: Translations;
  lang: Language;
}

interface MovementModalProps {
  selectedItem: StockItem | null;
  movements: Movement[];
  onClose: () => void;
  lang: Language;
  t: Translations;
}

function MovementModal({
  selectedItem,
  movements,
  onClose,
  lang,
}: MovementModalProps) {
  if (!selectedItem) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 overflow-y-auto no-print">
      <div className="bg-white rounded-xl p-6 sm:p-7 w-full max-w-2xl max-h-[85vh] overflow-auto shadow-xl border border-slate-200/80">
        <div className="flex justify-between items-start mb-5 border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 bg-emerald-50 rounded-lg text-emerald-600">
                <Clock size={20} strokeWidth={1.75} />
              </span>
              <div>
                <h3 className="text-xl font-bold text-slate-900">
                  {selectedItem.name}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {lang === "hi" ? "गोदाम: " : "Godown: "}
                  <span className="font-semibold text-slate-700">{selectedItem.godown_name}</span>
                </p>
              </div>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose} 
            className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {movements.length === 0 ? (
          <EmptyTableMessage 
            message={lang === "hi" ? "इस सामान का कोई आवक-जावक इतिहास नहीं मिला।" : "No stock movement records found for this item."} 
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                  <th className="py-2.5 px-3">{lang === "hi" ? "तारीख" : "Date"}</th>
                  <th className="py-2.5 px-3">{lang === "hi" ? "प्रकार" : "Type"}</th>
                  <th className="py-2.5 px-3 text-right">{lang === "hi" ? "मात्रा (बदलाव)" : "Qty Change"}</th>
                  <th className="py-2.5 px-3">{lang === "hi" ? "संदर्भ / कारण" : "Reference"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movements.map((m, idx) => {
                  const isIncoming = m.qty_base > 0;
                  const typeLabel = 
                    m.type_ === "purchase" ? (lang === "hi" ? "खरीदी" : "Purchase") :
                    m.type_ === "sale" ? (lang === "hi" ? "बिक्री" : "Sale") :
                    m.type_ === "opening" ? (lang === "hi" ? "ओपनिंग" : "Opening") :
                    m.type_ === "adjustment" ? (lang === "hi" ? "सुधार" : "Adjustment") : m.type_;

                  return (
                    <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-3 font-mono text-slate-700 text-xs">
                        {formatDate(m.date)}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                          isIncoming ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                        }`}>
                          {isIncoming ? (
                            <ArrowDownLeft size={12} strokeWidth={2} />
                          ) : (
                            <ArrowUpRight size={12} strokeWidth={2} />
                          )}
                          {typeLabel}
                        </span>
                      </td>
                      <td className={`py-2.5 px-3 font-mono font-bold text-right text-xs ${
                        isIncoming ? "text-emerald-700" : "text-rose-700"
                      }`}>
                        {isIncoming ? `+${(m.qty_base / 1000).toFixed(2)}` : (m.qty_base / 1000).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 text-xs">{m.ref_id || "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export function StockView({ settings, refreshTrigger, t, lang }: StockViewProps) {
  const [stock, setStock] = useState<StockItem[]>([]);
  const [godowns, setGodowns] = useState<Godown[]>([]);
  const [selectedGodownId, setSelectedGodownId] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<StockItem | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);

  const loadData = async () => {
    try {
      const res = await invoke<StockItem[]>("get_stock_list_cmd");
      setStock(res);
      const gdRes = await invoke<Godown[]>("get_godowns_cmd");
      setGodowns(gdRes);
    } catch (e) {
      console.error("StockView load error:", e);
    }
  };

  useEffect(() => {
    loadData();
  }, [refreshTrigger]);

  const filteredStock = stock.filter((s) => {
    const matchesGodown = selectedGodownId === "all" || s.godown_id.toString() === selectedGodownId;
    const term = searchQuery.toLowerCase().trim();
    const matchesSearch = !term || s.name.toLowerCase().includes(term) || s.godown_name.toLowerCase().includes(term);
    return matchesGodown && matchesSearch;
  });

  const totalStockValue = filteredStock.reduce((acc, curr) => acc + curr.stock_value, 0);

  const handleRowClick = async (item: StockItem) => {
    setSelectedItem(item);
    try {
      const res = await invoke<Movement[]>("get_item_movement_cmd", { itemId: item.id, godownId: item.godown_id });
      setMovements(res);
    } catch (e) {
      console.error("get_item_movement_cmd error:", e);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-100">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            {t.stock.title}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {t.stock.subtitle}
          </p>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
          {/* Search Box */}
          <div className="relative min-w-[240px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <Search size={16} strokeWidth={1.75} />
            </span>
            <input
              type="text"
              placeholder={t.stock.searchPlaceholder}
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

          {/* Godown-wise Filter */}
          <select
            value={selectedGodownId}
            onChange={(e) => setSelectedGodownId(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white font-medium text-slate-700 focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
          >
            <option value="all">{t.stock.allGodowns}</option>
            {godowns.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200/80 p-5 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">
              {lang === "hi" ? "कुल सामान प्रकार" : "Total Item Types"}
            </span>
            <span className="p-2 bg-slate-50 text-slate-600 rounded-lg">
              <Package size={20} strokeWidth={1.75} />
            </span>
          </div>
          <span className="text-2xl font-bold font-mono text-slate-900 mt-2 block">
            {filteredStock.length}
          </span>
        </div>

        <div className="bg-white border border-slate-200/80 p-5 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">
              {t.stock.totalStockValue}
            </span>
            <span className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
              <Package size={20} strokeWidth={1.75} />
            </span>
          </div>
          <span className="text-2xl font-bold font-mono text-emerald-800 mt-2 block">
            {formatCurrency(totalStockValue)}
          </span>
        </div>
      </div>

      {/* Stock Table */}
      <div className="border border-slate-200/80 rounded-xl overflow-hidden bg-white shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50/75 text-slate-600 font-semibold border-b border-slate-200">
                <th className="py-3 px-4">{t.stock.itemName}</th>
                <th className="py-3 px-4">{t.common.godown}</th>
                <th className="py-3 px-4 text-right">{t.stock.availableQty}</th>
                <th className="py-3 px-4">{t.common.unit}</th>
                <th className="py-3 px-4 text-right">{t.stock.lastRate}</th>
                <th className="py-3 px-4 text-right">{t.stock.stockValue}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredStock.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyTableMessage message={t.common.emptyMessage} />
                  </td>
                </tr>
              ) : (
                filteredStock.map((s, i) => {
                  const isLowStock = s.qty_base / 1000 <= settings.lowStockThreshold;

                  return (
                    <tr
                      key={i}
                      onClick={() => handleRowClick(s)}
                      className={`cursor-pointer transition-colors ${
                        isLowStock ? "bg-rose-50/30 hover:bg-rose-50/60" : "hover:bg-slate-50/70"
                      }`}
                    >
                      <td className="py-3 px-4 font-medium text-slate-900 flex items-center gap-2.5">
                        <span className="flex-shrink-0">
                          {getItemCategoryIcon(s.name, 18)}
                        </span>
                        <span>{s.name}</span>
                        {isLowStock && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 font-semibold rounded text-xs">
                            <AlertCircle size={12} strokeWidth={2} />
                            {t.stock.lowStockTag}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600">{s.godown_name}</td>
                      <td
                        className={`py-3 px-4 font-mono font-bold text-right ${
                          isLowStock ? "text-rose-600" : "text-emerald-700"
                        }`}
                      >
                        {(s.qty_base / 1000).toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-slate-500 font-medium">{s.base_unit}</td>
                      <td className="py-3 px-4 font-mono text-right text-slate-600">
                        {s.last_purchase_rate > 0 ? formatCurrency(s.last_purchase_rate) : "-"}
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 text-right">
                        {formatCurrency(s.stock_value)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Movement Modal */}
      <MovementModal
        selectedItem={selectedItem}
        movements={movements}
        onClose={() => setSelectedItem(null)}
        lang={lang}
        t={t}
      />
    </div>
  );
}
