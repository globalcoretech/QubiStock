import React from "react";
import { BillData } from "../../types";
import { formatDate } from "../../utils/formatters";
import { chunkBillLines } from "../../utils/billPagination";
import "./BillStyles.css";

interface BillA6Props {
  bill: BillData;
  qrDataUrl?: string;
  isPrintPreview?: boolean;
}

export const BillA6: React.FC<BillA6Props> = ({
  bill,
  qrDataUrl,
  isPrintPreview = false,
}) => {
  const { shop, party, invoice, lines, totals, customization } = bill;
  const isWithoutTax =
    customization?.hideTaxDetails ||
    customization?.taxMode === "without_tax" ||
    invoice.billType === "CASH MEMO";
  const isBillOfSupply = !isWithoutTax && invoice.billType === "BILL OF SUPPLY";
  const displayQr = qrDataUrl || (bill as any).qrDataUrl;
  const pages = chunkBillLines(lines, "A6");

  return (
    <div
      className={`bill-container ${
        isPrintPreview ? "screen-preview-a6 space-y-4" : "w-full"
      }`}
    >
      {pages.map(({ items, pageIndex, totalPages, startIndex }) => {
        const isLastPage = pageIndex === totalPages - 1;

        return (
          <div
            key={pageIndex}
            className="bill-page bg-white text-slate-900 font-sans mx-auto p-2.5 relative select-text leading-tight text-[10px] border border-slate-300 shadow-sm print:shadow-none print:border-none print:p-0"
            style={{
              width: "105mm",
              minHeight: "148mm",
              boxSizing: "border-box",
              fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
            }}
          >
            {/* Watermarks */}
            {invoice.isDuplicate && (
              <div className="watermark-duplicate text-2xl opacity-20">डुप्लीकेट</div>
            )}
            {invoice.isCancelled && (
              <div className="watermark-cancelled text-2xl opacity-25">रद्द</div>
            )}

            {/* Slip Header (Repeated on Every Page) */}
            <div className="text-center pb-1.5 border-b-2 border-dashed border-slate-400">
              <div className="flex justify-between items-center text-[8px] text-slate-500 font-bold mb-0.5">
                {!isWithoutTax && shop.gstin ? (
                  <span>GSTIN: {shop.gstin}</span>
                ) : (
                  <span></span>
                )}
                <span className="font-mono text-slate-700 bg-slate-100 px-1 rounded">
                  Page {pageIndex + 1}/{totalPages}
                </span>
              </div>
              <h1 className="text-xs font-black font-serif uppercase tracking-tight text-slate-900">
                {shop.name}
              </h1>
              <p className="text-[8px] text-slate-600 truncate">{shop.address}</p>
              <p className="text-[8px] font-semibold text-slate-700">
                मो.: {shop.phone} • राज्य: {shop.stateCode}
              </p>
              <div className="mt-0.5 inline-block bg-slate-900 text-white font-bold text-[8px] uppercase px-2 py-0.5 rounded">
                {isWithoutTax
                  ? "BILL / CASH MEMO"
                  : invoice.billType === "TAX INVOICE"
                  ? "TAX INVOICE"
                  : isBillOfSupply
                  ? "BILL OF SUPPLY"
                  : "BILL / CASH MEMO"}
              </div>
            </div>

            {/* Bill & Party Metadata (On Every Page) */}
            <div className="py-1 border-b border-dashed border-slate-300 text-[8px] space-y-0.5">
              <div className="flex justify-between items-center font-bold">
                <span>
                  बिल नं: <span className="font-mono">{invoice.invoiceNo}</span>
                </span>
                <span>
                  तारीख: <span className="font-mono">{formatDate(invoice.date)}</span>
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-800">
                <span className="truncate pr-1">
                  ग्राहक: <strong className="font-sans">{party.name}</strong>
                </span>
                {party.phone && <span>फोन: {party.phone}</span>}
              </div>
              {party.village && (
                <div className="text-slate-600 truncate">स्थान: {party.village}</div>
              )}
            </div>

            {/* Items List for Current Page */}
            <div className="py-1 border-b-2 border-dashed border-slate-400 min-h-[140px]">
              <div className="flex justify-between font-bold text-[8px] border-b border-slate-300 pb-0.5 mb-1 text-slate-700">
                <span className="w-1/2 text-left">सामान / विवरण</span>
                <span className="w-1/4 text-center">मात्रा x दर</span>
                <span className="w-1/4 text-right">रकम (₹)</span>
              </div>
              <div className="space-y-0.5">
                {items.map((item, idx) => {
                  const itemIndex = startIndex + idx + 1;
                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-[8px] leading-snug"
                    >
                      <div className="w-1/2 font-sans font-bold text-slate-900 break-words pr-1">
                        {itemIndex}. {item.name}
                      </div>
                      <div className="w-1/4 text-center font-mono text-slate-700 text-[7.5px] whitespace-nowrap">
                        {item.qty} {item.unit} x {item.rate.toFixed(0)}
                      </div>
                      <div className="w-1/4 text-right font-mono font-bold text-slate-900">
                        {item.totalAmount.toFixed(2)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Non-final page continuation footer */}
            {!isLastPage && (
              <div className="py-3 text-center text-[8.5px] font-bold text-slate-600">
                --- जारी... अगला पृष्ठ देखें (Continued on Page {pageIndex + 2}) ---
              </div>
            )}

            {/* Totals ONLY on Last Page */}
            {isLastPage && (
              <>
                <div className="py-1 border-b-2 border-dashed border-slate-400 space-y-0.5 text-[8.5px]">
                  <div className="flex justify-between text-slate-600">
                    <span>कुल सामान / Items:</span>
                    <span className="font-mono font-bold">
                      {lines.length} (कुल मात्रा: {totals.totalQty})
                    </span>
                  </div>

                  <div className="flex justify-between text-slate-700">
                    <span>{isWithoutTax ? "कुल राशि (Sub Total):" : "कर योग्य मूल्य (Sub Total):"}</span>
                    <span className="font-mono font-bold">
                      ₹{totals.totalTaxable.toFixed(2)}
                    </span>
                  </div>

                  {totals.discount !== undefined && totals.discount > 0 && (
                    <div className="flex justify-between text-red-600">
                      <span>छूट (Discount):</span>
                      <span className="font-mono">-₹{totals.discount.toFixed(2)}</span>
                    </div>
                  )}

                  {/* Single-line GST - ONLY in With GST */}
                  {!isBillOfSupply && !isWithoutTax && totals.totalTax > 0 && (
                    <div className="flex justify-between text-slate-700 font-semibold">
                      <span>जीएसटी कर (GST Total):</span>
                      <span className="font-mono">₹{totals.totalTax.toFixed(2)}</span>
                    </div>
                  )}

                  {totals.roundOff !== 0 && (
                    <div className="flex justify-between text-slate-400 text-[7.5px]">
                      <span>राउंड ऑफ (Round Off):</span>
                      <span className="font-mono">
                        {totals.roundOff > 0 ? `+${totals.roundOff}` : totals.roundOff}
                      </span>
                    </div>
                  )}

                  {/* Grand Total */}
                  <div className="pt-1 border-t border-slate-300 flex justify-between items-center font-black text-[11px] text-slate-900">
                    <span className="uppercase font-sans">कुल देय (Grand Total):</span>
                    <span className="text-xs font-mono text-emerald-900">
                      ₹{totals.grandTotal.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Amount in Words */}
                <div className="py-0.5 border-b border-dashed border-slate-300 text-[7.5px] text-slate-600 font-sans truncate">
                  <strong>अक्षरों में:</strong> {totals.amountInWordsHindi}
                </div>

                {/* UPI QR & Footer */}
                <div className="pt-1 text-center space-y-1">
                  {displayQr && (
                    <div className="flex flex-col items-center justify-center">
                      <img
                        src={displayQr}
                        alt="QR"
                        className="w-14 h-14 object-contain border border-slate-200 rounded p-0.5 bg-white"
                      />
                      <span className="text-[7.5px] font-bold text-slate-600 mt-0.5">
                        UPI स्कैन करें (Scan to Pay)
                      </span>
                    </div>
                  )}

                  <div className="text-[9px] font-bold font-serif text-slate-800">
                    ।। धन्यवाद, फिर पधारें! ।।
                  </div>
                  <div className="text-[7.5px] text-slate-500">
                    {shop.footerNote || "बिका हुआ माल वापस नहीं होगा।"}
                  </div>
                  {isWithoutTax && (
                    <div className="text-[7px] font-semibold text-slate-500 pt-0.5">
                      * यह कर इनवॉइस नहीं है (This is not a Tax Invoice.) *
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};
