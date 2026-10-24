import {
  BillData,
  BillLineItem,
  BillHsnSummary,
  AppSettings,
  InvoicePrintDetails,
  DEFAULT_SETTINGS,
} from "../types";
import { numberToWordsHindi, numberToWordsEnglish } from "./numberToWords";
import { determineBillType, formatBillNumber } from "./billNumber";
import { generateUpiQrDataUrl } from "./qrCode";

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
}

export function buildBillData(options: BuildBillOptions): BillData {
  const settings = options.settings || DEFAULT_SETTINGS;
  const inv = options.invoiceDetails || {};

  const shopStateCode = (settings.stateCode || "23").trim();
  
  // Extract party state code from GSTIN or explicit option
  let partyStateCode = options.partyStateCode;
  if (!partyStateCode && inv.party_gstin && inv.party_gstin.trim().length >= 2) {
    partyStateCode = inv.party_gstin.trim().slice(0, 2);
  }
  if (!partyStateCode) {
    partyStateCode = shopStateCode; // default to same state (Intrastate)
  }

  const isInterstate = partyStateCode !== shopStateCode;

  // Build Lines preview for taxability check
  const rawLines = inv.lines || [];
  const hasTaxableItems = rawLines.length === 0
    ? true
    : rawLines.some((l: any) => {
        if (l.gst_status === "taxable") return true;
        if (l.gst_status === "nil_rated" || l.gst_status === "exempt") return false;
        if (typeof l.gst_rate === "number") return l.gst_rate > 0;
        if (typeof l.gst_amount === "number") return l.gst_amount > 0;
        return true;
      });

  // Determine Bill Type according to Indian GST Section 31
  const billType =
    options.explicitBillType ||
    determineBillType({
      isShopGstRegistered: settings.isGstRegistered !== false,
      isShopComposition: settings.isComposition === true || options.isComposition === true,
      hasTaxableItems,
      partyGstin: inv.party_gstin,
      partyCategory: options.partyCategory,
      paymentMode: inv.payment_mode,
      lines: rawLines as any,
    });

  const isBillOfSupply = billType === "BILL OF SUPPLY";

  // Build Lines
  const lines: BillLineItem[] = rawLines.map((l: any, index: number) => {
    const qtyUnits = typeof l.qty === "number" ? (l.qty > 1000 ? l.qty / 1000 : l.qty) : 1;
    // Rate in rupees (handles paise conversion if rate > 1000 and total matches)
    let rateRupees = typeof l.rate === "number" ? l.rate : 0;
    if (rateRupees > 5000 && l.total && rateRupees * qtyUnits > l.total * 50) {
      rateRupees = rateRupees / 100;
    } else if (l.rate && l.rate > 2000 && (!l.total || l.total > 100000)) {
      rateRupees = l.rate / 100;
    }

    let taxable = typeof l.taxable === "number" ? l.taxable : 0;
    if (taxable > 10000) taxable = taxable / 100;

    let total = typeof l.total === "number" ? l.total : 0;
    if (total > 10000) total = total / 100;

    // Fallbacks if not computed
    if (!taxable && rateRupees && qtyUnits) {
      taxable = rateRupees * qtyUnits;
    }
    if (!total && taxable) {
      total = taxable;
    }

    const discount = typeof l.discount === "number" ? l.discount : 0;
    const hsn = l.hsn || (l.item_name?.includes("यूरिया") ? "3102" : l.item_name?.includes("डीएपी") ? "3105" : "3808");
    const gstRate = isBillOfSupply ? 0 : (typeof l.gst_rate === "number" ? l.gst_rate : (l.item_name?.includes("क्लोरो") ? 18 : 5));

    let cgstRate = 0;
    let cgstAmount = 0;
    let sgstRate = 0;
    let sgstAmount = 0;
    let igstRate = 0;
    let igstAmount = 0;

    if (!isBillOfSupply && gstRate > 0) {
      if (isInterstate) {
        igstRate = gstRate;
        igstAmount = Number(((taxable * igstRate) / 100).toFixed(2));
      } else {
        cgstRate = gstRate / 2;
        cgstAmount = Number(((taxable * cgstRate) / 100).toFixed(2));
        sgstRate = gstRate / 2;
        sgstAmount = Number(((taxable * sgstRate) / 100).toFixed(2));
      }
    }

    const totalTax = cgstAmount + sgstAmount + igstAmount;
    const finalTotal = isBillOfSupply ? taxable : Number((taxable + totalTax).toFixed(2));

    return {
      srNo: index + 1,
      name: l.item_name || "सामान",
      hsn,
      qty: qtyUnits,
      unit: l.unit || "बोरी",
      rate: rateRupees,
      discount,
      taxableAmount: taxable,
      gstRate,
      cgstRate,
      cgstAmount,
      sgstRate,
      sgstAmount,
      igstRate,
      igstAmount,
      totalAmount: finalTotal,
    };
  });

  // Calculate Totals
  let totalQty = 0;
  let totalTaxable = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;

  lines.forEach((l) => {
    totalQty += l.qty;
    totalTaxable += l.taxableAmount;
    totalCgst += l.cgstAmount;
    totalSgst += l.sgstAmount;
    totalIgst += l.igstAmount;
  });

  totalTaxable = Number(totalTaxable.toFixed(2));
  totalCgst = Number(totalCgst.toFixed(2));
  totalSgst = Number(totalSgst.toFixed(2));
  totalIgst = Number(totalIgst.toFixed(2));
  const totalTax = Number((totalCgst + totalSgst + totalIgst).toFixed(2));

  const unroundedGrandTotal = totalTaxable + totalTax;
  const grandTotal = Math.round(unroundedGrandTotal);
  const roundOff = Number((grandTotal - unroundedGrandTotal).toFixed(2));

  // Build HSN Summary
  const hsnMap = new Map<string, BillHsnSummary>();
  if (!isBillOfSupply) {
    lines.forEach((l) => {
      const existing = hsnMap.get(l.hsn);
      if (existing) {
        existing.taxableAmount = Number((existing.taxableAmount + l.taxableAmount).toFixed(2));
        existing.cgstAmount = Number((existing.cgstAmount + l.cgstAmount).toFixed(2));
        existing.sgstAmount = Number((existing.sgstAmount + l.sgstAmount).toFixed(2));
        existing.igstAmount = Number((existing.igstAmount + l.igstAmount).toFixed(2));
        existing.totalTax = Number((existing.totalTax + l.cgstAmount + l.sgstAmount + l.igstAmount).toFixed(2));
      } else {
        hsnMap.set(l.hsn, {
          hsn: l.hsn,
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
  }

  const hsnSummary = Array.from(hsnMap.values());

  const invoiceNo = inv.invoice_no || formatBillNumber(1, settings.fyPrefix || "KK", inv.date);
  const date = inv.date || new Date().toISOString().split("T")[0];

  return {
    shop: {
      name: settings.shopName || "श्री राम कृषि केंद्र",
      logoData: settings.logoData || (settings as any).logoUrl || "",
      logoUrl: settings.logoData || (settings as any).logoUrl || "",
      address: settings.address || "मुख्य बाजार, सीहोर (म.प्र.)",
      gstin: settings.gstin || "23AAAAA0000A1Z5",
      phone: settings.phone || "9876543210",
      stateCode: shopStateCode,
      bankName: settings.bankName || "State Bank of India (भारतीय स्टेट बैंक)",
      bankAccountNo: settings.bankAccountNo || "30291827364",
      bankIfsc: settings.bankIfsc || "SBIN0001234",
      bankBranch: settings.bankBranch || "सीहोर मुख्य शाखा (Sehore Main)",
      upiId: settings.upiId || "ramkrishi@sbi",
      termsAndConditions: settings.termsAndConditions || settings.footerNote || "",
      signatureText: settings.signatureText || "अधिकृत हस्ताक्षरकर्ता (Authorized Signatory)",
      signatureData: settings.signatureData || (settings as any).signatureUrl || "",
      signatureUrl: settings.signatureData || (settings as any).signatureUrl || "",
    },
    party: {
      name: inv.party_name || "नकद ग्राहक (Cash Customer)",
      address: inv.party_village || "सीहोर",
      village: inv.party_village || undefined,
      gstin: inv.party_gstin || null,
      phone: inv.party_phone || null,
      stateCode: partyStateCode,
      category: options.partyCategory || (inv.party_gstin ? "Registered Regular" : "Unregistered Consumer"),
    },
    invoice: {
      invoiceNo,
      date,
      billType,
      isDuplicate: options.isDuplicate,
      isCancelled: options.isCancelled,
      paymentMode: inv.payment_mode || "cash",
      reverseCharge: "No",
    },
    lines,
    totals: {
      totalQty,
      totalTaxable,
      totalCgst,
      totalSgst,
      totalIgst,
      totalTax,
      roundOff,
      grandTotal,
      amountInWordsHindi: numberToWordsHindi(grandTotal),
      amountInWordsEnglish: numberToWordsEnglish(grandTotal),
    },
    hsnSummary,
    customization: {
      format: settings.defaultBillFormat || "A4",
      language: settings.billLanguage || "both",
      visibleColumns: settings.visibleColumns,
    },
  };
}

export async function buildBillDataWithQr(options: BuildBillOptions): Promise<BillData> {
  const bill = buildBillData(options);
  if (!options.qrDataUrl && bill.shop.upiId) {
    const qrDataUrl = await generateUpiQrDataUrl({
      upiId: bill.shop.upiId,
      payeeName: bill.shop.name,
      amount: bill.totals.grandTotal,
      invoiceNo: bill.invoice.invoiceNo,
    });
    if (qrDataUrl) {
      bill.shop.logoUrl = bill.shop.logoUrl || ""; // preserve
      (bill as any).qrDataUrl = qrDataUrl;
    }
  } else if (options.qrDataUrl) {
    (bill as any).qrDataUrl = options.qrDataUrl;
  }
  return bill;
}
