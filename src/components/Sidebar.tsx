import { View, AppSettings } from "../types";
import { Language, Translations } from "../i18n";
import {
  BahiLogoMark,
  LayoutDashboard,
  ShoppingCart,
  PackagePlus,
  BarChart3,
  Package,
  SlidersHorizontal,
  BookOpen,
  Users,
  FileText,
  Tags,
  RefreshCw,
  Settings,
  Wallet,
} from "./icons";

interface SidebarProps {
  currentView: View;
  onNavigate: (view: View) => void;
  settings: AppSettings;
  lang: Language;
  onSelectLanguage: (lang: Language) => void;
  t: Translations;
}

export function Sidebar({
  currentView,
  onNavigate,
  settings,
  lang,
  onSelectLanguage,
  t,
}: SidebarProps) {
  interface NavLinkItem {
    id: View;
    title: string;
    icon: (props: { size?: number; className?: string }) => React.ReactElement;
  }

  interface NavGroup {
    name: string;
    items: NavLinkItem[];
  }

  const groups: NavGroup[] = [
    {
      name: t.nav.groups.rozana,
      items: [
        { id: "Sale", title: t.nav.items.sale, icon: ShoppingCart },
        { id: "Purchase", title: t.nav.items.purchase, icon: PackagePlus },
        { id: "Payment", title: t.nav.items.payment, icon: Wallet },
      ],
    },
    {
      name: t.nav.groups.stock,
      items: [
        { id: "Stock", title: t.nav.items.stockReport, icon: BarChart3 },
        { id: "Opening Stock", title: t.nav.items.openingStock, icon: Package },
        { id: "Stock Adjustment", title: t.nav.items.stockAdjustment, icon: SlidersHorizontal },
      ],
    },
    {
      name: t.nav.groups.hisaab,
      items: [
        { id: "Len-Den", title: t.nav.items.lenDen, icon: BookOpen },
        { id: "Parties", title: t.nav.items.parties, icon: Users },
        { id: "Reports", title: t.nav.items.reports, icon: FileText },
      ],
    },
    {
      name: t.nav.groups.setup,
      items: [
        { id: "Items", title: t.nav.items.itemsList, icon: Tags },
        { id: "Tally Import", title: t.nav.items.tallyImport, icon: RefreshCw },
      ],
    },
  ];

  return (
    <aside className="w-64 bg-forest text-surface border-r border-forest-dark flex flex-col h-screen select-none flex-shrink-0 z-20 no-print">
      {/* Sidebar Header: Bahi Logo Mark, Shop name & "हिं | EN" pill */}
      <div className="px-3.5 py-3.5 border-b border-forest-2/80 flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 overflow-hidden min-w-0">
          <BahiLogoMark size={34} className="flex-shrink-0 shadow-xs" />
          <div className="overflow-hidden min-w-0">
            <h1 className="font-serif text-[15px] font-bold text-surface leading-tight truncate tracking-tight">
              {settings.shopName}
            </h1>
            <p className="text-[11px] text-surface/65 font-medium truncate num-tabular">
              {settings.gstin || (lang === "hi" ? "डिजिटल बही-खाता" : "Digital Bahi-Khata")}
            </p>
          </div>
        </div>

        {/* Sleek minimal "हिं | EN" pill */}
        <div className="flex items-center bg-forest-dark/80 border border-forest-2 rounded-full p-0.5 text-xs font-semibold flex-shrink-0">
          <button
            type="button"
            data-testid="lang-hi"
            onClick={() => onSelectLanguage("hi")}
            className={`px-2 py-0.5 rounded-full text-[11px] transition-all ${
              lang === "hi"
                ? "bg-marigold text-ink font-bold shadow-xs"
                : "text-surface/60 hover:text-surface"
            }`}
          >
            हिं
          </button>
          <span className="text-forest-2 text-[10px] px-0.5 select-none">|</span>
          <button
            type="button"
            data-testid="lang-en"
            onClick={() => onSelectLanguage("en")}
            className={`px-2 py-0.5 rounded-full text-[11px] transition-all ${
              lang === "en"
                ? "bg-marigold text-ink font-bold shadow-xs"
                : "text-surface/60 hover:text-surface"
            }`}
          >
            EN
          </button>
        </div>
      </div>

      {/* Navigation (1366x768 fit) */}
      <nav className="flex-1 px-2.5 py-2.5 space-y-2 overflow-y-auto">
        {/* Dashboard Link */}
        <div>
          <button
            type="button"
            data-testid="nav-Dashboard"
            onClick={() => onNavigate("Dashboard")}
            className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-all flex items-center gap-2.5 min-h-[36px] ${
              currentView === "Dashboard"
                ? "bg-forest-2 text-surface font-semibold border-l-4 border-marigold pl-2.5 shadow-xs"
                : "text-surface/75 hover:bg-forest-2/50 hover:text-surface font-medium"
            }`}
          >
            <LayoutDashboard size={17} className={currentView === "Dashboard" ? "text-marigold" : "text-surface/60"} />
            <span className="truncate">{t.nav.dashboard}</span>
          </button>
        </div>

        {/* 4 Groups */}
        {groups.map((group) => (
          <div key={group.name} className="space-y-0.5 pt-1">
            <div className="px-3 pb-0.5 text-[10px] font-serif font-bold text-marigold/70 uppercase tracking-wider">
              {group.name}
            </div>
            {group.items.map((item) => {
              const isActive = currentView === item.id;
              const IconComponent = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`nav-${item.id}`}
                  onClick={() => onNavigate(item.id)}
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-all flex items-center gap-2.5 min-h-[34px] ${
                    isActive
                      ? "bg-forest-2 text-surface font-semibold border-l-4 border-marigold pl-2.5 shadow-xs"
                      : "text-surface/75 hover:bg-forest-2/50 hover:text-surface font-medium"
                  }`}
                >
                  <IconComponent size={16} className={isActive ? "text-marigold" : "text-surface/60"} />
                  <span className="truncate">{item.title}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Pinned Bottom Settings Link */}
      <div className="px-2.5 py-1.5 border-t border-forest-2/80">
        <button
          type="button"
          data-testid="nav-Settings"
          onClick={() => onNavigate("Settings")}
          className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-all flex items-center gap-2.5 min-h-[36px] ${
            currentView === "Settings"
              ? "bg-forest-2 text-surface font-semibold border-l-4 border-marigold pl-2.5 shadow-xs"
              : "text-surface/75 hover:bg-forest-2/50 hover:text-surface font-medium"
          }`}
        >
          <Settings size={16} className={currentView === "Settings" ? "text-marigold" : "text-surface/60"} />
          <span className="truncate">{t.nav.items.settings}</span>
        </button>
      </div>

      {/* Clean Footer info */}
      <div className="px-3.5 py-1.5 border-t border-forest-2/60 text-[10px] text-surface/50 text-center num-tabular">
        {settings.stateCode === "23" ? (lang === "hi" ? "मध्य प्रदेश (23)" : "Madhya Pradesh (23)") : `State: ${settings.stateCode}`} • v0.2.0
      </div>
    </aside>
  );
}

