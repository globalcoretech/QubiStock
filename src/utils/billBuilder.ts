import {
  BillData,
  BillLineItem,
  BillHsnSummary,
  AppSettings,
  InvoicePrintDetails,
  DEFAULT_SETTINGS,
  BillTaxMode,
} from "../types";
import { numberToWordsHindi, numberToWordsEnglish } from "./numberToWords";
import { determineBillType, formatBillNumber } from "./billNumber";
import { generateUpiQrDataUrl } from "./qrCode";
import { localTodayIso } from "./dateUtils";

export { determineBillType, formatBillNumber };

export interface BuildBillOptions {
  invoiceDetails?: Partial<InvoicePrintDetails>;
  settings?: AppSettings;
  isDuplicate?: boolean;
  isCancelled?: boolean;
  isComposition?: boolean;
  partyStateCode?: string;
  partyCategory?: string;
  explicitBillType?: "TAX INVOICE" | "BILL OF SUPPLY" | "CASH MEMO";
  qrDataUrl?: string;
  taxMode?: BillTaxMode;
  hideTaxDetails?: boolean;
}

export interface CalculatedBillPair {
  withGst: BillData;
  withoutGst: BillData;
}

/**
 * PURE SINGLE SOURCE OF TRUTH CALCULATION FUNCTION:
 * Returns both WITH_GST and WITHOUT_GST BillData structures from the saved invoice.
 * Guaranteed pure: never mutates input arguments and never writes to DB.
 *
 * Exact Units from get_invoice_details_cmd:
 * - qty: milli-units (integer, e.g. 1000 = 1.0 unit, 500 = 0.5 unit) -> converted by / 1000
 * - rate: paise (integer, e.g. 5000 = Rs 50.00) -> converted by / 100
 * - taxable: paise (integer, e.g. 2500 = Rs 25.00) -> converted by / 100
 * - gst_amount: paise (integer, sum of CGST+SGST+IGST in paise) -> converted by / 100
 * - total: paise (integer, taxable + gst_amount in paise) -> converted by / 100
 * - total_amount (bill level): paise (integer) -> converted by / 100
 * - bill-level discount: NOT stored in DB, derived as: (sum(taxable) + sum(gst)) - total_amount
 */
export function calculateBill(
  invoiceDetails: Partial<InvoicePrintDetails> = {},
  settings: AppSettings = DEFAULT_SETTINGS,
  extraOptions: Partial<BuildBillOptions> = {}
): CalculatedBillPair {
  const shopStateCode = (settings.stateCode || "23").trim();

  // Extract party state code from GSTIN or explicit option
  let partyStateCode = extraOptions.partyStateCode;
  if (!partyStateCode && invoiceDetails.party_gstin && invoiceDetails.party_gstin.trim().length >= 2) {
    partyStateCode = invoiceDetails.party_gstin.trim().slice(0, 2);
  }
  if (!partyStateCode) {
    partyStateCode = shopStateCode;
  }

  const isInterstate = partyStateCode !== shopStateCode;
  const rawLines = invoiceDetails.lines || [];

  const savedTotalRupees =
    typeof invoiceDetails.total_amount === "number"
      ? Number((invoiceDetails.total_amount / 100).toFixed(2))
      : undefined;

  // 1. Process Line Items (Explicit unit conversions: qty / 1000, money / 100; NO magnitude guessing)
  interface LineSnapshot {
    name: string;
    qtyUnits: number;
    unit: string;
    rateRupees: number;
    taxableRupees: number;
    discountRupees: number;
    hsn: string;
    gstRate: number;
    cgstRate: number;
    cgstAmount: number;
    sgstRate: number;
    sgstAmount: number;
    igstRate: number;
    igstAmount: number;
    lineGstTotal: number;
    totalAmountRupees: number;
  }

  const snapshots: LineSnapshot[] = rawLines.map((l: any) => {
    // Explicit conversion: qty milli-units / 1000
    const qtyUnits = typeof l.qty === "number" ? l.qty / 1000 : 0;

    // Explicit conversion: rate paise / 100
    const rateRupees = typeof l.rate === "number" ? Number((l.rate / 100).toFixed(2)) : 0;

    // Explicit conversion: taxable paise / 100 (or derived from rate * qty)
    let taxableRupees = typeof l.taxable === "number" ? Number((l.taxable / 100).toFixed(2)) : 0;
    if (!taxableRupees && rateRupees && qtyUnits) {
      taxableRupees = Number((rateRupees * qtyUnits).toFixed(2));
    }

    // Line discount if present in paise / 100
    const discountRupees = typeof l.discount === "number" ? Number((l.discount / 100).toFixed(2)) : 0;

    // HSN: No guessing from item name. Show "-" when missing.
    const hsn = (l.hsn && String(l.hsn).trim()) ? String(l.hsn).trim() : "-";

    // GST Rate: No guessing from item name. Derive from saved gst_amount / taxable, otherwise 0.
    let gstRate = 0;
    if (typeof l.gst_rate === "number") {
      gstRate = l.gst_rate > 100 ? l.gst_rate / 1000 : l.gst_rate;
    } else if (typeof l.gstRate === "number") {
      gstRate = l.gstRate;
    } else if (typeof l.gst_amount === "number" && typeof l.taxable === "number" && l.taxable > 0) {
      gstRate = Math.round((l.gst_amount / l.taxable) * 100);
    } else {
      gstRate = 0;
    }

    let cgstRate = 0;
    let cgstAmount = 0;
    let sgstRate = 0;
    let sgstAmount = 0;
    let igstRate = 0;
    let igstAmount = 0;

    if (gstRate > 0) {
      const lineGstPaise =
        typeof l.gst_amount === "number"
          ? l.gst_amount
          : ((typeof l.cgst === "number" ? l.cgst : 0) +
             (typeof l.sgst === "number" ? l.sgst : 0) +
             (typeof l.igst === "number" ? l.igst : 0));

      const fullGstRupees = lineGstPaise > 0
        ? Number((lineGstPaise / 100).toFixed(2))
        : Number(((taxableRupees * gstRate) / 100).toFixed(2));

      if (isInterstate) {
        igstRate = gstRate;
        igstAmount = fullGstRupees;
      } else {
        cgstRate = gstRate / 2;
        sgstRate = gstRate / 2;
        if (typeof l.cgst === "number" && typeof l.sgst === "number" && (l.cgst > 0 || l.sgst > 0)) {
          cgstAmount = Number((l.cgst / 100).toFixed(2));
          sgstAmount = Number((l.sgst / 100).toFixed(2));
        } else {
          cgstAmount = Number((fullGstRupees / 2).toFixed(2));
          sgstAmount = Number((fullGstRupees - cgstAmount).toFixed(2));
        }
      }
    }

    const lineGstTotal = Number((cgstAmount + sgstAmount + igstAmount).toFixed(2));
    const totalAmount = Number((taxableRupees + lineGstTotal).toFixed(2));

    return {
      name: l.item_name || "सामान",
      qtyUnits,
      unit: l.unit || "",
      rateRupees,
      taxableRupees,
      discountRupees,
      hsn,
      gstRate,
      cgstRate,
      cgstAmount,
      sgstRate,
      sgstAmount,
      igstRate,
      igstAmount,
      lineGstTotal,
      totalAmountRupees: totalAmount,
    };
  });

  const totalQty = snapshots.reduce((acc, s) => acc + s.qtyUnits, 0);

  // -------------------------------------------------------------
  // BILL DISCOUNT DERIVATION:
  // Derived as: derivedDiscount = (sum(line taxable) + sum(line gst)) - total_amount
  // Stored in paise; converted to rupees without reading unknown fields via `as any`.
  // -------------------------------------------------------------
  const sumLineTaxablePaise = rawLines.reduce(
    (acc, l: any) => acc + (typeof l.taxable === "number" ? l.taxable : 0),
    0
  );
  const sumLineGstPaise = rawLines.reduce((acc, l: any) => {
    if (typeof l.gst_amount === "number") return acc + l.gst_amount;
    const tax =
      (typeof l.cgst === "number" ? l.cgst : 0) +
      (typeof l.sgst === "number" ? l.sgst : 0) +
      (typeof l.igst === "number" ? l.igst : 0);
    return acc + tax;
  }, 0);
  const sumLinesTotalPaise = sumLineTaxablePaise + sumLineGstPaise;

  // -------------------------------------------------------------
  // CALCULATION A: WITH GST
  // -------------------------------------------------------------
  let withGstTaxable = 0;
  let withGstCgst = 0;
  let withGstSgst = 0;
  let withGstIgst = 0;

  snapshots.forEach((s) => {
    withGstTaxable += s.taxableRupees;
    withGstCgst += s.cgstAmount;
    withGstSgst += s.sgstAmount;
    withGstIgst += s.igstAmount;
  });

  withGstTaxable = Number(withGstTaxable.toFixed(2));
  withGstCgst = Number(withGstCgst.toFixed(2));
  withGstSgst = Number(withGstSgst.toFixed(2));
  withGstIgst = Number(withGstIgst.toFixed(2));
  const withGstTotalTax = Number((withGstCgst + withGstSgst + withGstIgst).toFixed(2));
  const withGstLineSum = Number((withGstTaxable + withGstTotalTax).toFixed(2));

  // -------------------------------------------------------------
  // DERIVED DISCOUNT vs ROUND-OFF (paise-level accuracy):
  // let diff = (sum taxable + sum gst) - total_amount (paise).
  // If |diff| < 100 paise, treat it as round-off only (billDiscount = 0, roundOff = -diff).
  // Else billDiscount = diff rounded to the nearest rupee and the remainder (< 1 rupee) is round-off.
  // A bill with no discount must NEVER show a Discount line, in either mode.
  // A negative diff must never become a negative discount.
  // -------------------------------------------------------------
  let billDiscountRupees = 0;
  let withGstRoundOff = 0;
  let withGstGrandTotal = 0;

  if (typeof invoiceDetails.total_amount === "number") {
    const diffPaise = sumLinesTotalPaise - invoiceDetails.total_amount;
    if (Math.abs(diffPaise) < 100) {
      // Round-off only, no discount
      billDiscountRupees = 0;
      withGstRoundOff = Number((-diffPaise / 100).toFixed(2));
    } else if (diffPaise >= 100) {
      billDiscountRupees = Math.round(diffPaise / 100);
      const remainderPaise = diffPaise - (billDiscountRupees * 100);
      withGstRoundOff = Number((-remainderPaise / 100).toFixed(2));
    } else {
      // diffPaise <= -100: Negative diff must NEVER become a negative discount
      billDiscountRupees = 0;
      withGstRoundOff = Number((-diffPaise / 100).toFixed(2));
    }
    withGstGrandTotal = savedTotalRupees!;
  } else {
    billDiscountRupees = 0;
    const unroundedWithGst = withGstLineSum;
    withGstGrandTotal = Math.round(unroundedWithGst);
    withGstRoundOff = Number((withGstGrandTotal - unroundedWithGst).toFixed(2));
  }

  const withGstLines: BillLineItem[] = snapshots.map((s, idx) => ({
    srNo: idx + 1,
    name: s.name,
    hsn: s.hsn,
    qty: s.qtyUnits,
    unit: s.unit,
    rate: s.rateRupees,
    discount: s.discountRupees,
    taxableAmount: s.taxableRupees,
    gstRate: s.gstRate,
    cgstRate: s.cgstRate,
    cgstAmount: s.cgstAmount,
    sgstRate: s.sgstRate,
    sgstAmount: s.sgstAmount,
    igstRate: s.igstRate,
    igstAmount: s.igstAmount,
    totalAmount: s.totalAmountRupees,
  }));

  const hsnMap = new Map<string, BillHsnSummary>();
  withGstLines.forEach((l) => {
    const hsnKey = l.hsn || "-";
    const existing = hsnMap.get(hsnKey);
    if (existing) {
      existing.taxableAmount = Number((existing.taxableAmount + l.taxableAmount).toFixed(2));
      existing.cgstAmount = Number((existing.cgstAmount + l.cgstAmount).toFixed(2));
      existing.sgstAmount = Number((existing.sgstAmount + l.sgstAmount).toFixed(2));
      existing.igstAmount = Number((existing.igstAmount + l.igstAmount).toFixed(2));
      existing.totalTax = Number(
        (existing.totalTax + l.cgstAmount + l.sgstAmount + l.igstAmount).toFixed(2)
      );
    } else {
      hsnMap.set(hsnKey, {
        hsn: hsnKey,
        taxableAmount: l.taxableAmount,
        cgstRate: l.cgstRate || 0,
        cgstAmount: l.cgstAmount,
        sgstRate: l.sgstRate || 0,
        sgstAmount: l.sgstAmount,
        igstRate: l.igstRate || 0,
        igstAmount: l.igstAmount,
        totalTax: Number((l.cgstAmount + l.sgstAmount + l.igstAmount).toFixed(2)),
      });
    }
  });

  const invoiceNo = invoiceDetails.invoice_no || formatBillNumber(1, settings.fyPrefix || "KK", invoiceDetails.date);
  const date = invoiceDetails.date || localTodayIso();

  // Party address: Show "-" when address / village is missing. No default "सीहोर".
  const partyAddress = (invoiceDetails.party_village && invoiceDetails.party_village.trim())
    ? invoiceDetails.party_village.trim()
    : "-";

  const withGstData: BillData = {
    shop: {
      name: settings.shopName || "",
      logoData: settings.logoData || (settings as any).logoUrl || "",
      logoUrl: settings.logoData || (settings as any).logoUrl || "",
      address: settings.address || "",
      gstin: settings.gstin || "",
      phone: settings.phone || "",
      stateCode: shopStateCode,
      bankName: settings.bankName || "",
      bankAccountNo: settings.bankAccountNo || "",
      bankIfsc: settings.bankIfsc || "",
      bankBranch: settings.bankBranch || "",
      upiId: settings.upiId || "",
      termsAndConditions: settings.termsAndConditions || settings.footerNote || "",
      signatureText: settings.signatureText || "अधिकृत हस्ताक्षरकर्ता (Authorized Signatory)",
      signatureData: settings.signatureData || (settings as any).signatureUrl || "",
      signatureUrl: settings.signatureData || (settings as any).signatureUrl || "",
    },
    party: {
      name: invoiceDetails.party_name || "नकद ग्राहक (Cash Customer)",
      address: partyAddress,
      village: invoiceDetails.party_village || undefined,
      gstin: invoiceDetails.party_gstin || null,
      phone: invoiceDetails.party_phone || null,
      stateCode: partyStateCode,
      category: extraOptions.partyCategory || (invoiceDetails.party_gstin ? "Registered Regular" : "Unregistered Consumer"),
    },
    invoice: {
      invoiceNo,
      date,
      billType: "TAX INVOICE",
      isDuplicate: extraOptions.isDuplicate,
      isCancelled: extraOptions.isCancelled ?? (invoiceDetails.status === "cancelled"),
      paymentMode: invoiceDetails.payment_mode || "cash",
      reverseCharge: "No",
    },
    lines: withGstLines,
    totals: {
      totalQty,
      totalTaxable: withGstTaxable,
      discount: billDiscountRupees > 0 ? billDiscountRupees : undefined,
      totalCgst: withGstCgst,
      totalSgst: withGstSgst,
      totalIgst: withGstIgst,
      totalTax: withGstTotalTax,
      roundOff: withGstRoundOff,
      grandTotal: withGstGrandTotal,
      amountInWordsHindi: numberToWordsHindi(withGstGrandTotal),
      amountInWordsEnglish: numberToWordsEnglish(withGstGrandTotal),
    },
    hsnSummary: Array.from(hsnMap.values()),
    customization: {
      format: settings.defaultBillFormat || "A4",
      language: settings.billLanguage || "both",
      visibleColumns: settings.visibleColumns,
      taxMode: "with_tax",
      hideTaxDetails: false,
    },
  };

  // -------------------------------------------------------------
  // CALCULATION B: WITHOUT GST (Pure: qty x rate minus billDiscount)
  // -------------------------------------------------------------
  const withoutGstLines: BillLineItem[] = snapshots.map((s, idx) => ({
    srNo: idx + 1,
    name: s.name,
    hsn: "", // Hidden in Without GST
    qty: s.qtyUnits,
    unit: s.unit,
    rate: s.rateRupees,
    discount: s.discountRupees,
    taxableAmount: s.taxableRupees,
    gstRate: 0,
    cgstRate: 0,
    cgstAmount: 0,
    sgstRate: 0,
    sgstAmount: 0,
    igstRate: 0,
    igstAmount: 0,
    totalAmount: s.taxableRupees, // Line amount = taxable = qty x rate
  }));

  const withoutGstSubtotal = Number(
    withoutGstLines.reduce((acc, l) => acc + l.totalAmount, 0).toFixed(2)
  );
  const withoutGstAfterDiscount = Number(
    Math.max(0, withoutGstSubtotal - billDiscountRupees).toFixed(2)
  );
  const withoutGstGrandTotal = Math.round(withoutGstAfterDiscount);
  const withoutGstRoundOff = Number((withoutGstGrandTotal - withoutGstAfterDiscount).toFixed(2));

  const withoutGstData: BillData = {
    shop: {
      name: settings.shopName || "",
      logoData: settings.logoData || (settings as any).logoUrl || "",
      logoUrl: settings.logoData || (settings as any).logoUrl || "",
      address: settings.address || "",
      gstin: "", // Strictly hidden
      phone: settings.phone || "",
      stateCode: shopStateCode,
      bankName: settings.bankName || "",
      bankAccountNo: settings.bankAccountNo || "",
      bankIfsc: settings.bankIfsc || "",
      bankBranch: settings.bankBranch || "",
      upiId: settings.upiId || "",
      termsAndConditions: settings.termsAndConditions || settings.footerNote || "",
      signatureText: settings.signatureText || "अधिकृत हस्ताक्षरकर्ता (Authorized Signatory)",
      signatureData: settings.signatureData || (settings as any).signatureUrl || "",
      signatureUrl: settings.signatureData || (settings as any).signatureUrl || "",
    },
    party: {
      name: invoiceDetails.party_name || "नकद ग्राहक (Cash Customer)",
      address: partyAddress,
      village: invoiceDetails.party_village || undefined,
      gstin: null, // Strictly hidden
      phone: invoiceDetails.party_phone || null,
      stateCode: partyStateCode,
      category: "Consumer",
    },
    invoice: {
      invoiceNo,
      date,
      billType: "CASH MEMO",
      isDuplicate: extraOptions.isDuplicate,
      isCancelled: extraOptions.isCancelled ?? (invoiceDetails.status === "cancelled"),
      paymentMode: invoiceDetails.payment_mode || "cash",
      reverseCharge: "No",
    },
    lines: withoutGstLines,
    totals: {
      totalQty,
      totalTaxable: withoutGstSubtotal,
      discount: billDiscountRupees > 0 ? billDiscountRupees : undefined,
      totalCgst: 0,
      totalSgst: 0,
      totalIgst: 0,
      totalTax: 0,
      roundOff: withoutGstRoundOff,
      grandTotal: withoutGstGrandTotal,
      amountInWordsHindi: numberToWordsHindi(withoutGstGrandTotal),
      amountInWordsEnglish: numberToWordsEnglish(withoutGstGrandTotal),
    },
    hsnSummary: [], // No HSN summary table in Without GST
    customization: {
      format: settings.defaultBillFormat || "A4",
      language: settings.billLanguage || "both",
      visibleColumns: settings.visibleColumns,
      taxMode: "without_tax",
      hideTaxDetails: true,
    },
  };

  return {
    withGst: withGstData,
    withoutGst: withoutGstData,
  };
}

export function buildBillData(options: BuildBillOptions): BillData {
  const settings = options.settings || DEFAULT_SETTINGS;
  const pair = calculateBill(options.invoiceDetails || {}, settings, options);
  const isWithoutTax =
    options.taxMode === "without_tax" || options.hideTaxDetails === true;
  return isWithoutTax ? pair.withoutGst : pair.withGst;
}

export async function buildBillDataWithQr(options: BuildBillOptions): Promise<BillData> {
  const bill = buildBillData(options);
  if (!options.qrDataUrl && bill.shop.upiId) {
    const qrDataUrl = await generateUpiQrDataUrl({
      upiId: bill.shop.upiId,
      payeeName: bill.shop.name,
      amount: bill.totals.grandTotal, // Uses the active mode's grand total
      invoiceNo: bill.invoice.invoiceNo,
    });
    if (qrDataUrl) {
      bill.shop.logoUrl = bill.shop.logoUrl || "";
      (bill as any).qrDataUrl = qrDataUrl;
    }
  } else if (options.qrDataUrl) {
    (bill as any).qrDataUrl = options.qrDataUrl;
  }
  return bill;
}
