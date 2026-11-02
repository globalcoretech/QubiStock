import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Users,
  UserPlus,
  KeyRound,
  Shield,
  ShieldAlert,
  Clock,
  History,
  AlertTriangle,
  CheckCircle2,
  Lock,
} from "lucide-react";
import { UserInfo, LoginLogEntry, SessionUser } from "../types";

interface UserManagementViewProps {
  currentUser?: SessionUser | null;
  securityEnabled: boolean;
  autoLockMinutes: number;
  onUpdateAutoLock: (minutes: number) => void;
  onEnableSecurity?: () => void;
}

export const UserManagementView: React.FC<UserManagementViewProps> = ({
  currentUser,
  securityEnabled,
  autoLockMinutes,
  onUpdateAutoLock,
  onEnableSecurity,
}) => {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [logs, setLogs] = useState<LoginLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  // Add User State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserRole, setNewUserRole] = useState<"owner" | "staff">("staff");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [confirmUserPassword, setConfirmUserPassword] = useState("");

  // Reset Password State
  const [resettingUser, setResettingUser] = useState<UserInfo | null>(null);
  const [resetPasswordVal, setResetPasswordVal] = useState("");

  // Change Own Password State
  const [showChangeOwnModal, setShowChangeOwnModal] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [ownNewPassword, setOwnNewPassword] = useState("");
  const [confirmOwnNewPassword, setConfirmOwnNewPassword] = useState("");

  const loadData = async () => {
    try {
      setLoading(true);
      const [uList, lList] = await Promise.all([
        invoke<UserInfo[]>("get_users_cmd"),
        invoke<LoginLogEntry[]>("get_login_logs_cmd", { limit: 50 }).catch(() => []),
      ]);
      setUsers(uList || []);
      setLogs(lList || []);
    } catch (err: any) {
      console.error("Failed to load users/logs:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    const name = newUserName.trim();
    if (!name) {
      setMessage({ text: "कृपया नाम दर्ज करें।", isError: true });
      return;
    }
    if (newUserPassword.length < 6) {
      setMessage({ text: "पासवर्ड कम से कम 6 अक्षरों का होना चाहिए।", isError: true });
      return;
    }
    if (newUserPassword !== confirmUserPassword) {
      setMessage({ text: "पासवर्ड मेल नहीं खाते।", isError: true });
      return;
    }

    try {
      await invoke("create_user_cmd", {
        name,
        role: newUserRole,
        password: newUserPassword,
      });
      setMessage({ text: `यूज़र "${name}" सफलतापूर्वक बनाया गया।`, isError: false });
      setShowAddModal(false);
      setNewUserName("");
      setNewUserPassword("");
      setConfirmUserPassword("");
      loadData();
    } catch (err: any) {
      setMessage({ text: typeof err === "string" ? err : err?.message || "त्रुटि हुई।", isError: true });
    }
  };

  const handleToggleUserStatus = async (user: UserInfo) => {
    setMessage(null);
    try {
      await invoke("update_user_status_cmd", {
        userId: user.id,
        isActive: !user.is_active,
        role: user.role,
      });
      setMessage({
        text: `यूज़र "${user.name}" की स्थिति अपडेट हो गई।`,
        isError: false,
      });
      loadData();
    } catch (err: any) {
      setMessage({ text: typeof err === "string" ? err : err?.message || "त्रुटि हुई।", isError: true });
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resettingUser) return;
    setMessage(null);

    if (resetPasswordVal.length < 6) {
      setMessage({ text: "पासवर्ड कम से कम 6 अक्षरों का होना चाहिए।", isError: true });
      return;
    }

    try {
      await invoke("reset_user_password_cmd", {
        userId: resettingUser.id,
        newPassword: resetPasswordVal,
      });
      setMessage({
        text: `यूज़र "${resettingUser.name}" का पासवर्ड रीसेट हो गया।`,
        isError: false,
      });
      setResettingUser(null);
      setResetPasswordVal("");
      loadData();
    } catch (err: any) {
      setMessage({ text: typeof err === "string" ? err : err?.message || "त्रुटि हुई।", isError: true });
    }
  };

  const handleChangeOwnPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    setMessage(null);

    if (ownNewPassword.length < 6) {
      setMessage({ text: "नया पासवर्ड कम से कम 6 अक्षरों का होना चाहिए।", isError: true });
      return;
    }
    if (ownNewPassword !== confirmOwnNewPassword) {
      setMessage({ text: "पासवर्ड मेल नहीं खाते।", isError: true });
      return;
    }

    try {
      await invoke("change_own_password_cmd", {
        oldPassword,
        newPassword: ownNewPassword,
      });
      setMessage({ text: "आपका पासवर्ड सफलतापूर्वक बदल गया।", isError: false });
      setShowChangeOwnModal(false);
      setOldPassword("");
      setOwnNewPassword("");
      setConfirmOwnNewPassword("");
      loadData();
    } catch (err: any) {
      setMessage({ text: typeof err === "string" ? err : err?.message || "त्रुटि हुई।", isError: true });
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto py-2">
      {/* Alert / Feedback message */}
      {message && (
        <div
          data-testid="user-management-feedback"
          className={`p-3.5 rounded-xl border text-sm flex items-center gap-2.5 ${
            message.isError
              ? "bg-red-50 border-red-200 text-red-700"
              : "bg-emerald-50 border-emerald-200 text-emerald-800"
          }`}
        >
          {message.isError ? (
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Security Status Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`p-2.5 rounded-xl ${
                securityEnabled ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
              }`}
            >
              {securityEnabled ? <Shield className="w-6 h-6" /> : <ShieldAlert className="w-6 h-6" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 text-base">
                  ऐप सुरक्षा स्थिति / Security Status
                </h3>
                <span
                  data-testid="security-status-badge"
                  className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${
                    securityEnabled
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {securityEnabled ? "सक्रिय (Enabled)" : "अक्षम (Disabled)"}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {securityEnabled
                  ? "स्थानीय 2-रोल सुरक्षा प्रणाली (Owner & Staff) सक्रिय है।"
                  : "सुरक्षा बंद है। कोई भी बिना पासवर्ड के व्यवस्थापक के रूप में कार्य कर सकता है।"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!securityEnabled && onEnableSecurity && (
              <button
                type="button"
                data-testid="turn-on-security-btn"
                onClick={onEnableSecurity}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-xs"
              >
                सुरक्षा सक्षम करें / Enable Security
              </button>
            )}

            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl text-xs text-slate-700">
              <Clock className="w-4 h-4 text-slate-500" />
              <span>ऑटो-लॉक / Auto-Lock:</span>
              <select
                data-testid="auto-lock-minutes-select"
                value={autoLockMinutes}
                onChange={(e) => onUpdateAutoLock(Number(e.target.value))}
                className="bg-white border border-slate-300 rounded-lg px-2 py-0.5 font-medium text-slate-800"
              >
                <option value={5}>5 मिनट / min</option>
                <option value={10}>10 मिनट / min (Default)</option>
                <option value={15}>15 मिनट / min</option>
                <option value={30}>30 मिनट / min</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Users List Section */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="p-4 px-5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-slate-700" />
            <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
              <span>यूज़र सूची / User Accounts ({users.length})</span>
              {loading && <span className="text-xs text-slate-500 font-normal">लोड हो रहा है...</span>}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            {currentUser && (
              <button
                type="button"
                data-testid="change-own-password-btn"
                onClick={() => setShowChangeOwnModal(true)}
                className="px-3 py-1.5 border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-medium flex items-center gap-1.5"
              >
                <KeyRound className="w-3.5 h-3.5 text-slate-500" />
                अपना पासवर्ड बदलें
              </button>
            )}

            <button
              type="button"
              data-testid="open-add-user-modal-btn"
              onClick={() => {
                setShowAddModal(true);
                setNewUserName("");
                setNewUserPassword("");
                setConfirmUserPassword("");
              }}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-medium flex items-center gap-1.5 shadow-xs"
            >
              <UserPlus className="w-3.5 h-3.5" />
              नया यूज़र जोड़ें / Add User
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider">
                <th className="p-3 pl-5">यूज़र नाम / Name</th>
                <th className="p-3">भूमिका / Role</th>
                <th className="p-3">स्थिति / Status</th>
                <th className="p-3">गलत प्रयास / Failed</th>
                <th className="p-3 pr-5 text-right">कार्य / Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => {
                const isLocked = !!u.locked_until && new Date(u.locked_until) > new Date();
                return (
                  <tr key={u.id} data-testid={`user-row-${u.name}`} className="hover:bg-slate-50/70">
                    <td className="p-3 pl-5 font-semibold text-slate-800">{u.name}</td>
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full font-medium ${
                          u.role === "owner"
                            ? "bg-purple-100 text-purple-800"
                            : "bg-blue-100 text-blue-800"
                        }`}
                      >
                        {u.role === "owner" ? "व्यवस्थापक (Owner)" : "कर्मचारी (Staff)"}
                      </span>
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${
                          u.is_active
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {u.is_active ? "सक्रिय (Active)" : "अक्षम (Disabled)"}
                      </span>
                    </td>
                    <td className="p-3 font-mono">
                      {isLocked ? (
                        <span className="text-red-600 font-bold flex items-center gap-1">
                          <Lock className="w-3 h-3" />
                          लॉक है (5 मिनट)
                        </span>
                      ) : (
                        <span className="text-slate-600">{u.failed_attempts}</span>
                      )}
                    </td>
                    <td className="p-3 pr-5 text-right space-x-2">
                      <button
                        type="button"
                        data-testid={`reset-user-pwd-btn-${u.name}`}
                        onClick={() => {
                          setResettingUser(u);
                          setResetPasswordVal("");
                        }}
                        className="text-xs text-blue-600 hover:text-blue-800 hover:underline font-medium"
                      >
                        पासवर्ड रीसेट
                      </button>

                      <button
                        type="button"
                        data-testid={`toggle-user-status-btn-${u.name}`}
                        onClick={() => handleToggleUserStatus(u)}
                        className={`text-xs hover:underline font-medium ${
                          u.is_active ? "text-amber-700 hover:text-amber-900" : "text-emerald-700 hover:text-emerald-900"
                        }`}
                      >
                        {u.is_active ? "अक्षम करें" : "सक्रिय करें"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Login & Security Log (Append-only) */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="p-4 px-5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
          <History className="w-5 h-5 text-slate-700" />
          <h3 className="font-bold text-slate-800 text-sm">
            सुरक्षा लॉग / Login & Security Activity Log (हाल के {logs.length} इवेंट)
          </h3>
        </div>

        <div className="overflow-x-auto max-h-60 overflow-y-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 bg-slate-100 z-10 border-b border-slate-200">
              <tr className="text-slate-600 font-semibold uppercase tracking-wider">
                <th className="p-2.5 pl-5">समय / Timestamp</th>
                <th className="p-2.5">यूज़र / User</th>
                <th className="p-2.5 pr-5">इवेंट / Event</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-4 text-center text-slate-400">
                    कोई लॉग रिकॉर्ड नहीं है।
                  </td>
                </tr>
              ) : (
                logs.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50">
                    <td className="p-2.5 pl-5 text-slate-500 font-mono text-[11px]">
                      {new Date(l.at).toLocaleString("hi-IN")}
                    </td>
                    <td className="p-2.5 font-medium text-slate-800">{l.user_name}</td>
                    <td className="p-2.5 pr-5">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                          l.event === "login"
                            ? "bg-emerald-100 text-emerald-800"
                            : l.event === "failed_attempt"
                            ? "bg-red-100 text-red-800"
                            : l.event === "lock"
                            ? "bg-rose-100 text-rose-800"
                            : l.event === "unlock"
                            ? "bg-teal-100 text-teal-800"
                            : l.event === "password_change"
                            ? "bg-purple-100 text-purple-800"
                            : l.event === "recovery_use"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {l.event}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Add User */}
      {showAddModal && (
        <div
          data-testid="add-user-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5 space-y-4">
            <h3 className="font-bold text-slate-900 text-base">
              नया यूज़र जोड़ें / Add New User
            </h3>
            <form onSubmit={handleCreateUser} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  यूज़र नाम / User Name
                </label>
                <input
                  data-testid="new-user-name-input"
                  type="text"
                  required
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="उदा. ramesh_sharma"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  भूमिका / Role
                </label>
                <select
                  data-testid="new-user-role-select"
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="staff">कर्मचारी (Staff - बिल/भुगतान, रिपोर्ट व सेटिंग्स प्रतिबंधित)</option>
                  <option value="owner">व्यवस्थापक (Owner - पूर्ण अधिकार)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  पासवर्ड / Password (कम से कम 6 अक्षर)
                </label>
                <input
                  data-testid="new-user-password-input"
                  type="password"
                  required
                  minLength={6}
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  पासवर्ड पुष्टि / Confirm Password
                </label>
                <input
                  data-testid="new-user-confirm-password-input"
                  type="password"
                  required
                  minLength={6}
                  value={confirmUserPassword}
                  onChange={(e) => setConfirmUserPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-2 text-xs font-medium border border-slate-300 rounded-xl text-slate-700 hover:bg-slate-50"
                >
                  रद्द करें / Cancel
                </button>
                <button
                  type="submit"
                  data-testid="submit-create-user-btn"
                  className="flex-1 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs"
                >
                  बनाएं / Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Reset Password */}
      {resettingUser && (
        <div
          data-testid="reset-user-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5 space-y-4">
            <h3 className="font-bold text-slate-900 text-base">
              "{resettingUser.name}" का पासवर्ड रीसेट करें
            </h3>
            <form onSubmit={handleResetPassword} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  नया पासवर्ड / New Password (कम से कम 6 अक्षर)
                </label>
                <input
                  data-testid="reset-user-password-input"
                  type="password"
                  required
                  minLength={6}
                  value={resetPasswordVal}
                  onChange={(e) => setResetPasswordVal(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResettingUser(null)}
                  className="flex-1 py-2 text-xs font-medium border border-slate-300 rounded-xl text-slate-700 hover:bg-slate-50"
                >
                  रद्द करें / Cancel
                </button>
                <button
                  type="submit"
                  data-testid="submit-reset-password-btn"
                  className="flex-1 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs"
                >
                  रीसेट करें / Reset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Change Own Password */}
      {showChangeOwnModal && (
        <div
          data-testid="change-own-password-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5 space-y-4">
            <h3 className="font-bold text-slate-900 text-base">
              अपना पासवर्ड बदलें / Change Password
            </h3>
            <form onSubmit={handleChangeOwnPassword} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  वर्तमान पासवर्ड / Current Password
                </label>
                <input
                  data-testid="current-password-input"
                  type="password"
                  required
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  नया पासवर्ड / New Password (कम से कम 6 अक्षर)
                </label>
                <input
                  data-testid="own-new-password-input"
                  type="password"
                  required
                  minLength={6}
                  value={ownNewPassword}
                  onChange={(e) => setOwnNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  नया पासवर्ड पुष्टि / Confirm New Password
                </label>
                <input
                  data-testid="own-confirm-new-password-input"
                  type="password"
                  required
                  minLength={6}
                  value={confirmOwnNewPassword}
                  onChange={(e) => setConfirmOwnNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowChangeOwnModal(false)}
                  className="flex-1 py-2 text-xs font-medium border border-slate-300 rounded-xl text-slate-700 hover:bg-slate-50"
                >
                  रद्द करें / Cancel
                </button>
                <button
                  type="submit"
                  data-testid="submit-change-own-password-btn"
                  className="flex-1 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs"
                >
                  अपडेट करें / Update
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
