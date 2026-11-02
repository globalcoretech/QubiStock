import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Lock, User, AlertTriangle, Copy, Check, Printer, Shield } from "./icons";
import { SessionUser, UserInfo } from "../types";

interface LoginModalProps {
  onLoginSuccess: (user: SessionUser) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ onLoginSuccess }) => {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Forgot password with recovery key state
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotSuccessNewKey, setForgotSuccessNewKey] = useState<string | null>(null);
  const [copiedNewKey, setCopiedNewKey] = useState(false);
  const [confirmedNewKeySaved, setConfirmedNewKeySaved] = useState(false);

  const fetchUsers = async () => {
    try {
      const allUsers: UserInfo[] = await invoke("get_users_cmd");
      const active = allUsers.filter((u) => u.is_active);
      setUsers(active);
      if (active.length > 0 && !selectedUser) {
        setSelectedUser(active[0].name);
      }
    } catch (e) {
      console.error("Failed to fetch users", e);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedUser) {
      setError("कृपया यूज़र चुनें। / Please select a user.");
      return;
    }
    if (!password) {
      setError("कृपया पासवर्ड दर्ज करें। / Please enter password.");
      return;
    }

    try {
      setLoading(true);
      const user: SessionUser = await invoke("login_cmd", {
        name: selectedUser,
        password,
      });
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
      const generatedNewKey: string = await invoke("reset_owner_with_recovery_key_cmd", {
        recoveryKey: key,
        newPassword,
      });
      setForgotSuccessNewKey(generatedNewKey);
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
          <title>Krishi Kendra - New Security Recovery Key</title>
          <style>
            body { font-family: monospace; padding: 40px; text-align: center; }
            .box { border: 2px dashed #000; padding: 30px; display: inline-block; margin-top: 20px; }
            .key { font-size: 24px; font-weight: bold; letter-spacing: 2px; color: #b91c1c; margin: 15px 0; }
            .note { color: #555; max-width: 500px; margin: 0 auto; font-size: 14px; }
          </style>
        </head>
        <body>
          <h2>कृषि केंद्र - नई व्यवस्थापक सुरक्षा रिकवरी कुंजी</h2>
          <h3>Krishi Kendra - New Owner Recovery Key</h3>
          <div class="box">
            <div class="key">${forgotSuccessNewKey}</div>
            <div>तारीख / Date: ${new Date().toLocaleDateString("hi-IN")}</div>
          </div>
          <p class="note">
            पुरानी रिकवरी कुंजी अमान्य हो गई है। यह आपकी नई रिकवरी कुंजी है। इसे सुरक्षित रखें।
          </p>
          <script>window.print();</script>
        </body>
      </html>
    `);
    win.document.close();
  };

  return (
    <div
      data-testid="login-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-800 to-teal-900 text-white p-6 text-center">
          <div className="w-14 h-14 mx-auto mb-3 bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur-sm border border-white/20">
            <Lock className="w-7 h-7 text-emerald-300" />
          </div>
          <h2 className="text-xl font-bold">कृषि केंद्र लॉगिन / Login</h2>
          <p className="text-xs text-emerald-200 mt-1">सुरक्षित इन्वेंटरी प्रबंधन प्रणाली</p>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3.5 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div>{error}</div>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleLogin} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              यूज़र चुनें / Select User
            </label>
            <div className="relative">
              <select
                data-testid="login-user-select"
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm bg-white appearance-none pr-10"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.name}>
                    {u.name} ({u.role === "owner" ? "व्यवस्थापक / Owner" : "कर्मचारी / Staff"})
                  </option>
                ))}
              </select>
              <User className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-slate-700">
                पासवर्ड / Password
              </label>
              <button
                type="button"
                data-testid="forgot-password-link-btn"
                onClick={() => {
                  setShowForgotModal(true);
                  setForgotError(null);
                  setForgotSuccessNewKey(null);
                  setConfirmedNewKeySaved(false);
                }}
                className="text-xs text-emerald-700 hover:text-emerald-800 hover:underline"
              >
                पासवर्ड भूल गए? / Forgot?
              </button>
            </div>
            <input
              data-testid="login-password-input"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
            />
          </div>

          <button
            type="submit"
            data-testid="login-submit-btn"
            disabled={loading}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl shadow-sm transition disabled:opacity-50 text-sm flex items-center justify-center gap-2 mt-2"
          >
            {loading ? "सत्यापन हो रहा है..." : "लॉगिन करें / Login"}
          </button>
        </form>
      </div>

      {/* Forgot Password Recovery Modal */}
      {showForgotModal && (
        <div
          data-testid="forgot-password-modal"
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto"
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200">
            <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Shield className="w-6 h-6 text-amber-400" />
                <h3 className="font-bold text-base">रिकवरी कुंजी से रीसेट / Reset Password</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowForgotModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            {forgotError && (
              <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs">
                {forgotError}
              </div>
            )}

            {!forgotSuccessNewKey ? (
              <form onSubmit={handleResetWithRecoveryKey} className="p-6 space-y-4">
                <p className="text-xs text-slate-600 leading-relaxed">
                  व्यवस्थापक सेटअप के समय दी गई रिकवरी कुंजी दर्ज करें। रीसेट होने पर एक नई कुंजी जारी होगी।
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
                    नया पासवर्ड / New Password (कम से कम 6 अक्षर) <span className="text-red-500">*</span>
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
                    className="flex-1 py-2.5 border border-slate-300 rounded-xl text-slate-700 hover:bg-slate-50 text-sm font-medium"
                  >
                    रद्द करें / Cancel
                  </button>
                  <button
                    type="submit"
                    data-testid="submit-recovery-reset-btn"
                    disabled={loading}
                    className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium shadow-sm disabled:opacity-50"
                  >
                    {loading ? "रीसेट हो रहा है..." : "पासवर्ड बदलें / Reset"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="p-6 space-y-4">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800">
                  पासवर्ड सफलतापूर्वक रीसेट हो गया है! यह आपकी <strong>नई रिकवरी कुंजी</strong> है:
                </div>

                <div className="p-3 bg-slate-900 text-emerald-400 font-mono text-center text-sm rounded-xl tracking-wider select-all border border-slate-700">
                  <span data-testid="new-generated-recovery-key-text">{forgotSuccessNewKey}</span>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleCopyNewKey}
                    className="flex-1 py-2 px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium flex items-center justify-center gap-1.5"
                  >
                    {copiedNewKey ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedNewKey ? "कॉपी हो गया!" : "कॉपी करें / Copy"}
                  </button>

                  <button
                    type="button"
                    onClick={handlePrintNewKey}
                    className="flex-1 py-2 px-3 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium flex items-center justify-center gap-1.5"
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
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl text-sm disabled:opacity-50"
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
