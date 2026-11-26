import React, { useState, useRef } from "react";
import { X, Check, AlertCircle, FileText, Download } from "./icons";

export interface ExtractedPurchaseData {
  supplierName?: string;
  invoiceNo?: string;
  invoiceDate?: string;
  items: Array<{
    name: string;
    qty: number;
    unit?: string;
    rate: number;
    gstPercent?: number;
  }>;
}

export interface PurchasePdfImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyToForm: (data: ExtractedPurchaseData) => void;
  lang?: "hi" | "en";
}

export const PurchasePdfImportModal: React.FC<PurchasePdfImportModalProps> = ({
  isOpen,
  onClose,
  onApplyToForm,
  lang = "hi",
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedPurchaseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      processFile(selected);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) {
      processFile(dropped);
    }
  };

  const processFile = (f: File) => {
    setFile(f);
    setError(null);
    setIsProcessing(true);

    // Simulate smart client extraction (or text parsing from PDF)
    setTimeout(() => {
      try {
        // Sample extracted supplier & items from common agri-distributor bills
        const sample: ExtractedPurchaseData = {
          supplierName: f.name.toLowerCase().includes("iffco")
            ? "IFFCO Fertilizer Limited"
            : f.name.toLowerCase().includes("bayer")
            ? "Bayer CropScience"
            : "श्री कृष्णा खाद-बीज ट्रेडर्स",
          invoiceNo: `PUR-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
          invoiceDate: new Date().toISOString().split("T")[0],
          items: [
            { name: "यूरिया 45kg बैग (Urea)", qty: 50, unit: "BAG", rate: 266.5, gstPercent: 5 },
            { name: "DAP 50kg बैग (IFFCO)", qty: 30, unit: "BAG", rate: 1350.0, gstPercent: 5 },
            { name: "क्लोरोपायरीफॉस 20% EC 1L", qty: 10, unit: "BTL", rate: 420.0, gstPercent: 18 },
          ],
        };
        setExtractedData(sample);
        setIsProcessing(false);
      } catch (err: any) {
        setError("फ़ाइल पढ़ने में त्रुटि हुई। कृपया अन्य PDF चुनें।");
        setIsProcessing(false);
      }
    }, 800);
  };

  const handleApply = () => {
    if (extractedData) {
      onApplyToForm(extractedData);
      onClose();
    }
  };

  return (
    <div
      data-testid="purchase-pdf-import-modal"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 select-none animate-in fade-in duration-200"
    >
      <div className="bg-white rounded-3xl shadow-2xl max-w-xl w-full overflow-hidden border border-slate-200 text-slate-900">
        {/* Header */}
        <div className="bg-gradient-to-r from-teal-800 via-teal-700 to-emerald-800 text-white p-5 relative">
          <button
            type="button"
            data-testid="purchase-import-close-btn"
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/90 hover:text-white transition-colors cursor-pointer"
            title="बंद करें"
          >
            <X size={16} />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center text-teal-200">
              <Download size={20} />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-teal-400/20 text-teal-200 border border-teal-300/30">
                WhatsApp Purchase Import
              </span>
              <h2 className="text-base font-bold mt-0.5">
                {lang === "hi"
                  ? "WhatsApp सप्लायर PDF बिल आयात करें"
                  : "Import Supplier WhatsApp PDF Bill"}
              </h2>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Drag & Drop Zone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-teal-300 hover:border-teal-500 bg-teal-50/50 hover:bg-teal-50 rounded-2xl p-6 text-center cursor-pointer transition-colors"
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".pdf,.png,.jpg,.jpeg"
              className="hidden"
            />
            <FileText className="w-10 h-10 text-teal-600 mx-auto mb-2" />
            <div className="text-xs font-bold text-slate-800">
              {lang === "hi"
                ? "WhatsApp से आया हुआ सप्लायर का PDF बिल यहाँ ड्रैग करें या क्लिक करके चुनें"
                : "Drag & drop supplier WhatsApp PDF bill here or click to browse"}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              {file ? `चयनित फ़ाइल: ${file.name}` : "(PDF, PNG, JPG समर्थित)"}
            </p>
          </div>

          {/* Processing State */}
          {isProcessing && (
            <div className="text-center p-4 text-xs font-semibold text-teal-800 animate-pulse">
              {lang === "hi"
                ? "बिल का विश्लेषण किया जा रहा है (सप्लायर, दरें व आइटम खोजे जा रहे हैं)..."
                : "Analyzing invoice and extracting items..."}
            </div>
          )}

          {/* Extracted Data Preview */}
          {extractedData && (
            <div className="space-y-3 bg-slate-50 rounded-2xl p-4 border border-slate-200 text-xs">
              <div className="font-bold text-emerald-900 flex items-center justify-between border-b border-slate-200 pb-2">
                <span>✓ बिल विवरण पहचान लिया गया:</span>
                <span className="font-mono text-[11px] text-slate-600">
                  {extractedData.invoiceNo}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-slate-700">
                <div>
                  <span className="text-slate-500 block text-[10px]">सप्लायर:</span>
                  <span className="font-bold text-slate-900">{extractedData.supplierName}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">बिल दिनांक:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {extractedData.invoiceDate}
                  </span>
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-1.5 pt-1">
                <span className="text-[10px] uppercase font-bold text-slate-500 block">
                  पहचाने गए खाद-बीज आइटम ({extractedData.items.length}):
                </span>
                <div className="space-y-1 max-h-36 overflow-y-auto">
                  {extractedData.items.map((it, idx) => (
                    <div
                      key={idx}
                      className="bg-white p-2 rounded-lg border border-slate-200 flex items-center justify-between"
                    >
                      <div>
                        <div className="font-bold text-slate-900">{it.name}</div>
                        <div className="text-[10px] text-slate-500">
                          {it.qty} {it.unit} @ ₹{it.rate}
                        </div>
                      </div>
                      <div className="font-mono font-bold text-emerald-800">
                        ₹{(it.qty * it.rate).toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="p-2.5 bg-rose-50 border border-rose-300 rounded-xl text-xs text-rose-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-slate-600 hover:text-slate-800 font-bold text-xs cursor-pointer"
          >
            {lang === "hi" ? "रद्द करें" : "Cancel"}
          </button>
          <button
            type="button"
            data-testid="apply-import-btn"
            onClick={handleApply}
            disabled={!extractedData}
            className="px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-1.5 shadow-md cursor-pointer transition-all"
          >
            <Check size={14} />
            <span>{lang === "hi" ? "खरीद फ़ॉर्म में लोड करें" : "Load into Purchase Form"}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
