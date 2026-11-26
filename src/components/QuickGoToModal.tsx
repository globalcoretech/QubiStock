import React, { useState, useEffect, useRef } from "react";
import { View } from "../types";
import { Language } from "../i18n";
import { Search, X, BarChart3, Package, BookOpen, LayoutDashboard, SlidersHorizontal, Users, PackagePlus } from "./icons";

export interface QuickGoToItem {
  view: View;
  category: "report" | "editor";
  titleHi: string;
  titleEn: string;
  descHi: string;
  descEn: string;
  keywords: string;
  badge?: string;
  icon: React.ReactNode;
}

export const QUICK_GOTO_ITEMS: QuickGoToItem[] = [
  {
    view: "Stock",
    category: "report",
    titleHi: "वर्तमान स्टॉक (Stock Summary)",
    titleEn: "Stock Summary",
    descHi: "गोदाम में उपलब्ध स्टॉक और कम स्टॉक देखें",
    descEn: "View available inventory & low stock alerts",
    keywords: "stock inventory available qty godown माल गोदाम स्टॉक",
    badge: "Report",
    icon: <Package size={20} className="text-emerald-700" />,
  },
  {
    view: "Len-Den",
    category: "report",
    titleHi: "पार्टी खाता / उधारी (Party Khata)",
    titleEn: "Party Khata / Ledger",
    descHi: "किसानों और सप्लायरों का बकाया व लेन-देन देखें",
    descEn: "Check customer & supplier balances and ledger",
    keywords: "khata ledger party lenden balance udhari उधारी खाता बही",
    badge: "Report",
    icon: <BookOpen size={20} className="text-emerald-700" />,
  },
  {
    view: "Reports",
    category: "report",
    titleHi: "रिपोर्ट व रजिस्टर (Reports & Movement)",
    titleEn: "Reports & Item Movement",
    descHi: "बिक्री, खरीद, आइटम मूवमेंट व GST रिपोर्ट",
    descEn: "Sales, purchase register, item movement & GST reports",
    keywords: "reports sales purchase gst register movement रिपोर्ट रजिस्टर बिक्री खरीद",
    badge: "Report",
    icon: <BarChart3 size={20} className="text-emerald-700" />,
  },
  {
    view: "Dashboard",
    category: "report",
    titleHi: "मुख्य डैशबोर्ड (Dashboard)",
    titleEn: "Dashboard Overview",
    descHi: "आज की बिक्री, खरीद और मुख्य सारांश देखें",
    descEn: "Today's sales, purchases & business overview",
    keywords: "dashboard home summary डैशबोर्ड होम",
    badge: "Report",
    icon: <LayoutDashboard size={20} className="text-emerald-700" />,
  },
  {
    view: "Opening Stock",
    category: "editor",
    titleHi: "प्रारंभिक स्टॉक (Opening Stock)",
    titleEn: "Opening Stock Editor",
    descHi: "किसी भी आइटम का ओपनिंग स्टॉक भरें या बदलें",
    descEn: "Add or update opening stock quantities & rates",
    keywords: "opening stock balance प्रारंभिक ओपनिंग स्टॉक",
    badge: "Editor",
    icon: <PackagePlus size={20} className="text-amber-700" />,
  },
  {
    view: "Stock Adjustment",
    category: "editor",
    titleHi: "स्टॉक सुधार (Stock Adjustment)",
    titleEn: "Stock Adjustment",
    descHi: "क्षतिग्रस्त, खोया या अतिरिक्त स्टॉक तुरंत ठीक करें",
    descEn: "Adjust damaged, expired, or excess stock",
    keywords: "adjustment damage stock fix सुधार एडजस्टमेंट",
    badge: "Editor",
    icon: <SlidersHorizontal size={20} className="text-amber-700" />,
  },
  {
    view: "Items",
    category: "editor",
    titleHi: "आइटम मास्टर (Items & Rates)",
    titleEn: "Items & Rates Master",
    descHi: "नया आइटम जोड़ें या रेट, HSN व GST बदलें",
    descEn: "Add new items or edit rates, units & GST",
    keywords: "items product rate hsn gst आइटम रेट",
    badge: "Editor",
    icon: <Package size={20} className="text-amber-700" />,
  },
  {
    view: "Parties",
    category: "editor",
    titleHi: "पार्टी मास्टर (Customers & Suppliers)",
    titleEn: "Parties / Customers Master",
    descHi: "नया ग्राहक या सप्लायर जोड़ें व मोबाइल नंबर बदलें",
    descEn: "Add or edit customers, suppliers & phone numbers",
    keywords: "party customer supplier phone गांव ग्राहक सप्लायर",
    badge: "Editor",
    icon: <Users size={20} className="text-amber-700" />,
  },
];

export interface QuickGoToModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (view: View) => void;
  currentView: View;
  lang: Language;
}

export const QuickGoToModal: React.FC<QuickGoToModalProps> = ({
  isOpen,
  onClose,
  onNavigate,
  currentView,
  lang,
}) => {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const q = query.trim().toLowerCase();
  const filtered = QUICK_GOTO_ITEMS.filter((item) => {
    if (!q) return true;
    return (
      item.titleHi.toLowerCase().includes(q) ||
      item.titleEn.toLowerCase().includes(q) ||
      item.descHi.toLowerCase().includes(q) ||
      item.descEn.toLowerCase().includes(q) ||
      item.keywords.toLowerCase().includes(q) ||
      item.view.toLowerCase().includes(q)
    );
  });

  const reports = filtered.filter((i) => i.category === "report");
  const editors = filtered.filter((i) => i.category === "editor");

  const handleSelect = (view: View) => {
    onNavigate(view);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    } else if (e.key === "Enter" && filtered.length > 0) {
      e.preventDefault();
      handleSelect(filtered[0].view);
    }
  };

  return (
    <div
      data-testid="quick-goto-modal"
      className="fixed inset-0 z-[9995] flex items-start justify-center pt-10 sm:pt-14 bg-black/60 backdrop-blur-xs p-4 select-none animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl max-w-3xl w-full overflow-hidden border border-slate-200 text-slate-900"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Top Header + Search Bar */}
        <div className="bg-gradient-to-r from-emerald-800 via-teal-800 to-emerald-900 text-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-200 border border-amber-300/30 text-[11px] font-black tracking-wider uppercase">
                ⚡ Alt + G
              </span>
              <h2 className="text-lg font-bold">
                {lang === "hi"
                  ? "फटाफट रिपोर्ट या एडिटर खोलें (Quick Go To)"
                  : "Quick Go To — Reports & Editors"}
              </h2>
            </div>
            <button
              type="button"
              data-testid="quick-goto-close-btn"
              onClick={onClose}
              className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
              title="Close (Esc)"
            >
              <X size={18} />
            </button>
          </div>

          <div className="relative">
            <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-emerald-200" />
            <input
              ref={inputRef}
              type="text"
              data-testid="quick-goto-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                lang === "hi"
                  ? "रिपोर्ट या स्क्रीन का नाम लिखें... (जैसे: Stock, Khata, Opening Stock, Items)"
                  : "Search report or editor... (e.g., Stock, Khata, Opening Stock, Items)"
              }
              className="w-full pl-11 pr-4 py-3 rounded-2xl bg-white/15 border border-white/25 text-white placeholder:text-emerald-100/70 text-sm font-medium focus:outline-none focus:bg-white/20 focus:ring-2 focus:ring-amber-300/60"
            />
          </div>

          <p className="text-xs text-emerald-100/90 flex items-center gap-1.5">
            <span>🛡️</span>
            <span>
              {lang === "hi"
                ? "आपका वर्तमान अधूरा बिल/काम सुरक्षित रहेगा — रिपोर्ट देखकर 1 क्लिक में वापस आ सकते हैं!"
                : "Your current unfinished bill stays 100% safe — return in 1 click anytime!"}
            </span>
          </p>
        </div>

        {/* Two-Column Large Cards Body */}
        <div className="p-5 sm:p-6 bg-slate-50/70 max-h-[65vh] overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="text-center py-10 text-slate-500 text-sm">
              {lang === "hi" ? "कोई मेल खाता विकल्प नहीं मिला।" : "No matching report or editor found."}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Left Column: Quick Reports */}
              <div className="space-y-2.5">
                <div className="text-xs font-black uppercase tracking-wider text-emerald-800 px-1 flex items-center gap-1.5">
                  <span>📊</span>
                  <span>{lang === "hi" ? "फटाफट रिपोर्ट्स (Quick Reports)" : "Quick Reports"}</span>
                </div>
                <div className="space-y-2">
                  {reports.map((item) => {
                    const isCurrent = currentView === item.view;
                    return (
                      <button
                        key={item.view}
                        type="button"
                        data-testid={`quick-goto-item-${item.view}`}
                        onClick={() => handleSelect(item.view)}
                        className={`w-full text-left p-3.5 rounded-2xl border-2 transition-all flex items-start gap-3 cursor-pointer ${
                          isCurrent
                            ? "border-emerald-500 bg-emerald-50 shadow-xs"
                            : "border-slate-200 bg-white hover:border-emerald-400 hover:bg-emerald-50/50 hover:shadow-sm"
                        }`}
                      >
                        <div className="w-10 h-10 rounded-xl bg-emerald-100/80 border border-emerald-200 flex items-center justify-center flex-shrink-0">
                          {item.icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-sm text-slate-900 truncate">
                              {lang === "hi" ? item.titleHi : item.titleEn}
                            </span>
                            {isCurrent && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-900">
                                {lang === "hi" ? "खुला है" : "Active"}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 mt-0.5 leading-snug">
                            {lang === "hi" ? item.descHi : item.descEn}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Right Column: Quick Editors & Masters */}
              <div className="space-y-2.5">
                <div className="text-xs font-black uppercase tracking-wider text-amber-800 px-1 flex items-center gap-1.5">
                  <span>✏️</span>
                  <span>{lang === "hi" ? "तुरंत सुधार व मास्टर्स (Quick Editors)" : "Quick Editors & Masters"}</span>
                </div>
                <div className="space-y-2">
                  {editors.map((item) => {
                    const isCurrent = currentView === item.view;
                    return (
                      <button
                        key={item.view}
                        type="button"
                        data-testid={`quick-goto-item-${item.view}`}
                        onClick={() => handleSelect(item.view)}
                        className={`w-full text-left p-3.5 rounded-2xl border-2 transition-all flex items-start gap-3 cursor-pointer ${
                          isCurrent
                            ? "border-amber-500 bg-amber-50 shadow-xs"
                            : "border-slate-200 bg-white hover:border-amber-400 hover:bg-amber-50/50 hover:shadow-sm"
                        }`}
                      >
                        <div className="w-10 h-10 rounded-xl bg-amber-100/80 border border-amber-200 flex items-center justify-center flex-shrink-0">
                          {item.icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-sm text-slate-900 truncate">
                              {lang === "hi" ? item.titleHi : item.titleEn}
                            </span>
                            {isCurrent && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-200 text-amber-900">
                                {lang === "hi" ? "खुला है" : "Active"}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 mt-0.5 leading-snug">
                            {lang === "hi" ? item.descHi : item.descEn}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Hints */}
        <div className="px-6 py-3 bg-white border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>
            {lang === "hi"
              ? "कीबोर्ड शॉर्टकट: Alt + G या Ctrl + K से कभी भी खोलें"
              : "Keyboard Shortcut: Press Alt + G or Ctrl + K anytime"}
          </span>
          <span className="font-mono text-[11px] text-slate-400">Enter ➔ Open • Esc ➔ Close</span>
        </div>
      </div>
    </div>
  );
};
