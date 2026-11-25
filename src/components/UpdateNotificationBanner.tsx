import React, { useState, useRef, useEffect } from "react";
import {
  Sparkles,
  RefreshCw,
  X,
  ShieldCheck,
  Download,
  AlertTriangle,
  Clock,
  ChevronDown,
  Check,
  FileText,
} from "./icons";
import { installUpdate } from "../utils/updaterService";
import { setUpdateSnooze } from "../utils/updateScheduler";

export interface UpdateNotificationBannerProps {
  version: string;
  currentVersion?: string;
  notes?: string;
  date?: string;
  onClose: () => void;
  onSnoozed?: (minutes: number) => void;
  lang?: "hi" | "en";
}

export const UpdateNotificationBanner: React.FC<UpdateNotificationBannerProps> = ({
  version,
  currentVersion = "v0.1.3",
  notes,
  date,
  onClose,
  onSnoozed,
  lang = "hi",
}) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showScheduleMenu, setShowScheduleMenu] = useState(false);
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowScheduleMenu(false);
      }
    }
    if (showScheduleMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showScheduleMenu]);

  const handleStartUpdate = async () => {
    setIsUpdating(true);
    setError(null);
    setProgress(5);
    setStatusText(
      lang === "hi"
        ? "डेटाबेस का सुरक्षा बैकअप लिया जा रहा है... (Creating safety backup)"
        : "Creating database safety backup..."
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

  const handleSchedule = (minutes: number) => {
    setShowScheduleMenu(false);
    setUpdateSnooze(minutes);
    if (onSnoozed) {
      onSnoozed(minutes);
    }
    onClose();
  };

  const scheduleOptions = [
    { minutes: 15, hi: "15 मिनट बाद", en: "In 15 minutes" },
    { minutes: 30, hi: "30 मिनट बाद", en: "In 30 minutes" },
    { minutes: 60, hi: "1 घंटा बाद", en: "In 1 hour" },
    { minutes: 120, hi: "2 घंटे बाद", en: "In 2 hours" },
    { minutes: -1, hi: "ऐप बंद करते समय (Next Exit)", en: "On Next App Exit" },
  ];

  return (
    <>
      {/* Top Floating Notification Banner */}
      <div
        data-testid="update-notification-banner"
        className="fixed top-3 left-1/2 -translate-x-1/2 z-[9990] w-[95%] max-w-5xl bg-gradient-to-r from-slate-900 via-teal-950 to-emerald-950 text-white rounded-2xl shadow-2xl border border-teal-500/30 p-3.5 sm:p-4 backdrop-blur-md select-none animate-in fade-in slide-in-from-top-4 duration-300"
      >
        {isUpdating ? (
          /* Updating Progress State */
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs sm:text-sm font-semibold">
              <span className="flex items-center gap-2 text-teal-200">
                <RefreshCw className="w-4 h-4 animate-spin text-teal-400" />
                <span>{statusText}</span>
              </span>
              <span className="font-mono font-bold text-teal-300">{progress}%</span>
            </div>
            <div className="w-full h-2.5 bg-black/40 rounded-full overflow-hidden border border-teal-500/20">
              <div
                className="h-full bg-gradient-to-r from-teal-400 to-emerald-400 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-[11px] text-teal-200/70 text-center italic">
              {lang === "hi"
                ? "सुरक्षित बैकअप व अपडेट जारी है, कृपया ऐप बंद न करें..."
                : "Safe backup & update in progress, please do not close the app..."}
            </p>
          </div>
        ) : (
          /* Normal Banner Content */
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 sm:gap-4">
            {/* Left: Icon, Version & Assurance Info */}
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-teal-500/20 border border-teal-400/30 flex items-center justify-center flex-shrink-0 text-teal-300">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-300 border border-teal-400/30">
                    QubiStock {version}
                  </span>
                  <span className="text-xs sm:text-sm font-bold text-white">
                    {lang === "hi"
                      ? "नया अपडेट तैयार है!"
                      : "New Software Update Available!"}
                  </span>
                  {currentVersion && (
                    <span className="text-[10px] text-slate-400 font-mono">
                      ({currentVersion} ➔ {version})
                    </span>
                  )}
                </div>

                {/* Database Safety Assurance line in Hindi and English */}
                <div className="flex items-center gap-1.5 mt-1 text-[11px] text-emerald-300 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                  <span>
                    <strong>100% डेटाबेस सुरक्षा:</strong> आपका कोई भी पुराना बिल, खाता या स्टॉक डेटा नहीं बदलेगा।
                  </span>
                  <span className="text-slate-400 hidden lg:inline">
                    (Zero data loss guarantee • All bills & ledgers stay 100% safe)
                  </span>
                </div>
              </div>
            </div>

            {/* Right: Action Buttons & Dismiss */}
            <div className="flex items-center gap-2 self-end md:self-center flex-wrap">
              {/* Check What's New */}
              <button
                type="button"
                data-testid="whats-new-btn"
                onClick={() => setShowWhatsNew(true)}
                className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border border-white/15"
                title="नया क्या है देखें (View release notes)"
              >
                <FileText className="w-3.5 h-3.5 text-teal-300" />
                <span>{lang === "hi" ? "नया क्या है?" : "What's New"}</span>
              </button>

              {/* Update Later Dropdown Scheduler */}
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  data-testid="update-later-btn"
                  onClick={() => setShowScheduleMenu(!showScheduleMenu)}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border border-slate-600/50"
                >
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  <span>{lang === "hi" ? "बाद में याद दिलाएं" : "Update Later"}</span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </button>

                {showScheduleMenu && (
                  <div
                    data-testid="schedule-dropdown-menu"
                    className="absolute right-0 bottom-full mb-2 sm:bottom-auto sm:top-full sm:mt-2 w-56 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-1.5 z-[9999] animate-in fade-in zoom-in-95"
                  >
                    <div className="px-2.5 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                      ⏰ {lang === "hi" ? "कब याद दिलाएँ?" : "Remind Me When?"}
                    </div>
                    {scheduleOptions.map((opt) => (
                      <button
                        key={opt.minutes}
                        type="button"
                        data-testid={`schedule-opt-${opt.minutes}`}
                        onClick={() => handleSchedule(opt.minutes)}
                        className="w-full text-left px-2.5 py-2 rounded-lg text-xs hover:bg-teal-900/40 text-slate-200 hover:text-teal-200 flex items-center justify-between transition-colors cursor-pointer"
                      >
                        <span>{lang === "hi" ? opt.hi : opt.en}</span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {lang === "hi" ? opt.en : opt.hi}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Primary Update Now Button */}
              <button
                type="button"
                data-testid="banner-update-now-btn"
                onClick={handleStartUpdate}
                className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-950/50 transition-all hover:scale-105 active:scale-95 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{lang === "hi" ? "अभी अपडेट करें" : "Update Now"}</span>
              </button>

              {/* Close / Dismiss Cross Button */}
              <button
                type="button"
                data-testid="banner-close-btn"
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="हटाएं (Dismiss)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Error message if any */}
        {error && (
          <div className="mt-2.5 p-2 rounded-lg bg-rose-950/80 border border-rose-500/40 text-rose-200 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* What's New & Database Safety Modal */}
      {showWhatsNew && (
        <div
          data-testid="whats-new-modal"
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 select-none animate-in fade-in duration-200"
        >
          <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 text-slate-900">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-teal-800 via-teal-700 to-emerald-800 text-white p-5 relative">
              <button
                type="button"
                data-testid="whats-new-close-btn"
                onClick={() => setShowWhatsNew(false)}
                className="absolute top-4 right-4 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/90 hover:text-white transition-colors cursor-pointer"
                title="बंद करें"
              >
                <X size={16} />
              </button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-teal-200" />
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-teal-400/20 text-teal-200 border border-teal-300/30">
                    QubiStock {version}
                  </span>
                  <h2 className="text-base font-bold mt-0.5">
                    {lang === "hi"
                      ? "इस अपडेट में नया क्या है?"
                      : "What's New in this Update?"}
                  </h2>
                  {date && (
                    <span className="text-[10px] text-teal-200/80 font-mono block mt-0.5">
                      {lang === "hi" ? "तारीख: " : "Date: "} {date}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Prominent Database & Ledger Safety Guarantee Card in Hindi & English */}
              <div className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-4 text-emerald-950">
                <div className="flex items-center gap-2 mb-2">
                  <ShieldCheck className="w-6 h-6 text-emerald-700 flex-shrink-0" />
                  <div>
                    <h3 className="font-bold text-sm text-emerald-900">
                      🛡️ 100% डेटाबेस व बही-खाता सुरक्षा गारंटी
                    </h3>
                    <p className="text-[11px] text-emerald-800 font-medium">
                      Zero Data Loss Guarantee • Complete Business Continuity
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs text-emerald-900/90 pl-1">
                  <div className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                    <span>
                      <strong>पुराने बिल व खाते सुरक्षित:</strong> आपके किसी भी बिल, उधारी खाते या स्टॉक डेटा को कोई नुकसान नहीं होगा।
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                    <span>
                      <strong>स्वचालित सुरक्षा बैकअप:</strong> अपडेट शुरू होने से पहले सिस्टम आपके डेटाबेस का पूर्ण एन्क्रिप्टेड बैकअप लेता है।
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                    <span>
                      <strong>सुझाव:</strong> नई जीएसटी दरों, प्रिंटिंग स्पीड और सुरक्षा बग फिक्स के लिए अपडेट करना आवश्यक है।
                    </span>
                  </div>
                </div>
              </div>

              {/* Release Notes */}
              {notes && (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs text-slate-700">
                  <div className="font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-teal-700" />
                    <span>{lang === "hi" ? "रिलीज़ विवरण / Changelog:" : "Release Details:"}</span>
                  </div>
                  <div className="whitespace-pre-wrap leading-relaxed text-slate-600 font-mono text-[11px] max-h-36 overflow-y-auto">
                    {notes}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowWhatsNew(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs transition-colors cursor-pointer"
              >
                {lang === "hi" ? "वापस जाएं (Back)" : "Back"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowWhatsNew(false);
                  handleStartUpdate();
                }}
                className="px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all hover:scale-102 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{lang === "hi" ? "अभी सुरक्षित अपडेट करें" : "Update Safely Now"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
