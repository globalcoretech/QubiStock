import { Language } from "../i18n";

/**
 * Formats paise into Indian Rupee format, e.g. 12500000 -> ₹1,25,000.00
 */
export function formatCurrency(paise: number): string {
  const rupees = paise / 100;
  const formatted = rupees.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `₹${formatted}`;
}

/**
 * Formats date from YYYY-MM-DD or ISO to DD/MM/YYYY
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  // If already in DD/MM/YYYY format
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return dateStr;

  // Split YYYY-MM-DD
  const parts = dateStr.split("T")[0].split("-");
  if (parts.length === 3 && parts[0].length === 4) {
    const [year, month, day] = parts;
    return `${day}/${month}/${year}`;
  }

  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    }
  } catch {
    // fallback
  }

  return dateStr;
}

/**
 * Formats quantity in base unit from milli-units (e.g. 10000 milli -> "10")
 */
export function formatQty(qtyMilli: number): string {
  const val = qtyMilli / 1000;
  return val.toLocaleString("en-IN", {
    maximumFractionDigits: 3,
  });
}

/**
 * Formats payment mode localized
 */
export function formatPaymentMode(mode: string, lang: Language): string {
  switch (mode) {
    case "cash":
      return lang === "hi" ? "नकद" : "Cash";
    case "credit":
      return lang === "hi" ? "उधार" : "Credit";
    case "upi_bank":
      return lang === "hi" ? "UPI / बैंक" : "UPI / Bank";
    case "bank":
      return lang === "hi" ? "बैंक ट्रांसफर" : "Bank Transfer";
    default:
      return mode;
  }
}

