import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { X, Edit, AlertCircle } from "./icons";
import { Language } from "../i18n";

interface EditInvoiceNoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  billType: "sale" | "purchase";
  currentInvoiceNo: string;
  internalInvoiceNo?: string;
  supplierInvoiceDate?: string;
  lang?: Language;
}

export function EditInvoiceNoModal({
  isOpen,
  onClose,
  onSuccess,
  billType,
  currentInvoiceNo,
  internalInvoiceNo,
  supplierInvoiceDate,
  lang = "hi",
}: EditInvoiceNoModalProps) {
  const [newInvoiceNo, setNewInvoiceNo] = useState("");
  const [newSuppDate, setNewSuppDate] = useState("");
  const [reason, setReason] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [warningMsg, setWarningMsg] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setNewInvoiceNo(currentInvoiceNo || "");
      setNewSuppDate(supplierInvoiceDate || new Date().toISOString().split("T")[0]);
      setReason("");
      setErrorMsg("");
      setWarningMsg("");
      setIsSaving(false);
    }
  }, [isOpen, currentInvoiceNo, supplierInvoiceDate]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  const handleInvoiceNoChange = (val: string) => {
    if (billType === "sale") {
      const upper = val.toUpperCase();
      setNewInvoiceNo(upper);
      const trimmed = upper.trim();
      if (trimmed.length > 16) {
        setErrorMsg("बिल नंबर 16 अक्षरों से अधिक नहीं हो सकता / Max 16 characters");
      } else if (!/^[A-Z0-9\/\-]*$/.test(trimmed)) {
        setErrorMsg("केवल A-Z, 0-9, '/', '-' मान्य हैं / Only A-Z, 0-9, '/', '-' allowed");
      } else {
        setErrorMsg("");
      }

      if (trimmed && !/^[A-Z0-9]+\/\d{2}-\d{2}\/\d{4,}$/.test(trimmed)) {
        setWarningMsg("मानक प्रारूप से अलग है (जैसे KK/26-27/0001) / Non-standard series format");
      } else {
        setWarningMsg("");
      }
    } else {
      setNewInvoiceNo(val);
      if (val.trim().length > 30) {
        setErrorMsg("सप्लायर बिल नंबर 30 अक्षरों से अधिक नहीं हो सकता / Max 30 characters");
      } else {
        setErrorMsg("");
      }
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanNo = newInvoiceNo.trim();
    const cleanReason = reason.trim();

    if (!cleanNo) {
      setErrorMsg(
        billType === "sale"
          ? "नया बिल नंबर आवश्यक है / Invoice number required"
          : "सप्लायर का बिल नंबर आवश्यक है / Supplier invoice number required"
      );
      return;
    }

    if (!cleanReason) {
      setErrorMsg("परिवर्तन का कारण लिखना आवश्यक है / Reason is required");
      return;
    }

    setIsSaving(true);
    setErrorMsg("");

    try {
      if (billType === "sale") {
        await invoke("change_sales_invoice_no_cmd", {
          oldNo: currentInvoiceNo,
          newNo: cleanNo,
          reason: cleanReason,
        });
      } else {
        const targetInternalNo = internalInvoiceNo || currentInvoiceNo;
        await invoke("update_purchase_supplier_invoice_cmd", {
          internalInvoiceNo: targetInternalNo,
          supplierInvoiceNo: cleanNo,
          supplierInvoiceDate: newSuppDate || null,
          reason: cleanReason,
        });
      }
      setIsSaving(false);
      onSuccess();
      onClose();
    } catch (err: any) {
      setIsSaving(false);
      const raw = typeof err === "string" ? err : err?.message || String(err || "");
      setErrorMsg(raw);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-surface border border-border rounded-panel shadow-xl w-full max-w-md overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-3.5 bg-paper border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-forest/10 text-forest flex items-center justify-center">
              <Edit size={18} />
            </div>
            <div>
              <h3 className="font-serif text-base font-bold text-ink">
                {billType === "sale"
                  ? lang === "hi" ? "बिक्री बिल नंबर बदलें" : "Change Sales Invoice No."
                  : lang === "hi" ? "सप्लायर बिल नंबर संपादित करें" : "Edit Supplier Invoice No."}
              </h3>
              <p className="text-xs text-muted font-mono">{currentInvoiceNo}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-muted hover:text-ink hover:bg-border/40 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-5 space-y-4">
          {errorMsg && (
            <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs font-semibold flex items-center gap-2">
              <AlertCircle size={16} className="flex-shrink-0 text-red-500" />
              <span>{errorMsg}</span>
            </div>
          )}

          {warningMsg && (
            <div className="p-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-xs font-medium flex items-center gap-2">
              <AlertCircle size={15} className="flex-shrink-0 text-amber-500" />
              <span>{warningMsg}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-ink mb-1">
              {billType === "sale"
                ? "नया बिल नंबर (New Invoice No.) *"
                : "सप्लायर का बिल नंबर (Supplier Invoice No.) *"}
            </label>
            <input
              type="text"
              required
              maxLength={billType === "sale" ? 16 : 30}
              value={newInvoiceNo}
              onChange={(e) => handleInvoiceNoChange(e.target.value)}
              placeholder={billType === "sale" ? "KK/26-27/0001" : "SUPP-INV-1234"}
              className="w-full px-3 py-1.5 text-sm font-mono font-bold bg-paper border border-border rounded-lg focus:outline-none focus:border-forest"
            />
            <span className="text-[11px] text-muted">
              {billType === "sale"
                ? "अधिकतम 16 अक्षर (A-Z, 0-9, /, -)"
                : "सप्लायर द्वारा दिया गया बिल नंबर (अधिकतम 30 अक्षर)"}
            </span>
          </div>

          {billType === "purchase" && (
            <div>
              <label className="block text-xs font-bold text-ink mb-1">
                सप्लायर बिल तारीख (Supplier Invoice Date)
              </label>
              <input
                type="date"
                value={newSuppDate}
                onChange={(e) => setNewSuppDate(e.target.value)}
                className="w-full px-3 py-1.5 text-sm font-mono font-bold bg-paper border border-border rounded-lg focus:outline-none focus:border-forest"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-ink mb-1">
              बदलने का कारण (Reason for Change) *
            </label>
            <textarea
              required
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                lang === "hi"
                  ? "जैसे: गलत बिल नंबर टाइप हो गया था, ग्राहक की मांग..."
                  : "e.g. Typo correction in invoice number..."
              }
              className="w-full px-3 py-1.5 text-xs bg-paper border border-border rounded-lg focus:outline-none focus:border-forest resize-none"
            />
            <span className="text-[10px] text-muted block mt-0.5">
              यह ऑडिट लॉग (Audit Log) में दर्ज रहेगा।
            </span>
          </div>

          {/* Footer Buttons */}
          <div className="pt-3 border-t border-border flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-1.5 text-xs font-bold text-muted hover:text-ink border border-border rounded-lg bg-surface hover:bg-paper transition-colors"
            >
              रद्द करें (Cancel)
            </button>
            <button
              type="submit"
              disabled={isSaving || !newInvoiceNo.trim() || !reason.trim()}
              className="px-4 py-1.5 text-xs font-bold text-white bg-forest hover:bg-forest/90 disabled:opacity-50 rounded-lg shadow-xs transition-colors flex items-center gap-1.5"
            >
              {isSaving ? "सहेज रहे हैं..." : "सुरक्षित करें (Save)"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
