import { mockIPC } from "@tauri-apps/api/mocks";
import {
  DEMO_SETTINGS,
  DEMO_GODOWNS,
  DEMO_ITEMS,
  DEMO_PARTIES,
  DEMO_STOCK_LIST,
  DEMO_LAST_RATES,
  DEMO_PARTY_BALANCES,
  DEMO_TOP_RECEIVABLES,
  DEMO_LOW_STOCK_ITEMS,
  DEMO_DASHBOARD_STATS,
  DEMO_YESTERDAY_COMPARISON,
  DEMO_DAILY_TREND,
  DEMO_RECENT_ENTRIES,
  DEMO_PENDING_BILLS,
  DEMO_PARTY_STATEMENTS,
  DEMO_SAMPLE_INVOICE,
  DEMO_SALES_REGISTER,
  DEMO_PURCHASE_REGISTER,
  DEMO_GST_SUMMARY,
  DEMO_HSN_SUMMARY,
  DEMO_PROFIT_REPORT,
} from "./mockData";
import {
  Item,
  Party,
  StockItem,
  Movement,
  PartyBalance,
  InvoicePrintDetails,
} from "../types";

// In-memory cloneable state for mutations during interactive demo/screenshots
class DemoStore {
  items: Item[] = [...DEMO_ITEMS];
  parties: Party[] = [...DEMO_PARTIES];
  godowns = [...DEMO_GODOWNS];
  stockList: StockItem[] = [...DEMO_STOCK_LIST];
  partyBalances: PartyBalance[] = [...DEMO_PARTY_BALANCES];
  recentEntries = [...DEMO_RECENT_ENTRIES];
  invoices: Record<string, InvoicePrintDetails> = {
    "INV-2024-089": DEMO_SAMPLE_INVOICE,
  };

  reset() {
    this.items = [...DEMO_ITEMS];
    this.parties = [...DEMO_PARTIES];
    this.godowns = [...DEMO_GODOWNS];
    this.stockList = [...DEMO_STOCK_LIST];
    this.partyBalances = [...DEMO_PARTY_BALANCES];
    this.recentEntries = [...DEMO_RECENT_ENTRIES];
    this.invoices = { "INV-2024-089": DEMO_SAMPLE_INVOICE };
  }
}

const store = new DemoStore();

/**
 * Checks if demo mode is enabled via ?demo=1 in query params or VITE_DEMO=1 in env
 */
export function isDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  const urlParams = new URLSearchParams(window.location.search);
  return (
    urlParams.get("demo") === "1" ||
    urlParams.get("demo") === "true" ||
    import.meta.env.VITE_DEMO === "1" ||
    import.meta.env.VITE_DEMO === "true"
  );
}

/**
 * Installs Tauri IPC mock layer that intercepts all commands with realistic Krishi Kendra data
 */
export function setupDemoMocks() {
  // Ensure default demo settings in localStorage if none or default
  try {
    const existing = localStorage.getItem("krishi_kendra_settings");
    if (!existing || existing.includes("श्री राम")) {
      localStorage.setItem(
        "krishi_kendra_settings",
        JSON.stringify(DEMO_SETTINGS)
      );
    }
  } catch (e) {
    console.warn("Could not set demo settings in localStorage:", e);
  }

  // Set mockIPC from @tauri-apps/api/mocks
  mockIPC((cmd: string, payload: any = {}) => {
    switch (cmd) {
      case "init_db_cmd":
        return "ok";

      case "get_items_cmd":
        return store.items;

      case "add_item_cmd": {
        const newId = store.items.length + 1;
        const newItem: Item = {
          id: newId,
          name: payload.name || "नया सामान",
          base_unit: payload.baseUnit || payload.base_unit || "बोरी",
          hsn: payload.hsn || null,
          gst_rate: payload.gstRate ?? payload.gst_rate ?? 5,
        };
        store.items.push(newItem);
        return newId;
      }

      case "add_item_unit_cmd":
        return true;

      case "get_godowns_cmd":
        return store.godowns;

      case "get_parties_cmd": {
        const type = payload.partyType || payload.party_type;
        if (!type || type === "all") {
          return store.parties;
        }
        return store.parties.filter(
          (p) => p.party_type === type || p.party_type === "both"
        );
      }

      case "add_party_cmd": {
        const newId = store.parties.length + 1;
        const newParty: Party = {
          id: newId,
          name: payload.name || "नया ग्राहक",
          party_type: payload.partyType || payload.party_type || "customer",
          category: payload.category || "unregistered",
          village: payload.village || null,
          gstin: payload.gstin || null,
          phone: payload.phone || null,
        };
        store.parties.push(newParty);
        return newId;
      }

      case "cleanup_accounting_parties_cmd":
        return 0;

      case "get_stock_list_cmd":
        return store.stockList;

      case "get_item_movement_cmd": {
        const movements: Movement[] = [
          {
            date: "2024-10-05",
            qty_base: 50000,
            type_: "purchase",
            ref_id: "PUR-2024-026",
          },
          {
            date: "2024-10-10",
            qty_base: -15000,
            type_: "sale",
            ref_id: "INV-2024-087",
          },
          {
            date: "2024-10-11",
            qty_base: -20000,
            type_: "sale",
            ref_id: "INV-2024-089",
          },
        ];
        return movements;
      }

      case "get_available_stock_cmd": {
        const it = store.stockList.find(
          (s) =>
            s.id === payload.itemId &&
            (payload.godownId ? s.godown_id === payload.godownId : true)
        );
        return it ? it.qty_base : 50000;
      }

      case "get_last_rates_cmd": {
        const rates = DEMO_LAST_RATES[payload.itemId as number];
        return (
          rates || {
            last_purchase: {
              rate: 24200,
              date: "2024-10-05",
              party_name: "इफको फर्टिलाइजर्स लिमिटेड",
            },
            last_sale: {
              rate: 26650,
              date: "2024-10-11",
              party_name: "रमेश पटेल",
            },
          }
        );
      }

      case "add_opening_stock_cmd":
        return "ok";

      case "add_stock_adjustment_cmd":
        return "ok";

      case "save_invoice_cmd": {
        const invPayload = payload.payload || payload;
        const invNo =
          invPayload.invoiceNo ||
          invPayload.invoice_no ||
          `INV-2024-${Math.floor(100 + Math.random() * 900)}`;

        const party = store.parties.find(
          (p) => p.id === (invPayload.partyId || invPayload.party_id)
        );
        const partyName = party ? party.name : "ग्राहक";

        // Store invoice details for print preview
        const lines = (invPayload.lines || []).map((l: any) => ({
          item_name:
            store.items.find((it) => it.id === l.itemId)?.name ||
            l.itemName ||
            "खाद / बीज",
          qty: l.qty || 1000,
          unit: l.unit || "बोरी",
          rate: l.rate || 26650,
          taxable: l.taxable || 250000,
          gst_amount: (l.cgst || 0) + (l.sgst || 0) + (l.igst || 0),
          total: (l.taxable || 250000) + (l.cgst || 0) + (l.sgst || 0) + (l.igst || 0),
        }));

        const totalAmount = lines.reduce((acc: number, x: any) => acc + x.total, 0);

        store.invoices[invNo] = {
          invoice_no: invNo,
          date: invPayload.date || new Date().toISOString().split("T")[0],
          party_name: partyName,
          party_phone: party?.phone || null,
          party_gstin: party?.gstin || null,
          party_village: party?.village || null,
          payment_mode: invPayload.paymentMode || invPayload.payment_mode || "cash",
          paid_amount:
            invPayload.paidAmount ?? invPayload.paid_amount ?? totalAmount,
          total_amount: totalAmount,
          lines: lines.length > 0 ? lines : DEMO_SAMPLE_INVOICE.lines,
        };

        store.recentEntries.unshift({
          date: invPayload.date || new Date().toISOString().split("T")[0],
          entry_type: invPayload.type || invPayload.type_ || "sale",
          invoice_no: invNo,
          party_name: partyName,
          amount: totalAmount,
          payment_mode: invPayload.paymentMode || invPayload.payment_mode || "cash",
        });

        return invNo;
      }

      case "get_dashboard_stats_cmd":
        return DEMO_DASHBOARD_STATS;

      case "get_yesterday_comparison_cmd":
        return DEMO_YESTERDAY_COMPARISON;

      case "get_7_day_trend_cmd":
        return DEMO_DAILY_TREND;

      case "get_top_receivables_cmd":
        return DEMO_TOP_RECEIVABLES;

      case "get_low_stock_items_cmd":
        return DEMO_LOW_STOCK_ITEMS;

      case "get_recent_entries_cmd":
        return store.recentEntries;

      case "get_party_balances_cmd":
        return store.partyBalances;

      case "get_pending_bills_cmd": {
        const pId = payload.partyId as number;
        return DEMO_PENDING_BILLS[pId] || [];
      }

      case "record_payment_cmd": {
        const pPayload = payload.payload || payload;
        const ref =
          pPayload.ref_id ||
          `PAY-2024-${Math.floor(100 + Math.random() * 900)}`;

        const party = store.parties.find((p) => p.id === pPayload.party_id);
        store.recentEntries.unshift({
          date: pPayload.date || new Date().toISOString().split("T")[0],
          entry_type: "payment",
          invoice_no: ref,
          party_name: party ? party.name : "पार्टी",
          amount: pPayload.amount_paise || 500000,
          payment_mode: pPayload.payment_mode || "cash",
        });

        return ref;
      }

      case "get_party_statement_cmd": {
        const pId = payload.partyId as number;
        if (DEMO_PARTY_STATEMENTS[pId]) {
          return DEMO_PARTY_STATEMENTS[pId];
        }
        const p = store.parties.find((party) => party.id === pId);
        return {
          party_id: pId,
          party_name: p?.name || "ग्राहक",
          party_type: p?.party_type || "customer",
          category: p?.category || "unregistered",
          phone: p?.phone || null,
          village: p?.village || null,
          gstin: p?.gstin || null,
          total_debit: 5000000,
          total_credit: 2500000,
          closing_balance: 2500000,
          entries: [
            {
              id: 991,
              date: "2024-10-01",
              entry_type: "sale",
              ref_id: "INV-2024-080",
              debit: 5000000,
              credit: 0,
              payment_mode: "credit",
              remark: "खाद एवं बीज",
              running_balance: 5000000,
            },
            {
              id: 992,
              date: "2024-10-08",
              entry_type: "payment",
              ref_id: "PAY-2024-010",
              debit: 0,
              credit: 2500000,
              payment_mode: "cash",
              remark: "जमा राशि",
              running_balance: 2500000,
            },
          ],
        };
      }

      case "get_invoice_details_cmd": {
        const invNo = payload.invoiceNo as string;
        if (store.invoices[invNo]) {
          return store.invoices[invNo];
        }
        return {
          ...DEMO_SAMPLE_INVOICE,
          invoice_no: invNo || DEMO_SAMPLE_INVOICE.invoice_no,
        };
      }

      case "get_sales_register_cmd":
        return DEMO_SALES_REGISTER;

      case "get_purchase_register_cmd":
        return DEMO_PURCHASE_REGISTER;

      case "get_gst_summary_cmd":
        return DEMO_GST_SUMMARY;

      case "get_hsn_summary_cmd":
        return DEMO_HSN_SUMMARY;

      case "get_profit_report_cmd":
        return DEMO_PROFIT_REPORT;

      case "preview_tally_import_cmd":
        return {
          new_items: 5,
          new_godowns: 1,
          new_parties: 8,
          new_vouchers: 24,
          skipped_ledgers: 3,
        };

      case "confirm_tally_import_cmd":
        return true;

      case "add_ledger_entry_cmd":
        return "ok";

      default:
        console.warn(`[mockInvoke] Unhandled command: ${cmd}`, payload);
        return null;
    }
  });

  console.info("[mockInvoke] Krishi Kendra Demo Mode active: Tauri IPC mocked successfully.");
}
