import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  User,
  AlertTriangle,
  Copy,
  Check,
  Printer,
  Shield,
  Eye,
  EyeOff,
  Lock,
  LogOut,
  Sparkles,
  ArrowRight,
} from "./icons";
import { SessionUser, UserInfo } from "../types";
import qubiLogo from "../assets/qubistock_logo.png";

interface LoginModalProps {
  onLoginSuccess: (user: SessionUser) => void;
  onExitApp?: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ onLoginSuccess, onExitApp }) => {
  const [users, setUsers] = useState<UserInfo[]>([]);

  // Saved / remembered usernames in localStorage
  const [savedUsernames, setSavedUsernames] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("krishi_remembered_users");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            return parsed.filter((u: any) => typeof u === "string" && u.trim().length > 0);
          }
        }
      } catch {}
      const last = localStorage.getItem("krishi_last_username");
      if (last) return [last];
    }
    return [];
  });

  const [selectedUser, setSelectedUser] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const last = localStorage.getItem("krishi_last_username");
      if (last) return last;
      try {
        const stored = localStorage.getItem("krishi_remembered_users");
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed[0];
        }
      } catch {}
    }
    return "";
  });

  const [isManualInput, setIsManualInput] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Forgot password with recovery key state
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotSuccessNewKey, setForgotSuccessNewKey] = useState<string | null>(null);
  const [recoveredOwnerName, setRecoveredOwnerName] = useState<string | null>(null);
  const [copiedNewKey, setCopiedNewKey] = useState(false);
  const [confirmedNewKeySaved, setConfirmedNewKeySaved] = useState(false);

  const fetchUsers = async () => {
    try {
      const allUsers: UserInfo[] = await invoke("get_users_cmd");
      const active = allUsers.filter((u) => u.is_active);
      setUsers(active);
      if (active.length > 0) {
        const activeNames = active.map((u) => u.name);
        setSavedUsernames((prev) => {
          const merged = Array.from(new Set([...activeNames, ...prev]));
          try {
            localStorage.setItem("krishi_remembered_users", JSON.stringify(merged));
          } catch {}
          return merged;
        });
        if (!selectedUser) {
          setSelectedUser(active[0].name);
        }
      }
    } catch {
      // Normal when unauthenticated: fallback to savedUsernames from localStorage
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // Compute available usernames for dropdown
  const availableNames = users.length > 0 ? users.map((u) => u.name) : savedUsernames;

  // If we have available names and no user selected, pre-select the first one
  useEffect(() => {
    if (availableNames.length > 0 && !selectedUser) {
      setSelectedUser(availableNames[0]);
    }
  }, [availableNames, selectedUser]);

  const handleExit = () => {
    if (onExitApp) {
      onExitApp();
    } else {
      invoke("safe_exit_app_cmd").catch(() => {});
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedUser = selectedUser.trim();
    if (!trimmedUser) {
      setError("कृपया यूज़र चुनें या यूज़रनेम दर्ज करें। / Please select a user or enter username.");
      return;
    }
    if (!password) {
      setError("कृपया पासवर्ड दर्ज करें। / Please enter password.");
      return;
    }

    try {
      setLoading(true);
      const user: SessionUser = await invoke("login_cmd", {
        name: trimmedUser,
        password,
      });

      // Save to remembered users
      try {
        localStorage.setItem("krishi_last_username", user.name);
        const existing = savedUsernames.filter((n) => n !== user.name);
        const updated = [user.name, ...existing];
        localStorage.setItem("krishi_remembered_users", JSON.stringify(updated));
        setSavedUsernames(updated);
      } catch {}

      onLoginSuccess(user);
    } catch (err: any) {
      setError(typeof err === "string" ? err : err?.message || "लॉगिन विफल रहा।");
      fetchUsers(); // Refresh lockout status if any
    } finally {
      setLoading(false);
    }
  };

  const handleResetWithRecoveryKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError(null);

    const key = recoveryKey.trim();
    if (!key) {
      setForgotError("कृपया रिकवरी कुंजी दर्ज करें। / Please enter recovery key.");
      return;
    }
    if (newPassword.length < 6) {
      setForgotError("नया पासवर्ड कम से कम 6 अक्षरों का होना चाहिए। / Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setForgotError("पासवर्ड मेल नहीं खाते। / Passwords do not match.");
      return;
    }

    try {
      setLoading(true);
      const res: any = await invoke("reset_owner_with_recovery_key_cmd", {
        recoveryKey: key,
        newPassword,
      });

      const generatedNewKey = typeof res === "string" ? res : (res?.new_recovery_key || "");
      const ownerName = typeof res === "object" ? (res?.owner_name || "") : "";

      setForgotSuccessNewKey(generatedNewKey);

      if (ownerName) {
        setRecoveredOwnerName(ownerName);
        setSelectedUser(ownerName);
        setIsManualInput(false);
        try {
          localStorage.setItem("krishi_last_username", ownerName);
          const existing = savedUsernames.filter((n) => n !== ownerName);
          const updated = [ownerName, ...existing];
          localStorage.setItem("krishi_remembered_users", JSON.stringify(updated));
          setSavedUsernames(updated);
        } catch {}
      }
    } catch (err: any) {
      setForgotError(typeof err === "string" ? err : err?.message || "पासवर्ड रीसेट करने में त्रुटि।");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyNewKey = () => {
    if (forgotSuccessNewKey) {
      navigator.clipboard.writeText(forgotSuccessNewKey);
      setCopiedNewKey(true);
      setTimeout(() => setCopiedNewKey(false), 3000);
    }
  };

  const handlePrintNewKey = () => {
    if (!forgotSuccessNewKey) return;
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html>
        <head>
          <title>QubiStock - New Security Recovery Key</title>
          <style>
            body { font-family: monospace; padding: 40px; text-align: center; }
            .box { border: 2px dashed #059669; padding: 20px; margin: 20px auto; max-width: 450px; border-radius: 8px; background: #ecfdf5; }
            .key { font-size: 22px; font-weight: bold; letter-spacing: 2px; color: #065f46; margin: 10px 0; }
            .user { font-size: 16px; font-weight: bold; color: #1e293b; margin-bottom: 10px; }
            .warn { color: #dc2626; font-size: 13px; margin-top: 15px; }
          </style>
        </head>
        <body>
          <h2>QubiStock - नई व्यवस्थापक सुरक्षा रिकवरी कुंजी</h2>
          <h3>Owner Security Recovery Key</h3>
          <div class="box">
            ${recoveredOwnerName ? `<div class="user">व्यवस्थापक यूज़रनेम / Owner: <strong>${recoveredOwnerName}</strong></div>` : ""}
            <div class="key">${forgotSuccessNewKey}</div>
            <p>तारीख / Date: ${new Date().toLocaleDateString("hi-IN")}</p>
          </div>
          <p class="warn">⚠️ इस कुंजी को सुरक्षित रखें। पासवर्ड भूलने पर इसके बिना व्यवस्थापक खाता पुनः प्राप्त नहीं होगा।</p>
          <script>window.print(); window.close();</script>
        </body>
      </html>
    `);
    win.document.close();
  };

  return (
    <div
      data-testid="login-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-md p-4 select-none animate-in fade-in duration-200"
    >
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full overflow-hidden border border-slate-200/90 flex flex-col md:flex-row relative">
        
        {/* Left Side: Brand Identity & Feature Highlights */}
        <div className="md:w-5/12 bg-gradient-to-br from-emerald-900 via-teal-900 to-slate-900 text-white p-6 sm:p-8 flex flex-col justify-between relative overflow-hidden">
          {/* Subtle decorative glow */}
          <div className="absolute -top-16 -left-16 w-44 h-44 rounded-full bg-emerald-500/15 blur-2xl pointer-events-none" />
          <div className="absolute -bottom-16 -right-16 w-44 h-44 rounded-full bg-teal-400/15 blur-2xl pointer-events-none" />

          <div className="relative z-10">
            {/* Logo Badge */}
            <div className="bg-white/95 py-2.5 px-4 rounded-2xl shadow-sm inline-block mb-5">
              <img src={qubiLogo} alt="QubiStock" className="h-9 w-auto object-contain" />
            </div>

            <h1 className="text-xl font-extrabold tracking-tight text-white mb-1">
              QubiStock
            </h1>
            <p className="text-xs text-emerald-200/90 font-medium leading-relaxed">
              स्मार्ट इन्वेंटरी एवं बिलिंग समाधान
            </p>

            {/* Feature Pills */}
            <div className="mt-6 space-y-3">
              <div className="flex items-center gap-2.5 text-xs text-slate-200 bg-white/10 px-3 py-2 rounded-xl backdrop-blur-xs border border-white/5">
                <Sparkles size={15} className="text-emerald-300 shrink-0" />
                <span>तेज़ बिलिंग और सटीक स्टॉक</span>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-slate-200 bg-white/10 px-3 py-2 rounded-xl backdrop-blur-xs border border-white/5">
                <Shield size={15} className="text-teal-300 shrink-0" />
                <span>100% स्थानीय ऑफ़लाइन डेटा सुरक्षा</span>
              </div>
              <div className="flex items-center gap-2.5 text-xs text-slate-200 bg-white/10 px-3 py-2 rounded-xl backdrop-blur-xs border border-white/5">
                <Lock size={15} className="text-amber-300 shrink-0" />
                <span>Argon2 एन्क्रिप्शन व सुरक्षित सत्र</span>
              </div>
            </div>
          </div>

          {/* Bottom Version Tag */}
          <div className="relative z-10 pt-6 mt-6 border-t border-white/10 flex items-center justify-between text-[11px] text-emerald-300/80">
            <span>ऑफ़लाइन सुरक्षित</span>
            <span className="font-mono bg-emerald-950/60 px-2 py-0.5 rounded-md border border-emerald-500/20">
              v0.1.0
            </span>
          </div>
        </div>

        {/* Right Side: Simple & Focused Login Form */}
        <div className="md:w-7/12 p-6 sm:p-8 flex flex-col justify-between bg-white relative">
          
          {/* Top Bar with Clean Exit App Button */}
          <div className="flex items-center justify-between pb-3 mb-2 border-b border-slate-100">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg">
              <Lock size={13} className="text-emerald-600" />
              <span>सुरक्षित लॉगिन / Secure Login</span>
            </div>

            <button
              type="button"
              data-testid="login-exit-app-btn"
              onClick={handleExit}
              title="ऐप बंद करें / Exit Application"
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-rose-600 hover:bg-rose-50 px-2.5 py-1 rounded-lg transition-colors cursor-pointer group"
            >
              <LogOut size={14} className="group-hover:translate-x-0.5 transition-transform" />
              <span className="font-medium">ऐप बंद करें (Exit)</span>
            </button>
          </div>

          <div>
            <div className="mb-5">
              <h2 className="text-lg font-bold text-slate-900">कृषि केंद्र लॉगिन / Login</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                प्रवेश करने के लिए अपना यूज़र चुनें और पासवर्ड दर्ज करें
              </p>
            </div>

            {error && (
              <div className="mb-4 p-3.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-start gap-2.5 animate-in fade-in">
                <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <div className="leading-snug">{error}</div>
              </div>
            )}

            {/* Login Form */}
            <form onSubmit={handleLogin} className="space-y-4">
              {/* User Selection */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
                    यूज़र चुनें / Select User
                  </label>
                  {availableNames.length > 0 && (
                    <button
                      type="button"
                      data-testid="toggle-manual-username-btn"
                      onClick={() => {
                        const next = !isManualInput;
                        setIsManualInput(next);
                        if (!next && availableNames.length > 0 && !selectedUser) {
                          setSelectedUser(availableNames[0]);
                        }
                      }}
                      className="text-xs text-emerald-700 hover:text-emerald-800 font-semibold cursor-pointer hover:underline"
                    >
                      {isManualInput ? "सहेजे गए यूज़र चुनें" : "अन्य नाम टाइप करें"}
                    </button>
                  )}
                </div>

                <div className="relative">
                  {!isManualInput && availableNames.length > 0 ? (
                    <div className="relative">
                      <select
                        data-testid="login-user-select"
                        value={selectedUser}
                        onChange={(e) => {
                          if (e.target.value === "__MANUAL__") {
                            setIsManualInput(true);
                            setSelectedUser("");
                          } else {
                            setSelectedUser(e.target.value);
                          }
                        }}
                        className="w-full pl-10 pr-8 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm bg-white cursor-pointer shadow-2xs font-medium text-slate-800 transition"
                      >
                        {availableNames.map((name) => {
                          const uObj = users.find((u) => u.name === name);
                          const roleText = uObj
                            ? uObj.role === "owner"
                              ? "व्यवस्थापक / Owner"
                              : "कर्मचारी / Staff"
                            : "सहेजा गया यूज़र / Saved";
                          return (
                            <option key={name} value={name}>
                              {name} ({roleText})
                            </option>
                          );
                        })}
                      </select>
                      <User className="w-4 h-4 text-emerald-600 absolute left-3.5 top-3 pointer-events-none" />
                    </div>
                  ) : (
                    <div className="relative">
                      <input
                        data-testid="login-user-select"
                        type="text"
                        required
                        value={selectedUser}
                        onChange={(e) => setSelectedUser(e.target.value)}
                        placeholder="यूज़रनेम दर्ज करें / Username"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm bg-white shadow-2xs font-medium text-slate-800 transition"
                      />
                      <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none" />
                    </div>
                  )}
                </div>
              </div>

              {/* Password */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                    पासवर्ड / Password
                  </label>
                  <button
                    type="button"
                    data-testid="forgot-password-link-btn"
                    onClick={() => {
                      setShowForgotModal(true);
                      setForgotError(null);
                      setForgotSuccessNewKey(null);
                      setRecoveredOwnerName(null);
                      setConfirmedNewKeySaved(false);
                    }}
                    className="text-xs text-emerald-700 hover:text-emerald-800 hover:underline font-semibold cursor-pointer"
                  >
                    पासवर्ड भूल गए? / Forgot?
                  </button>
                </div>
                <div className="relative">
                  <input
                    data-testid="login-password-input"
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm text-slate-800 transition shadow-2xs"
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none" />
                  <button
                    type="button"
                    onClick={() => setShowPassword((p) => !p)}
                    tabIndex={-1}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer p-0.5 rounded"
                    title={showPassword ? "पासवर्ड छुपाएं" : "पासवर्ड देखें"}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                data-testid="login-submit-btn"
                disabled={loading}
                className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white font-semibold rounded-xl shadow-md transition disabled:opacity-50 text-sm flex items-center justify-center gap-2 pt-3 cursor-pointer group"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>सत्यापन हो रहा है...</span>
                  </>
                ) : (
                  <>
                    <span>लॉगिन करें / Login</span>
                    <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Footer note */}
          <div className="pt-4 mt-2 text-center border-t border-slate-100">
            <p className="text-[11px] text-slate-400">
              💡 शॉर्टकट: विवरण भरें और सीधे <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-slate-600 font-mono text-[10px]">Enter</kbd> दबाएं
            </p>
          </div>
        </div>
      </div>

      {/* Forgot Password Recovery Modal */}
      {showForgotModal && (
        <div
          data-testid="forgot-password-modal"
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in"
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200">
            <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold">व्यवस्थापक खाता रिकवरी</h3>
                  <p className="text-xs text-slate-400">Owner Account Recovery with Recovery Key</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowForgotModal(false)}
                className="text-slate-400 hover:text-white text-lg font-bold p-1 cursor-pointer"
                title="बंद करें (Close)"
              >
                ✕
              </button>
            </div>

            {forgotError && (
              <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <div>{forgotError}</div>
              </div>
            )}

            {!forgotSuccessNewKey ? (
              <form onSubmit={handleResetWithRecoveryKey} className="p-6 space-y-4">
                <p className="text-xs text-slate-600 leading-relaxed">
                  व्यवस्थापक सेटअप के समय दी गई रिकवरी कुंजी दर्ज करें और अपना नया पासवर्ड सेट करें। इससे आपका यूज़रनेम भी वापस मिल जाएगा।
                </p>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1 uppercase tracking-wide">
                    रिकवरी कुंजी / Recovery Key <span className="text-red-500">*</span>
                  </label>
                  <input
                    data-testid="recovery-key-input"
                    type="text"
                    required
                    value={recoveryKey}
                    onChange={(e) => setRecoveryKey(e.target.value)}
                    placeholder="RK-XXXX-XXXX-XXXX-XXXX"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 font-mono text-sm uppercase focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1 uppercase tracking-wide">
                    नया पासवर्ड / New Password <span className="text-red-500">*</span>
                  </label>
                  <input
                    data-testid="recovery-new-password-input"
                    type="password"
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1 uppercase tracking-wide">
                    पासवर्ड पुष्टि / Confirm Password <span className="text-red-500">*</span>
                  </label>
                  <input
                    data-testid="recovery-confirm-password-input"
                    type="password"
                    required
                    minLength={6}
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowForgotModal(false)}
                    className="flex-1 py-2.5 border border-slate-300 rounded-xl text-slate-700 hover:bg-slate-50 text-sm font-medium cursor-pointer"
                  >
                    रद्द करें / Cancel
                  </button>
                  <button
                    type="submit"
                    data-testid="submit-recovery-reset-btn"
                    disabled={loading}
                    className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium shadow-sm disabled:opacity-50 cursor-pointer"
                  >
                    {loading ? "रीसेट हो रहा है..." : "पासवर्ड बदलें / Reset"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="p-6 space-y-4">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-medium">
                  पासवर्ड सफलतापूर्वक रीसेट हो गया है!
                </div>

                {/* Recovered Owner Username Announcement Box */}
                {recoveredOwnerName && (
                  <div className="p-3.5 bg-emerald-100 border border-emerald-300 rounded-xl space-y-1 text-emerald-950">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                      व्यवस्थापक यूज़रनेम (Owner Username):
                    </div>
                    <div className="text-base font-extrabold text-emerald-900 flex items-center gap-2">
                      <User className="w-4 h-4 text-emerald-700 shrink-0" />
                      <span data-testid="recovered-owner-username-text">{recoveredOwnerName}</span>
                    </div>
                    <div className="text-[11px] text-emerald-700 font-medium">
                      यह यूज़रनेम लॉगिन बॉक्स में अपने आप भर दिया गया है।
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <div className="text-xs font-semibold text-slate-700">यह आपकी नई रिकवरी कुंजी है (New Key):</div>
                  <div className="p-3 bg-slate-900 text-emerald-400 font-mono text-center text-sm rounded-xl tracking-wider select-all border border-slate-700">
                    <span data-testid="new-generated-recovery-key-text">{forgotSuccessNewKey}</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleCopyNewKey}
                    className="flex-1 py-2 px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {copiedNewKey ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedNewKey ? "कॉपी हो गया!" : "कॉपी करें / Copy"}
                  </button>

                  <button
                    type="button"
                    onClick={handlePrintNewKey}
                    className="flex-1 py-2 px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5 text-slate-600" />
                    प्रिंट करें / Print
                  </button>
                </div>

                <label className="flex items-start gap-2.5 p-2.5 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="confirm-new-recovery-key-saved-checkbox"
                    checked={confirmedNewKeySaved}
                    onChange={(e) => setConfirmedNewKeySaved(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="text-xs text-slate-700">
                    मैंने नई रिकवरी कुंजी सुरक्षित रूप से सहेज ली है। / I have saved this new key safely.
                  </span>
                </label>

                <button
                  type="button"
                  data-testid="close-forgot-success-btn"
                  disabled={!confirmedNewKeySaved}
                  onClick={() => {
                    setShowForgotModal(false);
                    setPassword("");
                  }}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl text-sm disabled:opacity-50 cursor-pointer"
                >
                  लॉगिन पर लौटें / Return to Login
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
