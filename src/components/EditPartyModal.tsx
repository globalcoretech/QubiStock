import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { Party } from "../types";
import { X, Edit, AlertCircle } from "./icons";
import { Translations, Language } from "../i18n";

interface EditPartyModalProps {
  party: Party | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  t: Translations;
  lang: Language;
}

export function EditPartyModal({
  party,
  isOpen,
  onClose,
  onSuccess,
  t,
  lang,
}: EditPartyModalProps) {
  const [name, setName] = useState("");
  const [partyType, setPartyType] = useState<"customer" | "supplier" | "both">("customer");
  const [category, setCategory] = useState("unregistered");
  const [gstin, setGstin] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [village, setVillage] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const isCashSale = party?.id === 1;

  useEffect(() => {
    if (party && isOpen) {
      setName(party.name || "");
      setPartyType((party.party_type as any) || "customer");
      setCategory(party.category || "unregistered");
      setGstin(party.gstin || "");
      setStateCode(party.state_code || (party.gstin && party.gstin.length >= 2 ? party.gstin.slice(0, 2) : ""));
      setVillage(party.village || "");
      setAddress(party.address || "");
      setPhone(party.phone || "");
      setReason("");
      setErrorMsg("");
      setIsSaving(false);
    }
  }, [party, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen || !party) return null;

  const handleGstinChange = (val: string) => {
    const clean = val.toUpperCase().trim();
    setGstin(clean);
    if (clean.length >= 2 && /^\d{2}/.test(clean)) {
      setStateCode(clean.slice(0, 2));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (!name.trim()) {
      setErrorMsg(lang === "hi" ? "कृपया पार्टी का नाम दर्ज करें!" : "Please enter party name!");
      return;
    }

    if (category === "regular") {
      const cleanGstin = gstin.trim().toUpperCase();
      if (!cleanGstin || cleanGstin.length !== 15) {
        setErrorMsg(
          lang === "hi"
            ? "रेगुलर जीएसटी पार्टी के लिए 15 अक्षरों का सही GSTIN अनिवार्य है!"
            : "Valid 15-character GSTIN is required for regular GST party!"
        );
        return;
      }
    }

    setIsSaving(true);
    try {
      await invoke("update_party_cmd", {
        id: party.id,
        name: name.trim(),
        partyType: isCashSale ? "customer" : partyType,
        category,
        village: village.trim() || null,
        address: address.trim() || null,
        gstin: gstin.trim().toUpperCase() || null,
        phone: phone.trim() || null,
        stateCode: stateCode.trim() || null,
        reason: reason.trim() || null,
      });

      setIsSaving(false);
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error("update_party_cmd error:", err);
      setIsSaving(false);
      setErrorMsg(String(err));
    }
  };

  return createPortal(
    <div
      data-testid="edit-party-modal"
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
              {lang === "hi" ? "पार्टी विवरण संपादित करें (Edit Party)" : "Edit Party Details"}
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

        {isCashSale && (
          <div className="p-2.5 mb-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
            {lang === "hi"
              ? "डिफ़ॉल्ट 'Cash Sale' पार्टी का नाम या प्रकार नहीं बदला जा सकता।"
              : "Default 'Cash Sale' party name and type cannot be changed."}
          </div>
        )}

        {errorMsg && (
          <div className="p-3 mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-medium flex items-center gap-2">
            <AlertCircle size={16} className="text-red-600 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block mb-1 text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
              {t.common.party} *
            </label>
            <input
              required
              disabled={isCashSale}
              className={`w-full px-3 py-2 border rounded-lg text-xs outline-none ${
                isCashSale
                  ? "bg-slate-100 text-slate-500 border-slate-200 cursor-not-allowed"
                  : "bg-white border-slate-300 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
              }`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block mb-1 text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                {t.dashboard.entryType}
              </label>
              <select
                disabled={isCashSale}
                className={`w-full px-2.5 py-2 border rounded-lg text-xs outline-none ${
                  isCashSale
                    ? "bg-slate-100 text-slate-500 border-slate-200 cursor-not-allowed"
                    : "bg-white border-slate-300 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                }`}
                value={partyType}
                onChange={(e) => setPartyType(e.target.value as any)}
              >
                <option value="customer">{t.common.customer}</option>
                <option value="supplier">{t.common.supplier}</option>
                <option value="both">{t.parties.both}</option>
              </select>
            </div>

            <div>
              <label className="block mb-1 text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                {t.common.category}
              </label>
              <select
                className="w-full px-2.5 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="unregistered">{t.common.unregistered}</option>
                <option value="regular">{t.common.regular}</option>
                <option value="composition">{t.common.composition}</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block mb-1 text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                {t.common.gstin} {category === "regular" && <span className="text-red-500">*</span>}
              </label>
              <input
                required={category === "regular"}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono uppercase bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                placeholder="23ABCDE1234F1Z5"
                maxLength={15}
                value={gstin}
                onChange={(e) => handleGstinChange(e.target.value)}
              />
            </div>

            <div>
              <label className="block mb-1 text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                {lang === "hi" ? "राज्य कोड (State Code)" : "State Code"}
              </label>
              <input
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                placeholder="23"
                maxLength={2}
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block mb-1 text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                {t.common.village}
              </label>
              <input
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                placeholder="उदा. सीहोर / विदिशा"
                value={village}
                onChange={(e) => setVillage(e.target.value)}
              />
            </div>

            <div>
              <label className="block mb-1 text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                {t.common.phone}
              </label>
              <input
                type="tel"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                placeholder="9876543210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block mb-1 text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
              {lang === "hi" ? "पूरा पता (Address)" : "Full Address"}
            </label>
            <input
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
              placeholder={lang === "hi" ? "मंडी रोड, दुकान नंबर 4" : "Mandi Road, Shop #4"}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>

          <div>
            <label className="block mb-1 text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
              {lang === "hi" ? "बदलाव का कारण (Reason for Alteration - Audit Log)" : "Reason for Alteration (Audit Log)"}
            </label>
            <input
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
              placeholder={lang === "hi" ? "उदा. नया जीएसटी नंबर प्राप्त हुआ" : "e.g. Updated GSTIN / corrected phone"}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
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
