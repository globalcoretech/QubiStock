import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, InvoicePrintDetails, BillData, BillFormat } from "../types";
import { Translations, Language } from "../i18n";
import { Printer, X, AlertCircle, FileText, Check } from "./icons";
import { buildBillDataWithQr } from "../utils/billBuilder";
import { BillViewer } from "./bills/BillViewer";
import {
  printInvoiceBill,
  executeDialogPrint,
  PrintBillResponse,
} from "../utils/printManager";

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
  const [billData, setBillData] = useState<BillData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [printFeedback, setPrintFeedback] = useState<{
    msg: string;
    isError: boolean;
    rawError?: string;
  } | null>(null);
  const [printing, setPrinting] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<BillFormat>(
    settings.printerPaperSize || settings.defaultBillFormat || "A4"
  );
  const [isDuplicate, setIsDuplicate] = useState(false);

  useEffect(() => {
    if (isOpen && invoiceNo) {
      setLoading(true);
      setError("");
      setPrintFeedback(null);
      invoke<InvoicePrintDetails>("get_invoice_details_cmd", { invoiceNo })
        .then(async (details) => {
          const bill = await buildBillDataWithQr({
            invoiceDetails: details,
            settings: {
              ...settings,
              billLanguage: settings.billLanguage || (lang === "hi" ? "hi" : "both"),
            },
            isDuplicate,
          });
          setBillData(bill);
        })
        .catch((err) => {
          console.error("get_invoice_details_cmd error:", err);
          setError("बिल लोड करने में त्रुटि: " + String(err));
        })
        .finally(() => setLoading(false));
    }
  }, [isOpen, invoiceNo, settings, isDuplicate]);

  if (!isOpen) return null;

  const handlePrint = async () => {
    setPrinting(true);
    setPrintFeedback(null);

    try {
      const resp: PrintBillResponse = await printInvoiceBill({
        settings,
        format: selectedFormat,
        invoiceNo,
      });

      if (resp.success) {
        setPrintFeedback({
          msg:
            lang === "hi"
              ? `प्रिंट कमांड भेजी गई (${resp.printer_used})`
              : `Print sent (${resp.printer_used})`,
          isError: false,
        });
      } else {
        setPrintFeedback({
          msg:
            lang === "hi"
              ? `प्रिंट विफल: ${resp.message}`
              : `Print failed: ${resp.message}`,
          isError: true,
          rawError: resp.raw_error,
        });
      }
    } catch (err: any) {
      setPrintFeedback({
        msg: "प्रिंटर त्रुटि: प्रिंट नहीं हो सका।",
        isError: true,
        rawError: String(err),
      });
    } finally {
      setPrinting(false);
    }
  };

  const handleFallbackPdf = async () => {
    setPrinting(true);
    try {
      await executeDialogPrint(
        selectedFormat,
        settings.printOffsetXmm || 0,
        settings.printOffsetYmm || 0
      );
      setPrintFeedback({
        msg: "प्रिंट डायलॉग खोला गया (Save as PDF)",
        isError: false,
      });
    } catch (e: any) {
      setError("डायलॉग खोलने में विफल: " + String(e));
    } finally {
      setPrinting(false);
    }
  };

  return createPortal(
    <div
      data-testid="print-invoice-modal"
      data-scroll="true"
      className="bill-modal-overlay fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
    >
      <div className="bill-modal-card bg-white rounded-2xl w-full max-w-4xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[94vh]">
        {/* Controls Header (Hidden in Print) */}
        <div className="no-print p-3 sm:p-4 bg-slate-100/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Printer size={18} className="text-slate-700" />
            <span className="font-bold text-slate-900 text-sm">
              {invoiceNo} • {t.dashboard.printAction}
            </span>
            {settings.selectedPrinter && (
              <span className="text-[11px] font-medium text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
                {settings.selectedPrinter}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Duplicate mark toggle */}
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer bg-white px-2.5 py-1.5 rounded-lg border border-slate-300 shadow-2xs">
              <input
                type="checkbox"
                checked={isDuplicate}
                onChange={(e) => setIsDuplicate(e.target.checked)}
                className="rounded text-forest focus:ring-forest cursor-pointer"
              />
              <span>डुप्लीकेट मार्क</span>
            </label>

            {/* Direct PDF Fallback Button */}
            <button
              type="button"
              onClick={handleFallbackPdf}
              disabled={loading || !billData || printing}
              className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
              title="सिस्टम डायलॉग / PDF सेव करें"
            >
              <FileText size={14} />
              <span>PDF बनाओ</span>
            </button>

            {/* Print button */}
            <button
              type="button"
              onClick={handlePrint}
              disabled={loading || !billData || printing}
              className="btn-primary text-sm py-1.5 px-4 flex items-center gap-1.5 shadow-sm"
            >
              <Printer size={15} />
              <span>{printing ? "प्रिंट हो रहा है..." : t.common.print}</span>
            </button>

            <button
              type="button"
              data-testid="print-modal-close-btn"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg transition-colors hover:bg-slate-200"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Feedback Banner if print failed or succeeded */}
        {printFeedback && (
          <div
            className={`no-print px-4 py-2.5 text-xs font-semibold flex items-center justify-between gap-2 border-b ${
              printFeedback.isError
                ? "bg-red-50 text-red-900 border-red-200"
                : "bg-emerald-50 text-emerald-900 border-emerald-200"
            }`}
          >
            <div className="flex items-center gap-2">
              {printFeedback.isError ? (
                <AlertCircle size={15} className="text-red-600 flex-shrink-0" />
              ) : (
                <Check size={15} className="text-emerald-600 flex-shrink-0" />
              )}
              <span>{printFeedback.msg}</span>
              {printFeedback.rawError && (
                <span className="font-mono text-[11px] text-red-700 bg-red-100 px-1.5 py-0.5 rounded ml-1">
                  ({printFeedback.rawError})
                </span>
              )}
            </div>

            {printFeedback.isError && (
              <button
                type="button"
                onClick={handleFallbackPdf}
                className="btn-secondary text-[11px] py-1 px-2.5 bg-white border-red-300 text-red-800 hover:bg-red-50"
              >
                वैकल्पिक: PDF बनाओ
              </button>
            )}
          </div>
        )}


        {/* Printable Area */}
        <div
          data-scroll="true"
          className="p-4 sm:p-6 overflow-y-auto flex-1 bg-slate-100/50 flex justify-center text-slate-900"
        >
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

          {!loading && billData && (
            <div className="w-full flex justify-center">
              <BillViewer
                bill={billData}
                initialFormat={selectedFormat}
                onFormatChange={setSelectedFormat}
                isModal={true}
              />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
