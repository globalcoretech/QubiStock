import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { X, Plus, AlertCircle } from "./icons";
import { Translations, Language } from "../i18n";
import { GstStatus } from "../types";

interface AddItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newItemId: number) => void;
  t: Translations;
  lang: Language;
}

export function AddItemModal({
  isOpen,
  onClose,
  onSuccess,
  t,
  lang,
}: AddItemModalProps) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("kg");
  const [hsn, setHsn] = useState("");
  const [gstStatus, setGstStatus] = useState<GstStatus>("taxable");
  const [gstRate, setGstRate] = useState("5");
  const [altUnit, setAltUnit] = useState("");
  const [factor, setFactor] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName("");
      setUnit("kg");
      setHsn("");
      setGstStatus("taxable");
      setGstRate("5");
      setAltUnit("");
      setFactor("");
      setErrorMsg("");
      setIsSaving(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (!name.trim()) {
      setErrorMsg(lang === "hi" ? "कृपया सामान का नाम लिखें!" : "Please enter item name!");
      return;
    }

    if (hsn.trim() && !/^\d+$/.test(hsn.trim())) {
      setErrorMsg(lang === "hi" ? "HSN कोड में केवल अंक होने चाहिए!" : "HSN code must contain digits only!");
      return;
    }

    let g: number | null = null;
    if (gstStatus === "taxable") {
      const parsed = parseFloat(gstRate);
      if (isNaN(parsed) || parsed < 0 || parsed > 28) {
        setErrorMsg(lang === "hi" ? "GST दर 0% से 28% के बीच होनी चाहिए!" : "GST rate must be between 0% and 28%!");
        return;
      }
      g = Math.round(parsed * 1000);
    } else if (gstStatus === "nil_rated" || gstStatus === "exempt") {
      g = 0;
    } else {
      g = null;
    }

    setIsSaving(true);
    try {
      const id = await invoke<number>("add_item_cmd", {
        name: name.trim(),
        category: null,
        hsn: hsn.trim() || null,
        gstRate: g,
        baseUnit: unit,
        gstStatus: gstStatus,
      });

      if (altUnit.trim() && factor) {
        await invoke("add_item_unit_cmd", {
          itemId: id,
          unitName: altUnit.trim(),
          factorToBase: Math.round(parseFloat(factor) * 1000),
        });
      }

      setIsSaving(false);
      onSuccess(id);
      onClose();
    } catch (err: any) {
      console.error("add_item_cmd error:", err);
      setIsSaving(false);
      setErrorMsg(String(err));
    }
  };

  return createPortal(
    <div
      data-testid="add-item-modal"
      data-scroll="true"
      className="fixed inset-0 z-[9999] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto no-print"
    >
      <div
        className="bg-white rounded-xl p-4 sm:p-5 w-full max-w-lg shadow-xl border border-slate-200 max-h-[94vh] overflow-y-auto"
        data-scroll="true"
      >
        <div className="flex justify-between items-center pb-3 border-b border-slate-100 mb-4">
          <div className="flex items-center gap-2">
            <Plus size={18} className="text-emerald-600" />
            <h3 className="text-base font-bold text-slate-900">
              {lang === "hi" ? "नया सामान जोड़ें (New Item) [F2]" : "Add New Item [F2]"}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-medium flex items-center gap-2">
            <AlertCircle size={16} className="text-red-600 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block mb-1 text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
              {lang === "hi" ? "सामान का नाम" : "Item Name"} *
            </label>
            <input
              required
              autoFocus
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
              placeholder={lang === "hi" ? "उदा. यूरिया, डीएपी, जिंक सल्फेट..." : "e.g. Urea, DAP, Zinc..."}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block mb-1 text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                {lang === "hi" ? "मुख्य इकाई (Base Unit)" : "Base Unit"} *
              </label>
              <select
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              >
                <option value="kg">kg (किलोग्राम)</option>
                <option value="litre">litre (लीटर)</option>
                <option value="bag">bag (बोरी)</option>
                <option value="packet">packet (पैकेट)</option>
                <option value="bottle">bottle (बोतल)</option>
                <option value="piece">piece (नग / पीस)</option>
                <option value="quintal">quintal (क्विंटल)</option>
                <option value="gram">gram (ग्राम)</option>
                <option value="ml">ml (मिलीलीटर)</option>
              </select>
            </div>

            <div>
              <label className="block mb-1 text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                {lang === "hi" ? "HSN कोड (वैकल्पिक)" : "HSN Code (Optional)"}
              </label>
              <input
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 font-mono"
                placeholder="उदा. 3102"
                value={hsn}
                onChange={(e) => setHsn(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block mb-1 text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                {lang === "hi" ? "टैक्स प्रकार (GST Status)" : "GST Status"}
              </label>
              <select
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                value={gstStatus}
                onChange={(e) => setGstStatus(e.target.value as GstStatus)}
              >
                <option value="taxable">{lang === "hi" ? "टैक्सेबल (Taxable)" : "Taxable"}</option>
                <option value="exempt">{lang === "hi" ? "छूट प्राप्त (Exempt)" : "Exempt"}</option>
                <option value="nil_rated">{lang === "hi" ? "शून्य दर (Nil Rated)" : "Nil Rated"}</option>
              </select>
            </div>

            {gstStatus === "taxable" && (
              <div>
                <label className="block mb-1 text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                  {lang === "hi" ? "GST दर (%)" : "GST Rate (%)"} *
                </label>
                <select
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 font-mono"
                  value={gstRate}
                  onChange={(e) => setGstRate(e.target.value)}
                >
                  <option value="0">0%</option>
                  <option value="5">5% (उर्वरक/खाद)</option>
                  <option value="12">12% (सूक्ष्म पोषक तत्व/दवा)</option>
                  <option value="18">18% (कीटनाशक/उपकरण)</option>
                  <option value="28">28%</option>
                </select>
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-slate-100">
            <span className="block mb-1.5 text-[11px] font-bold text-slate-600">
              {lang === "hi" ? "वैकल्पिक दूसरी इकाई (Alt Unit - यदि हो)" : "Secondary Unit (Optional)"}
            </span>
            <div className="grid grid-cols-2 gap-3">
              <input
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:border-emerald-600"
                placeholder={lang === "hi" ? "इकाई नाम (उदा. bag)" : "Unit name (e.g. bag)"}
                value={altUnit}
                onChange={(e) => setAltUnit(e.target.value)}
              />
              <input
                type="number"
                step="any"
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:border-emerald-600 font-mono"
                placeholder={lang === "hi" ? "1 इकाई = कितने base unit (उदा. 45)" : "Factor (e.g. 45)"}
                value={factor}
                onChange={(e) => setFactor(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-2xs"
            >
              {isSaving ? (
                <span>{t.common.loading}</span>
              ) : (
                <>
                  <Plus size={14} />
                  <span>{lang === "hi" ? "सामान सुरक्षित करें" : "Save Item"}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

