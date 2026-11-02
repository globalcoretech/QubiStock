import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Lock, Unlock, LogOut, AlertTriangle, Shield, User } from "lucide-react";
import { SessionUser } from "../types";

interface LockScreenOverlayProps {
  currentUser: SessionUser;
  hasUnsavedWork?: boolean;
  onUnlocked: () => void;
  onSwitchUser: () => void;
}

export const LockScreenOverlay: React.FC<LockScreenOverlayProps> = ({
  currentUser,
  hasUnsavedWork = false,
  onUnlocked,
  onSwitchUser,
}) => {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSwitchConfirm, setShowSwitchConfirm] = useState(false);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!password) {
      setError("कृपया पासवर्ड दर्ज करें। / Please enter password.");
      return;
    }

    try {
      setLoading(true);
      await invoke("unlock_session_cmd", { password });
      setPassword("");
      onUnlocked();
    } catch (err: any) {
      setError(typeof err === "string" ? err : err?.message || "गलत पासवर्ड / Incorrect password");
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchUserClick = () => {
    if (hasUnsavedWork) {
      setShowSwitchConfirm(true);
    } else {
      executeSwitchUser();
    }
  };

  const executeSwitchUser = async () => {
    try {
      await invoke("logout_cmd");
      onSwitchUser();
    } catch (err) {
      console.error("Logout error during switch user", err);
      onSwitchUser();
    }
  };

  return (
    <div
      data-testid="lock-screen-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 animate-in fade-in duration-200"
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden border border-slate-700/30">
        {/* Top Header */}
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-6 text-center border-b border-slate-700">
          <div className="w-16 h-16 mx-auto mb-3 bg-emerald-500/20 rounded-full flex items-center justify-center border border-emerald-400/40">
            <Lock className="w-8 h-8 text-emerald-400" />
          </div>

          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-white/10 text-emerald-300 mb-2">
            <Shield className="w-3.5 h-3.5" />
            {currentUser.role === "owner" ? "व्यवस्थापक / Owner" : "कर्मचारी / Staff"}
          </div>

          <h2 data-testid="lock-screen-user-name" className="text-xl font-bold flex items-center justify-center gap-1.5">
            <User className="w-5 h-5 text-slate-400" />
            {currentUser.name}
          </h2>
          <p className="text-xs text-slate-400 mt-1">सत्र लॉक है / Session is locked</p>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Unlock Form */}
        <form onSubmit={handleUnlock} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
              अनलॉक पासवर्ड / Enter Password
            </label>
            <input
              data-testid="lock-screen-password-input"
              type="password"
              autoFocus
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
            />
          </div>

          <button
            type="submit"
            data-testid="lock-screen-unlock-btn"
            disabled={loading}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl shadow-sm transition disabled:opacity-50 text-sm flex items-center justify-center gap-2"
          >
            <Unlock className="w-4 h-4" />
            {loading ? "खोल रहे हैं..." : "अनलॉक करें / Unlock"}
          </button>

          <div className="pt-2 border-t border-slate-100">
            <button
              type="button"
              data-testid="lock-screen-switch-user-btn"
              onClick={handleSwitchUserClick}
              className="w-full py-2 px-3 text-slate-600 hover:text-slate-900 hover:bg-slate-50 text-xs font-medium rounded-lg transition flex items-center justify-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5 text-slate-400" />
              यूज़र बदलें (लॉगआउट) / Switch User (Logout)
            </button>
          </div>
        </form>
      </div>

      {/* Unsaved Work Warning Dialog */}
      {showSwitchConfirm && (
        <div
          data-testid="unsaved-switch-warning-modal"
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5 space-y-4 border border-amber-200">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-amber-100 rounded-xl text-amber-600 shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">
                  असुरक्षित डेटा की चेतावनी / Unsaved Work Warning
                </h3>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  स्क्रीन पर अधूरा बिल या फॉर्म खुला हुआ है। यूज़र बदलने पर यह डेटा हट सकता है। क्या आप वाकई लॉगआउट करना चाहते हैं?
                </p>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSwitchConfirm(false)}
                className="flex-1 py-2 text-xs font-medium border border-slate-300 rounded-xl text-slate-700 hover:bg-slate-50"
              >
                रद्द करें / Cancel
              </button>
              <button
                type="button"
                data-testid="confirm-switch-user-btn"
                onClick={() => {
                  setShowSwitchConfirm(false);
                  executeSwitchUser();
                }}
                className="flex-1 py-2 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-xl shadow-sm"
              >
                हाँ, लॉगआउट करें / Yes, Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
