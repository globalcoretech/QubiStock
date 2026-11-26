import React, { useState, useEffect } from "react";
import { X, Check, AlertCircle, RefreshCw, FolderOpen } from "./icons";
import {
  cleanPhoneNumber,
  generateWhatsAppBillMessage,
  exportInvoicePdf,
  openFileInExplorer,
  openWhatsAppChat,
  ExportPdfResult,
} from "../utils/whatsappService";

export interface WhatsAppShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoiceNo: string;
  customerName?: string;
  customerPhone?: string;
  date: string;
  totalAmount: number;
  htmlContent: string;
  shopName?: string;
  lang?: "hi" | "en";
}

export const WhatsAppShareModal: React.FC<WhatsAppShareModalProps> = ({
  isOpen,
  onClose,
  invoiceNo,
  customerName = "किसान भाई",
  customerPhone = "",
  date,
  totalAmount,
  htmlContent,
  shopName = "कृषि केंद्र",
  lang = "hi",
}) => {
  const [phone, setPhone] = useState(customerPhone || "");
  const [message, setMessage] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [pdfResult, setPdfResult] = useState<ExportPdfResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize phone and prefilled message
  useEffect(() => {
    if (isOpen) {
      setPhone(customerPhone || "");
      const initialMsg = generateWhatsAppBillMessage({
        customerName,
        shopName,
        invoiceNo,
        date,
        totalAmount,
        lang,
      });
      setMessage(initialMsg);
      setError(null);

      // Auto-export PDF on open
      let isMounted = true;
      setIsExporting(true);
      exportInvoicePdf({
        html: htmlContent,
        invoiceNo,
        customerName,
      })
        .then((res) => {
          if (isMounted) {
            setPdfResult(res);
            setIsExporting(false);
          }
        })
        .catch((err) => {
          if (isMounted) {
            console.error("PDF export error:", err);
            setError(typeof err === "string" ? err : err?.message || "PDF बनाने में त्रुटि हुई");
            setIsExporting(false);
          }
        });

      return () => {
        isMounted = false;
      };
    }
  }, [isOpen, invoiceNo, customerName, customerPhone, date, totalAmount, htmlContent, shopName, lang]);

  if (!isOpen) return null;

  const handleOpenFolder = async () => {
    if (pdfResult?.pdf_path) {
      await openFileInExplorer(pdfResult.pdf_path);
    }
  };

  const handleSendWhatsApp = async () => {
    const cleaned = cleanPhoneNumber(phone);
    if (!cleaned || cleaned.length < 10) {
      setError(
        lang === "hi"
          ? "कृपया ग्राहक का वैध 10-अंकों का WhatsApp नंबर दर्ज करें।"
          : "Please enter a valid 10-digit WhatsApp mobile number."
      );
      return;
    }

    setError(null);
    try {
      // 1. Open WhatsApp Chat with prefilled message
      await openWhatsAppChat(cleaned, message);

      // 2. Open folder and highlight the PDF for effortless drag & attach
      if (pdfResult?.pdf_path) {
        await openFileInExplorer(pdfResult.pdf_path);
      }

      // Close modal after dispatch
      onClose();
    } catch (err: any) {
      setError(typeof err === "string" ? err : err?.message || "WhatsApp खोलने में त्रुटि हुई");
    }
  };

  return (
    <div
      data-testid="whatsapp-share-modal"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 select-none animate-in fade-in duration-200"
    >
      <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 text-slate-900">
        {/* Header with WhatsApp Emerald Branding */}
        <div className="bg-gradient-to-r from-emerald-700 via-emerald-600 to-teal-700 text-white p-5 relative">
          <button
            type="button"
            data-testid="whatsapp-modal-close-btn"
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/90 hover:text-white transition-colors cursor-pointer"
            title="बंद करें (Close)"
          >
            <X size={16} />
          </button>

          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center flex-shrink-0 text-white shadow-inner">
              {/* WhatsApp Icon */}
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2ZM12.05 3.67C14.25 3.67 16.31 4.53 17.87 6.09C19.42 7.65 20.28 9.72 20.28 11.92C20.28 16.46 16.58 20.15 12.04 20.15C10.56 20.15 9.11 19.76 7.85 19L7.55 18.83L4.43 19.65L5.26 16.61L5.06 16.29C4.24 14.99 3.81 13.47 3.81 11.91C3.81 7.37 7.5 3.67 12.05 3.67ZM8.53 7.33C8.37 7.33 8.1 7.39 7.87 7.64C7.65 7.89 7 8.5 7 9.73C7 10.97 7.9 12.16 8.03 12.33C8.15 12.49 9.8 15.06 12.33 16.15C14.44 17.06 14.86 16.88 15.32 16.84C15.78 16.8 16.81 16.23 17.02 15.63C17.23 15.03 17.23 14.52 17.17 14.41C17.11 14.31 16.95 14.25 16.71 14.13C16.47 14.01 15.28 13.42 15.05 13.34C14.83 13.26 14.67 13.22 14.51 13.46C14.34 13.71 13.87 14.26 13.73 14.42C13.59 14.59 13.44 14.61 13.2 14.49C12.96 14.37 11.98 14.05 10.82 13.01C9.91 12.21 9.3 11.22 9.14 10.94C8.98 10.66 9.12 10.51 9.24 10.39C9.35 10.28 9.49 10.1 9.61 9.96C9.73 9.82 9.77 9.72 9.85 9.56C9.93 9.39 9.89 9.25 9.83 9.13C9.77 9.01 9.29 7.84 9.09 7.36C8.9 6.89 8.7 6.95 8.53 7.33Z" />
              </svg>
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/20 text-emerald-100 border border-white/20">
                WhatsApp Bill Share
              </span>
              <h2 className="text-base font-bold mt-0.5">
                {lang === "hi"
                  ? "ग्राहक को WhatsApp पर बिल PDF भेजें"
                  : "Send Bill PDF to Customer via WhatsApp"}
              </h2>
            </div>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Customer & Phone Input */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {lang === "hi" ? "ग्राहक का नाम:" : "Customer Name:"}
              </label>
              <div className="text-sm font-semibold text-slate-900 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200">
                {customerName}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {lang === "hi" ? "WhatsApp मोबाइल नंबर:" : "WhatsApp Mobile Number:"}
              </label>
              <div className="flex items-center gap-2">
                <span className="px-3 py-2 bg-slate-100 border border-slate-300 rounded-xl text-xs font-bold text-slate-600 select-none">
                  +91 (भारत)
                </span>
                <input
                  type="text"
                  data-testid="whatsapp-phone-input"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="9876543210 (10 अंक)"
                  className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent font-mono"
                  maxLength={13}
                />
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                {lang === "hi"
                  ? "यदि नंबर गलत या अधूरा हो तो यहाँ 10 अंकों का नंबर ठीक करें।"
                  : "Enter or correct 10-digit mobile number if needed."}
              </p>
            </div>
          </div>

          {/* PDF Status Card */}
          <div className="bg-emerald-50/80 border border-emerald-300 rounded-2xl p-3 text-xs">
            {isExporting ? (
              <div className="flex items-center gap-2 text-emerald-800 font-semibold py-1">
                <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
                <span>
                  {lang === "hi"
                    ? "बिल का PDF तैयार किया जा रहा है..."
                    : "Generating invoice PDF..."}
                </span>
              </div>
            ) : pdfResult?.success ? (
              <div className="space-y-1 text-emerald-950">
                <div className="flex items-center justify-between font-bold text-emerald-900">
                  <span className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span>
                      {lang === "hi" ? "बिल PDF तैयार है:" : "Bill PDF Ready:"}
                    </span>
                  </span>
                  <button
                    type="button"
                    data-testid="open-pdf-folder-btn"
                    onClick={handleOpenFolder}
                    className="text-[11px] text-emerald-700 hover:text-emerald-900 font-bold underline flex items-center gap-1 cursor-pointer"
                  >
                    <FolderOpen size={13} />
                    <span>{lang === "hi" ? "फ़ोल्डर देखें" : "View Folder"}</span>
                  </button>
                </div>
                <div className="font-mono text-[11px] text-emerald-800 truncate">
                  📄 {pdfResult.filename}
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  📁 {pdfResult.directory}
                </div>
              </div>
            ) : (
              <div className="text-amber-800 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <span>
                  {lang === "hi"
                    ? "PDF बैकग्राउंड में तैयार हो जाएगा।"
                    : "PDF will be generated in background."}
                </span>
              </div>
            )}
          </div>

          {/* Editable Message Preview */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center justify-between">
              <span>{lang === "hi" ? "भेजा जाने वाला संदेश (Message):" : "Message Preview:"}</span>
              <span className="text-[10px] text-slate-400 font-normal">
                {lang === "hi" ? "(ज़रूरत हो तो बदलाव कर सकते हैं)" : "(Editable)"}
              </span>
            </label>
            <textarea
              data-testid="whatsapp-message-input"
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-800 font-sans focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white resize-none"
            />
          </div>

          {/* Error Banner */}
          {error && (
            <div className="p-2.5 bg-rose-50 border border-rose-300 rounded-xl text-xs text-rose-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2">
          <button
            type="button"
            data-testid="whatsapp-folder-action-btn"
            onClick={handleOpenFolder}
            className="px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <FolderOpen size={14} />
            <span>{lang === "hi" ? "फ़ोल्डर खोलें" : "Open Folder"}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="whatsapp-cancel-btn"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl text-slate-600 hover:text-slate-800 font-bold text-xs transition-colors cursor-pointer"
            >
              {lang === "hi" ? "रद्द करें" : "Cancel"}
            </button>
            <button
              type="button"
              data-testid="whatsapp-send-btn"
              onClick={handleSendWhatsApp}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-emerald-950/20 transition-all hover:scale-102 active:scale-98 cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
              <span>{lang === "hi" ? "WhatsApp खोलें और भेजें" : "Open WhatsApp & Send"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
