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
import { Pagination } from "../components/Pagination";

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
      <div className="bg-white rounded-xl p-5 w-full max-w-2xl max-h-[85vh] overflow-auto shadow-xl border border-slate-200/80">
        <div className="flex justify-between items-start mb-4 border-b border-slate-100 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-emerald-50 rounded-lg text-emerald-600">
                <Clock size={18} strokeWidth={1.75} />
              </span>
              <div>
                <h3 className="text-lg font-bold text-slate-900">
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
            className="text-slate-400 hover:text-slate-600 p-1"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {movements.length === 0 ? (
          <EmptyTableMessage message={lang === "hi" ? "कोई हलचल नहीं मिली" : "No movements found"} />
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-2 px-3">तारीख / Date</th>
                  <th className="py-2 px-3">प्रकार / Type</th>
                  <th className="py-2 px-3 text-right">मात्रा / Qty</th>
                  <th className="py-2 px-3">इनवॉइस / Inv</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movements.map((m, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="py-2 px-3 font-mono">{formatDate(m.date)}</td>
                    <td className="py-2 px-3 capitalize">
                      <span className={`inline-flex items-center gap-1 font-semibold ${
                        m.type_ === "purchase" || m.type_ === "opening"
                          ? "text-emerald-700"
                          : "text-rose-700"
                      }`}>
                        {m.type_ === "purchase" || m.type_ === "opening" ? (
                          <ArrowDownLeft size={12} />
                        ) : (
                          <ArrowUpRight size={12} />
                        )}
                        {m.type_}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-mono font-bold text-right">
                      {(m.qty_base / 1000).toFixed(2)}
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-500">{m.ref_id || "-"}</td>
                  </tr>
                ))}
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

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(7);

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

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedGodownId]);

  const filteredStock = stock.filter((s) => {
    const matchesGodown = selectedGodownId === "all" || s.godown_id.toString() === selectedGodownId;
    const term = searchQuery.toLowerCase().trim();
    const matchesSearch = !term || s.name.toLowerCase().includes(term) || s.godown_name.toLowerCase().includes(term);
    return matchesGodown && matchesSearch;
  });

  const totalStockValue = filteredStock.reduce((acc, curr) => acc + curr.stock_value, 0);

  const totalItems = filteredStock.length;
  const paginatedStock = filteredStock.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

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
    <div className="h-full flex flex-col min-h-0 space-y-2.5">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-2 border-b border-slate-100 flex-shrink-0">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">
            {t.stock.title}
          </h2>
          <p className="text-xs text-slate-500">
            {t.stock.subtitle}
          </p>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
          {/* Search Box */}
          <div className="relative min-w-[220px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <Search size={14} strokeWidth={1.75} />
            </span>
            <input
              type="text"
              placeholder={t.stock.searchPlaceholder}
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

          {/* Godown-wise Filter */}
          <select
            value={selectedGodownId}
            onChange={(e) => setSelectedGodownId(e.target.value)}
            className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white font-medium text-slate-700 focus:ring-1 focus:ring-emerald-500 outline-none"
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

      {/* Summary KPI Cards - Compact single row */}
      <div className="grid grid-cols-2 gap-3 flex-shrink-0">
        <div className="bg-white border border-slate-200/80 px-3.5 py-2.5 rounded-xl shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-slate-500 block">
              {lang === "hi" ? "कुल सामान प्रकार" : "Total Item Types"}
            </span>
            <span className="text-lg font-bold font-mono text-slate-900 mt-0.5 block leading-tight">
              {filteredStock.length}
            </span>
          </div>
          <span className="p-2 bg-slate-50 text-slate-600 rounded-lg">
            <Package size={18} strokeWidth={1.75} />
          </span>
        </div>

        <div className="bg-white border border-slate-200/80 px-3.5 py-2.5 rounded-xl shadow-2xs flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-slate-500 block">
              {t.stock.totalStockValue}
            </span>
            <span className="text-lg font-bold font-mono text-emerald-800 mt-0.5 block leading-tight">
              {formatCurrency(totalStockValue)}
            </span>
          </div>
          <span className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
            <Package size={18} strokeWidth={1.75} />
          </span>
        </div>
      </div>

      {/* Paginated Stock Table Card */}
      <div className="flex-1 min-h-0 flex flex-col border border-slate-200/80 rounded-xl overflow-hidden bg-white shadow-2xs">
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-50/90 backdrop-blur-xs text-slate-600 font-semibold border-b border-slate-200 z-10">
              <tr>
                <th className="py-2 px-3">{t.stock.itemName}</th>
                <th className="py-2 px-3">{t.common.godown}</th>
                <th className="py-2 px-3 text-right">{t.stock.availableQty}</th>
                <th className="py-2 px-3">{t.common.unit}</th>
                <th className="py-2 px-3 text-right">{t.stock.lastRate}</th>
                <th className="py-2 px-3 text-right">{t.stock.stockValue}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedStock.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyTableMessage message={t.common.emptyMessage} />
                  </td>
                </tr>
              ) : (
                paginatedStock.map((s, i) => {
                  const isLowStock = s.qty_base / 1000 <= settings.lowStockThreshold;

                  return (
                    <tr
                      key={i}
                      onClick={() => handleRowClick(s)}
                      className={`cursor-pointer transition-colors ${
                        isLowStock ? "bg-rose-50/30 hover:bg-rose-50/60" : "hover:bg-slate-50/70"
                      }`}
                    >
                      <td className="py-2 px-3 font-medium text-slate-900 flex items-center gap-2">
                        <span className="flex-shrink-0">
                          {getItemCategoryIcon(s.name, 16)}
                        </span>
                        <span className="truncate max-w-[200px]">{s.name}</span>
                        {isLowStock && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 font-semibold rounded text-[10px]">
                            <AlertCircle size={10} strokeWidth={2} />
                            {t.stock.lowStockTag}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-slate-600 text-[11px]">{s.godown_name}</td>
                      <td
                        className={`py-2 px-3 font-mono font-bold text-right ${
                          isLowStock ? "text-rose-600" : "text-emerald-700"
                        }`}
                      >
                        {(s.qty_base / 1000).toFixed(2)}
                      </td>
                      <td className="py-2 px-3 text-slate-500 font-medium text-[11px]">{s.base_unit}</td>
                      <td className="py-2 px-3 font-mono text-right text-slate-600 text-[11px]">
                        {s.last_purchase_rate > 0 ? formatCurrency(s.last_purchase_rate) : "-"}
                      </td>
                      <td className="py-2 px-3 font-mono font-bold text-slate-900 text-right">
                        {formatCurrency(s.stock_value)}
                      </td>
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
