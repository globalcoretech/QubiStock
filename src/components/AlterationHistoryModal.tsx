import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AuditLogEntry } from "../types";
import { History, X, Clock, AlertCircle } from "./icons";

interface AlterationHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType?: string;
  entityId?: string;
  title?: string;
}

export function AlterationHistoryModal({
  isOpen,
  onClose,
  entityType,
  entityId,
  title,
}: AlterationHistoryModalProps) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchLogs();
    }
  }, [isOpen, entityType, entityId]);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await invoke<AuditLogEntry[]>("get_audit_logs_cmd", {
        entityType: entityType || null,
        entityId: entityId || null,
      });
      setLogs(res);
      if (res.length > 0) {
        setExpandedRow(res[0].id);
      }
    } catch (err: any) {
      console.error("Failed to load audit logs:", err);
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const renderDiff = (beforeJson: string | null, afterJson: string | null) => {
    if (!beforeJson && !afterJson) {
      return <div className="text-muted text-xs italic">कोई विवरण उपलब्ध नहीं (No changes recorded)</div>;
    }

    let beforeObj: Record<string, any> | null = null;
    let afterObj: Record<string, any> | null = null;

    try {
      if (beforeJson) beforeObj = JSON.parse(beforeJson);
    } catch {}

    try {
      if (afterJson) afterObj = JSON.parse(afterJson);
    } catch {}

    if (beforeObj && afterObj) {
      const allKeys = Array.from(new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]));
      const changedKeys = allKeys.filter(
        (key) => JSON.stringify(beforeObj![key]) !== JSON.stringify(afterObj![key])
      );

      if (changedKeys.length === 0) {
        return <div className="text-muted text-xs">कोई फ़ील्ड नहीं बदली (No fields changed)</div>;
      }

      return (
        <div className="space-y-1.5 font-mono text-xs">
          <div className="grid grid-cols-12 gap-2 text-[11px] font-bold text-slate-500 uppercase border-b border-border pb-1">
            <div className="col-span-3">फ़ील्ड (Field)</div>
            <div className="col-span-4 text-rose-700">पुराना मान (Old Value)</div>
            <div className="col-span-5 text-emerald-700">नया मान (New Value)</div>
          </div>
          {changedKeys.map((key) => {
            const oldVal = beforeObj![key];
            const newVal = afterObj![key];
            return (
              <div
                key={key}
                className="grid grid-cols-12 gap-2 items-start py-1 border-b border-border/40 text-[11px]"
              >
                <div className="col-span-3 font-semibold text-slate-700 break-words">{key}</div>
                <div className="col-span-4 text-rose-700 bg-rose-50/60 p-1 rounded break-words">
                  {oldVal !== undefined ? JSON.stringify(oldVal) : "—"}
                </div>
                <div className="col-span-5 text-emerald-800 bg-emerald-50/60 p-1 rounded font-semibold break-words">
                  {newVal !== undefined ? JSON.stringify(newVal) : "—"}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    // Fallback: render raw JSON
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
        {beforeJson && (
          <div className="bg-rose-50 border border-rose-200 rounded p-2 overflow-x-auto">
            <div className="text-rose-800 font-bold mb-1">Before:</div>
            <pre className="text-[11px] text-rose-900 whitespace-pre-wrap">{beforeJson}</pre>
          </div>
        )}
        {afterJson && (
          <div className="bg-emerald-50 border border-emerald-200 rounded p-2 overflow-x-auto">
            <div className="text-emerald-800 font-bold mb-1">After:</div>
            <pre className="text-[11px] text-emerald-900 whitespace-pre-wrap">{afterJson}</pre>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3 sm:p-4 backdrop-blur-2xs">
      <div className="bg-surface border border-border rounded-panel shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in duration-200">
        {/* Header */}
        <div className="bg-surface-alt border-b border-border p-3.5 px-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center font-bold">
              <History size={18} />
            </div>
            <div>
              <h3 className="font-serif text-sm sm:text-base font-bold text-ink">
                {title || "बदलाव का इतिहास (Alteration History)"}
              </h3>
              <p className="text-[11px] text-muted">
                {entityType && entityId ? `${entityType} #${entityId}` : "सभी ऑडिट रिकॉर्ड्स (Audit Log)"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-paper transition-all"
            title="बंद करें"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3" data-scroll="true">
          {loading ? (
            <div className="py-12 text-center text-muted text-xs flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-forest border-t-transparent rounded-full animate-spin" />
              <span>लोड हो रहा है...</span>
            </div>
          ) : error ? (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs flex items-center gap-2">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          ) : logs.length === 0 ? (
            <div className="py-12 text-center text-muted text-xs">
              <History size={32} className="mx-auto mb-2 opacity-40" />
              <p className="font-semibold text-slate-700">कोई बदलाव इतिहास नहीं मिला</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                इस रिकॉर्ड में अभी तक कोई बदलाव नहीं किया गया है।
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {logs.map((log) => {
                const isExpanded = expandedRow === log.id;
                return (
                  <div
                    key={log.id}
                    className="border border-border rounded-xl bg-paper overflow-hidden shadow-2xs"
                  >
                    {/* Row Summary / Header */}
                    <div
                      onClick={() => setExpandedRow(isExpanded ? null : log.id)}
                      className="p-3 px-4 flex flex-wrap items-center justify-between gap-2 cursor-pointer hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase ${
                            log.action === "update"
                              ? "bg-blue-100 text-blue-800"
                              : log.action === "cancel"
                              ? "bg-rose-100 text-rose-800"
                              : log.action === "alter"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {log.action}
                        </span>
                        <span className="text-xs font-bold text-ink">
                          {log.entity_type} #{log.entity_id}
                        </span>
                        {log.reason && (
                          <span className="text-xs text-slate-600 italic">
                            — "{log.reason}"
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-muted font-mono">
                        <Clock size={12} />
                        <span>{log.created_at}</span>
                      </div>
                    </div>

                    {/* Diff Body */}
                    {isExpanded && (
                      <div className="p-3 px-4 bg-surface border-t border-border">
                        {renderDiff(log.before_json, log.after_json)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-surface-alt border-t border-border p-3 px-4 flex justify-between items-center flex-shrink-0">
          <span className="text-[11px] text-muted">
            कुल बदलाव: {logs.length} (Audit Log अपरिवर्तनीय है)
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-border bg-surface text-xs font-bold text-ink hover:bg-paper transition-all"
          >
            बंद करें (Close)
          </button>
        </div>
      </div>
    </div>
  );
}
