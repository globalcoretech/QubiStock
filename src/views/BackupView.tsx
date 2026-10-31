import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, BackupInfo, BackupResult, BackupStatusInfo, RestoreResult } from "../types";
import { Translations, Language } from "../i18n";
import { Database, HardDrive, AlertCircle, Check, RefreshCw, FolderOpen, Undo2 } from "../components/icons";

interface BackupViewProps {
  settings: AppSettings;
  refreshTrigger: number;
  onRefresh: () => void;
  onUpdateSettings?: (newSettings: AppSettings) => Promise<void>;
  t: Translations;
  lang: Language;
}

const toSettingsPayload = (s: AppSettings) => {
  const { logoUrl, signatureUrl, ...rest } = s as any;
  return {
    ...rest,
    logoData: rest.logoData ?? logoUrl ?? null,
    signatureData: rest.signatureData ?? signatureUrl ?? null,
  };
};

export function BackupView({
  settings,
  refreshTrigger,
  onRefresh,
  onUpdateSettings,
  t,
  lang,
}: BackupViewProps) {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [statusInfo, setStatusInfo] = useState<BackupStatusInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isChangingFolder, setIsChangingFolder] = useState(false);
  const [selectedBackupForRestore, setSelectedBackupForRestore] = useState<BackupInfo | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; isError?: boolean; isWarning?: boolean } | null>(null);

  // Modal prompt for copying old backups to new primary folder
  const [copyPrompt, setCopyPrompt] = useState<{
    oldPath: string;
    newPath: string;
  } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [list, stat] = await Promise.all([
        invoke<BackupInfo[]>("list_backups_cmd"),
        invoke<BackupStatusInfo>("get_backup_status_cmd"),
      ]);
      setBackups(list || []);
      setStatusInfo(stat || null);
    } catch (err: any) {
      console.error("Failed to load backup data:", err);
      setFeedback({
        message: err?.message || String(err),
        isError: true,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [refreshTrigger]);

  const handleBackupNow = async () => {
    setIsBackingUp(true);
    setFeedback(null);
    try {
      const res = await invoke<BackupResult>("backup_now_cmd");
      if (res.secondaryWarning) {
        setFeedback({
          message: `${res.message} • ${res.secondaryWarning}`,
          isWarning: true,
        });
      } else {
        setFeedback({
          message: res.message || (lang === "hi" ? "बैकअप सफलतापूर्वक लिया गया ✓" : "Backup created successfully ✓"),
          isError: false,
        });
      }
      await loadData();
      onRefresh();
    } catch (err: any) {
      console.error("Backup now error:", err);
      setFeedback({
        message: err?.message || String(err),
        isError: true,
      });
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleOpenFolder = async (folderType: "primary" | "secondary") => {
    try {
      await invoke("open_backup_folder_cmd", { folderType });
    } catch (err: any) {
      setFeedback({
        message: err?.message || String(err),
        isError: true,
      });
    }
  };

  // Primary folder change workflow
  const handleChangePrimaryFolder = async () => {
    setIsChangingFolder(true);
    setFeedback(null);
    try {
      const picked = await invoke<string | null>("pick_folder_cmd");
      if (!picked) return;

      // Immediate write-test
      try {
        await invoke("test_write_folder_cmd", { folderPath: picked });
      } catch {
        setFeedback({
          message: "इस फोल्डर में लिख नहीं सकते, दूसरा चुनो",
          isError: true,
        });
        return;
      }

      const oldFolder = statusInfo?.primaryFolder || settings.backupFolder || "";
      if (oldFolder && oldFolder.toLowerCase() !== picked.toLowerCase() && backups.length > 0) {
        setCopyPrompt({
          oldPath: oldFolder,
          newPath: picked,
        });
      } else {
        await finalizePrimaryFolderChange(picked, false);
      }
    } catch (err: any) {
      setFeedback({ message: err?.message || String(err), isError: true });
    } finally {
      setIsChangingFolder(false);
    }
  };

  const finalizePrimaryFolderChange = async (newPath: string, shouldCopy: boolean) => {
    const promptData = copyPrompt;
    setCopyPrompt(null);
    setIsChangingFolder(true);
    try {
      if (shouldCopy && promptData) {
        try {
          await invoke<number>("copy_backups_cmd", {
            fromFolder: promptData.oldPath,
            toFolder: promptData.newPath,
          });
        } catch (copyErr: any) {
          console.error("Backup copy error:", copyErr);
          setFeedback({
            message: `बैकअप कॉपी चेतावनी: ${copyErr?.message || String(copyErr)}`,
            isWarning: true,
          });
        }
      }

      const updatedSettings: AppSettings = {
        ...settings,
        backupFolder: newPath,
      };
      await invoke("set_settings_cmd", { settings: toSettingsPayload(updatedSettings) });
      if (onUpdateSettings) {
        await onUpdateSettings(updatedSettings);
      }

      // Immediately take a backup to the new location
      await invoke<BackupResult>("backup_now_cmd");
      setFeedback({
        message: `नई जगह: ${newPath} में बैकअप बन गया ✓`,
        isError: false,
      });
      await loadData();
      onRefresh();
    } catch (err: any) {
      setFeedback({ message: err?.message || String(err), isError: true });
    } finally {
      setIsChangingFolder(false);
    }
  };

  const handleResetPrimaryToDefault = async () => {
    setIsChangingFolder(true);
    setFeedback(null);
    try {
      const updatedSettings: AppSettings = {
        ...settings,
        backupFolder: "",
      };
      await invoke("set_settings_cmd", { settings: toSettingsPayload(updatedSettings) });
      if (onUpdateSettings) {
        await onUpdateSettings(updatedSettings);
      }

      await invoke<BackupResult>("backup_now_cmd");
      setFeedback({
        message: `पहला फोल्डर (Documents\\KrishiBackup) सेट हो गया ✓`,
        isError: false,
      });
      await loadData();
      onRefresh();
    } catch (err: any) {
      setFeedback({ message: err?.message || String(err), isError: true });
    } finally {
      setIsChangingFolder(false);
    }
  };

  // Secondary folder workflow (Pendrive / 2nd drive)
  const handleChangeSecondaryFolder = async () => {
    setIsChangingFolder(true);
    setFeedback(null);
    try {
      const picked = await invoke<string | null>("pick_folder_cmd");
      if (!picked) return;

      try {
        await invoke("test_write_folder_cmd", { folderPath: picked });
      } catch {
        setFeedback({
          message: "इस फोल्डर में लिख नहीं सकते, दूसरा चुनो",
          isError: true,
        });
        return;
      }

      const updatedSettings: AppSettings = {
        ...settings,
        secondaryBackupFolder: picked,
      };
      await invoke("set_settings_cmd", { settings: toSettingsPayload(updatedSettings) });
      if (onUpdateSettings) {
        await onUpdateSettings(updatedSettings);
      }

      const res = await invoke<BackupResult>("backup_now_cmd");
      setFeedback({
        message: `नई जगह: ${picked} में बैकअप बन गया ✓`,
        isError: false,
        isWarning: !!res.secondaryWarning,
      });
      await loadData();
      onRefresh();
    } catch (err: any) {
      setFeedback({ message: err?.message || String(err), isError: true });
    } finally {
      setIsChangingFolder(false);
    }
  };

  const handleRemoveSecondaryFolder = async () => {
    setIsChangingFolder(true);
    setFeedback(null);
    try {
      const updatedSettings: AppSettings = {
        ...settings,
        secondaryBackupFolder: "",
      };
      await invoke("set_settings_cmd", { settings: toSettingsPayload(updatedSettings) });
      if (onUpdateSettings) {
        await onUpdateSettings(updatedSettings);
      }

      setFeedback({
        message: "दूसरी बैकअप जगह हटा दी गई है।",
        isError: false,
      });
      await loadData();
      onRefresh();
    } catch (err: any) {
      setFeedback({ message: err?.message || String(err), isError: true });
    } finally {
      setIsChangingFolder(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!selectedBackupForRestore) return;
    setIsRestoring(true);
    try {
      const res = await invoke<RestoreResult>("prepare_restore_cmd", {
        backupPath: selectedBackupForRestore.filePath,
      });
      setFeedback({
        message: res.message || "डेटा रिस्टोर की तैयारी पूरी हो चुकी है।",
        isError: false,
      });
      setSelectedBackupForRestore(null);
    } catch (err: any) {
      console.error("Restore error:", err);
      setFeedback({
        message: err?.message || String(err),
        isError: true,
      });
      setIsRestoring(false);
    }
  };

  const formatTimestamp = (isoStr?: string | null) => {
    if (!isoStr) return t.backup.neverBackedUp;
    try {
      const d = new Date(isoStr);
      return d.toLocaleString(lang === "hi" ? "hi-IN" : "en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      return isoStr;
    }
  };

  const isCustomPrimary = !!settings.backupFolder && settings.backupFolder.trim().length > 0;
  const hasSecondary = !!settings.secondaryBackupFolder && settings.secondaryBackupFolder.trim().length > 0;
  const showSuggestionBox = (statusInfo?.isSameDriveAsDb ?? true) && !hasSecondary;

  return (
    <div className="h-full flex flex-col overflow-hidden text-ink font-body select-none">
      {/* 1. Header with clean Hindi and no technical jargon */}
      <div className="bg-surface border border-border border-t-4 border-t-forest rounded-panel p-3 px-4 shadow-[0_1px_2px_rgba(28,43,36,0.04)] flex items-center justify-between gap-3 flex-shrink-0 mb-2.5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-forest/10 border border-forest/20 text-forest flex items-center justify-center shadow-2xs">
            <Database size={22} />
          </div>
          <div>
            <h2 className="font-serif text-lg font-bold tracking-tight text-ink flex items-center gap-2">
              <span>{t.backup.title}</span>
              <span className="text-[11px] font-sans font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300 px-2.5 py-0.5 rounded-full">
                {lang === "hi" ? "सुरक्षित एवं जाँचा हुआ" : "Verified & Protected"}
              </span>
            </h2>
            <p className="text-xs font-semibold text-muted tracking-wide">
              {t.backup.subtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="backup-now-btn"
            disabled={isBackingUp || isChangingFolder}
            onClick={handleBackupNow}
            className={`min-h-[42px] px-5 rounded-xl text-white font-bold text-sm flex items-center gap-2 shadow-sm transition-all ${
              isBackingUp || isChangingFolder
                ? "bg-slate-400 cursor-not-allowed opacity-75"
                : "bg-forest hover:bg-forest/90 active:scale-95 cursor-pointer"
            }`}
          >
            <RefreshCw size={17} className={isBackingUp ? "animate-spin" : ""} />
            <span>{isBackingUp ? t.backup.backingUpBtn : t.backup.backupNowBtn}</span>
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          data-testid="backup-feedback-banner"
          className={`mb-2.5 p-3 px-4 rounded-xl text-xs font-bold border flex items-center gap-2 flex-shrink-0 transition-all ${
            feedback.isError
              ? "bg-rose-50 border-rose-300 text-rose-800"
              : feedback.isWarning
              ? "bg-amber-50 border-amber-300 text-amber-900"
              : "bg-emerald-50 border-emerald-300 text-emerald-900"
          }`}
        >
          {feedback.isError ? (
            <AlertCircle size={16} className="text-rose-600 flex-shrink-0" />
          ) : feedback.isWarning ? (
            <AlertCircle size={16} className="text-amber-600 flex-shrink-0" />
          ) : (
            <Check size={16} className="text-emerald-600 flex-shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Suggestion Box: Shown when primary folder is on same drive as database and secondary is not set */}
      {showSuggestionBox && (
        <div
          data-testid="secondary-backup-suggestion-box"
          className="mb-2.5 p-3 px-4 bg-amber-50 border border-amber-300 rounded-xl flex items-center justify-between gap-3 text-amber-900 flex-shrink-0 shadow-2xs"
        >
          <div className="flex items-center gap-2.5">
            <AlertCircle size={18} className="text-amber-600 flex-shrink-0" />
            <span className="text-xs font-bold">
              सुरक्षा के लिए पेनड्राइव या दूसरी ड्राइव में भी बैकअप रखें
            </span>
          </div>
          <button
            type="button"
            data-testid="suggestion-pick-secondary-btn"
            disabled={isChangingFolder}
            onClick={handleChangeSecondaryFolder}
            className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-xs transition-all cursor-pointer whitespace-nowrap active:scale-95"
          >
            पेनड्राइव / दूसरी ड्राइव चुनो
          </button>
        </div>
      )}

      {/* 2. Top Info Cards: Locations and Last Backup Status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mb-2.5 flex-shrink-0">
        {/* Card 1: Last Backup Time */}
        <div className="bg-surface border border-border rounded-panel p-3.5 shadow-2xs flex flex-col justify-between">
          <span className="text-[11px] font-bold text-muted uppercase tracking-wider">
            {t.backup.lastBackupLabel}
          </span>
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                statusInfo?.isBackupRecent ? "bg-emerald-500 animate-pulse" : "bg-rose-500"
              }`}
            />
            <span className="font-serif font-bold text-sm text-ink truncate">
              {formatTimestamp(statusInfo?.lastBackupTime)}
            </span>
          </div>
          <div className="mt-2 text-[11px] text-muted font-medium">
            {statusInfo?.isBackupRecent ? (
              <span className="text-emerald-700 font-bold">✓ {lang === "hi" ? "डेटा पूर्णतः सुरक्षित है" : "Data fully protected"}</span>
            ) : (
              <span className="text-rose-700 font-bold">! {t.backup.backupOldChip}</span>
            )}
          </div>
        </div>

        {/* Card 2: Primary Backup Folder */}
        <div className="bg-surface border border-border rounded-panel p-3.5 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
              <HardDrive size={14} className="text-forest" />
              <span>{t.backup.primaryFolderLabel}</span>
            </span>
            {statusInfo?.primaryFreeSpace && (
              <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100/90 px-2 py-0.5 rounded-md border border-emerald-200">
                {statusInfo.primaryFreeSpace}
              </span>
            )}
          </div>
          <p
            className="mt-1 text-xs font-mono font-semibold text-ink truncate bg-paper px-2.5 py-1.5 rounded-lg border border-border"
            title={statusInfo?.primaryFolder || "Documents\\KrishiBackup"}
          >
            {statusInfo?.primaryFolder || "Documents\\KrishiBackup"}
          </p>
          <div className="mt-2.5 flex items-center gap-2 flex-wrap">
            <button
              type="button"
              data-testid="change-primary-folder-btn"
              disabled={isChangingFolder}
              onClick={handleChangePrimaryFolder}
              className="px-2.5 py-1 text-xs font-bold rounded-lg bg-forest text-white hover:bg-forest/90 transition-all cursor-pointer shadow-2xs"
            >
              फोल्डर बदलो
            </button>
            <button
              type="button"
              data-testid="open-primary-folder-btn"
              onClick={() => handleOpenFolder("primary")}
              className="px-2.5 py-1 text-xs font-bold rounded-lg bg-surface border border-border text-forest hover:bg-forest/10 transition-all cursor-pointer flex items-center gap-1"
            >
              <FolderOpen size={13} />
              <span>{t.backup.openFolderBtn}</span>
            </button>
            {isCustomPrimary && (
              <button
                type="button"
                data-testid="reset-primary-folder-btn"
                disabled={isChangingFolder}
                onClick={handleResetPrimaryToDefault}
                title="Documents\KrishiBackup पर वापस लौटें"
                className="px-2 py-1 text-[11px] font-bold rounded-lg text-muted hover:text-ink hover:bg-border/40 transition-all cursor-pointer flex items-center gap-1"
              >
                <Undo2 size={12} />
                <span>पहली जगह पर लौटो</span>
              </button>
            )}
          </div>
        </div>

        {/* Card 3: Secondary Backup Location (Pendrive / Other Drive) */}
        <div className="bg-surface border border-border rounded-panel p-3.5 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-muted uppercase tracking-wider flex items-center gap-1.5">
              <HardDrive size={14} className="text-amber-700" />
              <span>{t.backup.secondaryFolderLabel}</span>
            </span>
            {hasSecondary && statusInfo?.secondaryFreeSpace && (
              <span className="text-[10px] font-bold text-amber-900 bg-amber-100 px-2 py-0.5 rounded-md border border-amber-200">
                {statusInfo.secondaryFreeSpace}
              </span>
            )}
          </div>

          {hasSecondary ? (
            <>
              <p
                className="mt-1 text-xs font-mono font-semibold text-ink truncate bg-paper px-2.5 py-1.5 rounded-lg border border-border"
                title={settings.secondaryBackupFolder || ""}
              >
                {settings.secondaryBackupFolder}
              </p>
              <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  data-testid="change-secondary-folder-btn"
                  disabled={isChangingFolder}
                  onClick={handleChangeSecondaryFolder}
                  className="px-2.5 py-1 text-xs font-bold rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-all cursor-pointer shadow-2xs"
                >
                  बदलो
                </button>
                <button
                  type="button"
                  data-testid="remove-secondary-folder-btn"
                  disabled={isChangingFolder}
                  onClick={handleRemoveSecondaryFolder}
                  className="px-2.5 py-1 text-xs font-bold rounded-lg bg-surface border border-rose-300 text-rose-700 hover:bg-rose-50 transition-all cursor-pointer"
                >
                  हटाओ
                </button>
                <button
                  type="button"
                  data-testid="open-secondary-folder-btn"
                  onClick={() => handleOpenFolder("secondary")}
                  className="px-2.5 py-1 text-xs font-bold rounded-lg bg-surface border border-border text-forest hover:bg-forest/10 transition-all cursor-pointer flex items-center gap-1"
                >
                  <FolderOpen size={13} />
                  <span>{t.backup.openFolderBtn}</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-1 text-xs text-muted font-medium bg-paper/60 px-2.5 py-1.5 rounded-lg border border-dashed border-border truncate">
                पेनड्राइव या दूसरी हार्ड ड्राइव सेट नहीं है
              </p>
              <div className="mt-2.5">
                <button
                  type="button"
                  data-testid="pick-secondary-folder-btn"
                  disabled={isChangingFolder}
                  onClick={handleChangeSecondaryFolder}
                  className="w-full py-1.5 px-3 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white transition-all cursor-pointer shadow-2xs active:scale-95 text-center"
                >
                  पेनड्राइव / दूसरी ड्राइव चुनो
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 3. Backups List Table */}
      <div className="flex-1 min-h-0 bg-surface border border-border rounded-panel flex flex-col shadow-2xs overflow-hidden">
        <div className="p-2.5 px-4 border-b border-border bg-paper/60 flex items-center justify-between flex-shrink-0">
          <h3 className="font-serif text-sm font-bold text-ink flex items-center gap-2">
            <span>{t.backup.backupsListTitle}</span>
            <span className="text-xs font-mono font-bold bg-surface border border-border px-2 py-0.5 rounded-full text-forest">
              {backups.length}
            </span>
          </h3>
          <span className="text-xs text-muted font-medium">
            {lang === "hi" ? "सुरक्षित जाँचे हुए बैकअप" : "Verified Backups"}
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto" data-scroll="true">
          {loading ? (
            <div className="h-40 flex items-center justify-center text-muted text-xs font-bold gap-2">
              <RefreshCw size={16} className="animate-spin text-forest" />
              <span>डेटा लोड हो रहा है...</span>
            </div>
          ) : backups.length === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center text-muted text-xs space-y-1">
              <Database size={24} className="text-border" />
              <p>{t.backup.noBackupsFound}</p>
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border bg-paper/40 text-[11px] font-bold text-muted uppercase tracking-wider sticky top-0 z-10">
                  <th className="py-2 px-3">{t.backup.colDate}</th>
                  <th className="py-2 px-3">{t.backup.colFileName}</th>
                  <th className="py-2 px-3">{t.backup.colSize}</th>
                  <th className="py-2 px-3 text-center">{t.backup.colStatus}</th>
                  <th className="py-2 px-3 text-right">{t.backup.colAction}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {backups.map((b) => (
                  <tr key={b.fileName} className="hover:bg-paper/40 transition-colors">
                    <td className="py-2 px-3 font-semibold text-ink whitespace-nowrap">
                      {b.timestamp}
                    </td>
                    <td className="py-2 px-3 font-mono text-[11px] text-muted truncate max-w-[280px]">
                      <span className="font-semibold text-ink">{b.fileName}</span>
                      {b.isSafetyBackup && (
                        <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
                          {t.backup.safetyBackupTag}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 font-mono text-xs whitespace-nowrap">
                      {b.formattedSize}
                    </td>
                    <td className="py-2 px-3 text-center whitespace-nowrap">
                      {b.isVerified ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                          <span>{t.backup.statusVerified}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
                          <span>{t.backup.statusUnverified}</span>
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        data-testid={`restore-btn-${b.fileName}`}
                        onClick={() => setSelectedBackupForRestore(b)}
                        className="px-3 py-1 rounded-lg text-xs font-bold text-forest bg-forest/10 hover:bg-forest hover:text-white border border-forest/30 transition-all cursor-pointer active:scale-95"
                      >
                        {t.backup.restoreBtn}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Confirmation Modal for Restore */}
      {selectedBackupForRestore && (
        <div
          data-testid="restore-confirm-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
        >
          <div className="bg-surface border border-border rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 border-b border-border pb-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center">
                <AlertCircle size={22} />
              </div>
              <div>
                <h3 className="font-serif text-base font-bold text-ink">
                  {t.backup.confirmRestoreTitle}
                </h3>
                <p className="text-xs text-muted font-mono">{selectedBackupForRestore.fileName}</p>
              </div>
            </div>

            <div className="text-xs text-muted space-y-2 leading-relaxed bg-paper p-3 rounded-xl border border-border">
              <p>{t.backup.confirmRestoreDesc}</p>
              <div className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 p-2 rounded-lg border border-emerald-200">
                ✓ सुरक्षा बैकअप: प्री-रिस्टोर फ़ाइल स्वतः सुरक्षित रहेगी
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                data-testid="cancel-restore-btn"
                disabled={isRestoring}
                onClick={() => setSelectedBackupForRestore(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-ink bg-paper hover:bg-border/60 border border-border transition-all cursor-pointer"
              >
                {t.backup.cancelBtn}
              </button>
              <button
                type="button"
                data-testid="confirm-restore-btn"
                disabled={isRestoring}
                onClick={handleConfirmRestore}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-forest hover:bg-forest/90 shadow-md transition-all flex items-center gap-2 cursor-pointer"
              >
                {isRestoring && <RefreshCw size={14} className="animate-spin" />}
                <span>{isRestoring ? t.backup.restoringBtn : t.backup.confirmBtn}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Copying Backups to New Folder */}
      {copyPrompt && (
        <div
          data-testid="copy-backups-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
        >
          <div className="bg-surface border border-border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 border-b border-border pb-3 text-forest">
              <HardDrive size={24} />
              <h3 className="font-serif text-base font-bold text-ink">
                पुराने बैकअप भी नई जगह कॉपी करें?
              </h3>
            </div>
            <p className="text-xs text-muted leading-relaxed">
              आपके पुराने बैकअप्स <span className="font-mono text-ink font-semibold">{copyPrompt.oldPath}</span> से नई जगह <span className="font-mono text-ink font-semibold">{copyPrompt.newPath}</span> पर जाँचे हुए कॉपी किए जाएंगे। पुरानी फ़ाइलें डिलीट नहीं होंगी।
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                data-testid="modal-copy-no-btn"
                onClick={() => finalizePrimaryFolderChange(copyPrompt.newPath, false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-ink bg-paper hover:bg-border/60 border border-border transition-all cursor-pointer"
              >
                नहीं
              </button>
              <button
                type="button"
                data-testid="modal-copy-yes-btn"
                onClick={() => finalizePrimaryFolderChange(copyPrompt.newPath, true)}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-forest hover:bg-forest/90 shadow-md transition-all cursor-pointer"
              >
                हाँ, कॉपी करो
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
