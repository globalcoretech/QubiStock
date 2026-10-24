import QRCode from "qrcode";

export interface UpiQrParams {
  upiId: string;
  payeeName: string;
  amount?: number;
  invoiceNo?: string;
  note?: string;
}

/**
 * Builds standard NPCI UPI URI
 * e.g. upi://pay?pa=ramkrishi@sbi&pn=Shri%20Ram%20Krishi&am=12500.00&cu=INR&tn=Invoice_KK-25-26-0001
 */
export function buildUpiUri(params: UpiQrParams): string {
  const { upiId, payeeName, amount, invoiceNo, note } = params;
  if (!upiId) return "";

  const cleanUpi = upiId.trim();
  const cleanName = payeeName.trim().slice(0, 50);
  const transactionNote = (note || (invoiceNo ? `Bill ${invoiceNo}` : "Payment")).trim();

  let uri = `upi://pay?pa=${encodeURIComponent(cleanUpi)}&pn=${encodeURIComponent(cleanName)}&cu=INR`;
  if (amount && amount > 0) {
    uri += `&am=${amount.toFixed(2)}`;
  }
  if (transactionNote) {
    uri += `&tn=${encodeURIComponent(transactionNote)}`;
  }

  return uri;
}

/**
 * Generates an offline Base64 Data URL for UPI QR code
 */
export async function generateUpiQrDataUrl(params: UpiQrParams): Promise<string> {
  const uri = buildUpiUri(params);
  if (!uri) return "";

  try {
    const dataUrl = await QRCode.toDataURL(uri, {
      margin: 1,
      width: 140,
      color: {
        dark: "#1c2b24", // matches brand ink
        light: "#ffffff",
      },
      errorCorrectionLevel: "M",
    });
    return dataUrl;
  } catch (err) {
    console.error("Failed to generate UPI QR:", err);
    return "";
  }
}
