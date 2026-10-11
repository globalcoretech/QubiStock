import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, InvoicePrintDetails } from "../types";
import { Translations, Language } from "../i18n";
import { formatCurrency, formatDate, formatPaymentMode } from "../utils/formatters";
import { Printer, X, AlertCircle } from "./icons";

interface PrintInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoiceNo: string;
  settings: AppSettings;
  t: Translations;
  lang: Language;
}

export function PrintInvoiceModal({
  isOpen,
  onClose,
  invoiceNo,
  settings,
  t,
  lang,
}: PrintInvoiceModalProps) {
  const [details, setDetails] = useState<InvoicePrintDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen && invoiceNo) {
      setLoading(true);
      setError("");
      invoke<InvoicePrintDetails>("get_invoice_details_cmd", { invoiceNo })
        .then(setDetails)
        .catch((err) => {
          console.error("get_invoice_details_cmd error:", err);
          setError("बिल लोड करने में त्रुटि: " + String(err));
        })
        .finally(() => setLoading(false));
    }
  }, [isOpen, invoiceNo]);

  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-xl w-full max-w-3xl shadow-xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Controls Header (Hidden in Print) */}
        <div className="no-print p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Printer size={18} className="text-slate-700" />
            <span className="font-semibold text-slate-900 text-sm">
              {invoiceNo} • {t.dashboard.printAction}
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handlePrint}
              disabled={loading || !details}
              className="btn-primary text-sm py-2 px-4"
            >
              <Printer size={15} />
              <span>{t.common.print}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Printable Area */}
        <div className="p-8 overflow-y-auto flex-1 bg-white print-area text-slate-900 font-sans">
          {loading && (
            <div className="p-12 text-center text-slate-400 text-sm">
              {t.common.loading}
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm font-medium flex items-center gap-2">
              <AlertCircle size={16} className="text-red-600 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {details && (
            <div className="space-y-5">
              {/* Header: Shop Name & Details */}
              <div className="text-center pb-3 border-b-2 border-slate-900">
                <h1 className="text-2xl font-bold text-slate-900 uppercase tracking-tight">
                  {settings.shopName}
                </h1>
                <p className="text-sm text-slate-600 mt-0.5">{settings.address}</p>
                <div className="flex flex-wrap items-center justify-center gap-4 text-xs font-medium text-slate-700 mt-1">
                  {settings.phone && <span>फोन: {settings.phone}</span>}
                  {settings.gstin && <span className="font-mono">GSTIN: {settings.gstin}</span>}
                  <span>राज्य कोड: {settings.stateCode}</span>
                </div>
                <div className="inline-block mt-2 px-3 py-0.5 bg-slate-900 text-white font-semibold text-xs tracking-wider uppercase rounded">
                  बिक्री बिल / TAX INVOICE
                </div>
              </div>

              {/* Invoice & Customer Metadata */}
              <div className="grid grid-cols-2 gap-4 text-sm border-b border-slate-200 pb-3">
                <div className="space-y-0.5">
                  <div>
                    <span className="text-slate-500">{t.common.customer}: </span>
                    <strong className="text-slate-900 font-semibold">{details.party_name}</strong>
                  </div>
                  {details.party_village && (
                    <div className="text-slate-600">
                      <span className="text-slate-500">{t.common.village}: </span>
                      <span>{details.party_village}</span>
                    </div>
                  )}
                  {details.party_phone && (
                    <div className="text-slate-600 font-mono">
                      <span className="text-slate-500">{t.common.phone}: </span>
                      <span>{details.party_phone}</span>
                    </div>
                  )}
                  {details.party_gstin && (
                    <div className="text-slate-600 font-mono">
                      <span className="text-slate-500">GSTIN: </span>
                      <span className="font-semibold">{details.party_gstin}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-0.5 text-right">
                  <div>
                    <span className="text-slate-500">{t.dashboard.invoiceNo}: </span>
                    <strong className="font-mono text-slate-900">{details.invoice_no}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">{t.common.date}: </span>
                    <strong className="font-mono">{formatDate(details.date)}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">{t.common.paymentMode}: </span>
                    <strong className="font-medium">
                      {formatPaymentMode(details.payment_mode, lang)}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs report-table border border-slate-300">
                  <thead>
                    <tr className="border-b border-slate-400 bg-slate-50 text-slate-800 font-semibold">
                      <th className="p-2 border border-slate-300 text-center w-10">क्र.</th>
                      <th className="p-2 border border-slate-300">{t.salePurchase.itemsTableHeader.item}</th>
                      <th className="p-2 border border-slate-300 text-right w-20">{t.salePurchase.itemsTableHeader.qty}</th>
                      <th className="p-2 border border-slate-300 text-right w-20">{t.salePurchase.itemsTableHeader.rate}</th>
                      <th className="p-2 border border-slate-300 text-right w-24">{t.salePurchase.itemsTableHeader.taxable}</th>
                      <th className="p-2 border border-slate-300 text-right w-20">{t.common.tax}</th>
                      <th className="p-2 border border-slate-300 text-right w-24">{t.salePurchase.itemsTableHeader.total}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {details.lines.map((l, idx) => (
                      <tr key={idx}>
                        <td className="p-2 border border-slate-300 text-center text-slate-500">{idx + 1}</td>
                        <td className="p-2 border border-slate-300 font-medium text-slate-900">{l.item_name}</td>
                        <td className="p-2 border border-slate-300 text-right font-mono">
                          {(l.qty / 1000).toFixed(2)} {l.unit}
                        </td>
                        <td className="p-2 border border-slate-300 text-right font-mono">
                          {formatCurrency(l.rate)}
                        </td>
                        <td className="p-2 border border-slate-300 text-right font-mono">
                          {formatCurrency(l.taxable)}
                        </td>
                        <td className="p-2 border border-slate-300 text-right font-mono text-slate-600">
                          {formatCurrency(l.gst_amount)}
                        </td>
                        <td className="p-2 border border-slate-300 text-right font-mono font-semibold text-slate-900">
                          {formatCurrency(l.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-800 bg-slate-50 font-bold text-slate-900">
                      <td colSpan={4} className="p-2 border border-slate-300 uppercase">
                        {t.common.total}
                      </td>
                      <td className="p-2 border border-slate-300 text-right font-mono">
                        {formatCurrency(details.lines.reduce((acc, x) => acc + x.taxable, 0))}
                      </td>
                      <td className="p-2 border border-slate-300 text-right font-mono">
                        {formatCurrency(details.lines.reduce((acc, x) => acc + x.gst_amount, 0))}
                      </td>
                      <td className="p-2 border border-slate-300 text-right font-mono text-sm">
                        {formatCurrency(details.total_amount)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Payment Settlement Summary */}
              <div className="flex justify-between items-start text-xs border-t border-slate-200 pt-3">
                <div className="max-w-md text-slate-500">
                  <p className="font-semibold text-slate-700">शर्तें एवं नियम:</p>
                  <p className="mt-0.5 leading-relaxed">
                    {settings.footerNote || "बिका हुआ माल वापस नहीं होगा। धन्यवाद!"}
                  </p>
                </div>

                <div className="w-56 space-y-1 text-right">
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t.salePurchase.confirmTotal}:</span>
                    <span className="font-mono font-semibold text-slate-900">
                      {formatCurrency(details.total_amount)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">{t.salePurchase.confirmPaid}:</span>
                    <span className="font-mono text-emerald-700 font-semibold">
                      {formatCurrency(details.paid_amount)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-1">
                    <span className="text-slate-600 font-semibold">{t.salePurchase.confirmBalance}:</span>
                    <span className="font-mono font-bold text-slate-900">
                      {formatCurrency(details.total_amount - details.paid_amount)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Signatures */}
              <div className="pt-10 flex justify-between items-end text-xs text-slate-500">
                <div className="text-center">
                  <div className="w-36 border-t border-slate-300 pt-1">ग्राहक के हस्ताक्षर</div>
                </div>
                <div className="text-center">
                  <p className="font-semibold text-slate-800 mb-6">कृते, {settings.shopName}</p>
                  <div className="w-40 border-t border-slate-300 pt-1">अधिकृत हस्ताक्षरकर्ता</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
