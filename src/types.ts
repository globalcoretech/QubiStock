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
  | "Settings";

export interface AppSettings {
  shopName: string;
  gstin: string;
  stateCode: string;
  phone: string;
  address: string;
  lowStockThreshold: number;
  footerNote: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  shopName: "श्री राम कृषि केंद्र",
  gstin: "23AAAAA0000A1Z5",
  stateCode: "23",
  phone: "9876543210",
  address: "मुख्य बाजार, कृषि उपज मंडी रोड, सीहोर (म.प्र.)",
  lowStockThreshold: 10,
  footerNote: "बिका हुआ माल वापस नहीं होगा। हमारे यहाँ सभी प्रकार के उन्नत खाद, बीज एवं कीटनाशक उपलब्ध हैं। धन्यवाद!",
};

export interface Item {
  id: number;
  name: string;
  base_unit: string;
  hsn: string | null;
  gst_rate: number | null;
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
  qty: number;      // milli
  unit: string;
  rate: number;     // paise
  taxable: number;  // paise
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

