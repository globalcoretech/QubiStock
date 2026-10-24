import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { View, AppSettings } from "../types";
import { Language, Translations } from "../i18n";
import {
  BahiLogoMark,
  DuotoneHouse,
  DuotoneReceipt,
  DuotoneTruck,
  DuotoneWallet,
  DuotoneWarehouse,
  DuotoneBook,
  DuotoneChart,
  DuotoneDotsThree,
  Tags,
  Users,
  Package,
  SlidersHorizontal,
  RefreshCw,
  Settings,
  Printer,
  PanelLeftClose,
  PanelLeftOpen,
} from "./icons";

interface SidebarProps {
  currentView: View;
  onNavigate: (view: View) => void;
  settings: AppSettings;
  lang: Language;
  onSelectLanguage: (lang: Language) => void;
  t: Translations;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

interface NavItemDef {
  id: View;
  titleHi: string;
  titleEn: string;
  icon: (props: { size?: number; className?: string }) => React.ReactElement;
  tileBg: string;
  tileText: string;
  activeBorder: string;
  activeBg: string;
}

export function Sidebar({
  currentView,
  onNavigate,
  settings,
  lang,
  onSelectLanguage,
  t: _t,
  isCollapsed,
  onToggleCollapse,
}: SidebarProps) {
  const [isFlyoutOpen, setIsFlyoutOpen] = useState(false);
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const flyoutMenuRef = useRef<HTMLDivElement>(null);

  // 7 Big Primary Items with specific system colors
  const primaryNavItems: NavItemDef[] = [
    {
      id: "Dashboard",
      titleHi: "घर",
      titleEn: "Home",
      icon: DuotoneHouse,
      tileBg: "bg-teal-950/60 text-teal-300 group-hover:bg-teal-900",
      tileText: "text-teal-300",
      activeBorder: "border-teal-400",
      activeBg: "bg-teal-900/60 text-white font-semibold shadow-xs",
    },
    {
      id: "Sale",
      titleHi: "बिल बनाओ",
      titleEn: "Sale (Bill)",
      icon: DuotoneReceipt,
      tileBg: "bg-emerald-950/60 text-emerald-300 group-hover:bg-emerald-900",
      tileText: "text-emerald-300",
      activeBorder: "border-emerald-400",
      activeBg: "bg-emerald-900/60 text-white font-semibold shadow-xs",
    },
    {
      id: "Purchase",
      titleHi: "माल आया",
      titleEn: "Purchase (In)",
      icon: DuotoneTruck,
      tileBg: "bg-blue-950/60 text-blue-300 group-hover:bg-blue-900",
      tileText: "text-blue-300",
      activeBorder: "border-blue-400",
      activeBg: "bg-blue-900/60 text-white font-semibold shadow-xs",
    },
    {
      id: "Payment",
      titleHi: "पैसा मिला/दिया",
      titleEn: "Payments",
      icon: DuotoneWallet,
      tileBg: "bg-amber-950/60 text-amber-300 group-hover:bg-amber-900",
      tileText: "text-amber-300",
      activeBorder: "border-amber-400",
      activeBg: "bg-amber-900/60 text-white font-semibold shadow-xs",
    },
    {
      id: "Stock",
      titleHi: "स्टॉक",
      titleEn: "Stock",
      icon: DuotoneWarehouse,
      tileBg: "bg-purple-950/60 text-purple-300 group-hover:bg-purple-900",
      tileText: "text-purple-300",
      activeBorder: "border-purple-400",
      activeBg: "bg-purple-900/60 text-white font-semibold shadow-xs",
    },
    {
      id: "Len-Den",
      titleHi: "लेना-देना",
      titleEn: "Khata (Ledger)",
      icon: DuotoneBook,
      tileBg: "bg-rose-950/60 text-rose-300 group-hover:bg-rose-900",
      tileText: "text-rose-300",
      activeBorder: "border-rose-400",
      activeBg: "bg-rose-900/60 text-white font-semibold shadow-xs",
    },
    {
      id: "Reports",
      titleHi: "रिपोर्ट",
      titleEn: "Reports",
      icon: DuotoneChart,
      tileBg: "bg-indigo-950/60 text-indigo-300 group-hover:bg-indigo-900",
      tileText: "text-indigo-300",
      activeBorder: "border-indigo-400",
      activeBg: "bg-indigo-900/60 text-white font-semibold shadow-xs",
    },
  ];

  // Secondary items shown inside "और" flyout
  const flyoutItems: { id: View; titleHi: string; titleEn: string; icon: any }[] = [
    { id: "Items", titleHi: "सामान सूची", titleEn: "Items List", icon: Tags },
    { id: "Parties", titleHi: "पार्टी खाता", titleEn: "Parties", icon: Users },
    { id: "Opening Stock", titleHi: "ओपनिंग स्टॉक", titleEn: "Opening Stock", icon: Package },
    { id: "Stock Adjustment", titleHi: "स्टॉक सुधार", titleEn: "Stock Adjustment", icon: SlidersHorizontal },
    { id: "Tally Import", titleHi: "टैली इम्पोर्ट", titleEn: "Tally Import", icon: RefreshCw },
    { id: "PrinterSetup", titleHi: "प्रिंटर सेटअप", titleEn: "Printer Setup", icon: Printer },
    { id: "Settings", titleHi: "सेटिंग्स", titleEn: "Settings", icon: Settings },
  ];

  const isFlyoutActive = flyoutItems.some((f) => f.id === currentView);

  // Close flyout on outside click or Escape
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        flyoutMenuRef.current &&
        !flyoutMenuRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setIsFlyoutOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsFlyoutOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Adjust flyout position so it always fits within window bounds
  useEffect(() => {
    if (isFlyoutOpen && flyoutMenuRef.current) {
      const rect = flyoutMenuRef.current.getBoundingClientRect();
      if (rect.bottom > window.innerHeight - 8) {
        const adjustedTop = Math.max(8, window.innerHeight - rect.height - 8);
        setFlyoutPos((prev) => ({ ...prev, top: adjustedTop }));
      }
    }
  }, [isFlyoutOpen]);

  return (
    <aside
      className={`${
        isCollapsed ? "w-16" : "w-60"
      } bg-forest text-surface border-r border-forest-dark flex flex-col h-screen max-h-screen select-none flex-shrink-0 z-30 no-print transition-all duration-200 ease-in-out relative overflow-hidden`}
    >
      {/* 1. Header: Dukaan ka naam poora dikhe + Bahi logo + collapse toggle */}
      <div className="p-3 border-b border-forest-2/70 flex-shrink-0 bg-forest-dark/40">
        {isCollapsed ? (
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate("Dashboard")}
              title={settings.shopName}
              className="p-1 rounded-lg hover:bg-forest-2/60 transition-colors"
            >
              <BahiLogoMark size={32} />
            </button>
            <button
              type="button"
              onClick={onToggleCollapse}
              title={lang === "hi" ? "साइडबार खोलें (Ctrl+B)" : "Expand Sidebar (Ctrl+B)"}
              className="p-1.5 rounded-lg text-marigold bg-forest-2 hover:bg-forest-2/80 transition-colors shadow-xs"
            >
              <PanelLeftOpen size={16} />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => onNavigate("Dashboard")}
              className="flex items-center gap-2.5 text-left focus:outline-none flex-1 min-w-0"
              title={settings.shopName}
            >
              <BahiLogoMark size={34} className="flex-shrink-0 shadow-xs" />
              <div className="min-w-0">
                <h1 className="font-serif text-[15px] font-bold text-surface leading-snug truncate tracking-tight">
                  {settings.shopName}
                </h1>
                <p className="text-[11px] text-surface/65 font-medium truncate num-tabular">
                  {settings.gstin || (lang === "hi" ? "डिजिटल बही-खाता" : "Digital Bahi-Khata")}
                </p>
              </div>
            </button>
            <button
              type="button"
              onClick={onToggleCollapse}
              title={lang === "hi" ? "साइडबार छोटा करें (Ctrl+B)" : "Collapse Sidebar (Ctrl+B)"}
              className="p-1.5 rounded-lg text-surface/70 hover:text-marigold hover:bg-forest-2 transition-colors flex-shrink-0"
            >
              <PanelLeftClose size={17} />
            </button>
          </div>
        )}
      </div>

      {/* 2. Exactly 7 Main Navigation Items - Fits vertically without any page scroll */}
      <nav
        className="flex-1 px-2 py-2 space-y-1 overflow-y-auto flex flex-col justify-start"
        data-scroll="true"
      >
        {primaryNavItems.map((item) => {
          const isActive = currentView === item.id;
          const IconComp = item.icon;
          const title = lang === "hi" ? item.titleHi : item.titleEn;

          return (
            <button
              key={item.id}
              type="button"
              data-testid={`nav-${item.id}`}
              onClick={() => {
                setIsFlyoutOpen(false);
                onNavigate(item.id);
              }}
              title={isCollapsed ? title : undefined}
              className={`w-full group rounded-lg transition-all flex items-center gap-2.5 min-h-[38px] ${
                isCollapsed ? "justify-center px-1 py-1" : "px-2.5 py-1 justify-start text-left"
              } ${
                isActive
                  ? `${item.activeBg} border-l-4 ${item.activeBorder}`
                  : "text-surface/85 hover:bg-forest-2/50 hover:text-surface"
              }`}
            >
              {/* Colorful Icon Tile */}
              <div
                className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105 ${
                  isActive ? "bg-white/20 text-white shadow-xs" : item.tileBg
                }`}
              >
                <IconComp size={17} />
              </div>

              {!isCollapsed && (
                <span className="font-medium text-[15px] truncate tracking-tight">
                  {title}
                </span>
              )}
            </button>
          );
        })}

        {/* 8. "और" (More) Flyout Trigger Button */}
        <div className="relative pt-1">
          <button
            ref={buttonRef}
            type="button"
            data-testid="nav-More"
            onClick={() => {
              if (!isFlyoutOpen && buttonRef.current) {
                const rect = buttonRef.current.getBoundingClientRect();
                const flyoutH = 340;
                const maxTop = Math.max(8, window.innerHeight - flyoutH - 8);
                const top = Math.max(8, Math.min(rect.top - 120, maxTop));
                const left = rect.right + 8;
                setFlyoutPos({ top, left });
                setIsFlyoutOpen(true);
              } else {
                setIsFlyoutOpen(false);
              }
            }}
            title={isCollapsed ? (lang === "hi" ? "और विकल्प" : "More...") : undefined}
            className={`w-full group rounded-lg transition-all flex items-center gap-2.5 min-h-[38px] ${
              isCollapsed ? "justify-center px-1 py-1" : "px-2.5 py-1 justify-start text-left"
            } ${
              isFlyoutActive || isFlyoutOpen
                ? "bg-forest-2 text-marigold font-semibold border-l-4 border-marigold shadow-xs"
                : "text-surface/85 hover:bg-forest-2/50 hover:text-surface"
            }`}
          >
            <div
              className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105 ${
                isFlyoutActive || isFlyoutOpen
                  ? "bg-marigold/20 text-marigold"
                  : "bg-surface/10 text-surface/80 group-hover:bg-surface/20"
              }`}
            >
              <DuotoneDotsThree size={18} />
            </div>

            {!isCollapsed && (
              <div className="flex items-center justify-between flex-1 min-w-0">
                <span className="font-medium text-[15px] truncate">
                  {lang === "hi" ? "और..." : "More..."}
                </span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-forest-dark/80 text-surface/60">
                  {flyoutItems.length}
                </span>
              </div>
            )}
          </button>

          {/* Flyout Popup Menu - Rendered via Portal directly into document.body */}
          {isFlyoutOpen &&
            createPortal(
              <div
                ref={flyoutMenuRef}
                data-testid="sidebar-more-flyout"
                data-scroll="true"
                style={{
                  position: "fixed",
                  top: `${flyoutPos.top}px`,
                  left: `${flyoutPos.left}px`,
                  maxHeight: "calc(100vh - 16px)",
                  zIndex: 9999,
                }}
                className="bg-surface text-ink rounded-panel border border-border shadow-2xl p-2 w-56 animate-in fade-in zoom-in-95 duration-150 select-none overflow-y-auto"
              >
                <div className="px-2.5 py-1.5 border-b border-border/70 text-[11px] font-bold text-muted uppercase tracking-wider">
                  {lang === "hi" ? "अन्य सेवाएं एवं सेटिंग्स" : "More Modules & Settings"}
                </div>
                <div className="py-1 space-y-0.5">
                  {flyoutItems.map((fi) => {
                    const isCurrent = currentView === fi.id;
                    const IconComponent = fi.icon;
                    const label = lang === "hi" ? fi.titleHi : fi.titleEn;
                    return (
                      <button
                        key={fi.id}
                        type="button"
                        data-testid={`nav-${fi.id}`}
                        onClick={() => {
                          setIsFlyoutOpen(false);
                          onNavigate(fi.id);
                        }}
                        className={`w-full text-left px-2.5 py-2 rounded-lg text-sm flex items-center gap-2.5 transition-colors ${
                          isCurrent
                            ? "bg-forest text-surface font-semibold shadow-2xs"
                            : "text-ink/80 hover:bg-paper hover:text-ink font-medium"
                        }`}
                      >
                        <IconComponent
                          size={17}
                          className={isCurrent ? "text-marigold" : "text-muted"}
                        />
                        <span className="truncate">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>,
              document.body
            )}
        </div>
      </nav>

      {/* 3. Bottom Area: Language Toggle + State info */}
      <div className="p-2 border-t border-forest-2/70 flex-shrink-0 bg-forest-dark/30 space-y-2">
        {/* Language Toggle Pill */}
        <div className="flex items-center justify-between gap-1 bg-forest-dark/90 border border-forest-2/80 rounded-full p-0.5">
          <button
            type="button"
            data-testid="lang-hi"
            onClick={() => onSelectLanguage("hi")}
            className={`flex-1 text-center py-1 rounded-full text-xs font-semibold transition-all ${
              lang === "hi"
                ? "bg-marigold text-ink font-bold shadow-xs"
                : "text-surface/65 hover:text-surface"
            }`}
          >
            हिन्दी
          </button>
          <span className="text-forest-2 text-xs select-none">|</span>
          <button
            type="button"
            data-testid="lang-en"
            onClick={() => onSelectLanguage("en")}
            className={`flex-1 text-center py-1 rounded-full text-xs font-semibold transition-all ${
              lang === "en"
                ? "bg-marigold text-ink font-bold shadow-xs"
                : "text-surface/65 hover:text-surface"
            }`}
          >
            English
          </button>
        </div>

        {/* State / Version info */}
        {!isCollapsed && (
          <div className="text-[10px] text-surface/50 text-center num-tabular truncate">
            {settings.stateCode === "23"
              ? lang === "hi"
                ? "म.प्र. (23)"
                : "MP (23)"
              : `State: ${settings.stateCode}`}{" "}
            • v0.3.0
          </div>
        )}
      </div>
    </aside>
  );
}
