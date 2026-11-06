import React, { useState } from "react";
import { Sparkles, RefreshCw, X, ShieldCheck, Download, AlertTriangle } from "./icons";
import { installUpdate } from "../utils/updaterService";

interface UpdateNotificationModalProps {
  version: string;
  currentVersion?: string;
  notes?: string;
  date?: string;
  onClose: () => void;
  lang?: "hi" | "en";
}

export const UpdateNotificationModal: React.FC<UpdateNotificationModalProps> = ({
  version,
  currentVersion = "v0.1.0",
  notes,
  date,
  onClose,
  lang = "hi",
}) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleStartUpdate = async () => {
    setIsUpdating(true);
    setError(null);
    setProgress(5);
    setStatusText(
      lang === "hi"
        ? "डेटाबेस का सुरक्षा बैकअप लिया जा रहा है..."
        : "Creating safety backup of database..."
    );

    try {
      await installUpdate((pct, msg) => {
        setProgress(pct);
        setStatusText(msg);
      });
    } catch (err: any) {
      console.error("Update install failed:", err);
      setIsUpdating(false);
      setError(
        typeof err === "string" ? err : err?.message || "अपडेट डाउनलोड या इंस्टॉल करने में विफल"
      );
    }
  };

  return (
    <div
      data-testid="update-notification-modal"
      className="fixed inset-0 z-9999 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 select-none animate-in fade-in duration-200"
    >
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200">
        {/* Top Header Card */}
        <div className="bg-gradient-to-r from-teal-800 via-teal-700 to-emerald-800 text-white p-6 relative">
          {!isUpdating && (
            <button
              type="button"
              onClick={onClose}
              className="absolute top-4 right-4 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/90 hover:text-white transition-colors cursor-pointer"
              title="बंद करें (Close)"
            >
              <X size={16} />
            </button>
          )}

          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/15 backdrop-blur-sm border border-white/20 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-6 h-6 text-teal-200" />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-teal-400/20 text-teal-200 border border-teal-300/30">
                QubiStock Update
              </span>
              <h2 className="text-lg font-bold mt-1">
                {lang === "hi" ? "नया अपडेट उपलब्ध है!" : "New Update Available!"}
              </h2>
              {date && (
                <span className="text-[10px] text-teal-200/80 font-mono block mt-0.5">
                  {lang === "hi" ? "तारीख: " : "Date: "} {date}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 mt-4 text-xs font-mono">
            <span className="px-2.5 py-1 rounded-lg bg-black/20 text-white/80">
              {lang === "hi" ? "मौजूदा: " : "Current: "} {currentVersion}
            </span>
            <span className="text-teal-300 font-bold">➔</span>
            <span className="px-2.5 py-1 rounded-lg bg-teal-500/40 text-teal-100 font-bold border border-teal-300/30">
              {lang === "hi" ? "नया: " : "New: "} {version}
            </span>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4">
          {/* Release Notes */}
          {notes && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 text-xs text-slate-700 max-h-36 overflow-y-auto">
              <div className="font-bold text-slate-900 mb-1 flex items-center gap-1.5">
                <span>📋 {lang === "hi" ? "इस अपडेट में क्या नया है:" : "What's new in this release:"}</span>
              </div>
              <div className="whitespace-pre-wrap leading-relaxed text-slate-600 font-mono text-[11px]">
                {notes}
              </div>
            </div>
          )}

          {/* Database Protection Guarantee Box */}
          <div className="bg-emerald-50/80 border border-emerald-300 rounded-2xl p-3 flex items-start gap-2.5 text-emerald-950 text-xs">
            <ShieldCheck className="w-5 h-5 text-emerald-700 flex-shrink-0 mt-0.5" />
            <div className="leading-snug">
              <strong className="font-bold block text-emerald-900">
                {lang === "hi" ? "डेटाबेस सुरक्षा गारंटी" : "100% Database Safety Guarantee"}
              </strong>
              <span className="text-emerald-800/90 text-[11px]">
                {lang === "hi"
                  ? "अपडेट से आपकी इन्वेंटरी, खातों और बिलों को कोई नुकसान नहीं होगा। अपडेट से पहले स्वचालित सुरक्षा बैकअप लिया जाएगा।"
                  : "All your bills, accounts, and inventory data remain 100% intact. An automatic safety backup is taken prior to update."}
              </span>
            </div>
          </div>

          {/* Error Message if any */}
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl text-xs text-rose-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Download Progress Bar */}
          {isUpdating ? (
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                <span className="flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-teal-600" />
                  <span>{statusText}</span>
                </span>
                <span className="font-mono font-bold text-teal-700">{progress}%</span>
              </div>
              <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                <div
                  className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-[11px] text-slate-500 text-center italic">
                {lang === "hi"
                  ? "कृपया ऐप बंद न करें, अपडेट पूरा होते ही ऐप स्वतः पुनः प्रारंभ होगा..."
                  : "Please do not close the app; it will restart automatically upon completion..."}
              </p>
            </div>
          ) : (
            /* Action Buttons */
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs transition-colors cursor-pointer"
              >
                {lang === "hi" ? "बाद में याद दिलाएं" : "Remind Me Later"}
              </button>
              <button
                type="button"
                data-testid="start-update-btn"
                onClick={handleStartUpdate}
                className="flex-1 py-2.5 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
              >
                <Download size={15} />
                <span>{lang === "hi" ? "अभी अपडेट करें" : "Update Now"}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
