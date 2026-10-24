import { ChevronLeft, ChevronRight } from "./icons";

export interface PaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (newPage: number) => void;
  onPageSizeChange?: (newSize: number) => void;
  pageSizeOptions?: number[];
  lang?: "hi" | "en";
  className?: string;
  compact?: boolean;
}

export function Pagination({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50],
  lang = "hi",
  className = "",
  compact = false,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const startItem = totalItems === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1;
  const endItem = Math.min(safeCurrentPage * pageSize, totalItems);

  return (
    <div
      className={`flex items-center justify-between gap-3 text-xs text-ink/80 py-2 px-3 bg-surface border-t border-border select-none ${className}`}
    >
      {/* Left: 1-10 / 48 range indicator */}
      <div className="flex items-center gap-2 font-medium">
        <span className="num-tabular font-semibold text-ink">
          {startItem}-{endItem}
        </span>
        <span className="text-muted">/</span>
        <span className="num-tabular text-muted font-semibold">
          {totalItems}
        </span>
        {!compact && (
          <span className="text-muted text-[11px] hidden sm:inline">
            {lang === "hi" ? "दर्ज" : "items"}
          </span>
        )}
      </div>

      {/* Right: Page Size Selector + Prev/Next buttons */}
      <div className="flex items-center gap-3">
        {onPageSizeChange && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted text-[11px] hidden sm:inline">
              {lang === "hi" ? "प्रति पृष्ठ:" : "Per page:"}
            </span>
            <select
              value={pageSize}
              onChange={(e) => {
                onPageSizeChange(Number(e.target.value));
                onPageChange(1);
              }}
              className="bg-paper border border-border rounded px-1.5 py-0.5 text-xs font-semibold text-ink focus:outline-none focus:ring-1 focus:ring-forest cursor-pointer"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(safeCurrentPage - 1)}
            disabled={safeCurrentPage <= 1}
            title={lang === "hi" ? "पिछला पृष्ठ" : "Previous Page"}
            className="p-1 rounded bg-paper hover:bg-forest/10 border border-border text-ink disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={16} />
          </button>

          <span className="px-2 py-0.5 font-bold num-tabular text-ink text-xs min-w-[32px] text-center">
            {safeCurrentPage} / {totalPages}
          </span>

          <button
            type="button"
            onClick={() => onPageChange(safeCurrentPage + 1)}
            disabled={safeCurrentPage >= totalPages}
            title={lang === "hi" ? "अगला पृष्ठ" : "Next Page"}
            className="p-1 rounded bg-paper hover:bg-forest/10 border border-border text-ink disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
