export type View = 
  | "Dashboard" 
  | "Items" 
  | "Parties" 
  | "Stock" 
  | "Opening Stock"
  | "Stock Adjustment"
  | "Len-Den" 
  | "Purchase" 
  | "Sale" 
  | "Payment"
  | "Reports"
  | "Tally Import"
  | "Settings"
  | "PrinterSetup"
  | "Backup";

export type BillFormat = "A4" | "A5" | "A6";
export type BillType = "TAX INVOICE" | "BILL OF SUPPLY" | "CASH MEMO";
export type BillLanguage = "hi" | "en" | "both";

export interface BillVisibleColumns {
  hsn: boolean;
  unit: boolean;
  discount: boolean;
  gstRate: boolean;
  taxable: boolean;
}

export interface AppSettings {
  shopName: string;
  gstin: string;
  stateCode: string;
  phone: string;
  address: string;
  lowStockThreshold: number;
  footerNote: string;
  // Bill Settings & Bank Info
  logoData?: string;
  bankName?: string;
  bankAccountNo?: string;
  bankIfsc?: string;
  bankBranch?: string;
  upiId?: string;
  termsAndConditions?: string;
  signatureText?: string;
  signatureData?: string;
  defaultBillFormat?: BillFormat;
  billLanguage?: BillLanguage;
  visibleColumns?: BillVisibleColumns;
  fyPrefix?: string;
  // Printer Setup & Alignment
  selectedPrinter?: string;
  printerPaperSize?: BillFormat;
  printOffsetXMm?: number;
  printOffsetYMm?: number;
  printOffsetXmm?: number; // legacy alias
  printOffsetYmm?: number; // legacy alias
  printMode?: "dialog" | "silent";
  // GST Scheme & Shop Registration
  isGstRegistered?: boolean;
  isComposition?: boolean;
  silentPrintBeta?: boolean;
  // Backup & Restore
  backupFolder?: string;
  secondaryBackupFolder?: string;
  lastBackupTime?: string;
}

export const DEFAULT_VISIBLE_COLUMNS: BillVisibleColumns = {
  hsn: true,
  unit: true,
  discount: true,
  gstRate: true,
  taxable: true,
};

export const DEFAULT_SETTINGS: AppSettings = {
  shopName: "",
  gstin: "",
  stateCode: "",
  phone: "",
  address: "",
  lowStockThreshold: 10,
  footerNote: "धन्यवाद!",
  logoData: "",
  bankName: "",
  bankAccountNo: "",
  bankIfsc: "",
  bankBranch: "",
  upiId: "",
  termsAndConditions: "",
  signatureText: "अधिकृत हस्ताक्षरकर्ता (Authorized Signatory)",
  signatureData: "",
  defaultBillFormat: "A4",
  billLanguage: "both",
  visibleColumns: DEFAULT_VISIBLE_COLUMNS,
  fyPrefix: "KK",
  selectedPrinter: "",
  printerPaperSize: "A4",
  printOffsetXMm: 0,
  printOffsetYMm: 0,
  printMode: "dialog",
  isGstRegistered: true,
  isComposition: false,
  silentPrintBeta: false,
  backupFolder: "",
  secondaryBackupFolder: "",
  lastBackupTime: "",
};

export interface BackupInfo {
  fileName: string;
  filePath: string;
  timestamp: string;
  sizeBytes: number;
  formattedSize: string;
  isVerified: boolean;
  isSafetyBackup: boolean;
  // Compatibility aliases
  filename?: string;
  path?: string;
  created_at_formatted?: string;
  size_formatted?: string;
}

export interface BackupResult {
  success: boolean;
  fileName: string;
  primaryPath: string;
  secondaryPath?: string | null;
  secondaryWarning?: string | null;
  timestamp: string;
  sizeBytes: number;
  formattedSize: string;
  isVerified: boolean;
  message: string;
}

export interface IntegrityCheckReport {
  isOk: boolean;
  message: string;
  details?: string[];
  suggestedBackup?: BackupInfo | null;
  // Compatibility aliases
  is_ok?: boolean;
  suggested_backup?: BackupInfo | null;
}

export interface BackupStatusInfo {
  lastBackupTime?: string | null;
  isBackupRecent: boolean;
  formattedChipText: string;
  primaryFolder: string;
  secondaryFolder?: string | null;
  primaryFreeSpace?: string | null;
  secondaryFreeSpace?: string | null;
  isSameDriveAsDb?: boolean;
  // Compatibility aliases
  last_backup_time?: string | null;
  is_recent?: boolean;
  formatted_chip_hi?: string;
  formatted_chip_en?: string;
  primary_free_space?: string | null;
  secondary_free_space?: string | null;
  is_same_drive_as_db?: boolean;
}

export interface RestoreResult {
  success: boolean;
  safetyBackupPath: string;
  pendingPath: string;
  message: string;
}


export interface BillLineItem {
  srNo: number;
  name: string;
  hsn: string;
  qty: number;
  unit: string;
  rate: number; // in ₹ e.g. 266.50
  discount?: number; // in ₹
  taxableAmount: number; // in ₹
  gstRate: number; // 0, 5, 12, 18, 28
  cgstRate?: number;
  cgstAmount: number; // in ₹
  sgstRate?: number;
  sgstAmount: number; // in ₹
  igstRate?: number;
  igstAmount: number; // in ₹
  totalAmount: number; // in ₹
  gst_status?: GstStatus;
}

export interface BillHsnSummary {
  hsn: string;
  taxableAmount: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  totalTax: number;
}

export type BillTaxMode = "with_tax" | "without_tax";

export interface BillData {
  shop: {
    name: string;
    logoData?: string;
    logoUrl?: string;
    address: string;
    gstin: string;
    phone: string;
    stateCode: string;
    bankName: string;
    bankAccountNo: string;
    bankIfsc: string;
    bankBranch: string;
    upiId: string;
    termsAndConditions: string;
    signatureText: string;
    signatureData?: string;
    signatureUrl?: string;
    footerNote?: string;
  };
  party: {
    name: string;
    address?: string;
    village?: string;
    gstin?: string | null;
    phone?: string | null;
    stateCode?: string;
    category?: string;
  };
  invoice: {
    invoiceNo: string;
    date: string;
    billType: BillType;
    isDuplicate?: boolean;
    isCancelled?: boolean;
    paymentMode?: string;
    poNumber?: string;
    ewayBill?: string;
    reverseCharge?: "Yes" | "No";
  };
  lines: BillLineItem[];
  totals: {
    totalQty: number;
    totalTaxable: number;
    discount?: number;
    totalCgst: number;
    totalSgst: number;
    totalIgst: number;
    totalTax: number;
    roundOff: number;
    grandTotal: number;
    amountInWordsHindi: string;
    amountInWordsEnglish: string;
  };
  hsnSummary: BillHsnSummary[];
  customization?: {
    format?: BillFormat;
    language?: BillLanguage;
    visibleColumns?: BillVisibleColumns;
    taxMode?: BillTaxMode;
    hideTaxDetails?: boolean;
  };
}

export type GstStatus = "taxable" | "nil_rated" | "exempt" | "not_set";

export interface Item {
  id: number;
  name: string;
  base_unit: string;
  hsn: string | null;
  gst_rate: number | null;
  gst_status?: GstStatus;
}

export interface StockItem {
  id: number;
  name: string;
  godown_id: number;
  godown_name: string;
  qty_base: number;
  base_unit: string;
  last_purchase_rate: number;
  stock_value: number;
}

export interface Party {
  id: number;
  name: string;
  party_type: string;
  category: string;
  village: string | null;
  gstin: string | null;
  phone: string | null;
}

export interface PartyBalance {
  party_id: number;
  party_name: string;
  party_type: string;
  category: string;
  phone: string | null;
  village: string | null;
  total_debit: number;
  total_credit: number;
  net_balance: number;
}

export interface LastRateInfo {
  rate: number;
  date: string;
  party_name: string;
}

export interface LastRates {
  last_purchase: LastRateInfo | null;
  last_sale: LastRateInfo | null;
}

export interface Feedback {
  message: string;
  isError: boolean;
  details?: string;
}


export interface Godown {
  id: number;
  name: string;
}

export interface Movement {
  date: string;
  qty_base: number;
  type_: string;
  ref_id: string | null;
}

export interface DashboardStats {
  today_sales: number;      // paise
  today_purchases: number;  // paise
  total_receivable: number; // paise
  total_payable: number;    // paise
}

export interface RecentEntry {
  date: string;
  entry_type: string;
  invoice_no: string;
  party_name: string;
  amount: number;
  payment_mode: string;
}

export interface InvoicePrintLine {
  item_name: string;
  hsn?: string;
  qty: number;      // milli
  unit: string;
  rate: number;     // paise
  taxable: number;  // paise
  gst_rate?: number | null;
  gst_status?: GstStatus;
  gst_amount: number; // paise
  total: number;    // paise
}

export interface InvoicePrintDetails {
  invoice_no: string;
  date: string;
  party_name: string;
  party_phone: string | null;
  party_gstin: string | null;
  party_village: string | null;
  payment_mode: string;
  paid_amount: number;
  total_amount: number;
  bill_mode?: "WITH_GST" | "WITHOUT_GST" | string | null;
  lines: InvoicePrintLine[];
}

export interface RegisterEntry {
  invoice_no: string;
  date: string;
  party_name: string;
  party_gstin: string | null;
  state_type: "intrastate" | "interstate";
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  payment_mode: string;
  paid_amount: number;
}

export interface RegisterReport {
  entries: RegisterEntry[];
  total_taxable: number;
  total_cgst: number;
  total_sgst: number;
  total_igst: number;
  grand_total: number;
}

export interface GstSummaryReport {
  output_taxable: number;
  output_cgst: number;
  output_sgst: number;
  output_igst: number;
  output_total_gst: number;
  input_taxable_eligible: number;
  input_taxable_ineligible: number;
  input_cgst: number;
  input_sgst: number;
  input_igst: number;
  input_total_gst: number;
  net_cgst_payable: number;
  net_sgst_payable: number;
  net_igst_payable: number;
  net_total_payable: number;
}

export interface HsnSummaryItem {
  hsn: string;
  item_names: string;
  base_unit: string;
  total_qty: number;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  total_tax: number;
  total_value: number;
}

export interface HsnSummaryReport {
  items: HsnSummaryItem[];
  total_taxable: number;
  total_tax: number;
  grand_total: number;
}

export interface ProfitReportItem {
  item_id: number;
  item_name: string;
  base_unit: string;
  qty_sold: number;
  taxable_sale: number;
  cost_amount: number;
  profit_without_gst: number;
  gross_sale: number;
  gross_profit: number;
  unit_sale_price: number;
  unit_cost: number;
  unit_profit: number;
  margin_percent: number;
}

export interface ProfitReport {
  items: ProfitReportItem[];
  total_taxable_sale: number;
  total_cost: number;
  total_profit_without_gst: number;
  total_gross_sale: number;
  total_gross_profit: number;
}

export interface SearchableOption {
  value: string;
  label: string;
  subLabel?: string;
  badge?: string;
  badgeColor?: string;
}

export interface PaymentPayload {
  party_id: number;
  payment_type: "receipt" | "payment";
  amount_paise: number;
  payment_mode: "cash" | "upi_bank" | "bank";
  date: string;
  remark?: string;
  ref_id?: string;
}

export interface PendingBill {
  invoice_no: string;
  date: string;
  bill_type: "sale" | "purchase";
  total_amount: number;
  paid_amount: number;
  pending_amount: number;
  party_id?: number;
  party_name?: string;
}

export interface PartyStatementItem {
  id: number;
  date: string;
  entry_type: string;
  ref_id: string | null;
  debit: number;
  credit: number;
  payment_mode: string;
  remark: string | null;
  running_balance: number;
}

export interface PartyStatement {
  party_id: number;
  party_name: string;
  party_type: string;
  category: string;
  phone: string | null;
  village: string | null;
  gstin: string | null;
  total_debit: number;
  total_credit: number;
  closing_balance: number;
  entries: PartyStatementItem[];
}

export interface DailyTrend {
  date: string;
  sales_paise: number;
  purchases_paise: number;
}

export interface YesterdayComparison {
  today_date: string;
  yesterday_date: string;
  today_sales: number;
  yesterday_sales: number;
  sales_growth_percent: number;
  today_purchases: number;
  yesterday_purchases: number;
  purchases_growth_percent: number;
}

export interface TopReceivableParty {
  party_id: number;
  name: string;
  village: string | null;
  phone: string | null;
  receivable_paise: number;
  oldest_debt_date: string | null;
  oldest_debt_days: number;
}

export interface LowStockItem {
  item_id: number;
  name: string;
  category: string | null;
  godown_id: number;
  godown_name: string;
  current_stock_milli: number;
  base_unit: string;
  threshold_milli: number;
  last_purchase_rate: number;
}

// ==========================================
// NEW REPORTS TYPES
// ==========================================

export interface SalesGstModeInvoiceItem {
  invoice_no: string;
  date: string;
  party_name: string;
  taxable: number;      // paise
  gst: number;          // paise
  total: number;        // paise (saved total_amount)
  cost: number;         // paise
  profit: number;       // paise (taxable - bill_discount - cost)
  printed_mode: "WITH_GST" | "WITHOUT_GST" | "NOT_PRINTED" | string;
  last_printed_time?: string | null;
}

export interface SalesGstModeGroupSummary {
  group_key: "WITH_GST" | "WITHOUT_GST" | "NOT_PRINTED" | string;
  group_name: string;
  bills_count: number;
  taxable_sales: number;      // paise
  gst_collected: number;      // paise
  bill_total: number;         // paise
  cost: number;               // paise
  profit: number;             // paise
  profit_margin_pct: number;
  diff_vs_printed_total: number; // paise
  invoices: SalesGstModeInvoiceItem[];
}

export interface SalesGstModeReport {
  groups: SalesGstModeGroupSummary[];
  total_bills_count: number;
  total_taxable_sales: number;
  total_gst_collected: number;
  total_bill_amount: number;
  total_cost: number;
  total_profit: number;
  total_profit_margin_pct: number;
  total_diff_vs_printed_total: number;
}

export interface ItemPartyBillDetail {
  invoice_no: string;
  date: string;
  qty: number;          // milli-units in base unit
  unit: string;         // base unit
  rate: number;         // paise per base unit
  taxable: number;      // paise
  tax_amount: number;   // paise
  total_amount: number; // paise
}

export interface ItemPartySummary {
  party_id: number;
  party_name: string;
  bills_count: number;
  total_qty: number;    // milli-units
  unit: string;
  total_taxable: number; // paise
  total_amount: number; // paise (including GST)
  min_rate: number;     // paise
  max_rate: number;     // paise
  average_rate: number; // paise
  last_rate: number;    // paise
  last_date: string;
  bills: ItemPartyBillDetail[];
}

export interface ItemPartiesReport {
  item_id: number;
  item_name: string;
  base_unit: string;
  direction: "purchased_from" | "sold_to" | string;
  parties: ItemPartySummary[];
  total_bills_count: number;
  total_qty: number;
  total_taxable: number;
  total_amount: number;
}

export interface PartyItemBillDetail {
  invoice_no: string;
  date: string;
  qty: number;          // milli-units in base unit
  unit: string;         // base unit
  rate: number;         // paise per base unit
  taxable: number;      // paise
  tax_amount: number;   // paise
  total_amount: number; // paise
}

export interface PartyItemSummary {
  item_id: number;
  item_name: string;
  base_unit: string;
  bills_count: number;
  total_qty: number;    // milli-units in base unit
  total_taxable: number; // paise
  total_amount: number; // paise (including GST)
  min_rate: number;     // paise
  max_rate: number;     // paise
  average_rate: number; // paise
  last_rate: number;    // paise
  last_date: string;
  bills: PartyItemBillDetail[];
}

export interface PartyItemsReport {
  party_id: number;
  party_name: string;
  direction: "purchased_from" | "sold_to" | string;
  items: PartyItemSummary[];
  total_bills_count: number;
  total_qty: number;
  total_taxable: number;
  total_amount: number;
}




