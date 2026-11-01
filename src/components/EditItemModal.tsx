import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { Item, GstStatus } from "../types";
import { X, Edit, AlertCircle } from "./icons";
import { Translations, Language } from "../i18n";

interface EditItemModalProps {
  item: Item | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  t: Translations;
  lang: Language;
}

export function EditItemModal({
  item,
  isOpen,
  onClose,
  onSuccess,
  t,
  lang,
}: EditItemModalProps) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [hsn, setHsn] = useState("");
  const [gstStatus, setGstStatus] = useState<GstStatus>("taxable");
  const [gstRate, setGstRate] = useState("5");
  const [baseUnit, setBaseUnit] = useState("kg");
  const [isActive, setIsActive] = useState(true);
  const [reason, setReason] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (item && isOpen) {
      setName(item.name || "");
      setCategory(item.category || "");
      setHsn(item.hsn || "");
      setGstStatus(item.gst_status || (item.gst_rate !== null && item.gst_rate > 0 ? "taxable" : "not_set"));
      setGstRate(item.gst_rate !== null && item.gst_rate !== undefined ? String(item.gst_rate / 1000) : "5");
      setBaseUnit(item.base_unit || "kg");
      setIsActive(item.is_active !== 0);
      setReason("");
      setErrorMsg("");
      setIsSaving(false);
    }
  }, [item, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen || !item) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (!name.trim()) {
      setErrorMsg(lang === "hi" ? "सामान का नाम अनिवार्य है!" : "Item name is required!");
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
      await invoke("update_item_cmd", {
        id: item.id,
        name: name.trim(),
        category: category.trim() || null,
        hsn: hsn.trim() || null,
        gstRate: g,
        baseUnit: baseUnit.trim(),
        gstStatus: gstStatus,
        isActive: isActive ? 1 : 0,
        reason: reason.trim() || null,
      });

      setIsSaving(false);
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error("update_item_cmd error:", err);
      setIsSaving(false);
      setErrorMsg(String(err));
    }
  };

  return createPortal(
    <div
      data-testid="edit-item-modal"
      data-scroll="true"
      className="fixed inset-0 z-[9999] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto no-print"
    >
      <div
        className="bg-white rounded-xl p-4 sm:p-5 w-full max-w-lg shadow-xl border border-slate-200 max-h-[94vh] overflow-y-auto"
        data-scroll="true"
      >
        <div className="flex justify-between items-center pb-3 border-b border-slate-100 mb-4">
          <div className="flex items-center gap-2">
            <Edit size={18} className="text-emerald-600" />
            <h3 className="text-base font-bold text-slate-900">
              {lang === "hi" ? "सामान विवरण संपादित करें (Edit Item)" : "Edit Item Details"}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block mb-1 text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                {lang === "hi" ? "सामान का नाम" : "Item Name"} *
              </label>
              <input
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div>
              <label className="block mb-1 text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                {lang === "hi" ? "श्रेणी (Category)" : "Category"}
              </label>
              <input
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                placeholder={lang === "hi" ? "उदा. उर्वरक / कीटनाशक / बीज" : "e.g. Fertilizer / Pesticide / Seed"}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block mb-1 text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                {t.items.hsnCode}
              </label>
              <input
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                placeholder="3102"
                value={hsn}
                onChange={(e) => setHsn(e.target.value)}
              />
            </div>

            <div>
              <label className="block mb-1 text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                {lang === "hi" ? "GST प्रकार" : "GST Status"}
              </label>
              <select
                value={gstStatus}
                onChange={(e) => setGstStatus(e.target.value as GstStatus)}
                className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
              >
                <option value="taxable">{lang === "hi" ? "कर योग्य (Taxable)" : "Taxable"}</option>
                <option value="nil_rated">{lang === "hi" ? "शून्य दर (Nil 0%)" : "Nil Rated (0%)"}</option>
                <option value="exempt">{lang === "hi" ? "छूट प्राप्त (Exempt)" : "Exempt (0%)"}</option>
                <option value="not_set">{lang === "hi" ? "अनिर्धारित" : "Not Set"}</option>
              </select>
            </div>

            <div>
              <label className="block mb-1 text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                {t.items.gstRate} (%)
              </label>
              <input
                type="number"
                step="0.01"
                disabled={gstStatus !== "taxable"}
                placeholder={gstStatus === "taxable" ? "5 or 18" : "0"}
                value={gstStatus === "taxable" ? gstRate : "0"}
                onChange={(e) => setGstRate(e.target.value)}
                className={`w-full px-3 py-2 border rounded-lg text-xs font-mono outline-none ${
                  gstStatus === "taxable"
                    ? "bg-white border-slate-300 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                    : "bg-slate-100 text-slate-400 border-slate-200"
                }`}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block mb-1 text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                {t.items.baseUnit}
              </label>
              <select
                value={baseUnit}
                onChange={(e) => setBaseUnit(e.target.value)}
                className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
              >
                <option value="kg">{lang === "hi" ? "किलोग्राम (kg)" : "Kilogram (kg)"}</option>
                <option value="liter">{lang === "hi" ? "लीटर (liter)" : "Liter (liter)"}</option>
                <option value="bag">{lang === "hi" ? "बोरी (bag)" : "Bag (bag)"}</option>
                <option value="bottle">{lang === "hi" ? "बोतल (bottle)" : "Bottle (bottle)"}</option>
                <option value="packet">{lang === "hi" ? "पैकेट (packet)" : "Packet (packet)"}</option>
                <option value="piece">{lang === "hi" ? "नग (piece)" : "Piece (piece)"}</option>
              </select>
              <p className="text-[10px] text-slate-500 mt-0.5">
                {lang === "hi"
                  ? "* लेन-देन होने पर मुख्य इकाई नहीं बदली जा सकती।"
                  : "* Base unit locked if item has transactions."}
              </p>
            </div>

            <div>
              <label className="block mb-1 text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                {lang === "hi" ? "स्थिति (Status)" : "Item Status"}
              </label>
              <div className="flex items-center gap-4 mt-2">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="isActiveRadio"
                    checked={isActive}
                    onChange={() => setIsActive(true)}
                    className="text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-xs font-semibold text-emerald-700">
                    {lang === "hi" ? "सक्रिय (Active)" : "Active"}
                  </span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="isActiveRadio"
                    checked={!isActive}
                    onChange={() => setIsActive(false)}
                    className="text-slate-600 focus:ring-slate-500"
                  />
                  <span className="text-xs font-semibold text-slate-500">
                    {lang === "hi" ? "अक्रिय (Inactive / Disabled)" : "Inactive"}
                  </span>
                </label>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">
                {lang === "hi"
                  ? "अक्रिय सामान नए बिल में नहीं दिखेगा, पुराने बिलों में रहेगा।"
                  : "Inactive items are hidden from new bills but preserved in history."}
              </p>
            </div>
          </div>

          <div>
            <label className="block mb-1 text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
              {lang === "hi" ? "बदलाव का कारण (Reason for Alteration - Audit Log)" : "Reason for Alteration (Audit Log)"}
            </label>
            <input
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
              placeholder={lang === "hi" ? "उदा. नया HSN कोड / जीएसटी दर अपडेट" : "e.g. Updated HSN code / corrected rate"}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <div className="p-2.5 rounded-lg bg-emerald-50/60 border border-emerald-200/60 text-emerald-800 text-[11px] leading-relaxed">
            {lang === "hi"
              ? "जीएसटी दर या HSN कोड में किया गया बदलाव केवल आगे बनने वाले बिलों पर लागू होगा। पूर्व में सहेजे गए बिलों का टैक्स व डेटा सुरक्षित रहेगा।"
              : "Changes to GST rate or HSN apply only to future bills. Already saved bills preserve their snapshotted tax rates."}
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-3.5 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg text-xs font-semibold"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs disabled:opacity-50"
            >
              {isSaving ? (lang === "hi" ? "सहेज रहे हैं..." : "Saving...") : (lang === "hi" ? "संशोधन सहेजें" : "Save Changes")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
