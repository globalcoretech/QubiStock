import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Plus, AlertCircle } from "./icons";
import { Translations } from "../i18n";

interface AddPartyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newPartyId: number) => void;
  defaultType?: "customer" | "supplier" | "both";
  t: Translations;
}

export function AddPartyModal({
  isOpen,
  onClose,
  onSuccess,
  defaultType = "customer",
  t,
}: AddPartyModalProps) {
  const [name, setName] = useState("");
  const [partyType, setPartyType] = useState(defaultType);
  const [category, setCategory] = useState("unregistered");
  const [gstin, setGstin] = useState("");
  const [village, setVillage] = useState("");
  const [phone, setPhone] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (isOpen) {
      setName("");
      setPartyType(defaultType);
      setCategory("unregistered");
      setGstin("");
      setVillage("");
      setPhone("");
      setErrorMsg("");
    }
  }, [isOpen, defaultType]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (!name.trim()) {
      setErrorMsg("कृपया पार्टी का नाम दर्ज करें!");
      return;
    }

    if (category === "regular") {
      const cleanGstin = gstin.trim().toUpperCase();
      if (!cleanGstin || cleanGstin.length !== 15) {
        setErrorMsg("रेगुलर जीएसटी पार्टी के लिए 15 अक्षरों का सही GSTIN नंबर अनिवार्य है!");
        return;
      }
    }

    try {
      const id = await invoke<number>("add_party_cmd", {
        name: name.trim(),
        partyType,
        category,
        village: village.trim() || null,
        gstin: category === "regular" ? gstin.trim().toUpperCase() : gstin.trim() || null,
        phone: phone.trim() || null,
      });
      onSuccess(id);
      onClose();
    } catch (err: any) {
      console.error("add_party_cmd error:", err);
      setErrorMsg(String(err));
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto no-print">
      <div className="bg-white rounded-xl p-6 w-full max-w-lg shadow-xl border border-slate-200">
        <div className="flex justify-between items-center pb-3 border-b border-slate-100 mb-5">
          <div className="flex items-center gap-2">
            <Plus size={18} className="text-emerald-600" />
            <h3 className="text-lg font-semibold text-slate-900">
              {t.common.newParty}
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
          <div className="p-3 mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-center gap-2">
            <AlertCircle size={16} className="text-red-600 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block mb-1 text-xs font-medium text-slate-600 uppercase tracking-wider">
              {t.common.party} *
            </label>
            <input
              required
              autoFocus
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
              placeholder="उदा. राम खाद एवं बीज भंडार / रमेश पटेल"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block mb-1 text-xs font-medium text-slate-600 uppercase tracking-wider">
                {t.dashboard.entryType}
              </label>
              <select
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                value={partyType}
                onChange={(e) => setPartyType(e.target.value as any)}
              >
                <option value="customer">{t.common.customer}</option>
                <option value="supplier">{t.common.supplier}</option>
                <option value="both">दोनों (Customer & Supplier)</option>
              </select>
            </div>

            <div>
              <label className="block mb-1 text-xs font-medium text-slate-600 uppercase tracking-wider">
                {t.common.category}
              </label>
              <select
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="unregistered">{t.common.unregistered}</option>
                <option value="regular">{t.common.regular}</option>
                <option value="composition">{t.common.composition}</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block mb-1 text-xs font-medium text-slate-600 uppercase tracking-wider">
                {t.common.gstin} {category === "regular" && <span className="text-red-500">*</span>}
              </label>
              <input
                required={category === "regular"}
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm font-mono uppercase bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                placeholder="23ABCDE1234F1Z5"
                maxLength={15}
                value={gstin}
                onChange={(e) => setGstin(e.target.value)}
              />
            </div>

            <div>
              <label className="block mb-1 text-xs font-medium text-slate-600 uppercase tracking-wider">
                {t.common.village}
              </label>
              <input
                className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                placeholder="उदा. सीहोर / विदिशा"
                value={village}
                onChange={(e) => setVillage(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block mb-1 text-xs font-medium text-slate-600 uppercase tracking-wider">
              {t.common.phone}
            </label>
            <input
              type="tel"
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm font-mono bg-white focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
              placeholder="9876543210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button type="button" onClick={onClose} className="btn-secondary">
              {t.common.cancel}
            </button>
            <button type="submit" className="btn-primary">
              {t.common.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
