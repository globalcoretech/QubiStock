import React, { useState } from "react";
import { AppSettings, DEFAULT_SETTINGS } from "../types";
import { Language, Translations } from "../i18n";
import { Check, AlertCircle, Image, Trash2 } from "../components/icons";

interface FirstTimeSetupViewProps {
  initialSettings?: AppSettings;
  onSave: (settings: AppSettings) => Promise<void>;
  lang: Language;
  onSelectLanguage?: (lang: Language) => void;
  t: Translations;
}

export function FirstTimeSetupView({
  initialSettings,
  onSave,
  lang,
  onSelectLanguage,
  t: _t,
}: FirstTimeSetupViewProps) {
  const [formData, setFormData] = useState<AppSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...(initialSettings || {}),
    shopName: initialSettings?.shopName || "",
    gstin: initialSettings?.gstin || "",
    stateCode: initialSettings?.stateCode || "",
    phone: initialSettings?.phone || "",
    address: initialSettings?.address || "",
    isGstRegistered: initialSettings?.isGstRegistered ?? true,
    isComposition: initialSettings?.isComposition ?? false,
    bankName: initialSettings?.bankName || "",
    bankAccountNo: initialSettings?.bankAccountNo || "",
    bankIfsc: initialSettings?.bankIfsc || "",
    bankBranch: initialSettings?.bankBranch || "",
    upiId: initialSettings?.upiId || "",
    logoData: initialSettings?.logoData || "",
  }));

  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showOptionalFields, setShowOptionalFields] = useState(false);

  // GSTIN 15-character standard pattern check
  const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

  const handleGstinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 15);
    const autoState = rawVal.length >= 2 && /^\d{2}$/.test(rawVal.slice(0, 2))
      ? rawVal.slice(0, 2)
      : formData.stateCode;

    setFormData((prev) => ({
      ...prev,
      gstin: rawVal,
      stateCode: autoState,
    }));
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        setErrorMessage(
          lang === "hi"
            ? "लोगो का साइज़ 2MB से कम होना चाहिए!"
            : "Logo size must be under 2MB!"
        );
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData((prev) => ({ ...prev, logoData: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveLogo = () => {
    setFormData((prev) => ({ ...prev, logoData: "" }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // 1. दुकान का नाम* required check
    const trimmedShopName = formData.shopName.trim();
    if (!trimmedShopName) {
      setErrorMessage(
        lang === "hi"
          ? "कृपया दुकान का नाम दर्ज करें (अनिवार्य)!"
          : "Please enter shop name (required)!"
      );
      return;
    }

    // 2. GST Registered checks
    const trimmedGstin = (formData.gstin || "").trim().toUpperCase();
    let stateCode = formData.stateCode || "23";

    if (formData.isGstRegistered) {
      if (!trimmedGstin) {
        setErrorMessage(
          lang === "hi"
            ? "GST पंजीकृत होने पर GSTIN दर्ज करना अनिवार्य है!"
            : "GSTIN is required for GST registered businesses!"
        );
        return;
      }

      if (trimmedGstin.length !== 15 || !GSTIN_REGEX.test(trimmedGstin)) {
        setErrorMessage(
          lang === "hi"
            ? "GSTIN 15 अक्षरों का मान्य प्रारूप होना चाहिए (उदा. 23AAACK1425H1Z4)!"
            : "GSTIN must be a valid 15-character format (e.g. 23AAACK1425H1Z4)!"
        );
        return;
      }

      // First 2 digits auto state code
      stateCode = trimmedGstin.slice(0, 2);
    }

    const payloadToSave: AppSettings = {
      ...formData,
      shopName: trimmedShopName,
      gstin: formData.isGstRegistered ? trimmedGstin : "",
      stateCode: stateCode,
      phone: (formData.phone || "").trim(),
      address: (formData.address || "").trim(),
      bankName: (formData.bankName || "").trim(),
      bankAccountNo: (formData.bankAccountNo || "").trim(),
      bankIfsc: (formData.bankIfsc || "").trim().toUpperCase(),
      bankBranch: (formData.bankBranch || "").trim(),
      upiId: (formData.upiId || "").trim(),
      footerNote: formData.footerNote?.trim() || "धन्यवाद!",
    };

    setSaving(true);
    try {
      await onSave(payloadToSave);
      // Success will transition out of this view via App state
    } catch (err: any) {
      console.error("First time setup save failed:", err);
      const rawError = err?.message || (typeof err === "string" ? err : JSON.stringify(err));
      setErrorMessage(
        lang === "hi"
          ? `सेव विफल रहा (त्रुटि): ${rawError}`
          : `Save failed (Error): ${rawError}`
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-screen max-h-screen w-screen max-w-full overflow-y-auto bg-paper flex flex-col items-center p-3 sm:p-6 font-body text-ink">
      <div className="w-full max-w-2xl bg-surface border border-border rounded-2xl shadow-xl overflow-hidden my-auto flex-shrink-0">
        {/* Header Banner */}
        <div className="bg-forest px-6 py-6 text-white flex items-center justify-between border-b border-forest-2">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-marigold/20 text-marigold text-xs font-semibold uppercase tracking-wider mb-2">
              <span>{lang === "hi" ? "आरंभिक सेटअप" : "Initial Setup"}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-heading font-bold text-surface tracking-tight">
              {lang === "hi" ? "पहली बार सेटअप" : "First Time Setup"}
            </h1>
            <p className="text-sm text-surface/80 mt-1">
              {lang === "hi"
                ? "बिलिंग और इन्वेंट्री शुरू करने के लिए अपनी दुकान की जानकारी भरें"
                : "Enter your shop details to start billing and inventory management"}
            </p>
          </div>

          {onSelectLanguage && (
            <div className="flex items-center gap-1 bg-surface/10 p-1 rounded-lg">
              <button
                type="button"
                onClick={() => onSelectLanguage("hi")}
                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${
                  lang === "hi" ? "bg-marigold text-forest font-bold" : "text-surface hover:text-white"
                }`}
              >
                हिन्दी
              </button>
              <button
                type="button"
                onClick={() => onSelectLanguage("en")}
                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${
                  lang === "en" ? "bg-marigold text-forest font-bold" : "text-surface hover:text-white"
                }`}
              >
                English
              </button>
            </div>
          )}
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-6">
          {/* Asli Error Red Alert Box */}
          {errorMessage && (
            <div
              data-testid="setup-error-box"
              role="alert"
              className="p-4 bg-red-50 border-2 border-red-500 rounded-xl text-red-800 text-sm font-medium flex items-start gap-3 shadow-xs animate-shake"
            >
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold text-red-900">
                  {lang === "hi" ? "त्रुटि (Error):" : "Error:"}
                </p>
                <p className="mt-0.5 break-words">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Section 1: अनिवार्य जानकारी (Shop Details) */}
          <div className="space-y-4">
            <h2 className="text-base font-bold text-forest border-b border-border pb-1.5 flex items-center justify-between">
              <span>{lang === "hi" ? "दुकान की मुख्य जानकारी" : "Shop Primary Details"}</span>
              <span className="text-xs font-normal text-slate-500">
                * {lang === "hi" ? "अनिवार्य फ़ील्ड" : "Required fields"}
              </span>
            </h2>

            {/* Shop Name */}
            <div>
              <label htmlFor="setup-shop-name" className="block text-sm font-semibold text-slate-800 mb-1">
                {lang === "hi" ? "दुकान का नाम" : "Shop Name"} <span className="text-red-500">*</span>
              </label>
              <input
                id="setup-shop-name"
                data-testid="setup-shop-name"
                type="text"
                required
                value={formData.shopName}
                onChange={(e) => setFormData({ ...formData, shopName: e.target.value })}
                placeholder={lang === "hi" ? "उदा. किसान कृषि सेवा केंद्र" : "e.g. Kisan Krishi Kendra"}
                className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-paper text-ink focus:border-forest focus:ring-2 focus:ring-forest/20 text-base font-medium transition-all"
              />
            </div>

            {/* Address */}
            <div>
              <label htmlFor="setup-address" className="block text-sm font-semibold text-slate-800 mb-1">
                {lang === "hi" ? "पता" : "Address"}
              </label>
              <input
                id="setup-address"
                data-testid="setup-address"
                type="text"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder={lang === "hi" ? "उदा. कृषि उपज मंडी रोड, सीहोर (म.प्र.)" : "e.g. Mandi Road, Sehore (M.P.)"}
                className="w-full px-3.5 py-2 rounded-lg border border-border bg-paper text-ink focus:border-forest focus:ring-2 focus:ring-forest/20 text-sm transition-all"
              />
            </div>

            {/* Phone */}
            <div>
              <label htmlFor="setup-phone" className="block text-sm font-semibold text-slate-800 mb-1">
                {lang === "hi" ? "फोन / मोबाइल" : "Phone / Mobile"}
              </label>
              <input
                id="setup-phone"
                data-testid="setup-phone"
                type="text"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder={lang === "hi" ? "उदा. 9826012345" : "e.g. 9826012345"}
                className="w-full px-3.5 py-2 rounded-lg border border-border bg-paper text-ink focus:border-forest focus:ring-2 focus:ring-forest/20 text-sm font-mono transition-all"
              />
            </div>
          </div>

          {/* Section 2: GST & Tax Configuration */}
          <div className="space-y-4 pt-2">
            <h2 className="text-base font-bold text-forest border-b border-border pb-1.5">
              {lang === "hi" ? "GST एवं टैक्स विवरण" : "GST & Tax Configuration"}
            </h2>

            {/* GST Registered Toggle */}
            <div className="flex items-center justify-between p-3.5 bg-paper rounded-xl border border-border">
              <div>
                <span className="text-sm font-bold text-slate-800">
                  {lang === "hi" ? "क्या दुकान GST में पंजीकृत है?" : "Is Shop GST Registered?"}
                </span>
                <p className="text-xs text-slate-500">
                  {lang === "hi"
                    ? "हाँ चुनने पर बिल पर GSTIN प्रिंट होगा और टैक्स इनवॉइस बनेगा"
                    : "If checked, GSTIN will be required and printed on Tax Invoices"}
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  data-testid="setup-gst-registered"
                  checked={formData.isGstRegistered}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      isGstRegistered: e.target.checked,
                    })
                  }
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-forest"></div>
              </label>
            </div>

            {/* GSTIN & State Code (if GST registered) */}
            {formData.isGstRegistered && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 bg-emerald-50/50 rounded-xl border border-emerald-200">
                <div className="sm:col-span-2">
                  <label htmlFor="setup-gstin" className="block text-sm font-semibold text-slate-800 mb-1">
                    GSTIN (15 {lang === "hi" ? "अक्षर" : "chars"}) <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="setup-gstin"
                    data-testid="setup-gstin"
                    type="text"
                    maxLength={15}
                    value={formData.gstin}
                    onChange={handleGstinChange}
                    placeholder="23AAACK1425H1Z4"
                    className="w-full px-3.5 py-2 rounded-lg border border-border bg-white text-ink uppercase tracking-wider font-mono text-sm focus:border-forest focus:ring-2 focus:ring-forest/20 transition-all"
                  />
                  <p className="text-2xs text-slate-500 mt-1">
                    {formData.gstin && formData.gstin.length !== 15 && (
                      <span className="text-amber-700">
                        {15 - formData.gstin.length} {lang === "hi" ? "अक्षर बाकी" : "chars remaining"}
                      </span>
                    )}
                    {formData.gstin && formData.gstin.length === 15 && (
                      <span className="text-emerald-700 font-semibold flex items-center gap-1">
                        <Check size={12} /> 15 {lang === "hi" ? "अक्षर पूरे" : "chars complete"}
                      </span>
                    )}
                  </p>
                </div>

                <div>
                  <label htmlFor="setup-state-code" className="block text-sm font-semibold text-slate-800 mb-1">
                    {lang === "hi" ? "राज्य कोड" : "State Code"}
                  </label>
                  <input
                    id="setup-state-code"
                    data-testid="setup-state-code"
                    type="text"
                    readOnly
                    value={formData.stateCode || "23"}
                    className="w-full px-3.5 py-2 rounded-lg border border-border bg-slate-100 text-slate-700 font-mono text-sm cursor-not-allowed"
                    title={lang === "hi" ? "GSTIN के पहले 2 अंकों से स्वतः निर्धारित" : "Auto-determined from first 2 digits of GSTIN"}
                  />
                  <p className="text-2xs text-slate-500 mt-1">
                    {formData.stateCode === "23" ? "मध्य प्रदेश (23)" : `राज्य कोड: ${formData.stateCode || "23"}`}
                  </p>
                </div>

                {/* Composition Scheme Toggle */}
                <div className="sm:col-span-3 flex items-center justify-between pt-2 border-t border-emerald-200/70">
                  <div>
                    <span className="text-sm font-semibold text-slate-800">
                      {lang === "hi" ? "क्या कम्पोज़ीशन स्कीम में हैं?" : "Composition Scheme?"}
                    </span>
                    <p className="text-xs text-slate-500">
                      {lang === "hi"
                        ? "कम्पोज़ीशन में बिल ऑफ़ सप्लाई जारी होता है और टैक्स एकत्र नहीं होता"
                        : "Generates Bill of Supply without charging tax"}
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      data-testid="setup-composition"
                      checked={formData.isComposition}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          isComposition: e.target.checked,
                        })
                      }
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-forest"></div>
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Optional Bank / UPI / Logo (Collapsible/Accordion) */}
          <div className="border border-border rounded-xl overflow-hidden bg-paper/50">
            <button
              type="button"
              data-testid="setup-toggle-optional"
              onClick={() => setShowOptionalFields(!showOptionalFields)}
              className="w-full px-4 py-3 bg-surface hover:bg-slate-50 flex items-center justify-between text-left transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-800">
                  {lang === "hi" ? "बैंक, UPI एवं लोगो विवरण" : "Bank, UPI & Logo Details"}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium">
                  {lang === "hi" ? "वैकल्पिक (Optional)" : "Optional"}
                </span>
              </div>
              <span className="text-sm font-semibold text-forest">
                {showOptionalFields ? (lang === "hi" ? "छिपाएं ▲" : "Hide ▲") : (lang === "hi" ? "भरें ▼" : "Expand ▼")}
              </span>
            </button>

            {showOptionalFields && (
              <div className="p-4 sm:p-5 space-y-4 border-t border-border bg-surface">
                {/* Bank Name & Account */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="setup-bank-name" className="block text-xs font-semibold text-slate-700 mb-1">
                      {lang === "hi" ? "बैंक का नाम" : "Bank Name"}
                    </label>
                    <input
                      id="setup-bank-name"
                      type="text"
                      value={formData.bankName}
                      onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                      placeholder={lang === "hi" ? "उदा. State Bank of India" : "e.g. State Bank of India"}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-paper text-ink text-sm focus:border-forest transition-all"
                    />
                  </div>

                  <div>
                    <label htmlFor="setup-account-no" className="block text-xs font-semibold text-slate-700 mb-1">
                      {lang === "hi" ? "खाता संख्या" : "Account Number"}
                    </label>
                    <input
                      id="setup-account-no"
                      type="text"
                      value={formData.bankAccountNo}
                      onChange={(e) => setFormData({ ...formData, bankAccountNo: e.target.value })}
                      placeholder="30291827364"
                      className="w-full px-3 py-2 rounded-lg border border-border bg-paper text-ink text-sm font-mono focus:border-forest transition-all"
                    />
                  </div>
                </div>

                {/* IFSC & Branch */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="setup-ifsc" className="block text-xs font-semibold text-slate-700 mb-1">
                      {lang === "hi" ? "IFSC कोड" : "IFSC Code"}
                    </label>
                    <input
                      id="setup-ifsc"
                      type="text"
                      value={formData.bankIfsc}
                      onChange={(e) => setFormData({ ...formData, bankIfsc: e.target.value.toUpperCase() })}
                      placeholder="SBIN0001234"
                      className="w-full px-3 py-2 rounded-lg border border-border bg-paper text-ink text-sm font-mono uppercase focus:border-forest transition-all"
                    />
                  </div>

                  <div>
                    <label htmlFor="setup-branch" className="block text-xs font-semibold text-slate-700 mb-1">
                      {lang === "hi" ? "शाखा (Branch)" : "Branch"}
                    </label>
                    <input
                      id="setup-branch"
                      type="text"
                      value={formData.bankBranch}
                      onChange={(e) => setFormData({ ...formData, bankBranch: e.target.value })}
                      placeholder={lang === "hi" ? "उदा. मुख्य शाखा सीहोर" : "e.g. Main Branch"}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-paper text-ink text-sm focus:border-forest transition-all"
                    />
                  </div>
                </div>

                {/* UPI ID */}
                <div>
                  <label htmlFor="setup-upi" className="block text-xs font-semibold text-slate-700 mb-1">
                    UPI ID ({lang === "hi" ? "बिल पर QR कोड हेतु" : "for Bill QR Code"})
                  </label>
                  <input
                    id="setup-upi"
                    type="text"
                    value={formData.upiId}
                    onChange={(e) => setFormData({ ...formData, upiId: e.target.value })}
                    placeholder="ramkrishi@sbi"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-paper text-ink text-sm font-mono focus:border-forest transition-all"
                  />
                </div>

                {/* Shop Logo */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {lang === "hi" ? "दुकान का लोगो (Logo)" : "Shop Logo"}
                  </label>
                  <div className="flex items-center gap-4">
                    {formData.logoData ? (
                      <div className="relative border border-border rounded-lg p-1 bg-paper flex items-center gap-2">
                        <img
                          src={formData.logoData}
                          alt="Shop Logo Preview"
                          className="w-14 h-14 object-contain rounded"
                        />
                        <button
                          type="button"
                          onClick={handleRemoveLogo}
                          className="px-2 py-1 text-xs text-red-600 hover:text-red-700 flex items-center gap-1 font-semibold"
                        >
                          <Trash2 size={13} />
                          <span>{lang === "hi" ? "हटाएं" : "Remove"}</span>
                        </button>
                      </div>
                    ) : (
                      <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 border border-dashed border-border rounded-lg hover:border-forest bg-paper text-xs font-semibold text-forest transition-colors">
                        <Image size={15} />
                        <span>{lang === "hi" ? "लोगो अपलोड करें (PNG/JPG)" : "Upload Logo (PNG/JPG)"}</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleLogoUpload}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              data-testid="setup-save-button"
              disabled={saving}
              className={`w-full py-3.5 px-6 rounded-xl font-bold text-base text-white shadow-lg transition-all flex items-center justify-center gap-2 ${
                saving
                  ? "bg-forest/70 cursor-not-allowed"
                  : "bg-forest hover:bg-forest-2 active:scale-[0.99] hover:shadow-xl"
              }`}
            >
              {saving ? (
                <>
                  <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  <span>{lang === "hi" ? "सुरक्षित हो रहा है..." : "Saving..."}</span>
                </>
              ) : (
                <>
                  <Check size={20} className="text-marigold" />
                  <span>
                    {lang === "hi"
                      ? "दुकान की जानकारी सुरक्षित करें और शुरू करें"
                      : "Save Shop Details & Get Started"}
                  </span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
