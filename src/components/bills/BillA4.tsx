import React from "react";
import { BillData } from "../../types";
import { formatDate } from "../../utils/formatters";
import { chunkBillLines } from "../../utils/billPagination";
import "./BillStyles.css";

interface BillA4Props {
  bill: BillData;
  qrDataUrl?: string;
  isPrintPreview?: boolean;
}

export const BillA4: React.FC<BillA4Props> = ({
  bill,
  qrDataUrl,
  isPrintPreview = false,
}) => {
  const { shop, party, invoice, lines, totals, hsnSummary, customization } = bill;
  const isWithoutTax =
    customization?.hideTaxDetails ||
    customization?.taxMode === "without_tax" ||
    invoice.billType === "CASH MEMO";
  const isBillOfSupply = !isWithoutTax && invoice.billType === "BILL OF SUPPLY";
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
  const pages = chunkBillLines(lines, "A4");

  return (
    <div
      className={`bill-container ${
        isPrintPreview ? "screen-preview-a4 space-y-6" : "w-full"
      }`}
    >
      {pages.map(({ items, pageIndex, totalPages, startIndex }) => {
        const isLastPage = pageIndex === totalPages - 1;

        return (
          <div
            key={pageIndex}
            className="bill-page bg-white text-slate-900 font-sans mx-auto p-6 relative select-text leading-tight border border-slate-300 shadow-md print:shadow-none print:border-none print:p-0"
            style={{
              width: "210mm",
              minHeight: "297mm",
              boxSizing: "border-box",
              color: "#0f172a",
              fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
            }}
          >
            {/* Watermarks */}
            {invoice.isDuplicate && (
              <div className="watermark-duplicate">डुप्लीकेट / DUPLICATE</div>
            )}
            {invoice.isCancelled && (
              <div className="watermark-cancelled">रद्द / CANCELLED</div>
            )}

            {/* Top Header: Shop Info & Invoice Badge (Repeated on Every Page) */}
            <div className="border-2 border-slate-900 rounded-t-md p-3.5 bg-slate-50/50">
              <div className="flex items-start justify-between gap-4">
                {/* Shop Logo & Name */}
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  {shop.logoData || shop.logoUrl ? (
                    <img
                      src={shop.logoData || shop.logoUrl}
                      alt="Shop Logo"
                      className="w-14 h-14 object-contain rounded border border-slate-300 flex-shrink-0 bg-white"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-emerald-800 text-amber-300 flex items-center justify-center font-serif text-2xl font-bold flex-shrink-0 shadow-sm">
                      श्री
                    </div>
                  )}
                  <div className="min-w-0">
                    <h1 className="text-2xl font-serif font-black tracking-tight text-slate-900 leading-tight">
                      {shop.name}
                    </h1>
                    <p className="text-xs font-medium text-slate-700 mt-0.5">{shop.address}</p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs font-semibold text-slate-800 mt-0.5">
                      {!isWithoutTax && shop.gstin && (
                        <span>
                          <strong className="text-slate-600">GSTIN:</strong> {shop.gstin}
                        </span>
                      )}
                      <span>
                        <strong className="text-slate-600">फोन:</strong> {shop.phone}
                      </span>
                      <span>
                        <strong className="text-slate-600">राज्य:</strong> {shop.stateCode} (मध्य प्रदेश)
                      </span>
                    </div>
                  </div>
                </div>

                {/* Invoice Category Heading & Page Count */}
                <div className="text-right flex-shrink-0">
                  <div className="flex items-center gap-2 justify-end">
                    <div className="inline-block border-2 border-slate-900 bg-slate-900 text-white font-black text-xs uppercase px-2.5 py-1 rounded tracking-wider shadow-sm">
                      {isWithoutTax
                        ? "BILL / CASH MEMO"
                        : invoice.billType === "TAX INVOICE"
                        ? "TAX INVOICE"
                        : isBillOfSupply
                        ? "BILL OF SUPPLY"
                        : "BILL / CASH MEMO"}
                    </div>
                    <div className="bg-slate-200 border border-slate-400 font-mono text-xs font-bold text-slate-900 px-2 py-1 rounded">
                      Page {pageIndex + 1}/{totalPages}
                    </div>
                  </div>
                  {isWithoutTax ? (
                    <p className="text-[10px] font-bold text-slate-600 mt-1 max-w-[200px]">
                      (बिल / कैश मेमो / Cash Memo)
                    </p>
                  ) : isBillOfSupply ? (
                    <p className="text-[10px] font-bold text-slate-600 mt-1 max-w-[200px]">
                      (कर रहित बिल - कम्पोज़िशन डीलर अथवा कर मुक्त माल)
                    </p>
                  ) : null}
                  <div className="text-xs font-semibold text-slate-600 mt-1">
                    <span>मूल प्रति / Original for Recipient</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Bill & Party Details Section (On Every Page) */}
            <div className="border-x-2 border-b-2 border-slate-900 grid grid-cols-12 text-xs">
              {/* Buyer / Bill To Details (7 Cols) */}
              <div className="col-span-7 p-2.5 border-r-2 border-slate-900 bg-white">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-0.5 border-b border-slate-200 pb-0.5">
                  {isBilingual ? "क्रेता का विवरण (BILL TO / BUYER)" : isHi ? "क्रेता का विवरण" : "BILL TO (BUYER)"}
                </div>
                <div className="font-bold text-sm text-slate-900">{party.name}</div>
                {party.village && (
                  <div className="text-slate-700 mt-0.5">
                    <strong className="text-slate-500">स्थान / Village:</strong> {party.village}
                  </div>
                )}
                {party.address && party.address !== party.village && (
                  <div className="text-slate-700">{party.address}</div>
                )}
                <div className="mt-1 space-y-0.5">
                  {!isWithoutTax && (
                    <div>
                      <strong className="text-slate-600">GSTIN / UIN:</strong>{" "}
                      {party.gstin ? (
                        <span className="font-mono font-bold">{party.gstin}</span>
                      ) : (
                        <span className="text-slate-500 italic">Unregistered (अपंजीकृत)</span>
                      )}
                    </div>
                  )}
                  {party.phone && (
                    <div>
                      <strong className="text-slate-600">फोन / Phone:</strong> {party.phone}
                    </div>
                  )}
                </div>
              </div>

              {/* Invoice Metadata (5 Cols) */}
              <div className="col-span-5 p-2.5 bg-slate-50/30 flex flex-col justify-between">
                <div className="space-y-1">
                  <div className="flex justify-between items-center border-b border-slate-200 pb-0.5">
                    <span className="font-semibold text-slate-600">
                      {isBilingual ? "बिल नं. / Invoice No:" : isHi ? "बिल नं.:" : "Invoice No:"}
                    </span>
                    <span className="font-mono font-black text-sm text-slate-900 tracking-tight">
                      {invoice.invoiceNo}
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-slate-600">
                      {isBilingual ? "तारीख / Date:" : isHi ? "तारीख:" : "Date:"}
                    </span>
                    <span className="font-bold text-slate-900 font-mono">
                      {formatDate(invoice.date)}
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-slate-600">भुगतान माध्यम / Mode:</span>
                    <span className="font-bold text-slate-900 uppercase">
                      {invoice.paymentMode === "credit"
                        ? "उधार (Credit)"
                        : invoice.paymentMode === "upi_bank"
                        ? "UPI / Bank"
                        : "नकद (Cash)"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Main Items Table */}
            <div className="border-x-2 border-b-2 border-slate-900 min-h-0">
              <table className="w-full text-xs border-collapse bill-table">
                <thead className="bg-slate-100 text-slate-900 font-bold border-b-2 border-slate-900">
                  <tr>
                    <th className="py-1.5 px-1.5 border-r border-slate-400 text-center w-8">
                      {isBilingual ? "क्र./Sr." : isHi ? "क्र." : "Sr."}
                    </th>
                    <th className="py-1.5 px-2.5 border-r border-slate-400 text-left">
                      {isBilingual ? "सामान का विवरण (Description of Goods)" : isHi ? "विवरण" : "Description of Goods"}
                    </th>
                    {cols.hsn && !isBillOfSupply && !isWithoutTax && (
                      <th className="py-1.5 px-2 border-r border-slate-400 text-center w-16">
                        HSN
                      </th>
                    )}
                    <th className="py-1.5 px-2 border-r border-slate-400 text-right w-14">
                      {isBilingual ? "मात्रा/Qty" : isHi ? "मात्रा" : "Qty"}
                    </th>
                    {cols.unit && (
                      <th className="py-1.5 px-1.5 border-r border-slate-400 text-center w-12">
                        {isBilingual ? "इकाई/Unit" : isHi ? "इकाई" : "Unit"}
                      </th>
                    )}
                    <th className="py-1.5 px-2 border-r border-slate-400 text-right w-16">
                      {isBilingual ? "दर/Rate (₹)" : isHi ? "दर (₹)" : "Rate (₹)"}
                    </th>
                    {cols.discount && (
                      <th className="py-1.5 px-1.5 border-r border-slate-400 text-right w-14">
                        {isBilingual ? "छूट/Disc" : isHi ? "छूट" : "Disc"}
                      </th>
                    )}
                    {cols.taxable && !isBillOfSupply && !isWithoutTax && (
                      <th className="py-1.5 px-2 border-r border-slate-400 text-right w-20">
                        {isBilingual ? "कर योग्य/Taxable" : isHi ? "कर योग्य" : "Taxable"}
                      </th>
                    )}
                    {cols.gstRate && !isBillOfSupply && !isWithoutTax && (
                      <th className="py-1.5 px-1.5 border-r border-slate-400 text-center w-12">
                        GST%
                      </th>
                    )}
                    <th className="py-1.5 px-2.5 text-right w-24">
                      {isBilingual ? "रकम / Total (₹)" : isHi ? "रकम (₹)" : "Total (₹)"}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {items.map((item, idx) => {
                    const itemSr = startIndex + idx + 1;
                    return (
                      <tr key={idx} className="hover:bg-slate-50/60">
                        <td className="py-1 px-1.5 border-r border-slate-300 text-center font-mono text-slate-600">
                          {itemSr}
                        </td>
                        <td className="py-1 px-2.5 border-r border-slate-300 break-words">
                          <span className="font-bold text-slate-900">{item.name}</span>
                        </td>
                        {cols.hsn && !isBillOfSupply && !isWithoutTax && (
                          <td className="py-1 px-2 border-r border-slate-300 text-center font-mono text-slate-700">
                            {item.hsn}
                          </td>
                        )}
                        <td className="py-1 px-2 border-r border-slate-300 text-right font-mono font-bold text-slate-900">
                          {item.qty}
                        </td>
                        {cols.unit && (
                          <td className="py-1 px-1.5 border-r border-slate-300 text-center text-slate-600 uppercase text-[11px]">
                            {item.unit}
                          </td>
                        )}
                        <td className="py-1 px-2 border-r border-slate-300 text-right font-mono text-slate-800">
                          {item.rate.toFixed(2)}
                        </td>
                        {cols.discount && (
                          <td className="py-1 px-1.5 border-r border-slate-300 text-right font-mono text-slate-500">
                            {item.discount ? item.discount.toFixed(2) : "-"}
                          </td>
                        )}
                        {cols.taxable && !isBillOfSupply && !isWithoutTax && (
                          <td className="py-1 px-2 border-r border-slate-300 text-right font-mono text-slate-800">
                            {item.taxableAmount.toFixed(2)}
                          </td>
                        )}
                        {cols.gstRate && !isBillOfSupply && !isWithoutTax && (
                          <td className="py-1 px-1.5 border-r border-slate-300 text-center font-mono text-slate-700">
                            {item.gstRate}%
                          </td>
                        )}
                        <td className="py-1 px-2.5 text-right font-mono font-black text-slate-900">
                          {item.totalAmount.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Continuation note on non-final pages */}
            {!isLastPage && (
              <div className="py-6 text-center text-xs font-bold text-slate-600">
                --- जारी... अगला पृष्ठ देखें (Continued on Page {pageIndex + 2}) ---
              </div>
            )}

            {/* Totals & Full Summary ONLY on Last Page */}
            {isLastPage && (
              <>
                {/* HSN / Tax Breakdown Summary - ONLY in With GST */}
                {!isBillOfSupply && !isWithoutTax && hsnSummary && hsnSummary.length > 0 && (
                  <div className="border-x-2 border-b-2 border-slate-900 text-xs">
                    <div className="bg-slate-100 px-3 py-1 font-bold border-b border-slate-300 flex justify-between items-center">
                      <span className="uppercase text-[11px] tracking-wider text-slate-700">
                        {isBilingual ? "कर विश्लेषण (GST Tax Analysis Summary)" : "GST Tax Analysis"}
                      </span>
                      <span className="font-mono text-slate-900 font-bold">
                        कुल टैक्स / Total Tax: ₹{totals.totalTax.toFixed(2)}
                      </span>
                    </div>
                    <table className="w-full border-collapse">
                      <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-300 text-[11px]">
                        <tr>
                          <th className="py-1 px-2 border-r border-slate-300 text-left">HSN/SAC</th>
                          <th className="py-1 px-2 border-r border-slate-300 text-right">कर योग्य मूल्य (Taxable)</th>
                          <th className="py-1 px-2 border-r border-slate-300 text-right">केन्द्रीय कर (CGST)</th>
                          <th className="py-1 px-2 border-r border-slate-300 text-right">राज्य कर (SGST)</th>
                          <th className="py-1 px-2 border-r border-slate-300 text-right">एकीकृत कर (IGST)</th>
                          <th className="py-1 px-2 text-right">कुल कर (Total Tax)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 font-mono text-[11px]">
                        {hsnSummary.map((hs, i) => (
                          <tr key={i} className="hover:bg-slate-50/50">
                            <td className="py-1 px-2 border-r border-slate-300 font-bold">{hs.hsn}</td>
                            <td className="py-1 px-2 border-r border-slate-300 text-right">{hs.taxableAmount.toFixed(2)}</td>
                            <td className="py-1 px-2 border-r border-slate-300 text-right">{hs.cgstAmount.toFixed(2)}</td>
                            <td className="py-1 px-2 border-r border-slate-300 text-right">{hs.sgstAmount.toFixed(2)}</td>
                            <td className="py-1 px-2 border-r border-slate-300 text-right">{hs.igstAmount.toFixed(2)}</td>
                            <td className="py-1 px-2 text-right font-bold text-slate-900">{hs.totalTax.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Amount In Words & Financial Summary */}
                <div className="border-x-2 border-b-2 border-slate-900 grid grid-cols-12 text-xs">
                  {/* Left: Amount in Words & Terms */}
                  <div className="col-span-7 p-3 border-r-2 border-slate-900 bg-slate-50/40 flex flex-col justify-between">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">
                        कुल राशि शब्दों में / Amount in Words:
                      </div>
                      {isHi && (
                        <div className="font-bold text-slate-900 text-xs">
                          🇮🇳 {totals.amountInWordsHindi}
                        </div>
                      )}
                      {isEn && (
                        <div className="text-slate-600 italic text-[11px] mt-0.5">
                          🔤 {totals.amountInWordsEnglish}
                        </div>
                      )}
                    </div>

                    {shop.termsAndConditions && (
                      <div className="mt-2 pt-1.5 border-t border-slate-300">
                        <div className="text-[10px] font-bold text-slate-600 uppercase mb-0.5">
                          नियम एवं शर्तें / Terms & Conditions:
                        </div>
                        <div className="text-[10px] text-slate-600 whitespace-pre-line leading-tight">
                          {shop.termsAndConditions}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right: Totals Box */}
                  <div className="col-span-5 p-3 bg-white space-y-1.5 text-xs">
                    {isWithoutTax ? (
                      <div className="flex justify-between text-slate-700">
                        <span>कुल मूल्य / Sub Total:</span>
                        <span className="font-mono font-bold">₹{totals.totalTaxable.toFixed(2)}</span>
                      </div>
                    ) : (
                      <div className="flex justify-between text-slate-700">
                        <span>कर योग्य मूल्य / Taxable Amount:</span>
                        <span className="font-mono font-bold">₹{totals.totalTaxable.toFixed(2)}</span>
                      </div>
                    )}

                    {totals.discount !== undefined && totals.discount > 0 && (
                      <div className="flex justify-between text-red-600">
                        <span>छूट / Discount:</span>
                        <span className="font-mono font-semibold">-₹{totals.discount.toFixed(2)}</span>
                      </div>
                    )}

                    {!isBillOfSupply && !isWithoutTax && (
                      <>
                        {totals.totalCgst > 0 && (
                          <div className="flex justify-between text-slate-700">
                            <span>केन्द्रीय कर / CGST:</span>
                            <span className="font-mono">₹{totals.totalCgst.toFixed(2)}</span>
                          </div>
                        )}
                        {totals.totalSgst > 0 && (
                          <div className="flex justify-between text-slate-700">
                            <span>राज्य कर / SGST:</span>
                            <span className="font-mono">₹{totals.totalSgst.toFixed(2)}</span>
                          </div>
                        )}
                        {totals.totalIgst > 0 && (
                          <div className="flex justify-between text-slate-700">
                            <span>एकीकृत कर / IGST:</span>
                            <span className="font-mono">₹{totals.totalIgst.toFixed(2)}</span>
                          </div>
                        )}
                      </>
                    )}

                    {totals.roundOff !== 0 && (
                      <div className="flex justify-between text-slate-500 text-[11px]">
                        <span>राउंड ऑफ / Round Off:</span>
                        <span className="font-mono">{totals.roundOff > 0 ? `+${totals.roundOff}` : totals.roundOff}</span>
                      </div>
                    )}

                    <div className="pt-2 border-t-2 border-slate-900 flex justify-between items-center text-slate-900">
                      <span className="font-black text-sm uppercase">
                        {isBilingual ? "कुल देय / Grand Total:" : isHi ? "कुल देय:" : "Grand Total:"}
                      </span>
                      <span className="font-black text-xl font-mono text-emerald-900">
                        ₹{totals.grandTotal.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Footer: Bank Details + UPI QR + Signature */}
                <div className="border-x-2 border-b-2 border-slate-900 rounded-b-md p-3 bg-slate-50 grid grid-cols-12 gap-3 items-center">
                  <div className="col-span-8 flex items-center gap-3">
                    {displayQr && (
                      <div className="flex flex-col items-center flex-shrink-0 bg-white p-1 border border-slate-300 rounded shadow-2xs">
                        <img
                          src={displayQr}
                          alt="UPI QR Code"
                          className="w-16 h-16 object-contain"
                        />
                        <span className="text-[8px] font-black text-slate-700 uppercase tracking-tight mt-0.5">
                          Scan UPI
                        </span>
                      </div>
                    )}

                    <div className="text-[11px] space-y-0.5 min-w-0">
                      <div className="font-bold text-slate-900 uppercase tracking-wide border-b border-slate-200 pb-0.5 mb-0.5">
                        बैंक विवरण / Bank Details:
                      </div>
                      <div>
                        <strong className="text-slate-600">बैंक:</strong> {shop.bankName}
                      </div>
                      <div>
                        <strong className="text-slate-600">खाता:</strong>{" "}
                        <span className="font-mono font-bold text-slate-900">{shop.bankAccountNo}</span>
                      </div>
                      <div>
                        <strong className="text-slate-600">IFSC:</strong>{" "}
                        <span className="font-mono font-bold text-slate-900">{shop.bankIfsc}</span>
                        <span className="mx-1 text-slate-300">•</span>
                        <strong className="text-slate-600">शाखा:</strong> {shop.bankBranch}
                      </div>
                      {shop.upiId && (
                        <div>
                          <strong className="text-slate-600">UPI ID:</strong>{" "}
                          <span className="font-mono font-bold text-emerald-800">{shop.upiId}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="col-span-4 border-l-2 border-slate-300 pl-3 flex flex-col justify-between h-full min-h-[80px] text-right">
                    <div className="text-[10px] font-bold text-slate-700">
                      कृते / For <strong className="text-slate-900">{shop.name}</strong>
                    </div>
                    <div className="flex-1 flex items-center justify-end py-1">
                      {shop.signatureData || shop.signatureUrl ? (
                        <img
                          src={shop.signatureData || shop.signatureUrl}
                          alt="Signature"
                          className="max-h-10 object-contain"
                        />
                      ) : (
                        <div className="h-8"></div>
                      )}
                    </div>
                    <div className="border-t border-slate-400 pt-1 text-[10px] font-bold text-slate-800">
                      {shop.signatureText || "अधिकृत हस्ताक्षरकर्ता / Auth. Signatory"}
                    </div>
                  </div>
                </div>
                {isWithoutTax && (
                  <div className="mt-1.5 text-center text-[10px] font-semibold text-slate-500">
                    * यह कर इनवॉइस नहीं है (This is not a Tax Invoice.) *
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};
