import React from "react";
import { BillData } from "../../types";
import { formatDate } from "../../utils/formatters";
import { chunkBillLines } from "../../utils/billPagination";
import "./BillStyles.css";

interface BillA5Props {
  bill: BillData;
  qrDataUrl?: string;
  isPrintPreview?: boolean;
}

export const BillA5: React.FC<BillA5Props> = ({
  bill,
  qrDataUrl,
  isPrintPreview = false,
}) => {
  const { shop, party, invoice, lines, totals, hsnSummary, customization } = bill;
  const isBillOfSupply = invoice.billType === "BILL OF SUPPLY";
  const lang = customization?.language || "both";
  const cols = customization?.visibleColumns || {
    hsn: true,
    unit: true,
    discount: true,
    gstRate: true,
    taxable: true,
  };

  const isBilingual = lang === "both";
  const isHi = lang === "hi" || isBilingual;
  const isEn = lang === "en" || isBilingual;

  const displayQr = qrDataUrl || (bill as any).qrDataUrl;
  const pages = chunkBillLines(lines, "A5");

  return (
    <div
      className={`bill-container ${
        isPrintPreview ? "screen-preview-a5 space-y-4" : "w-full"
      }`}
    >
      {pages.map(({ items, pageIndex, totalPages, startIndex }) => {
        const isLastPage = pageIndex === totalPages - 1;

        return (
          <div
            key={pageIndex}
            className="bill-page bg-white text-slate-900 font-sans mx-auto p-3.5 relative select-text leading-tight text-[11px] border border-slate-300 shadow-sm print:shadow-none print:border-none print:p-0"
            style={{
              width: "148mm",
              minHeight: "210mm",
              boxSizing: "border-box",
              fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
            }}
          >
            {/* Watermarks */}
            {invoice.isDuplicate && (
              <div className="watermark-duplicate text-3xl opacity-20">डुप्लीकेट</div>
            )}
            {invoice.isCancelled && (
              <div className="watermark-cancelled text-3xl opacity-25">रद्द / CANCELLED</div>
            )}

            {/* Header (Repeated on Every Page) */}
            <div className="border border-slate-900 rounded-t p-2 bg-slate-50/60">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  {shop.logoData || shop.logoUrl ? (
                    <img
                      src={shop.logoData || shop.logoUrl}
                      alt="Logo"
                      className="w-10 h-10 object-contain rounded border border-slate-200 bg-white"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded bg-emerald-800 text-amber-300 flex items-center justify-center font-serif text-base font-bold flex-shrink-0">
                      श्री
                    </div>
                  )}
                  <div className="min-w-0">
                    <h1 className="text-base font-serif font-black tracking-tight text-slate-900 leading-none">
                      {shop.name}
                    </h1>
                    <p className="text-[9.5px] text-slate-600 truncate mt-0.5">{shop.address}</p>
                    <div className="flex flex-wrap gap-x-2 text-[9.5px] font-semibold text-slate-800">
                      <span>GSTIN: {shop.gstin}</span>
                      <span>मो.: {shop.phone}</span>
                      <span>राज्य: {shop.stateCode}</span>
                    </div>
                  </div>
                </div>

                <div className="text-right flex-shrink-0">
                  <div className="flex items-center gap-1 justify-end">
                    <span className="inline-block border border-slate-900 bg-slate-900 text-white font-bold text-[10px] uppercase px-1.5 py-0.5 rounded">
                      {invoice.billType === "TAX INVOICE"
                        ? "TAX INVOICE"
                        : invoice.billType === "BILL OF SUPPLY"
                        ? "BILL OF SUPPLY"
                        : "CASH MEMO"}
                    </span>
                    <span className="font-mono text-[9px] bg-slate-200 text-slate-800 px-1 py-0.5 rounded font-bold">
                      Page {pageIndex + 1}/{totalPages}
                    </span>
                  </div>
                  <div className="text-[8.5px] font-medium text-slate-500 mt-0.5">
                    मूल प्रति (Original for Recipient)
                  </div>
                </div>
              </div>
            </div>

            {/* Bill & Party Details Box (On Every Page) */}
            <div className="border-x border-b border-slate-900 grid grid-cols-12 text-[9.5px]">
              {/* Party (7 cols) */}
              <div className="col-span-7 p-1.5 border-r border-slate-900">
                <div className="text-[8.5px] font-bold uppercase text-slate-400 mb-0.5">
                  क्रेता (Buyer):
                </div>
                <div className="font-bold text-xs text-slate-900">{party.name}</div>
                {party.village && (
                  <div className="text-slate-600">स्थान: {party.village}</div>
                )}
                <div className="mt-0.5">
                  <strong className="text-slate-500">GSTIN:</strong>{" "}
                  {party.gstin || <span className="italic">Unregistered (अपंजीकृत)</span>}
                </div>
                {party.phone && <div>फोन: {party.phone}</div>}
              </div>

              {/* Invoice Info (5 cols) */}
              <div className="col-span-5 p-1.5 bg-slate-50/40 space-y-0.5">
                <div className="flex justify-between items-center border-b border-slate-200 pb-0.5">
                  <span className="font-semibold text-slate-500">बिल नं./Inv No:</span>
                  <span className="font-mono font-bold text-slate-900">{invoice.invoiceNo}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-500">तारीख/Date:</span>
                  <span className="font-mono">{formatDate(invoice.date)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-500">माध्यम/Mode:</span>
                  <span className="font-bold uppercase text-[8.5px]">{invoice.paymentMode || "Cash"}</span>
                </div>
              </div>
            </div>

            {/* Items Table for this page */}
            <div className="border-x border-b border-slate-900 min-h-0">
              <table className="w-full text-[9.5px] border-collapse bill-table">
                <thead className="bg-slate-100 text-slate-900 font-bold border-b border-slate-900">
                  <tr>
                    <th className="py-1 px-1 border-r border-slate-300 text-center w-6">#</th>
                    <th className="py-1 px-1.5 border-r border-slate-300 text-left">सामान / Description</th>
                    {cols.hsn && !isBillOfSupply && (
                      <th className="py-1 px-1 border-r border-slate-300 text-center w-12">HSN</th>
                    )}
                    <th className="py-1 px-1 border-r border-slate-300 text-right w-10">मात्रा</th>
                    {cols.unit && (
                      <th className="py-1 px-1 border-r border-slate-300 text-center w-8">इकाई</th>
                    )}
                    <th className="py-1 px-1 border-r border-slate-300 text-right w-12">दर (₹)</th>
                    {cols.discount && (
                      <th className="py-1 px-1 border-r border-slate-300 text-right w-10">छूट</th>
                    )}
                    {cols.taxable && !isBillOfSupply && (
                      <th className="py-1 px-1 border-r border-slate-300 text-right w-14">कर योग्य</th>
                    )}
                    {cols.gstRate && !isBillOfSupply && (
                      <th className="py-1 px-1 border-r border-slate-300 text-center w-8">GST</th>
                    )}
                    <th className="py-1 px-1.5 text-right w-16">रकम (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {items.map((item, idx) => {
                    const itemSr = startIndex + idx + 1;
                    return (
                      <tr key={idx}>
                        <td className="py-0.5 px-1 border-r border-slate-200 text-center font-mono">{itemSr}</td>
                        <td className="py-0.5 px-1.5 border-r border-slate-200 font-semibold truncate max-w-[150px]">{item.name}</td>
                        {cols.hsn && !isBillOfSupply && (
                          <td className="py-0.5 px-1 border-r border-slate-200 text-center font-mono">{item.hsn}</td>
                        )}
                        <td className="py-0.5 px-1 border-r border-slate-200 text-right font-mono font-bold">{item.qty}</td>
                        {cols.unit && (
                          <td className="py-0.5 px-1 border-r border-slate-200 text-center text-slate-500">{item.unit}</td>
                        )}
                        <td className="py-0.5 px-1 border-r border-slate-200 text-right font-mono">{item.rate.toFixed(2)}</td>
                        {cols.discount && (
                          <td className="py-0.5 px-1 border-r border-slate-200 text-right font-mono text-slate-500">
                            {item.discount ? item.discount.toFixed(2) : "-"}
                          </td>
                        )}
                        {cols.taxable && !isBillOfSupply && (
                          <td className="py-0.5 px-1 border-r border-slate-200 text-right font-mono">{item.taxableAmount.toFixed(2)}</td>
                        )}
                        {cols.gstRate && !isBillOfSupply && (
                          <td className="py-0.5 px-1 border-r border-slate-200 text-center font-mono">{item.gstRate}%</td>
                        )}
                        <td className="py-0.5 px-1.5 text-right font-mono font-bold">{item.totalAmount.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Continuation Note on Non-Final Pages */}
            {!isLastPage && (
              <div className="py-4 text-center text-[9.5px] font-bold text-slate-600">
                --- जारी... अगला पृष्ठ देखें (Continued on Page {pageIndex + 2}) ---
              </div>
            )}

            {/* Totals & Full Footer ONLY on Last Page */}
            {isLastPage && (
              <>
                {/* HSN Summary (Compact) */}
                {!isBillOfSupply && hsnSummary.length > 0 && (
                  <div className="border-x border-b border-slate-900 text-[8.5px]">
                    <div className="bg-slate-100 px-2 py-0.5 font-bold border-b border-slate-300 flex justify-between">
                      <span>GST Tax Summary</span>
                      <span className="font-mono">कर: ₹{totals.totalTax.toFixed(2)}</span>
                    </div>
                    <table className="w-full border-collapse">
                      <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                        <tr>
                          <th className="py-0.5 px-1 border-r border-slate-200 text-left">HSN</th>
                          <th className="py-0.5 px-1 border-r border-slate-200 text-right">कर योग्य</th>
                          <th className="py-0.5 px-1 border-r border-slate-200 text-right">CGST</th>
                          <th className="py-0.5 px-1 border-r border-slate-200 text-right">SGST</th>
                          <th className="py-0.5 px-1 border-r border-slate-200 text-right">IGST</th>
                          <th className="py-0.5 px-1 text-right">कुल टैक्स</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono">
                        {hsnSummary.map((hs, i) => (
                          <tr key={i}>
                            <td className="py-0.5 px-1 border-r border-slate-200 font-bold">{hs.hsn}</td>
                            <td className="py-0.5 px-1 border-r border-slate-200 text-right">{hs.taxableAmount.toFixed(2)}</td>
                            <td className="py-0.5 px-1 border-r border-slate-200 text-right">{hs.cgstAmount.toFixed(2)}</td>
                            <td className="py-0.5 px-1 border-r border-slate-200 text-right">{hs.sgstAmount.toFixed(2)}</td>
                            <td className="py-0.5 px-1 border-r border-slate-200 text-right">{hs.igstAmount.toFixed(2)}</td>
                            <td className="py-0.5 px-1 text-right font-bold">{hs.totalTax.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Words and Totals Summary */}
                <div className="border-x border-b border-slate-900 grid grid-cols-12 text-[9.5px]">
                  <div className="col-span-8 p-1.5 border-r border-slate-900 bg-slate-50/40 space-y-1">
                    <div>
                      <span className="text-[8.5px] font-bold text-slate-500 uppercase block">शब्दों में / Words:</span>
                      {isHi && <div className="font-bold text-slate-900">🇮🇳 {totals.amountInWordsHindi}</div>}
                      {isEn && <div className="text-slate-600 italic text-[8.5px] mt-0.5">🔤 {totals.amountInWordsEnglish}</div>}
                    </div>
                    {shop.termsAndConditions && (
                      <div className="pt-0.5 border-t border-slate-200 text-[8px] text-slate-500 whitespace-pre-line truncate">
                        {shop.termsAndConditions.split("\n")[0]}
                      </div>
                    )}
                  </div>

                  <div className="col-span-4 p-1.5 bg-white space-y-0.5">
                    <div className="flex justify-between text-slate-600">
                      <span>कर योग्य (Taxable):</span>
                      <span className="font-mono">₹{totals.totalTaxable.toFixed(2)}</span>
                    </div>
                    {!isBillOfSupply && (
                      <div className="flex justify-between text-slate-600">
                        <span>कुल टैक्स (GST):</span>
                        <span className="font-mono">₹{totals.totalTax.toFixed(2)}</span>
                      </div>
                    )}
                    {totals.roundOff !== 0 && (
                      <div className="flex justify-between text-slate-400 text-[8.5px]">
                        <span>राउंड ऑफ:</span>
                        <span className="font-mono">{totals.roundOff > 0 ? `+${totals.roundOff}` : totals.roundOff}</span>
                      </div>
                    )}
                    <div className="pt-1 border-t border-slate-900 flex justify-between items-center font-black text-slate-900">
                      <span className="uppercase text-[10px]">कुल देय:</span>
                      <span className="text-xs font-mono text-emerald-900">₹{totals.grandTotal.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {/* Footer: Bank Info & Signature */}
                <div className="border-x border-b border-slate-900 rounded-b p-2 bg-slate-50 grid grid-cols-12 gap-2 text-[9px] items-center">
                  <div className="col-span-8 flex items-center gap-2">
                    {displayQr && (
                      <img src={displayQr} alt="QR" className="w-12 h-12 object-contain border border-slate-300 rounded p-0.5 bg-white flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div><strong>बैंक / Bank:</strong> {shop.bankName}</div>
                      <div><strong>खाता / A/c:</strong> <span className="font-mono font-bold">{shop.bankAccountNo}</span></div>
                      <div><strong>IFSC:</strong> <span className="font-mono">{shop.bankIfsc}</span> • {shop.bankBranch}</div>
                      {shop.upiId && <div><strong>UPI ID:</strong> <span className="font-mono text-emerald-800">{shop.upiId}</span></div>}
                    </div>
                  </div>
                  <div className="col-span-4 border-l border-slate-300 pl-2 text-right">
                    <div className="text-[8.5px] text-slate-600">कृते / For {shop.name}</div>
                    <div className="h-6"></div>
                    <div className="border-t border-slate-400 pt-0.5 text-[8.5px] font-bold text-slate-800">
                      {shop.signatureText || "हस्ताक्षर / Auth. Signatory"}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};
