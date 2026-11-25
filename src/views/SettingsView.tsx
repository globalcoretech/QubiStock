import React, { useState, useMemo } from "react";
import {
  AppSettings,
  Feedback,
  BillFormat,
  BillLanguage,
  BillVisibleColumns,
  DEFAULT_VISIBLE_COLUMNS,
  SessionUser,
  SecurityStatus,
} from "../types";
import { Translations, Language } from "../i18n";
import { FeedbackBanner } from "../components/FeedbackBanner";
import { Settings, Check, AlertCircle, Printer, Image, Trash2, Eye, Database, Users as UsersIcon, ShieldAlert, RefreshCw, Sparkles, Phone, Mail, Download } from "../components/icons";
import { buildBillData } from "../utils/billBuilder";
import { BillViewer } from "../components/bills/BillViewer";
import { formatBillNumber } from "../utils/billNumber";
import { localTodayIso } from "../utils/dateUtils";
import { PrinterSetupView } from "./PrinterSetupView";
import { UserManagementView } from "../components/UserManagementView";
import { checkForUpdates } from "../utils/updaterService";
import { UpdateNotificationModal } from "../components/UpdateNotificationModal";
import { useAppVersion } from "../utils/appVersion";

interface SettingsViewProps {
  settings: AppSettings;
  onSave: (s: AppSettings) => Promise<void> | void;
  t: Translations;
  lang: Language;
  currentUser?: SessionUser | null;
  securityStatus?: SecurityStatus | null;
  onEnableSecurity?: () => void;
  onUpdateAutoLock?: (minutes: number) => void;
}

export function SettingsView({
  settings,
  onSave,
  t,
  lang,
  currentUser,
  securityStatus,
  onEnableSecurity,
  onUpdateAutoLock,
}: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<"general" | "bill" | "printer" | "users">("bill");
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

  const appVersion = useAppVersion();
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateDetails, setUpdateDetails] = useState<{
    version: string;
    currentVersion?: string;
    notes?: string;
    date?: string;
  } | null>(null);

  const [updateCheckState, setUpdateCheckState] = useState<{
    checking: boolean;
    result: string | null;
    hasUpdate: boolean;
    version?: string;
  }>({ checking: false, result: null, hasUpdate: false });

  const handleManualCheckUpdates = async () => {
    setUpdateCheckState({ checking: true, result: null, hasUpdate: false });
    try {
      const res = await checkForUpdates();
      if (res && res.available && res.version) {
        setUpdateCheckState({
          checking: false,
          result: lang === "hi" ? `नया अपडेट उपलब्ध है: ${res.version}` : `New update available: ${res.version}`,
          hasUpdate: true,
          version: res.version,
        });
        setUpdateDetails({
          version: res.version,
          currentVersion: res.currentVersion || appVersion,
          notes: res.body,
          date: res.date,
        });
        setShowUpdateModal(true);
      } else if (res && res.error) {
        setUpdateCheckState({
          checking: false,
          result: typeof res.error === "string" ? res.error : (lang === "hi" ? "अपडेट जाँच विफल" : "Update check failed"),
          hasUpdate: false,
        });
      } else {
        setUpdateCheckState({
          checking: false,
          result: lang === "hi" ? `आप नवीनतम संस्करण उपयोग कर रहे हैं (${appVersion}) ✓` : `You are using the latest version (${appVersion}) ✓`,
          hasUpdate: false,
        });
      }
    } catch (e: any) {
      setUpdateCheckState({
        checking: false,
        result: typeof e === "string" ? e : e?.message || (lang === "hi" ? "अपडेट जाँच विफल" : "Update check failed"),
        hasUpdate: false,
      });
    }
  };

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
        date: localTodayIso(),
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
          {(!currentUser || currentUser.role === "owner") && (
            <button
              type="button"
              data-testid="tab-users-settings"
              onClick={() => setActiveTab("users")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === "users"
                  ? "bg-forest text-surface shadow-xs"
                  : "text-muted hover:text-ink"
              }`}
            >
              <UsersIcon size={15} />
              <span>यूज़र प्रबंधन (Users)</span>
            </button>
          )}
        </div>
      </div>

      {/* Persistent Reminder Banner when Security is disabled */}
      {securityStatus && !securityStatus.security_enabled && (
        <div
          data-testid="security-disabled-banner"
          className="mx-4 mt-3 p-3 bg-amber-50 border border-amber-300 rounded-xl text-amber-900 flex flex-wrap items-center justify-between gap-3 text-xs flex-shrink-0"
        >
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
            <div>
              <span className="font-bold">सुरक्षा अक्षम है (Security Disabled):</span> कोई भी बिना पासवर्ड के व्यवस्थापक (Owner) के रूप में कार्य कर सकता है।
              <span className="text-amber-700 block mt-0.5">Local login and role permissions are currently turned off.</span>
            </div>
          </div>
          {onEnableSecurity && (
            <button
              type="button"
              data-testid="enable-security-banner-btn"
              onClick={onEnableSecurity}
              className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-lg shrink-0 shadow-xs text-xs"
            >
              सुरक्षा चालू करें / Enable Security
            </button>
          )}
        </div>
      )}

      <div className="p-2 px-4 flex-shrink-0">
        <FeedbackBanner feedback={feedback} />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 pt-0" data-scroll="true">
        {activeTab === "users" ? (
          <UserManagementView
            currentUser={currentUser}
            securityEnabled={!!securityStatus?.security_enabled}
            autoLockMinutes={securityStatus?.auto_lock_minutes ?? 10}
            onUpdateAutoLock={onUpdateAutoLock || (() => {})}
            onEnableSecurity={onEnableSecurity}
          />
        ) : activeTab === "printer" ? (
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

              {/* Books Locked Period (हिसाब लॉक तारीख) */}
              <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl space-y-1.5">
                <label className="block text-xs font-bold text-amber-950 flex items-center justify-between">
                  <span>
                    {lang === "hi"
                      ? "हिसाब लॉक तारीख (Books locked up to date)"
                      : "Books locked up to (date)"}
                  </span>
                  {formData.booksLockedUntil && (
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, booksLockedUntil: null })}
                      className="text-[11px] text-amber-700 hover:text-amber-900 underline font-semibold"
                    >
                      {lang === "hi" ? "लॉक हटाएं (Clear)" : "Clear lock"}
                    </button>
                  )}
                </label>
                <input
                  type="date"
                  data-testid="settings-books-locked-until-input"
                  className="w-full sm:w-64 px-3 py-1.5 border border-amber-300 rounded-lg text-sm bg-white font-mono text-slate-900 focus:ring-1 focus:ring-amber-500 outline-none"
                  value={formData.booksLockedUntil || ""}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      booksLockedUntil: e.target.value ? e.target.value : null,
                    })
                  }
                />
                <p className="text-[11px] text-amber-800 leading-tight">
                  {lang === "hi"
                    ? "इस तारीख या इससे पहले के किसी भी लेनदेन (बिल/भुगतान) में बदलाव या रद्दीकरण की अनुमति नहीं होगी।"
                    : "Any edit or cancellation of transactions dated on or before this date will be strictly rejected."}
                </p>
              </div>

              {/* Backup Storage Locations (बैकअप सुरक्षित स्थान) */}
              <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-3">
                <div className="flex items-center gap-2 border-b border-emerald-200/80 pb-2">
                  <Database size={16} className="text-emerald-700" />
                  <h4 className="text-xs font-bold text-emerald-950 uppercase tracking-wide">
                    {lang === "hi" ? "डेटा बैकअप सुरक्षित स्थान (Backup Folders)" : "Backup Storage Folders"}
                  </h4>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    {t.settings.backupFolderLabel} *
                  </label>
                  <input
                    type="text"
                    data-testid="settings-backup-folder-input"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white font-mono text-slate-900 focus:ring-1 focus:ring-emerald-500 outline-none"
                    placeholder="Documents\KrishiBackup"
                    value={formData.backupFolder || ""}
                    onChange={(e) => setFormData({ ...formData, backupFolder: e.target.value })}
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    {lang === "hi"
                      ? "मुख्य बैकअप स्थान (खाली छोड़ने पर Documents\\KrishiBackup स्वतः रहेगा)"
                      : "Primary backup folder (defaults to Documents\\KrishiBackup if empty)"}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    {t.settings.secondaryBackupFolderLabel}
                  </label>
                  <input
                    type="text"
                    data-testid="settings-secondary-backup-folder-input"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white font-mono text-slate-900 focus:ring-1 focus:ring-emerald-500 outline-none"
                    placeholder={lang === "hi" ? "उदा. E:\\KrishiBackup या F:\\" : "e.g. E:\\KrishiBackup or F:\\"}
                    value={formData.secondaryBackupFolder || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, secondaryBackupFolder: e.target.value })
                    }
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    {lang === "hi"
                      ? "अतिरिक्त सुरक्षा के लिए पेनड्राइव या बाहरी ड्राइव का पाथ। ड्राइव न मिलने पर चेतावनी दिखेगी, बैकअप नहीं रुकेगा।"
                      : "Optional secondary location (Pendrive / 2nd drive). If drive is missing, a warning will be shown without interrupting backup."}
                  </p>
                </div>
              </div>

              {/* Technical Support & Helpdesk Section */}
              <div className="p-4 bg-gradient-to-r from-emerald-50/70 to-teal-50/70 border border-emerald-200/90 rounded-xl space-y-3">
                <div className="flex items-center justify-between border-b border-emerald-200/70 pb-2">
                  <div className="flex items-center gap-2">
                    <Phone size={16} className="text-emerald-700" />
                    <h4 className="text-xs font-bold text-emerald-950 uppercase tracking-wide">
                      {lang === "hi" ? "तकनीकी सहायता एवं संपर्क (Technical Support)" : "Technical Support & Helpdesk"}
                    </h4>
                  </div>
                  <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-md bg-emerald-100 text-emerald-900 border border-emerald-300">
                    GlobalCore Tech LLP
                  </span>
                </div>

                <p className="text-xs text-slate-600">
                  {lang === "hi"
                    ? "किसी भी तकनीकी समस्या, डेटा बैकअप या सहायता के लिए हमारी टेक्निकल सपोर्ट टीम से संपर्क करें:"
                    : "For any technical assistance, data backup inquiries, or troubleshooting, reach out to our team:"}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-emerald-100 shadow-2xs">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
                      <Phone size={16} />
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        {lang === "hi" ? "हेल्पलाइन / कॉल" : "Support Helpline"}
                      </div>
                      <a href="tel:+917879130175" className="text-xs font-bold text-emerald-800 hover:underline">
                        +91 78791 30175
                      </a>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-emerald-100 shadow-2xs">
                    <div className="w-8 h-8 rounded-lg bg-teal-100 flex items-center justify-center text-teal-700 shrink-0">
                      <Mail size={16} />
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        {lang === "hi" ? "आधिकारिक ईमेल" : "Support Email"}
                      </div>
                      <a href="mailto:contact@globlcoretech.com" className="text-xs font-bold text-teal-800 hover:underline">
                        contact@globlcoretech.com
                      </a>
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <div className="flex items-center gap-2">
                    <Sparkles size={16} className="text-teal-700" />
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                      {lang === "hi" ? "सॉफ़्टवेयर अपडेट (QubiStock Updates)" : "Software Updates"}
                    </h4>
                  </div>
                  <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-teal-100 text-teal-800 border border-teal-200">
                    {appVersion}
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                  <div>
                    <p className="text-xs font-semibold text-slate-800">
                      {lang === "hi" ? "GitHub से स्वचालित अपडेट प्राप्त करें" : "Automatic updates from GitHub"}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {updateCheckState.result ||
                        (lang === "hi"
                          ? "नया संस्करण आते ही सूचना मिलेगी। अपडेट के दौरान डेटाबेस 100% सुरक्षित रहता है।"
                          : "You will be notified when a new version is available. Database is 100% safe.")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {updateCheckState.hasUpdate && (
                      <button
                        type="button"
                        data-testid="update-now-settings-btn"
                        onClick={() => setShowUpdateModal(true)}
                        className="py-1.5 px-3.5 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-transform hover:scale-102 active:scale-98 cursor-pointer"
                      >
                        <Download size={13} />
                        <span>{lang === "hi" ? "अभी अपडेट करें" : "Update Now"}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid="check-updates-btn"
                      disabled={updateCheckState.checking}
                      onClick={handleManualCheckUpdates}
                      className="py-1.5 px-3.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 shadow-2xs transition-colors shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw size={13} className={updateCheckState.checking ? "animate-spin text-teal-600" : "text-slate-600"} />
                      <span>
                        {updateCheckState.checking
                          ? (lang === "hi" ? "जाँच हो रही है..." : "Checking...")
                          : (lang === "hi" ? "अपडेट की जाँच करें" : "Check for Updates")}
                      </span>
                    </button>
                  </div>
                </div>
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

      {showUpdateModal && updateDetails && (
        <UpdateNotificationModal
          version={updateDetails.version}
          currentVersion={updateDetails.currentVersion}
          notes={updateDetails.notes}
          date={updateDetails.date}
          onClose={() => setShowUpdateModal(false)}
          lang={lang}
        />
      )}
    </div>
  );
}
