import React, { useState } from "react";
import { AppSettings, Feedback } from "../types";
import { Translations, Language } from "../i18n";
import { FeedbackBanner } from "../components/FeedbackBanner";
import { Settings, Check, AlertCircle } from "../components/icons";

interface SettingsViewProps {
  settings: AppSettings;
  onSave: (s: AppSettings) => void;
  t: Translations;
  lang: Language;
}

export function SettingsView({
  settings,
  onSave,
  t,
  lang,
}: SettingsViewProps) {
  const [formData, setFormData] = useState<AppSettings>(settings);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.shopName.trim()) {
      setFeedback({
        message: lang === "hi" ? "कृपया दुकान का नाम दर्ज करें!" : "Please enter shop name!",
        isError: true,
      });
      return;
    }
    onSave(formData);
    setFeedback({
      message: t.settings.saveSuccess,
      isError: false,
    });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div className="pb-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Settings size={20} strokeWidth={1.75} className="text-slate-600" />
            <span>{t.settings.title}</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {t.settings.subtitle}
          </p>
        </div>
      </div>

      <FeedbackBanner feedback={feedback} />

      {/* Form Card */}
      <div className="bg-white border border-slate-200/80 rounded-xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              {t.settings.shopName} *
            </label>
            <input
              required
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white font-medium text-slate-900 focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
              placeholder={lang === "hi" ? "उदा. श्री राम कृषि केंद्र" : "e.g. Shri Ram Krishi Kendra"}
              value={formData.shopName}
              onChange={(e) => setFormData({ ...formData, shopName: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {t.settings.gstin}
              </label>
              <input
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono uppercase bg-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                placeholder="23AAAAA0000A1Z5"
                maxLength={15}
                value={formData.gstin}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase();
                  const autoState = val.length >= 2 ? val.slice(0, 2) : formData.stateCode || "23";
                  setFormData({ ...formData, gstin: val, stateCode: autoState });
                }}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {t.settings.stateCode} *
              </label>
              <input
                required
                maxLength={2}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono bg-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                placeholder="23"
                value={formData.stateCode || "23"}
                onChange={(e) => setFormData({ ...formData, stateCode: e.target.value })}
              />
              <p className="text-[11px] text-slate-400 mt-1">{t.settings.stateCodeHelp}</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {t.settings.phone}
              </label>
              <input
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono bg-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                placeholder="9876543210"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              {t.settings.address}
            </label>
            <input
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
              placeholder={lang === "hi" ? "उदा. मुख्य बाजार, कृषि मंडी रोड, सीहोर" : "e.g. Main Market, Mandi Road, Sehore"}
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            />
          </div>

          {/* Low Stock Threshold Setting */}
          <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-lg space-y-1.5">
            <label className="block text-xs font-semibold text-slate-800 flex items-center gap-1.5">
              <AlertCircle size={14} strokeWidth={2} className="text-amber-600" />
              <span>{t.settings.lowStockThreshold}</span>
            </label>
            <input
              type="number"
              min="1"
              className="w-32 px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-mono font-semibold bg-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
              value={formData.lowStockThreshold}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  lowStockThreshold: parseInt(e.target.value) || 0,
                })
              }
            />
            <p className="text-[11px] text-slate-500">
              {lang === "hi"
                ? "यदि किसी सामान का स्टॉक इस संख्या से कम या बराबर होगा, तो डैशबोर्ड और स्टॉक रिपोर्ट पर चेतावनी दिखेगी।"
                : "Items with inventory at or below this number will be flagged as low stock."}
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              {t.settings.footerNote}
            </label>
            <textarea
              rows={2}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
              value={formData.footerNote}
              onChange={(e) => setFormData({ ...formData, footerNote: e.target.value })}
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold shadow-xs transition-colors"
            >
              <Check size={16} strokeWidth={2} />
              <span>{t.settings.saveBtn}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
