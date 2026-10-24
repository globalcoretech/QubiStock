import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Feedback } from "../types";
import { Translations, Language } from "../i18n";
import { FeedbackBanner } from "../components/FeedbackBanner";
import { Check, Trash2, FileSpreadsheet, AlertCircle } from "../components/icons";

interface PreviewReport {
  new_items: number;
  new_godowns: number;
  new_parties: number;
  new_vouchers: number;
  skipped_ledgers: number;
}

interface TallyImportViewProps {
  onImportSuccess?: () => void;
  t: Translations;
  lang: Language;
}

export function TallyImportView({
  onImportSuccess,
  t,
  lang,
}: TallyImportViewProps) {
  const [fileName, setFileName] = useState("");
  const [xmlBase64, setXmlBase64] = useState("");
  const [report, setReport] = useState<PreviewReport | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isCleaning, setIsCleaning] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setFeedback(null);
    setReport(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const buffer = evt.target?.result as ArrayBuffer;
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const b64 = btoa(binary);
      setXmlBase64(b64);
    };
    reader.readAsArrayBuffer(file);
  };

  const handlePreview = async () => {
    if (!xmlBase64) return;
    setFeedback(null);
    try {
      const res = await invoke<PreviewReport>("preview_tally_import_cmd", { xmlBase64 });
      setReport(res);
    } catch (e: any) {
      console.error("preview_tally_import_cmd error:", e);
      if (String(e).includes("Duplicate")) {
        setFeedback({ message: t.tallyImport.duplicateMsg, isError: true });
      } else {
        setFeedback({ message: String(e), isError: true });
      }
    }
  };

  const handleConfirm = async () => {
    if (!xmlBase64) return;
    setIsImporting(true);
    setFeedback(null);
    try {
      await invoke("confirm_tally_import_cmd", {
        xmlBase64,
        fileName: fileName || "Imported.xml",
      });
      setFeedback({
        message: t.tallyImport.successMsg,
        isError: false,
      });
      setReport(null);
      setXmlBase64("");
      setFileName("");
      if (onImportSuccess) onImportSuccess();
    } catch (e: any) {
      console.error("confirm_tally_import_cmd error:", e);
      if (String(e).includes("Duplicate")) {
        setFeedback({ message: t.tallyImport.duplicateMsg, isError: true });
      } else {
        setFeedback({ message: String(e), isError: true });
      }
    } finally {
      setIsImporting(false);
    }
  };

  const handleCleanAccountingParties = async () => {
    const ok = window.confirm(t.parties.cleanConfirm);
    if (!ok) return;

    setIsCleaning(true);
    setFeedback(null);
    try {
      const count = await invoke<number>("cleanup_accounting_parties_cmd");
      setFeedback({
        message: `${t.tallyImport.cleanSuccessMsg} (${count} ${
          lang === "hi" ? "अवांछित लेजर हटाए गए" : "unwanted ledgers deleted"
        })`,
        isError: false,
      });
      if (onImportSuccess) onImportSuccess();
    } catch (err: any) {
      console.error("cleanup_accounting_parties_cmd error:", err);
      setFeedback({ message: String(err), isError: true });
    } finally {
      setIsCleaning(false);
    }
  };

  return (
    <div className="h-full flex flex-col min-h-0 space-y-3 overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 pb-2.5 border-b border-slate-100 flex-shrink-0">
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <FileSpreadsheet size={18} strokeWidth={1.75} className="text-emerald-700" />
            <span>{t.tallyImport.title}</span>
          </h2>
          <p className="text-xs text-slate-500">
            {t.tallyImport.subtitle}
          </p>
        </div>

        {/* Action to clean up previously created accounting ledgers */}
        <button
          type="button"
          onClick={handleCleanAccountingParties}
          disabled={isCleaning}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 hover:border-rose-300 hover:bg-rose-50 text-slate-600 hover:text-rose-700 rounded-lg text-xs font-medium transition-colors"
        >
          <Trash2 size={13} strokeWidth={1.75} />
          <span>{isCleaning ? t.common.saving : t.tallyImport.cleanAccountingPartiesBtn}</span>
        </button>
      </div>

      <FeedbackBanner feedback={feedback} />

      {/* File Select Card */}
      <div className="max-w-2xl bg-white border border-slate-200/80 rounded-xl p-4 sm:p-5 shadow-2xs space-y-3 flex-shrink-0">
        <label className="block text-xs font-semibold text-slate-700 mb-1">
          {t.tallyImport.selectXmlFile} *
        </label>
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept=".xml"
            data-testid="tally-file-input"
            onChange={handleFileChange}
            className="block w-full text-xs text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-600 file:text-white hover:file:bg-emerald-700 cursor-pointer border border-slate-200 rounded-lg p-2 bg-slate-50/50"
          />
        </div>
        {fileName && (
          <p className="text-xs font-mono text-slate-500">
            {t.tallyImport.chosenFile}: <span className="font-semibold text-slate-800">{fileName}</span>
          </p>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            data-testid="tally-preview-btn"
            onClick={handlePreview}
            disabled={!xmlBase64}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 disabled:opacity-40 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
          >
            {t.tallyImport.previewBtn}
          </button>

          {report && (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isImporting}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
            >
              <Check size={14} strokeWidth={2} />
              <span>{isImporting ? t.common.saving : t.tallyImport.confirmBtn}</span>
            </button>
          )}
        </div>
      </div>

      {/* Preview Report Card */}
      {report && (
        <div className="max-w-2xl bg-white border border-slate-200/80 rounded-xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.02)] space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900">
              {t.tallyImport.previewReport}
            </h3>
            <span className="text-xs text-slate-400 font-mono">{fileName}</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg text-center">
              <span className="text-xs text-slate-500 block">{t.tallyImport.newItems}</span>
              <span className="text-lg font-bold font-mono text-slate-800 mt-1 block">
                {report.new_items}
              </span>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg text-center">
              <span className="text-xs text-slate-500 block">{t.tallyImport.newGodowns}</span>
              <span className="text-lg font-bold font-mono text-slate-800 mt-1 block">
                {report.new_godowns}
              </span>
            </div>

            <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-lg text-center">
              <span className="text-xs text-emerald-700 font-medium block">{t.tallyImport.newParties}</span>
              <span className="text-lg font-bold font-mono text-emerald-800 mt-1 block">
                {report.new_parties}
              </span>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg text-center">
              <span className="text-xs text-slate-500 block">{t.tallyImport.newVouchers}</span>
              <span className="text-lg font-bold font-mono text-slate-800 mt-1 block">
                {report.new_vouchers}
              </span>
            </div>
          </div>

          {/* Skipped Non-Trade Ledgers Notice */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-start gap-2.5">
            <AlertCircle size={16} strokeWidth={1.75} className="text-slate-500 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-slate-600 leading-relaxed">
              <span className="font-semibold text-slate-800">{t.tallyImport.skippedLedgers}: </span>
              <span className="font-mono font-bold text-slate-900">{report.skipped_ledgers}</span>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {lang === "hi"
                  ? "केवल Sundry Debtors / Creditors पार्टियां बनाई जाएंगी। Cash, P&L, Sales, Purchase आदि लेजर छोड़ दिए गए हैं।"
                  : "Only trade parties under Sundry Debtors/Creditors are imported. Non-trade ledgers like Cash, P&L, Sales, Purchase are safely skipped."}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
