import React, { useState, useMemo } from "react";
import {
  AppSettings,
  Feedback,
  BillFormat,
  BillLanguage,
  BillVisibleColumns,
  DEFAULT_VISIBLE_COLUMNS,
} from "../types";
import { Translations, Language } from "../i18n";
import { FeedbackBanner } from "../components/FeedbackBanner";
import { Settings, Check, AlertCircle, Printer, Image, Trash2, Eye } from "../components/icons";
import { buildBillData } from "../utils/billBuilder";
import { BillViewer } from "../components/bills/BillViewer";
import { formatBillNumber } from "../utils/billNumber";
import { PrinterSetupView } from "./PrinterSetupView";

interface SettingsViewProps {
  settings: AppSettings;
  onSave: (s: AppSettings) => Promise<void> | void;
  t: Translations;
  lang: Language;
}

export function SettingsView({
  settings,
  onSave,
  t,
  lang,
}: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<"general" | "bill" | "printer">("bill");
  const [formData, setFormData] = useState<AppSettings>({
    ...settings,
    visibleColumns: settings.visibleColumns || DEFAULT_VISIBLE_COLUMNS,
    defaultBillFormat: settings.defaultBillFormat || "A4",
    billLanguage: settings.billLanguage || "both",
    fyPrefix: settings.fyPrefix || "KK",
  });
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [previewFormat, setPreviewFormat] = useState<BillFormat>(
    formData.defaultBillFormat || "A4"
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (!formData.shopName.trim()) {
      setFeedback({
        message: lang === "hi" ? "कृपया दुकान का नाम दर्ज करें!" : "Please enter shop name!",
        isError: true,
      });
      return;
    }
    try {
      // Ensure clean payload with no duplicate or snake_case keys
      const cleanData: AppSettings = { ...formData };
      delete (cleanData as any).logoUrl;
      delete (cleanData as any).signatureUrl;
      delete (cleanData as any).printOffsetXmm;
      delete (cleanData as any).printOffsetYmm;

      await onSave(cleanData);
      setFeedback({
        message: lang === "hi" ? "सेव हो गया" : "सेव हो गया",
        isError: false,
      });
    } catch (err: any) {
      console.error("Save settings error:", err);
      const errMsg = err?.message || String(err);
      setFeedback({
        message: lang === "hi" ? `सेव विफल रहा: ${errMsg}` : `Save failed: ${errMsg}`,
        isError: true,
      });
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        setFeedback({
          message: "लोगो का आकार 2MB से कम होना चाहिए!",
          isError: true,
        });
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData((prev) => ({ ...prev, logoData: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSignatureUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData((prev) => ({ ...prev, signatureData: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const toggleColumn = (colKey: keyof BillVisibleColumns) => {
    setFormData((prev) => ({
      ...prev,
      visibleColumns: {
        ...(prev.visibleColumns || DEFAULT_VISIBLE_COLUMNS),
        [colKey]: !prev.visibleColumns?.[colKey],
      },
    }));
  };

  // Generate Sample Live Preview Bill Data
  const sampleBillData = useMemo(() => {
    const invNo = formatBillNumber(1, formData.fyPrefix || "KK");
    return buildBillData({
      settings: formData,
      invoiceDetails: {
        invoice_no: invNo,
        date: new Date().toISOString().split("T")[0],
        party_name: "सुरेश कुमार पाटीदार (किसान)",
        party_village: "ग्राम बिलकिसगंज, सीहोर",
        party_phone: "9826012345",
        party_gstin: null,
        payment_mode: "cash",
        lines: [
          {
            item_name: "यूरिया 45kg (नीम लेपित)",
            qty: 10000, // 10 बोरी
            unit: "बोरी",
            rate: 26650, // ₹266.50
            taxable: 253810,
            gst_amount: 12690,
            total: 266500,
          },
          {
            item_name: "डीएपी 18:46:0 इफको (50kg)",
            qty: 5000, // 5 बोरी
            unit: "बोरी",
            rate: 135000, // ₹1350
            taxable: 642857,
            gst_amount: 32143,
            total: 675000,
          },
          {
            item_name: "क्लोरोपाइरीफॉस 20% EC (1L)",
            qty: 2000, // 2 L
            unit: "लीटर",
            rate: 46750, // ₹467.50
            taxable: 79237,
            gst_amount: 14263,
            total: 93500,
          },
        ],
      },
    });
  }, [formData]);

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden font-body text-ink">
      {/* Header & Tabs */}
      <div className="bg-surface border-b border-border p-3 px-4 flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
            <Settings size={20} />
          </div>
          <div>
            <h2 className="font-serif text-lg font-bold tracking-tight text-ink">
              {t.settings.title}
            </h2>
            <p className="text-xs text-muted">
              {activeTab === "bill"
                ? "जीएसटी बिल प्रारूप, दुकान लोगो, बैंक, UPI एवं प्रिंट सेटिंग्स"
                : t.settings.subtitle}
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1 bg-paper p-1 rounded-xl border border-border">
          <button
            type="button"
            data-testid="tab-bill-settings"
            onClick={() => setActiveTab("bill")}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === "bill"
                ? "bg-forest text-surface shadow-xs"
                : "text-muted hover:text-ink"
            }`}
          >
            <Printer size={15} />
            <span>बिल सेटिंग्स (Bill Settings)</span>
          </button>
          <button
            type="button"
            data-testid="tab-printer-settings"
            onClick={() => setActiveTab("printer")}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === "printer"
                ? "bg-forest text-surface shadow-xs"
                : "text-muted hover:text-ink"
            }`}
          >
            <Printer size={15} />
            <span>प्रिंटर सेटअप (Printer Setup)</span>
          </button>
          <button
            type="button"
            data-testid="tab-general-settings"
            onClick={() => setActiveTab("general")}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === "general"
                ? "bg-forest text-surface shadow-xs"
                : "text-muted hover:text-ink"
            }`}
          >
            <Settings size={15} />
            <span>दुकान सेटिंग्स (General)</span>
          </button>
        </div>
      </div>

      <div className="p-2 px-4 flex-shrink-0">
        <FeedbackBanner feedback={feedback} />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 pt-0" data-scroll="true">
        {activeTab === "printer" ? (
          <PrinterSetupView
            settings={formData}
            onSave={(updated) => {
              setFormData(updated);
              onSave(updated);
            }}
            t={t}
            lang={lang}
          />
        ) : activeTab === "bill" ? (
          /* BILL SETTINGS: 2-Column Responsive Layout with Form on Left and Live Preview on Right */
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 h-full">
            {/* Left Column: Form Controls (xl:col-span-6) */}
            <div className="xl:col-span-6 space-y-4" data-scroll="true">
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* 1. Format & Language Card */}
                <div className="bg-surface border border-border rounded-panel p-4 shadow-2xs space-y-3">
                  <h3 className="font-serif text-sm font-bold text-ink border-b border-border/80 pb-1.5 flex items-center justify-between">
                    <span>१. बिल प्रारूप एवं भाषा (Format & Language)</span>
                    <span className="text-[11px] font-mono font-semibold text-forest">
                      FY Series: {formData.fyPrefix}/25-26/0001
                    </span>
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="block font-bold text-muted mb-1 uppercase tracking-wider text-[11px]">
                        डिफ़ॉल्ट साइज (Default Size) *
                      </label>
                      <div className="flex rounded-lg border border-border bg-paper p-0.5">
                        {(["A4", "A5", "A6"] as BillFormat[]).map((fmt) => (
                          <button
                            key={fmt}
                            type="button"
                            onClick={() => {
                              setFormData({ ...formData, defaultBillFormat: fmt });
                              setPreviewFormat(fmt);
                            }}
                            className={`flex-1 py-1.5 text-center font-bold text-xs rounded-md transition-all ${
                              formData.defaultBillFormat === fmt
                                ? "bg-surface text-ink shadow-2xs font-black"
                                : "text-muted hover:text-ink"
                            }`}
                          >
                            {fmt}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block font-bold text-muted mb-1 uppercase tracking-wider text-[11px]">
                        बिल भाषा (Language) *
                      </label>
                      <select
                        value={formData.billLanguage || "both"}
                        onChange={(e) =>
                          setFormData({ ...formData, billLanguage: e.target.value as BillLanguage })
                        }
                        className="w-full px-2.5 py-1.5 border border-border rounded-lg bg-surface font-semibold text-xs focus:ring-1 focus:ring-forest outline-none"
                      >
                        <option value="both">दोनों (Bilingual: हिन्दी + English)</option>
                        <option value="hi">केवल हिन्दी (Hindi)</option>
                        <option value="en">English Only</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-bold text-muted mb-1 uppercase tracking-wider text-[11px]">
                        बिल नंबर प्रीफिक्स (Series Prefix)
                      </label>
                      <input
                        maxLength={4}
                        className="w-full px-2.5 py-1.5 border border-border rounded-lg bg-surface font-mono font-bold text-xs uppercase focus:ring-1 focus:ring-forest outline-none"
                        value={formData.fyPrefix || "KK"}
                        placeholder="KK"
                        onChange={(e) =>
                          setFormData({ ...formData, fyPrefix: e.target.value.toUpperCase() })
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* 2. Shop Logo & Identity Card */}
                <div className="bg-surface border border-border rounded-panel p-4 shadow-2xs space-y-3">
                  <h3 className="font-serif text-sm font-bold text-ink border-b border-border/80 pb-1.5">
                    २. दुकान का लोगो एवं पहचान (Shop Branding)
                  </h3>

                  <div className="flex flex-wrap items-center gap-4">
                    {formData.logoData || (formData as any).logoUrl ? (
                      <div className="relative group border-2 border-border rounded-xl p-1 bg-paper shadow-2xs">
                        <img
                          src={formData.logoData || (formData as any).logoUrl}
                          alt="Logo Preview"
                          className="w-20 h-20 object-contain rounded-lg"
                        />
                        <button
                          type="button"
                          onClick={() => setFormData({ ...formData, logoData: "" })}
                          className="absolute -top-2 -right-2 bg-rose-600 hover:bg-rose-700 text-white p-1 rounded-full shadow-md"
                          title="लोगो हटाएं"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ) : (
                      <div className="w-20 h-20 rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center text-muted text-xs bg-paper">
                        <Image size={24} className="opacity-50 mb-1" />
                        <span className="text-[10px]">लोगो नहीं</span>
                      </div>
                    )}

                    <div className="flex-1 min-w-[200px] space-y-1.5">
                      <label className="block text-xs font-bold text-slate-700">
                        दुकान का लोगो अपलोड करें (Upload Logo PNG/JPG)
                      </label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoUpload}
                        className="text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-forest/10 file:text-forest hover:file:bg-forest/20 cursor-pointer"
                      />
                      <p className="text-[11px] text-muted">
                        साफ बैकग्राउंड वाली इमेज A4 व A5 बिल के शीर्ष पर दिखाई देगी।
                      </p>
                    </div>
                  </div>
                </div>

                {/* 3. Bank & UPI Details Card */}
                <div className="bg-surface border border-border rounded-panel p-4 shadow-2xs space-y-3">
                  <h3 className="font-serif text-sm font-bold text-ink border-b border-border/80 pb-1.5">
                    ३. बैंक एवं डिजिटल भुगतान (Bank & UPI Details)
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block font-bold text-muted mb-1 text-[11px]">
                        बैंक का नाम (Bank Name)
                      </label>
                      <input
                        className="w-full px-2.5 py-1.5 border border-border rounded-lg bg-surface font-semibold text-xs focus:ring-1 focus:ring-forest outline-none"
                        placeholder="State Bank of India"
                        value={formData.bankName || ""}
                        onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-muted mb-1 text-[11px]">
                        खाता संख्या (A/c No.)
                      </label>
                      <input
                        className="w-full px-2.5 py-1.5 border border-border rounded-lg bg-surface font-mono font-bold text-xs focus:ring-1 focus:ring-forest outline-none"
                        placeholder="30291827364"
                        value={formData.bankAccountNo || ""}
                        onChange={(e) =>
                          setFormData({ ...formData, bankAccountNo: e.target.value })
                        }
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-muted mb-1 text-[11px]">
                        IFSC कोड
                      </label>
                      <input
                        className="w-full px-2.5 py-1.5 border border-border rounded-lg bg-surface font-mono font-bold text-xs uppercase focus:ring-1 focus:ring-forest outline-none"
                        placeholder="SBIN0001234"
                        value={formData.bankIfsc || ""}
                        onChange={(e) =>
                          setFormData({ ...formData, bankIfsc: e.target.value.toUpperCase() })
                        }
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-muted mb-1 text-[11px]">
                        शाखा का नाम (Branch)
                      </label>
                      <input
                        className="w-full px-2.5 py-1.5 border border-border rounded-lg bg-surface text-xs focus:ring-1 focus:ring-forest outline-none"
                        placeholder="सीहोर मुख्य शाखा"
                        value={formData.bankBranch || ""}
                        onChange={(e) => setFormData({ ...formData, bankBranch: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="pt-2 border-t border-border">
                    <label className="block font-bold text-emerald-900 mb-1 text-xs">
                      UPI आईडी (QR कोड के लिए) *
                    </label>
                    <input
                      className="w-full px-3 py-2 border border-emerald-300 rounded-lg bg-emerald-50/30 font-mono font-bold text-sm focus:ring-2 focus:ring-forest outline-none"
                      placeholder="ramkrishi@sbi या 9876543210@paytm"
                      value={formData.upiId || ""}
                      onChange={(e) => setFormData({ ...formData, upiId: e.target.value })}
                    />
                    <p className="text-[11px] text-muted mt-1">
                      इस UPI ID से बिल पर स्वतः ही बिल की कुल राशि का QR कोड जनरेट होगा।
                    </p>
                  </div>
                </div>

                {/* 4. Terms, Signature & Columns Card */}
                <div className="bg-surface border border-border rounded-panel p-4 shadow-2xs space-y-3">
                  <h3 className="font-serif text-sm font-bold text-ink border-b border-border/80 pb-1.5">
                    ४. शर्तें, हस्ताक्षर एवं कॉलम नियंत्रण (Terms, Sign & Columns)
                  </h3>

                  <div>
                    <label className="block font-bold text-muted mb-1 text-[11px]">
                      नियम एवं शर्तें (Terms & Conditions)
                    </label>
                    <textarea
                      rows={3}
                      className="w-full px-2.5 py-1.5 border border-border rounded-lg bg-surface text-xs focus:ring-1 focus:ring-forest outline-none leading-relaxed"
                      value={formData.termsAndConditions || ""}
                      onChange={(e) =>
                        setFormData({ ...formData, termsAndConditions: e.target.value })
                      }
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block font-bold text-muted mb-1 text-[11px]">
                        हस्ताक्षरकर्ता पदनाम (Signature Title)
                      </label>
                      <input
                        className="w-full px-2.5 py-1.5 border border-border rounded-lg bg-surface text-xs font-semibold focus:ring-1 focus:ring-forest outline-none"
                        value={formData.signatureText || ""}
                        placeholder="अधिकृत हस्ताक्षरकर्ता (Authorized Signatory)"
                        onChange={(e) =>
                          setFormData({ ...formData, signatureText: e.target.value })
                        }
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-muted mb-1 text-[11px]">
                        डिजिटल हस्ताक्षर (Signature Image)
                      </label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleSignatureUpload}
                        className="text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-[11px] file:font-semibold file:bg-slate-100 hover:file:bg-slate-200 cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* Columns ON / OFF */}
                  <div className="pt-2 border-t border-border">
                    <label className="block font-bold text-muted mb-1.5 text-[11px] uppercase tracking-wider">
                      बिल तालिका में कॉलम ऑन/ऑफ (Toggle Columns)
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                      {[
                        { key: "hsn", label: "HSN कोड" },
                        { key: "unit", label: "इकाई (Unit)" },
                        { key: "discount", label: "छूट (Discount)" },
                        { key: "gstRate", label: "GST %" },
                        { key: "taxable", label: "कर योग्य (Taxable)" },
                      ].map((c) => {
                        const isChecked = formData.visibleColumns?.[c.key as keyof BillVisibleColumns] ?? true;
                        return (
                          <label
                            key={c.key}
                            className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                              isChecked
                                ? "bg-forest/10 border-forest text-ink font-bold"
                                : "bg-paper border-border text-muted"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleColumn(c.key as keyof BillVisibleColumns)}
                              className="rounded text-forest focus:ring-forest cursor-pointer"
                            />
                            <span className="text-[11px]">{c.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Save Button */}
                <div className="pt-1">
                  <button
                    type="submit"
                    data-testid="save-bill-settings-btn"
                    className="w-full py-2.5 px-4 bg-forest hover:bg-forest-dark text-white rounded-xl text-sm font-bold shadow-md transition-all flex items-center justify-center gap-2"
                  >
                    <Check size={18} />
                    <span>बिल सेटिंग्स सहेजें (Save Bill Settings)</span>
                  </button>
                </div>
              </form>
            </div>

            {/* Right Column: Interactive Live Preview (xl:col-span-6) */}
            <div className="xl:col-span-6 flex flex-col bg-slate-100 border border-slate-300 rounded-panel overflow-hidden shadow-sm">
              {/* Preview Control Header */}
              <div className="bg-slate-200/90 p-2.5 px-3 border-b border-slate-300 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2">
                  <Eye size={16} className="text-forest" />
                  <span className="font-serif font-bold text-xs text-slate-800">
                    लाइव बिल पूर्वावलोकन (Live Preview)
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  {(["A4", "A5", "A6"] as BillFormat[]).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      data-testid={`preview-format-${fmt}`}
                      onClick={() => setPreviewFormat(fmt)}
                      className={`px-2.5 py-1 rounded text-xs font-bold transition-all ${
                        previewFormat === fmt
                          ? "bg-slate-900 text-white shadow-xs"
                          : "bg-white text-slate-700 hover:bg-slate-50 border border-slate-300"
                      }`}
                    >
                      {fmt}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="btn-primary text-xs py-1 px-3 ml-2 flex items-center gap-1"
                  >
                    <Printer size={13} />
                    <span>प्रिंट</span>
                  </button>
                </div>
              </div>

              {/* Preview Canvas */}
              <div
                className="flex-1 overflow-auto p-4 flex justify-center bg-slate-200/40"
                data-scroll="true"
              >
                <div className="scale-90 xl:scale-95 origin-top transition-all">
                  <BillViewer
                    bill={sampleBillData}
                    initialFormat={previewFormat}
                    onFormatChange={setPreviewFormat}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* GENERAL SETTINGS: Shop Details Form */
          <div className="max-w-2xl bg-surface border border-border rounded-panel p-6 shadow-2xs">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {t.settings.shopName} *
                </label>
                <input
                  required
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white font-medium text-slate-900 focus:ring-1 focus:ring-emerald-500 outline-none"
                  value={formData.shopName}
                  onChange={(e) => setFormData({ ...formData, shopName: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {t.settings.gstin}
                  </label>
                  <input
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono uppercase bg-white focus:ring-1 focus:ring-emerald-500 outline-none"
                    value={formData.gstin}
                    maxLength={15}
                    onChange={(e) => {
                      const val = e.target.value.toUpperCase();
                      const autoState = val.length >= 2 ? val.slice(0, 2) : formData.stateCode;
                      setFormData({ ...formData, gstin: val, stateCode: autoState });
                    }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {t.settings.stateCode} *
                  </label>
                  <input
                    required
                    maxLength={2}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono bg-white focus:ring-1 focus:ring-emerald-500 outline-none"
                    value={formData.stateCode}
                    onChange={(e) => setFormData({ ...formData, stateCode: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {t.settings.phone}
                  </label>
                  <input
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono bg-white focus:ring-1 focus:ring-emerald-500 outline-none"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
              </div>

              {/* GST Scheme & Registration Toggles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-paper rounded-xl border border-border">
                {/* 1. GST Registered Toggle */}
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isGstRegistered !== false}
                    onChange={(e) =>
                      setFormData({ ...formData, isGstRegistered: e.target.checked })
                    }
                    className="mt-0.5 w-4 h-4 text-forest rounded accent-forest cursor-pointer"
                  />
                  <div>
                    <span className="block text-xs font-bold text-ink">
                      दुकान GST रजिस्टर्ड है (GST Registered)
                    </span>
                    <span className="block text-[11px] text-muted leading-tight mt-0.5">
                      {formData.isGstRegistered !== false
                        ? "दुकान पंजीकृत है। कर योग्य माल बेचने पर Tax Invoice जारी होगा।"
                        : "दुकान अपंजीकृत है। सभी बिल 'Cash Memo' के रूप में जारी होंगे।"}
                    </span>
                  </div>
                </label>

                {/* 2. Composition Scheme Toggle */}
                <label
                  className={`flex items-start gap-2.5 cursor-pointer ${
                    formData.isGstRegistered === false ? "opacity-40 pointer-events-none" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={formData.isComposition === true}
                    disabled={formData.isGstRegistered === false}
                    onChange={(e) =>
                      setFormData({ ...formData, isComposition: e.target.checked })
                    }
                    className="mt-0.5 w-4 h-4 text-forest rounded accent-forest cursor-pointer"
                  />
                  <div>
                    <span className="block text-xs font-bold text-ink">
                      दुकान कंपोजिशन स्कीम में है (Composition Scheme)
                    </span>
                    <span className="block text-[11px] text-muted leading-tight mt-0.5">
                      {formData.isComposition === true
                        ? "कंपोजिशन डीलर केवल 'Bill of Supply' जारी करेगा (कोई टैक्स ब्रेकअप नहीं)।"
                        : "नियमित (Regular) GST योजना लागू है।"}
                    </span>
                  </div>
                </label>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {t.settings.address}
                </label>
                <input
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-1 focus:ring-emerald-500 outline-none"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>

              {/* Low Stock Threshold */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                <label className="block text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <AlertCircle size={14} className="text-amber-600" />
                  <span>{t.settings.lowStockThreshold}</span>
                </label>
                <input
                  type="number"
                  min="1"
                  className="w-32 px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-mono font-bold bg-white focus:ring-1 focus:ring-emerald-500 outline-none"
                  value={formData.lowStockThreshold}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      lowStockThreshold: parseInt(e.target.value) || 0,
                    })
                  }
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {t.settings.footerNote}
                </label>
                <textarea
                  rows={2}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-1 focus:ring-emerald-500 outline-none"
                  value={formData.footerNote}
                  onChange={(e) => setFormData({ ...formData, footerNote: e.target.value })}
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="btn-primary py-2 px-5 text-sm flex items-center gap-2"
                >
                  <Check size={16} />
                  <span>{t.settings.saveBtn}</span>
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
