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
import { localTodayIso } from "../utils/dateUtils";

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

let mockSettings: any = {
  ...DEMO_SETTINGS,
  isGstRegistered: true,
  isComposition: false,
  silentPrintBeta: false,
  printMode: "dialog",
  backupFolder: "Documents\\KrishiBackup",
  secondaryBackupFolder: "",
  lastBackupTime: new Date().toISOString(),
};

/**
 * Installs Tauri IPC mock layer that intercepts all commands with realistic Krishi Kendra data
 */
export function setupDemoMocks() {
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
          gst_rate: payload.gstRate ?? payload.gst_rate ?? null,
          gst_status: payload.gstStatus || (payload.gstRate > 0 ? "taxable" : payload.gstRate === 0 ? "nil_rated" : "not_set"),
        };
        store.items.push(newItem);
        return newId;
      }

      case "add_item_unit_cmd":
        return true;

      case "get_item_units_cmd":
        return [];

      case "update_item_cmd": {
        const pld = payload?.payload || payload;
        const it = store.items.find((x) => x.id === pld.id);
        if (it) {
          if (pld.name) it.name = pld.name;
          if (pld.hsn !== undefined) it.hsn = pld.hsn;
          if (pld.gstRate !== undefined || pld.gst_rate !== undefined) it.gst_rate = pld.gstRate ?? pld.gst_rate;
          if (pld.gstStatus || pld.gst_status) it.gst_status = pld.gstStatus ?? pld.gst_status;
          if (pld.baseUnit || pld.base_unit) it.base_unit = pld.baseUnit ?? pld.base_unit;
          if (pld.category !== undefined) it.category = pld.category;
          if (pld.isActive !== undefined || pld.is_active !== undefined) it.is_active = pld.isActive ?? pld.is_active;
        }
        return true;
      }

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

      case "update_party_cmd": {
        const pld = payload?.payload || payload;
        const p = store.parties.find((x) => x.id === pld.id);
        if (p) {
          if (pld.name) p.name = pld.name;
          if (pld.partyType || pld.party_type) p.party_type = pld.partyType ?? pld.party_type;
          if (pld.category) p.category = pld.category;
          if (pld.village !== undefined) p.village = pld.village;
          if (pld.address !== undefined) p.address = pld.address;
          if (pld.gstin !== undefined) p.gstin = pld.gstin;
          if (pld.phone !== undefined) p.phone = pld.phone;
          if (pld.stateCode !== undefined || pld.state_code !== undefined) p.state_code = pld.stateCode ?? pld.state_code;
        }
        return true;
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
            store.items.find((it) => it.id === (l.item_id || l.itemId))?.name ||
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
          date: invPayload.date || localTodayIso(),
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

        const entryType = invPayload.type || invPayload.type_ || "sale";
        const isSale = entryType === "sale";
        const godownId = invPayload.godownId || invPayload.godown_id || 1;

        // Update in-memory stock list so stock increases on purchase and decreases on sale
        for (const l of invPayload.lines || []) {
          const itId = l.itemId || l.item_id;
          const qtyMilli = Number(l.qty) || 0;
          const existingStock = store.stockList.find(
            (s) => s.id === itId && s.godown_id === godownId
          );
          if (existingStock) {
            if (isSale) {
              existingStock.qty_base = Math.max(0, existingStock.qty_base - qtyMilli);
            } else {
              existingStock.qty_base += qtyMilli;
            }
            existingStock.stock_value = Math.round(
              (existingStock.qty_base * existingStock.last_purchase_rate) / 1000
            );
          }
        }

        store.recentEntries.unshift({
          date: invPayload.date || localTodayIso(),
          entry_type: entryType,
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
          date: pPayload.date || localTodayIso(),
          entry_type: "payment",
          invoice_no: ref,
          party_name: party ? party.name : "पार्टी",
          amount: pPayload.amount_paise || 500000,
          payment_mode: pPayload.payment_mode || "cash",
        });

        return ref;
      }

      case "alter_payment_cmd":
        return true;

      case "cancel_payment_cmd":
        return true;

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

      case "get_sales_gst_mode_profit_report_cmd":
        return {
          groups: [
            {
              group_name: "WITH_GST",
              bills_count: 5,
              taxable_sales: 5000000,
              gst_collected: 900000,
              bill_total: 5900000,
              cost: 4000000,
              profit: 1000000,
              profit_margin_pct: 20.0,
              difference_vs_printed: 0,
              invoices: [],
            },
            {
              group_name: "WITHOUT_GST",
              bills_count: 3,
              taxable_sales: 3000000,
              gst_collected: 540000,
              bill_total: 3540000,
              cost: 2500000,
              profit: 500000,
              profit_margin_pct: 16.67,
              difference_vs_printed: 540000,
              invoices: [],
            },
            {
              group_name: "NOT_PRINTED",
              bills_count: 2,
              taxable_sales: 2000000,
              gst_collected: 360000,
              bill_total: 2360000,
              cost: 1600000,
              profit: 400000,
              profit_margin_pct: 20.0,
              difference_vs_printed: 0,
              invoices: [],
            },
          ],
          total: {
            group_name: "TOTAL",
            bills_count: 10,
            taxable_sales: 10000000,
            gst_collected: 1800000,
            bill_total: 11800000,
            cost: 8100000,
            profit: 1900000,
            profit_margin_pct: 19.0,
            difference_vs_printed: 540000,
            invoices: [],
          },
        };

      case "get_item_parties_report_cmd":
        return {
          item_id: payload.itemId || 1,
          item_name: "यूरिया 45kg",
          direction: payload.direction || "purchased",
          parties: [],
        };

      case "get_party_items_report_cmd":
        return {
          party_id: payload.partyId || 1,
          party_name: "राम शर्मा",
          direction: payload.direction || "purchased",
          items: [],
        };

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

      case "get_settings_cmd":
        return mockSettings;

      case "set_settings_cmd":
        if (payload.settings) {
          mockSettings = { ...mockSettings, ...payload.settings };
        }
        return mockSettings;

      case "get_next_bill_number_cmd": {
        const pfx = payload.prefix || (payload.billType === "purchase" ? "PUR" : "KK");
        const nextIdx = store.recentEntries.length + 1;
        const fy = payload.date ? payload.date.slice(2, 4) + "-" + (parseInt(payload.date.slice(2, 4)) + 1) : "26-27";
        return `${pfx}/${fy}/${String(nextIdx).padStart(4, "0")}`;
      }

      case "list_printers":
        return [
          { name: "Canon MF3010", is_default: true, status: "Ready", port_name: "USB001" },
          { name: "Microsoft Print to PDF", is_default: false, status: "Ready", port_name: "PORTPROMPT:" },
          { name: "EPSON LX-310 (Dot Matrix)", is_default: false, status: "Ready", port_name: "LPT1:" },
        ];

      case "get_default_printer":
        return "Canon MF3010";

      case "print_bill":
        return {
          success: true,
          message: payload.req?.silent
            ? "साइलेंट प्रिंटिंग (बीटा): '--kiosk-printing' के माध्यम से डिफ़ॉल्ट प्रिंटर पर भेजा गया (असली प्रिंटर पर टेस्ट नहीं हुआ)।"
            : "प्रिंट डायलॉग तैयार है।",
          printer_used: payload.req?.printer_name || "Canon MF3010",
          method_used: payload.req?.silent ? "kiosk_printing_beta" : "dialog",
          raw_error: undefined,
        };

      case "backup_now_cmd": {
        const nowIso = new Date().toISOString();
        mockSettings.lastBackupTime = nowIso;
        return {
          success: true,
          primary_path: "C:\\Users\\user\\Documents\\KrishiBackup\\inventory_2026-10-29_11-30.db",
          secondary_path: mockSettings.secondaryBackupFolder ? `${mockSettings.secondaryBackupFolder}\\inventory_2026-10-29_11-30.db` : null,
          secondary_warning: mockSettings.secondaryBackupFolder ? null : "दूसरी जगह (पेनड्राइव / दूसरी ड्राइव) कॉन्फ़िगर नहीं है",
          items_count: store.items.length,
          parties_count: store.parties.length,
          sales_count: 42,
          purchases_count: 18,
          created_at: nowIso,
          message: "बैकअप सफलतापूर्वक सुरक्षित हो गया (जाँचा हुआ ✓)",
        };
      }

      case "list_backups_cmd":
        return [
          {
            filename: "inventory_2026-10-29_11-30.db",
            path: "C:\\Users\\user\\Documents\\KrishiBackup\\inventory_2026-10-29_11-30.db",
            size_bytes: 524288,
            size_formatted: "512 KB",
            created_at: new Date().toISOString(),
            created_at_formatted: "29/10/2026 11:30",
            verified: true,
            is_pre_restore: false,
          },
          {
            filename: "inventory_2026-10-28_18-00.db",
            path: "C:\\Users\\user\\Documents\\KrishiBackup\\inventory_2026-10-28_18-00.db",
            size_bytes: 512000,
            size_formatted: "500 KB",
            created_at: new Date(Date.now() - 86400000).toISOString(),
            created_at_formatted: "28/10/2026 18:00",
            verified: true,
            is_pre_restore: false,
          },
        ];

      case "get_backup_status_cmd":
        return {
          lastBackupTime: mockSettings.lastBackupTime || new Date().toISOString(),
          isBackupRecent: true,
          formattedChipText: "आखिरी बैकअप: आज 11:30 ✓",
          primaryFolder: mockSettings.backupFolder || "C:\\Users\\user\\Documents\\KrishiBackup",
          secondaryFolder: mockSettings.secondaryBackupFolder || null,
          primaryFreeSpace: "C: पर 124 GB खाली",
          secondaryFreeSpace: mockSettings.secondaryBackupFolder ? "D: पर 58 GB खाली" : null,
          isSameDriveAsDb: !mockSettings.secondaryBackupFolder,
          last_backup_time: mockSettings.lastBackupTime || new Date().toISOString(),
          is_recent: true,
          formatted_chip_hi: "आखिरी बैकअप: आज 11:30 ✓",
          formatted_chip_en: "Last Backup: Today 11:30 ✓",
          is_older_than_3_days: false,
          isOlderThan3Days: false,
        };

      case "get_db_safety_info_cmd":
        return {
          db_path: "C:\\Users\\user\\AppData\\Roaming\\KrishiKendra\\inventory.db",
          journal_mode: "wal",
          synchronous: "2",
          foreign_keys: 1,
          busy_timeout: 5000,
          sync_warning: null,
          is_synced_or_removable: false,
        };

      case "graceful_exit_cmd":
        return "exited";

      case "prepare_restore_cmd":
        return {
          success: true,
          pending_file_path: "inventory.db.restore_pending",
          safety_backup_path: "C:\\Users\\user\\Documents\\KrishiBackup\\pre_restore_2026-10-29_11-30.db",
          message: "रीस्टोर फ़ाइल तैयार कर दी गई है। ऐप को पुनः प्रारंभ (Restart) करें।",
        };

      case "check_db_integrity_cmd":
        return {
          isOk: true,
          message: "Database integrity OK",
          details: ["ok"],
          suggestedBackup: null,
          is_ok: true,
          suggested_backup: null,
          available_backups: [],
          availableBackups: [],
        };

      case "open_backup_folder_cmd":
        return true;

      case "pick_folder_cmd":
        return "D:\\KrishiBackup_Demo";

      case "test_write_folder_cmd":
        return true;

      case "copy_backups_cmd":
        return 3;

      case "get_security_status_cmd":
        return {
          has_users: true,
          security_enabled: true,
          auto_lock_minutes: 10,
          is_locked: false,
          current_user: { id: 1, name: "sharma_owner", role: "owner" },
        };

      case "create_owner_initial_cmd":
        return "RK-DEMO-TEST-1234-5678";

      case "skip_security_setup_cmd":
        return true;

      case "login_cmd":
        return {
          id: 1,
          name: payload?.name || "sharma_owner",
          role: payload?.name?.includes("staff") ? "staff" : "owner",
        };

      case "logout_cmd":
        return true;

      case "lock_session_cmd":
        return true;

      case "unlock_session_cmd":
        return { id: 1, name: "sharma_owner", role: "owner" };

      case "get_current_user_cmd":
        return { id: 1, name: "sharma_owner", role: "owner" };

      case "reset_owner_with_recovery_key_cmd":
        return "RK-NEW-RECOVERY-KEY-9999";

      case "get_users_cmd":
        return [
          {
            id: 1,
            name: "sharma_owner",
            role: "owner",
            is_active: true,
            failed_attempts: 0,
            locked_until: null,
            created_at: "2026-01-01T10:00:00Z",
          },
          {
            id: 2,
            name: "ramesh_staff",
            role: "staff",
            is_active: true,
            failed_attempts: 0,
            locked_until: null,
            created_at: "2026-02-01T10:00:00Z",
          },
        ];

      case "create_user_cmd":
        return 3;

      case "update_user_status_cmd":
        return true;

      case "reset_user_password_cmd":
        return "ramesh_staff";

      case "change_own_password_cmd":
        return true;

      case "get_login_logs_cmd":
        return [
          {
            id: 1,
            user_name: "sharma_owner",
            event: "login",
            at: new Date().toISOString(),
          },
        ];

      default:
        console.warn(`[mockInvoke] Unhandled command: ${cmd}`, payload);
        return null;
    }
  });

  console.info("[mockInvoke] Krishi Kendra Demo Mode active: Tauri IPC mocked successfully.");
}
