import { invoke } from "@tauri-apps/api/core";

export interface ExportPdfResult {
  success: boolean;
  message: string;
  pdf_path: string;
  filename: string;
  directory: string;
}

/**
 * Sanitizes an Indian phone number to E.164 standard without '+' (e.g. 919876543210)
 */
export function cleanPhoneNumber(phone?: string | null): string {
  if (!phone) return "";
  let digits = phone.replace(/\D/g, "");

  // If 10 digits (standard Indian mobile), prepend 91
  if (digits.length === 10) {
    return `91${digits}`;
  }

  // If 11 digits starting with 0, replace 0 with 91
  if (digits.length === 11 && digits.startsWith("0")) {
    return `91${digits.slice(1)}`;
  }

  // If 12 digits starting with 91, return as-is
  if (digits.length === 12 && digits.startsWith("91")) {
    return digits;
  }

  return digits;
}

/**
 * Formats a respectful bilingual or Hindi/English invoice message for WhatsApp
 */
export function generateWhatsAppBillMessage(params: {
  customerName?: string;
  shopName?: string;
  invoiceNo: string;
  date: string;
  totalAmount: number;
  lang?: "hi" | "en";
}): string {
  const {
    customerName = "किसान भाई",
    shopName = "कृषि केंद्र",
    invoiceNo,
    date,
    totalAmount,
    lang = "hi",
  } = params;

  const formattedAmount = Number(totalAmount || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  if (lang === "en") {
    return `Hello ${customerName} Ji 🙏\n\nYour purchase bill from ${shopName} is attached.\n\n📄 Invoice No: ${invoiceNo}\n📅 Date: ${date}\n💰 Total Amount: ₹${formattedAmount}\n\n🌾 Thank you for shopping with us! High quality seeds, fertilizers & crop care always available.`;
  }

  return `नमस्ते ${customerName} जी 🙏\n\n${shopName} से आपकी खरीदारी का बिल संलग्न है।\n\n📄 बिल सं: ${invoiceNo}\n📅 दिनांक: ${date}\n💰 कुल राशि: ₹${formattedAmount}\n\n🌾 हमारे यहाँ सभी प्रकार के उन्नत खाद, बीज एवं कीटनाशक उपलब्ध हैं। धन्यवाद!`;
}

/**
 * Builds the wa.me deep-link URL
 */
export function buildWhatsAppUrl(phone: string, message: string): string {
  const cleaned = cleanPhoneNumber(phone);
  const encodedText = encodeURIComponent(message);
  if (cleaned) {
    return `https://wa.me/${cleaned}?text=${encodedText}`;
  }
  return `https://wa.me/?text=${encodedText}`;
}

/**
 * Invokes Rust command to export invoice HTML to PDF
 */
export async function exportInvoicePdf(params: {
  html: string;
  invoiceNo: string;
  customerName?: string;
}): Promise<ExportPdfResult> {
  if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
    // Mock for unit tests / web preview
    return {
      success: true,
      message: "Mock PDF exported",
      pdf_path: `C:\\Mock\\${params.invoiceNo}.pdf`,
      filename: `${params.invoiceNo}.pdf`,
      directory: "C:\\Mock",
    };
  }

  return await invoke<ExportPdfResult>("export_invoice_pdf_cmd", {
    req: {
      html: params.html,
      invoice_no: params.invoiceNo,
      customer_name: params.customerName || null,
    },
  });
}

/**
 * Opens file in Windows Explorer and selects/highlights it
 */
export async function openFileInExplorer(path: string): Promise<void> {
  if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
    console.log("Mock openFileInExplorer:", path);
    return;
  }
  await invoke("open_file_in_explorer_cmd", { path });
}

/**
 * Collects all loaded CSS stylesheets into a standalone HTML document for crisp headless PDF rendering
 */
export function buildPrintableBillHtml(
  billEl: Element | null,
  title: string,
  paperSize: string = "A4"
): string {
  let collectedCss = "";
  if (typeof document !== "undefined" && document.styleSheets) {
    for (let i = 0; i < document.styleSheets.length; i++) {
      const sheet = document.styleSheets[i];
      try {
        if (sheet.cssRules) {
          for (let j = 0; j < sheet.cssRules.length; j++) {
            collectedCss += sheet.cssRules[j].cssText + "\n";
          }
        }
      } catch {
        // Ignore cross-origin stylesheets that block cssRules access
      }
    }
  }

  let pageCss = "size: A4 portrait; margin: 6mm;";
  if (paperSize === "A5") {
    pageCss = "size: A5 portrait; margin: 5mm;";
  } else if (paperSize === "A6") {
    pageCss = "size: 105mm 148mm; margin: 4mm;";
  }

  const bodyHtml = billEl ? billEl.outerHTML : "";

  return `<!DOCTYPE html>
<html lang="hi">
<head>
<meta charset="utf-8" />
<title>${title}</title>
<style>
${collectedCss}
@page {
  ${pageCss}
}
html, body {
  background: #ffffff !important;
  color: #0f172a !important;
  margin: 0 !important;
  padding: 0 !important;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}
.no-print {
  display: none !important;
}
.bill-container,
.screen-preview-a4,
.screen-preview-a5,
.screen-preview-a6 {
  width: 100% !important;
  max-width: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
  box-shadow: none !important;
  border: none !important;
}
</style>
</head>
<body class="printing-bill">
${bodyHtml}
</body>
</html>`;
}

/**
 * Copies the generated PDF file to the Windows clipboard (CF_HDROP) so Ctrl+V attaches it directly in WhatsApp
 */
export async function copyFileToClipboard(path: string): Promise<boolean> {
  if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
    return true;
  }
  try {
    await invoke("copy_file_to_clipboard_cmd", { path });
    return true;
  } catch (err) {
    console.warn("copy_file_to_clipboard_cmd failed:", err);
    return false;
  }
}

/**
 * Opens WhatsApp chat via external URL launcher
 */
export async function openWhatsAppChat(phone: string, message: string): Promise<void> {
  const url = buildWhatsAppUrl(phone, message);
  if (typeof window === "undefined" || !(window as any).__TAURI_INTERNALS__) {
    if (typeof window !== "undefined") {
      window.open(url, "_blank");
    }
    return;
  }

  try {
    await invoke("open_external_url_cmd", { url });
  } catch (err) {
    console.warn("open_external_url_cmd failed, falling back to window.open:", err);
    window.open(url, "_blank");
  }
}
