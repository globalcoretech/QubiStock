import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, InvoicePrintDetails, BillData, BillFormat, BillTaxMode } from "../types";
import { Translations, Language } from "../i18n";
import { Printer, X, AlertCircle, FileText, Check } from "./icons";
import { calculateBill, buildBillDataWithQr } from "../utils/billBuilder";
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
  initialTaxMode?: BillTaxMode;
}

export function PrintInvoiceModal({
  isOpen,
  onClose,
  invoiceNo,
  settings,
  t,
  lang,
  initialTaxMode = "with_tax",
}: PrintInvoiceModalProps) {
  const [billData, setBillData] = useState<BillData | null>(null);
  const [rawDetails, setRawDetails] = useState<InvoicePrintDetails | null>(null);
  const [taxMode, setTaxMode] = useState<BillTaxMode>(initialTaxMode);
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

  // Sync initial tax mode or default when opening
  useEffect(() => {
    if (isOpen) {
      setTaxMode(initialTaxMode);
    }
  }, [isOpen, initialTaxMode]);

  // Load invoice details and last printed mode from DB
  useEffect(() => {
    if (isOpen && invoiceNo) {
      setLoading(true);
      setError("");
      setPrintFeedback(null);

      Promise.all([
        invoke<InvoicePrintDetails>("get_invoice_details_cmd", { invoiceNo }),
        invoke<string>("get_last_invoice_print_mode_cmd", { invoiceNo }).catch(
          () => "WITH_GST"
        ),
      ])
        .then(([details, lastMode]) => {
          setRawDetails(details);
          // Default to last printed mode from invoice_print_log, else WITH_GST
          if (lastMode === "WITHOUT_GST") {
            setTaxMode("without_tax");
          } else {
            setTaxMode("with_tax");
          }
        })
        .catch((err) => {
          console.error("Failed to load invoice details or print mode:", err);
          setError("बिल लोड करने में त्रुटि: " + String(err));
        })
        .finally(() => setLoading(false));
    }
  }, [isOpen, invoiceNo]);

  // Live preview update whenever taxMode, rawDetails, isDuplicate or format change
  // (Pure preview update - absolutely NO database write)
  useEffect(() => {
    if (rawDetails) {
      buildBillDataWithQr({
        invoiceDetails: rawDetails,
        settings: {
          ...settings,
          defaultBillFormat: selectedFormat,
          billLanguage: settings.billLanguage || (lang === "hi" ? "hi" : "both"),
        },
        isDuplicate,
        taxMode,
        hideTaxDetails: taxMode === "without_tax",
      }).then((bill) => {
        setBillData(bill);
      });
    }
  }, [rawDetails, taxMode, isDuplicate, selectedFormat, settings, lang]);

  if (!isOpen) return null;

  // Single source of truth calculation for both modes
  const billPair = rawDetails ? calculateBill(rawDetails, settings) : null;
  const withGstGrandTotal = billPair?.withGst.totals.grandTotal ?? 0;
  const withoutGstGrandTotal = billPair?.withoutGst.totals.grandTotal ?? 0;

  const logPrintToDb = async (mode: BillTaxMode) => {
    const dbMode = mode === "without_tax" ? "WITHOUT_GST" : "WITH_GST";
    try {
      await invoke("log_invoice_print_cmd", {
        invoiceNo,
        billMode: dbMode,
      });
    } catch (err) {
      console.warn("Could not log invoice print in invoice_print_log:", err);
    }
  };

  const handlePrint = async (overrideMode?: BillTaxMode) => {
    if (printing) return;
    setPrinting(true);
    setPrintFeedback(null);

    const activeMode = overrideMode || taxMode;
    if (overrideMode && overrideMode !== taxMode) {
      setTaxMode(overrideMode);
    }

    try {
      // 1. Ensure billData is synchronized with activeMode
      let currentBill = billData;
      if (rawDetails && (!currentBill || currentBill.customization?.taxMode !== activeMode)) {
        currentBill = await buildBillDataWithQr({
          invoiceDetails: rawDetails,
          settings: {
            ...settings,
            defaultBillFormat: selectedFormat,
            billLanguage: settings.billLanguage || (lang === "hi" ? "hi" : "both"),
          },
          isDuplicate,
          taxMode: activeMode,
          hideTaxDetails: activeMode === "without_tax",
        });
        setBillData(currentBill);
        await new Promise((r) => setTimeout(r, 60));
      }

      // 2. Extract rendered HTML content for silent print
      const billEl = document.querySelector(".bill-container");
      const htmlContent = billEl ? billEl.outerHTML : undefined;

      // 3. Print the bill matching selected mode
      const resp: PrintBillResponse = await printInvoiceBill({
        settings,
        format: selectedFormat,
        htmlContent,
        invoiceNo,
        taxMode: activeMode,
      });

      // 4. Log print ONLY after the print actually succeeded (Requirement 5)
      if (resp.success) {
        await logPrintToDb(activeMode);
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

  const handleFallbackPdf = async (overrideMode?: BillTaxMode) => {
    if (printing) return;
    setPrinting(true);
    const activeMode = overrideMode || taxMode;
    if (overrideMode && overrideMode !== taxMode) {
      setTaxMode(overrideMode);
    }

    try {
      if (rawDetails && (!billData || billData.customization?.taxMode !== activeMode)) {
        const updatedBill = await buildBillDataWithQr({
          invoiceDetails: rawDetails,
          settings: {
            ...settings,
            defaultBillFormat: selectedFormat,
            billLanguage: settings.billLanguage || (lang === "hi" ? "hi" : "both"),
          },
          isDuplicate,
          taxMode: activeMode,
          hideTaxDetails: activeMode === "without_tax",
        });
        setBillData(updatedBill);
        await new Promise((r) => setTimeout(r, 60));
      }

      await executeDialogPrint(
        selectedFormat,
        settings.printOffsetXmm || 0,
        settings.printOffsetYmm || 0
      );

      // Log print ONLY after the PDF dialog was opened successfully (Requirement 5)
      await logPrintToDb(activeMode);

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
      className="bill-modal-overlay fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto"
    >
      <div className="bill-modal-card bg-white rounded-2xl w-full max-w-5xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[96vh]">
        {/* Controls Header (Hidden in Print) */}
        <div className="no-print p-3 sm:p-3.5 bg-slate-100/95 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <Printer size={18} className="text-slate-700" />
            <span className="font-bold text-slate-900 text-sm">
              {invoiceNo} • {t.dashboard.printAction}
            </span>
            {settings.selectedPrinter && (
              <span className="text-[11px] font-medium text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200 hidden md:inline">
                {settings.selectedPrinter}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Paper Size Selector */}
            <div className="flex items-center bg-white p-0.5 rounded-lg border border-slate-300">
              {(["A4", "A5", "A6"] as BillFormat[]).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  data-testid={`modal-format-btn-${fmt}`}
                  onClick={() => setSelectedFormat(fmt)}
                  className={`px-2 py-1 rounded text-xs font-bold transition-all ${
                    selectedFormat === fmt
                      ? "bg-slate-800 text-white shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>

            {/* Duplicate mark toggle */}
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer bg-white px-2.5 py-1.5 rounded-lg border border-slate-300 shadow-2xs">
              <input
                type="checkbox"
                checked={isDuplicate}
                onChange={(e) => setIsDuplicate(e.target.checked)}
                className="rounded text-forest focus:ring-forest cursor-pointer"
              />
              <span>डुप्लीकेट</span>
            </label>

            {/* Direct PDF Fallback Button */}
            <button
              type="button"
              onClick={() => handleFallbackPdf()}
              disabled={loading || !billData || printing}
              className="btn-secondary text-xs py-1.5 px-2.5 flex items-center gap-1"
              title="सिस्टम डायलॉग / PDF सेव करें"
            >
              <FileText size={14} />
              <span>PDF</span>
            </button>

            {/* Main Print Button */}
            <button
              type="button"
              data-testid="print-action-btn"
              onClick={() => handlePrint()}
              disabled={loading || !billData || printing}
              className={`text-xs py-1.5 px-3 flex items-center gap-1.5 rounded-lg font-bold shadow-sm transition-all ${
                taxMode === "with_tax"
                  ? "bg-emerald-700 hover:bg-emerald-800 text-white ring-2 ring-emerald-400/50"
                  : "bg-amber-700 hover:bg-amber-800 text-white ring-2 ring-amber-400/50"
              }`}
              title="वर्तमान चयनित मोड में प्रिंट करें"
            >
              <Printer size={14} />
              <span>
                {printing
                  ? "प्रिंट..."
                  : taxMode === "with_tax"
                  ? "टैक्स सहित प्रिंट (Print With GST)"
                  : "बिना टैक्स प्रिंट (Print Without GST)"}
              </span>
            </button>

            {/* Close Button */}
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

        {/* Top Section: Calculation Comparison Cards (With GST vs Without GST) */}
        <div className="no-print bg-slate-50/95 border-b border-slate-200 px-4 py-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                {lang === "hi"
                  ? "प्रिंट का प्रारूप चुनें (Choose Print Mode):"
                  : "Choose Print Mode:"}
              </span>
              <span className="text-[11px] font-semibold text-slate-500">
                {lang === "hi"
                  ? "डेटाबेस में कोई बदलाव नहीं होगा"
                  : "Database is never changed"}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Card 1: With GST */}
              <button
                type="button"
                data-testid="print-card-with-tax"
                onClick={() => setTaxMode("with_tax")}
                className={`relative p-3 rounded-xl border-2 text-left transition-all flex items-start justify-between gap-3 ${
                  taxMode === "with_tax"
                    ? "border-emerald-600 bg-emerald-50/90 shadow-sm ring-2 ring-emerald-500/20"
                    : "border-slate-200 bg-white hover:border-emerald-300 hover:bg-slate-50/50"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-base">🧾</span>
                    <span className="font-bold text-sm text-slate-900">
                      With GST (Tax Invoice)
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    टैक्स इनवॉइस • GSTIN, HSN कोड व CGST/SGST सहित
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-[10px] uppercase font-bold text-slate-500">
                    Grand Total
                  </div>
                  <div className="text-lg font-black font-mono text-emerald-800">
                    ₹{withGstGrandTotal.toFixed(2)}
                  </div>
                  {taxMode === "with_tax" && (
                    <span className="inline-block mt-0.5 text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded">
                      ✓ चयनित (Selected)
                    </span>
                  )}
                </div>
              </button>

              {/* Card 2: Without GST */}
              <button
                type="button"
                data-testid="print-card-without-tax"
                onClick={() => setTaxMode("without_tax")}
                className={`relative p-3 rounded-xl border-2 text-left transition-all flex items-start justify-between gap-3 ${
                  taxMode === "without_tax"
                    ? "border-amber-600 bg-amber-50/90 shadow-sm ring-2 ring-amber-500/20"
                    : "border-slate-200 bg-white hover:border-amber-300 hover:bg-slate-50/50"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-base">📄</span>
                    <span className="font-bold text-sm text-slate-900">
                      Without GST (Bill / Cash Memo)
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    सरल खुदरा बिल • बिना GST/HSN, केवल शुद्ध दर व राशि
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-[10px] uppercase font-bold text-slate-500">
                    Grand Total
                  </div>
                  <div className="text-lg font-black font-mono text-amber-800">
                    ₹{withoutGstGrandTotal.toFixed(2)}
                  </div>
                  {taxMode === "without_tax" && (
                    <span className="inline-block mt-0.5 text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.2 rounded">
                      ✓ चयनित (Selected)
                    </span>
                  )}
                </div>
              </button>
            </div>

            {/* Notice under selector in WITHOUT_GST mode */}
            {taxMode === "without_tax" && (
              <div
                data-testid="without-tax-difference-note"
                className="text-[11.5px] font-semibold text-amber-900 bg-amber-100/90 border border-amber-300 rounded-lg px-3 py-1.5 flex items-center gap-2"
              >
                <AlertCircle size={15} className="text-amber-700 flex-shrink-0" />
                <span>
                  Amount differs from the saved invoice total. (यह राशि डेटाबेस में दर्ज मूल इनवॉइस राशि से भिन्न है।)
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Feedback Banner if print failed or succeeded */}
        {printFeedback && (
          <div
            className={`no-print px-4 py-2 text-xs font-semibold flex items-center justify-between gap-2 border-b ${
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
                onClick={() => handleFallbackPdf()}
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
          className="p-3 sm:p-5 overflow-y-auto flex-1 bg-slate-100/50 flex justify-center text-slate-900"
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
                taxMode={taxMode}
                onTaxModeChange={setTaxMode}
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
