import { invoke } from "@tauri-apps/api/core";
import { AppSettings, BillFormat } from "../types";

export interface PrinterInfo {
  name: string;
  is_default: boolean;
  status?: string;
  port_name?: string;
}

export interface PrintBillRequest {
  printer_name?: string;
  html?: string;
  title?: string;
  paper_size?: string;
  silent: boolean;
  offset_x_mm?: number;
  offset_y_mm?: number;
}

export interface PrintBillResponse {
  success: boolean;
  message: string;
  printer_used: string;
  method_used: string;
  raw_error?: string;
}

/**
 * Injects dynamic @page size and physical X/Y offset CSS rules into document head
 */
export function applyPrintPageStyles(
  paperSize: BillFormat = "A4",
  offsetXmm: number = 0,
  offsetYmm: number = 0
) {
  let styleEl = document.getElementById("krishi-dynamic-print-style") as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "krishi-dynamic-print-style";
    document.head.appendChild(styleEl);
  }

  let sizeCss = "size: A4 portrait; margin: 8mm;";
  if (paperSize === "A5") {
    sizeCss = "size: A5 portrait; margin: 6mm;";
  } else if (paperSize === "A6") {
    sizeCss = "size: 105mm 148mm; margin: 4mm;";
  }

  styleEl.textContent = `
    @media print {
      @page {
        ${sizeCss}
      }
      body {
        --print-offset-x: ${offsetXmm}mm;
        --print-offset-y: ${offsetYmm}mm;
      }
      .bill-container, .bill-print-container, .bill-paper {
        margin-left: ${offsetXmm}mm !important;
        margin-top: ${offsetYmm}mm !important;
      }
    }
  `;
}

/**
 * Triggers native window.print() dialog safely with exact paper size and alignment
 */
export function executeDialogPrint(
  paperSize: BillFormat = "A4",
  offsetXmm: number = 0,
  offsetYmm: number = 0
): Promise<void> {
  return new Promise((resolve) => {
    applyPrintPageStyles(paperSize, offsetXmm, offsetYmm);
    document.body.classList.add("printing-bill");

    const cleanup = () => {
      document.body.classList.remove("printing-bill");
      window.removeEventListener("afterprint", cleanup);
      resolve();
    };

    window.addEventListener("afterprint", cleanup);

    // Trigger dialog
    window.print();

    // Fallback cleanup in case afterprint event does not fire in some WebViews
    setTimeout(cleanup, 2000);
  });
}

/**
 * Executes bill print using the configured printer and mode (dialog vs silent)
 */
export async function printInvoiceBill(params: {
  settings: AppSettings;
  format?: BillFormat;
  htmlContent?: string;
  invoiceNo?: string;
}): Promise<PrintBillResponse> {
  const { settings, format, htmlContent, invoiceNo } = params;
  const paperSize = format || settings.printerPaperSize || settings.defaultBillFormat || "A4";
  const offsetX = settings.printOffsetXmm || 0;
  const offsetY = settings.printOffsetYmm || 0;
  const printerName = settings.selectedPrinter || undefined;
  const mode = settings.printMode || "dialog";

  if (mode === "dialog") {
    await executeDialogPrint(paperSize, offsetX, offsetY);
    return {
      success: true,
      message: "प्रिंट डायलॉग खोला गया।",
      printer_used: printerName || "सिस्टम डिफ़ॉल्ट",
      method_used: "dialog",
    };
  }

  // Silent Mode: Call Rust print_bill command
  try {
    const response = await invoke<PrintBillResponse>("print_bill", {
      req: {
        printer_name: printerName,
        html: htmlContent,
        title: `Bill ${invoiceNo || ""}`,
        paper_size: paperSize,
        silent: true,
        offset_x_mm: offsetX,
        offset_y_mm: offsetY,
      },
    });
    return response;
  } catch (err: any) {
    const errMsg = typeof err === "string" ? err : err?.message || JSON.stringify(err);
    return {
      success: false,
      message: `प्रिंटर '${printerName || "Default"}' पर प्रिंट करने में विफल।`,
      printer_used: printerName || "अज्ञात",
      method_used: "silent_edge",
      raw_error: errMsg,
    };
  }
}
