/**
 * Bill Number & Financial Year Generator
 * Formats: <PREFIX>/<FY>/<SEQ> e.g. KK/26-27/0001 (max 16 chars)
 */

export function getFinancialYear(dateInput?: Date | string): string {
  let year: number;
  let month: number; // 0 = Jan, 3 = Apr, 9 = Oct, 11 = Dec

  if (!dateInput) {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth();
  } else if (typeof dateInput === "string") {
    // Parse "YYYY-MM-DD" or ISO string
    const clean = dateInput.trim().split("T")[0];
    const parts = clean.split("-");
    if (parts.length >= 2) {
      year = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10) - 1; // 0-indexed
    } else {
      const d = new Date(dateInput);
      year = d.getFullYear();
      month = d.getMonth();
    }
  } else {
    year = dateInput.getFullYear();
    month = dateInput.getMonth();
  }

  let startYear = year;
  let endYear = year + 1;

  // Indian FY is April 1 to March 31
  // Jan (0), Feb (1), Mar (2) belong to previous calendar year's FY
  if (month < 3) {
    startYear = year - 1;
    endYear = year;
  }

  const startYY = String(startYear % 100).padStart(2, "0");
  const endYY = String(endYear % 100).padStart(2, "0");

  return `${startYY}-${endYY}`;
}

export function formatBillNumber(
  seq: number = 1,
  prefix: string = "KK",
  dateInput?: Date | string
): string {
  const cleanPrefix = (prefix || "KK").trim().toUpperCase().slice(0, 4);
  const fy = getFinancialYear(dateInput);
  const paddedSeq = String(seq).padStart(4, "0").slice(-5);
  
  const billNo = `${cleanPrefix}/${fy}/${paddedSeq}`;
  return billNo.slice(0, 16);
}

/**
 * Determines bill type according to GST Law:
 * Rule 1: Shop NOT GST registered -> Always "CASH MEMO"
 * Rule 2: Shop in Composition Scheme -> Always "BILL OF SUPPLY"
 * Rule 3: Shop regular registered:
 *   - Taxable items present -> Always "TAX INVOICE" (Unregistered customer's GSTIN is simply empty)
 *   - All items exempt/nil-rated -> "BILL OF SUPPLY"
 */
export interface BillLineForTaxCheck {
  name?: string;
  item_name?: string;
  gst_rate?: number | null;
  gst_status?: "taxable" | "nil_rated" | "exempt" | "not_set" | null;
  gstRate?: number | null;
}

export interface DetermineBillTypeOptions {
  isShopGstRegistered?: boolean;
  isShopComposition?: boolean;
  hasTaxableItems?: boolean;
  // Compatibility fallbacks
  isComposition?: boolean;
  partyGstin?: string | null;
  partyCategory?: string;
  hasGst?: boolean;
  paymentMode?: string;
  lines?: BillLineForTaxCheck[];
}

export function determineBillType(
  options: DetermineBillTypeOptions
): "TAX INVOICE" | "BILL OF SUPPLY" | "CASH MEMO" {
  // 0. Check lines: if any line has GST empty / not_set, bill cannot be created!
  if (options.lines && options.lines.length > 0) {
    for (const l of options.lines) {
      const status = l.gst_status;
      const rate = l.gst_rate !== undefined ? l.gst_rate : l.gstRate;
      if (status === "not_set" || (status === undefined && (rate === null || rate === undefined))) {
        throw new Error(
          `Item "${l.name || l.item_name || "Unknown"}" has GST status 'not_set'. Bill cannot be created.`
        );
      }
    }
  }

  // 1. Dukaan GST registered nahi hai -> Hamesha "CASH MEMO"
  if (options.isShopGstRegistered === false) {
    return "CASH MEMO";
  }

  // 2. Dukaan composition scheme me hai -> Hamesha "BILL OF SUPPLY"
  if (options.isShopComposition === true || options.isComposition === true) {
    return "BILL OF SUPPLY";
  }

  // Calculate hasTaxableItems from lines if not explicitly passed
  let hasTaxable = options.hasTaxableItems;
  if (hasTaxable === undefined && options.lines && options.lines.length > 0) {
    hasTaxable = options.lines.some((l) => {
      if (l.gst_status === "taxable") return true;
      if (l.gst_status === "nil_rated" || l.gst_status === "exempt") return false;
      const rate = l.gst_rate !== undefined ? l.gst_rate : l.gstRate;
      return typeof rate === "number" && rate > 0;
    });
  }

  // 3. Regular registered shop:
  // Maal exempt/nil-rated hai ya zero-tax hai -> "BILL OF SUPPLY"
  if (hasTaxable === false || options.hasGst === false) {
    return "BILL OF SUPPLY";
  }

  // 4. Regular registered shop + taxable maal = Hamesha "TAX INVOICE"
  // (Customer unregistered ho tab bhi Tax Invoice hi banega, GSTIN khali rahega)
  return "TAX INVOICE";
}
