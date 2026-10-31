import { formatDate, formatQty } from "./formatters";
import {
  SalesGstModeReport,
  SalesGstModeGroupSummary,
  ItemPartiesReport,
  PartyItemsReport,
} from "../types";

/**
 * Calculates derived bill discount and profit from invoice numbers.
 * Derived discount rule:
 * diff = (sum taxable + sum gst) - total_amount (paise)
 * If |diff| < 100 paise: billDiscount = 0, roundOff = -diff
 * Else: billDiscount = diff rounded to nearest rupee, remainder is round-off
 * net_taxable = taxable - billDiscount
 * profit = net_taxable - cost
 */
export function calculateInvoiceProfit(
  taxablePaise: number,
  gstPaise: number,
  totalAmountPaise: number,
  costPaise: number
): { billDiscount: number; netTaxable: number; profit: number; roundOff: number } {
  const sumLines = taxablePaise + gstPaise;
  const diff = sumLines - totalAmountPaise;

  let billDiscount = 0;
  let roundOff = 0;

  if (Math.abs(diff) < 100) {
    billDiscount = 0;
    roundOff = diff === 0 ? 0 : -diff;
  } else {
    billDiscount = Math.round(diff / 100) * 100;
    const remainder = diff - billDiscount;
    roundOff = remainder === 0 ? 0 : -remainder;
  }

  const netTaxable = taxablePaise - billDiscount;
  const profit = netTaxable - costPaise;

  return { billDiscount, netTaxable, profit, roundOff };
}

/**
 * Prepares CSV string with UTF-8 BOM
 */
export function generateCsvWithBom(headers: string[], rows: (string | number)[][]): string {
  const csvContent = [
    headers.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(","),
    ...rows.map((row) =>
      row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\r\n");

  return "\uFEFF" + csvContent;
}

/**
 * Prepares CSV data for Report 1: Sales & Profit With vs Without GST
 */
export function prepareSalesGstModeCsv(report: SalesGstModeReport): { headers: string[]; rows: (string | number)[][] } {
  const headers = [
    "समूह (Group)",
    "बिल संख्या (Bills)",
    "कर योग्य बिक्री (Taxable ₹)",
    "GST प्राप्त (GST ₹)",
    "कुल बिल राशि (Bill Total ₹)",
    "लागत (Cost ₹)",
    "लाभ (Profit ₹)",
    "मार्जिन (Margin %)",
    "प्रिंट अंतर (Diff vs Printed ₹)",
  ];

  const rows: (string | number)[][] = report.groups.map((g) => [
    g.group_name || g.group_key,
    g.bills_count,
    (g.taxable_sales / 100).toFixed(2),
    (g.gst_collected / 100).toFixed(2),
    (g.bill_total / 100).toFixed(2),
    (g.cost / 100).toFixed(2),
    (g.profit / 100).toFixed(2),
    g.profit_margin_pct.toFixed(2) + "%",
    g.group_key === "WITHOUT_GST" ? (g.diff_vs_printed_total / 100).toFixed(2) : "-",
  ]);

  // Total row
  rows.push([
    "कुल योग (Total)",
    report.total_bills_count,
    (report.total_taxable_sales / 100).toFixed(2),
    (report.total_gst_collected / 100).toFixed(2),
    (report.total_bill_amount / 100).toFixed(2),
    (report.total_cost / 100).toFixed(2),
    (report.total_profit / 100).toFixed(2),
    report.total_profit_margin_pct.toFixed(2) + "%",
    (report.total_diff_vs_printed_total / 100).toFixed(2),
  ]);

  return { headers, rows };
}

/**
 * Prepares CSV data for Report 1 Group Drill-Down Invoices
 */
export function prepareGroupInvoicesCsv(group: SalesGstModeGroupSummary): { headers: string[]; rows: (string | number)[][] } {
  const headers = [
    "तारीख",
    "बिल नं",
    "पार्टी",
    "कर योग्य (₹)",
    "GST (₹)",
    "कुल बिल राशि (₹)",
    "लागत (₹)",
    "लाभ (₹)",
    "प्रिंट मोड",
    "प्रिंट का समय",
  ];

  const rows = group.invoices.map((inv) => [
    formatDate(inv.date),
    inv.invoice_no,
    inv.party_name,
    (inv.taxable / 100).toFixed(2),
    (inv.gst / 100).toFixed(2),
    (inv.total / 100).toFixed(2),
    (inv.cost / 100).toFixed(2),
    (inv.profit / 100).toFixed(2),
    inv.printed_mode,
    inv.last_printed_time ? formatDate(inv.last_printed_time) : "-",
  ]);

  return { headers, rows };
}

/**
 * Prepares CSV data for Report 2: Item-wise Parties
 */
export function prepareItemPartiesCsv(report: ItemPartiesReport): { headers: string[]; rows: (string | number)[][] } {
  const isPurchase = report.direction !== "sold_to";
  const headers = [
    isPurchase ? "सप्लायर का नाम" : "ग्राहक का नाम",
    "बिल संख्या",
    `कुल मात्रा (${report.base_unit})`,
    "कुल राशि (₹)",
    "न्यूनतम भाव (₹)",
    "अधिकतम भाव (₹)",
    "औसत भाव (₹)",
    "अंतिम भाव (₹)",
    "अंतिम तारीख",
  ];

  const rows: (string | number)[][] = report.parties.map((p) => [
    p.party_name,
    p.bills_count,
    formatQty(p.total_qty),
    (p.total_amount / 100).toFixed(2),
    (p.min_rate / 100).toFixed(2),
    (p.max_rate / 100).toFixed(2),
    (p.average_rate / 100).toFixed(2),
    (p.last_rate / 100).toFixed(2),
    formatDate(p.last_date),
  ]);

  // Total row
  rows.push([
    "कुल योग (Total)",
    report.total_bills_count,
    formatQty(report.total_qty),
    (report.total_amount / 100).toFixed(2),
    "-",
    "-",
    "-",
    "-",
    "-",
  ]);

  return { headers, rows };
}

/**
 * Prepares CSV data for Report 3: Party-wise Items
 */
export function preparePartyItemsCsv(report: PartyItemsReport): { headers: string[]; rows: (string | number)[][] } {
  const headers = [
    "सामान का नाम (Item)",
    "बिल संख्या",
    "कुल मात्रा",
    "कुल राशि (₹)",
    "न्यूनतम भाव (₹)",
    "अधिकतम भाव (₹)",
    "औसत भाव (₹)",
    "अंतिम भाव (₹)",
    "अंतिम तारीख",
  ];

  const rows: (string | number)[][] = report.items.map((it) => [
    it.item_name,
    it.bills_count,
    `${formatQty(it.total_qty)} ${it.base_unit}`,
    (it.total_amount / 100).toFixed(2),
    (it.min_rate / 100).toFixed(2),
    (it.max_rate / 100).toFixed(2),
    (it.average_rate / 100).toFixed(2),
    (it.last_rate / 100).toFixed(2),
    formatDate(it.last_date),
  ]);

  // Total row
  rows.push([
    "कुल योग (Total)",
    report.total_bills_count,
    "-",
    (report.total_amount / 100).toFixed(2),
    "-",
    "-",
    "-",
    "-",
    "-",
  ]);

  return { headers, rows };
}
