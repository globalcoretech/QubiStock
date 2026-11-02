import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ShieldCheck, Key, Copy, Check, Printer, AlertTriangle } from "./icons";

interface InitialSetupWizardProps {
  onComplete: () => void;
}

export const InitialSetupWizard: React.FC<InitialSetupWizardProps> = ({ onComplete }) => {
  const [step, setStep] = useState<"form" | "key">("form");
  const [ownerName, setOwnerName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [generatedKey, setGeneratedKey] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [confirmedSaved, setConfirmedSaved] = useState(false);

  const handleCreateOwner = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const name = ownerName.trim();
    if (!name) {
      setError("कृपया व्यवस्थापक (Owner) का नाम दर्ज करें। / Please enter owner name.");
      return;
    }
    if (password.length < 6) {
      setError("पासवर्ड कम से कम 6 अक्षरों का होना चाहिए। / Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("पासवर्ड मेल नहीं खाते। / Passwords do not match.");
      return;
    }

    try {
      setLoading(true);
      const res: any = await invoke("create_owner_initial_cmd", {
        name,
        password,
      });
      setGeneratedKey(res.recovery_key);
      setStep("key");
    } catch (err: any) {
      setError(typeof err === "string" ? err : err?.message || "व्यवस्थापक बनाने में त्रुटि हुई।");
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = async () => {
    try {
      setLoading(true);
      await invoke("skip_security_setup_cmd");
      onComplete();
    } catch (err: any) {
      setError(typeof err === "string" ? err : err?.message || "सुरक्षा छोड़ने में त्रुटि हुई।");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const handlePrint = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html>
        <head>
          <title>Krishi Kendra - Security Recovery Key</title>
          <style>
            body { font-family: monospace; padding: 40px; text-align: center; }
            .box { border: 2px dashed #000; padding: 30px; display: inline-block; margin-top: 20px; }
            .key { font-size: 24px; font-weight: bold; letter-spacing: 2px; color: #b91c1c; margin: 15px 0; }
            .note { color: #555; max-width: 500px; margin: 0 auto; font-size: 14px; }
          </style>
        </head>
        <body>
          <h2>कृषि केंद्र - व्यवस्थापक सुरक्षा रिकवरी कुंजी</h2>
          <h3>Krishi Kendra - Owner Recovery Key</h3>
          <div class="box">
            <div>व्यवस्थापक यूज़र / Owner: <strong>${ownerName}</strong></div>
            <div class="key">${generatedKey}</div>
            <div>तारीख / Date: ${new Date().toLocaleDateString("hi-IN")}</div>
          </div>
          <p class="note">
            यह कुंजी केवल एक बार दिखाई जाती है। यदि आप अपना पासवर्ड भूल जाते हैं, तो केवल इस कुंजी द्वारा रीसेट किया जा सकता है। इसे किसी सुरक्षित स्थान पर रखें।
          </p>
          <script>window.print();</script>
        </body>
      </html>
    `);
    win.document.close();
  };

  return (
    <div
      data-testid="initial-setup-wizard-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-emerald-100 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-700 to-teal-800 text-white p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-white/10 rounded-xl">
              <ShieldCheck className="w-8 h-8 text-emerald-300" />
            </div>
            <div>
              <h2 className="text-xl font-bold">सुरक्षा सेटअप / Security Setup</h2>
              <p className="text-xs text-emerald-100">कृषि केंद्र इन्वेंटरी सुरक्षा प्रबंधन</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3.5 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div>{error}</div>
          </div>
        )}

        {step === "form" ? (
          <form onSubmit={handleCreateOwner} className="p-6 space-y-4">
            <p className="text-sm text-slate-600 leading-relaxed">
              ऐप को सुरक्षित रखने के लिए व्यवस्थापक (Owner) खाता बनाएं। आप बाद में सेटिंग्स से अन्य कर्मचारियों (Staff) को जोड़ सकते हैं।
            </p>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                व्यवस्थापक का नाम / Owner Name <span className="text-red-500">*</span>
              </label>
              <input
                data-testid="setup-owner-name-input"
                type="text"
                required
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="उदा. राजेश शर्मा"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                पासवर्ड / Password (कम से कम 6 अक्षर) <span className="text-red-500">*</span>
              </label>
              <input
                data-testid="setup-password-input"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                पासवर्ड दोबारा दर्ज करें / Confirm Password <span className="text-red-500">*</span>
              </label>
              <input
                data-testid="setup-confirm-password-input"
                type="password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
              />
            </div>

            <div className="pt-4 flex items-center justify-between gap-3 border-t border-slate-100">
              <button
                type="button"
                data-testid="setup-skip-btn"
                onClick={handleSkip}
                disabled={loading}
                className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition"
              >
                बाद में करें / Skip for now
              </button>

              <button
                type="submit"
                data-testid="setup-create-owner-btn"
                disabled={loading}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl shadow-sm transition disabled:opacity-50 text-sm"
              >
                {loading ? "बनाया जा रहा है..." : "खाता बनाएं / Create Owner"}
              </button>
            </div>
          </form>
        ) : (
          <div className="p-6 space-y-5">
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 space-y-1">
              <div className="font-semibold flex items-center gap-2 text-amber-900">
                <Key className="w-4 h-4 text-amber-600" />
                आपकी रिकवरी कुंजी / Master Recovery Key
              </div>
              <p className="text-xs text-amber-700">
                यह कुंजी केवल एक बार दिखाई जा रही है! यदि आप पासवर्ड भूल जाते हैं, तो केवल इसके जरिए खाता पुनः प्राप्त होगा।
              </p>
            </div>

            <div className="p-4 bg-slate-900 text-emerald-400 font-mono text-center text-lg rounded-xl tracking-wider select-all border border-slate-700 flex items-center justify-center gap-2">
              <span data-testid="generated-recovery-key-text">{generatedKey}</span>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                data-testid="copy-recovery-key-btn"
                onClick={handleCopy}
                className="flex-1 py-2 px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium flex items-center justify-center gap-2 transition"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                {copied ? "कॉपी हो गया! / Copied" : "कॉपी करें / Copy"}
              </button>

              <button
                type="button"
                data-testid="print-recovery-key-btn"
                onClick={handlePrint}
                className="flex-1 py-2 px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium flex items-center justify-center gap-2 transition"
              >
                <Printer className="w-4 h-4 text-slate-600" />
                प्रिंट करें / Print
              </button>
            </div>

            <label className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer">
              <input
                type="checkbox"
                data-testid="confirm-saved-recovery-key-checkbox"
                checked={confirmedSaved}
                onChange={(e) => setConfirmedSaved(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-xs text-slate-700 leading-snug">
                मैंने यह रिकवरी कुंजी लिख ली है या सुरक्षित स्थान पर सहेज ली है। / I have saved this recovery key safely.
              </span>
            </label>

            <button
              type="button"
              data-testid="finish-setup-btn"
              disabled={!confirmedSaved}
              onClick={onComplete}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl shadow-sm transition disabled:opacity-50 text-sm"
            >
              आगे बढ़ें / Proceed to App
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
