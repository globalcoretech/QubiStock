import React, { useState, useEffect } from "react";
import { BillData, BillFormat, BillTaxMode } from "../../types";
import { BillA4 } from "./BillA4";
import { BillA5 } from "./BillA5";
import { BillA6 } from "./BillA6";
import { generateUpiQrDataUrl } from "../../utils/qrCode";
import "./BillStyles.css";

interface BillViewerProps {
  bill: BillData;
  initialFormat?: BillFormat;
  onFormatChange?: (f: BillFormat) => void;
  taxMode?: BillTaxMode;
  onTaxModeChange?: (m: BillTaxMode) => void;
  isModal?: boolean;
}

export const BillViewer: React.FC<BillViewerProps> = ({
  bill,
  initialFormat,
  onFormatChange,
  isModal = false,
}) => {
  const [format, setFormat] = useState<BillFormat>(
    initialFormat || bill.customization?.format || "A4"
  );
  const [qrUrl, setQrUrl] = useState<string>((bill as any).qrDataUrl || "");

  useEffect(() => {
    if (initialFormat) {
      setFormat(initialFormat);
    }
  }, [initialFormat]);

  useEffect(() => {
    let isMounted = true;
    if (bill.shop.upiId && !qrUrl) {
      generateUpiQrDataUrl({
        upiId: bill.shop.upiId,
        payeeName: bill.shop.name,
        amount: bill.totals.grandTotal,
        invoiceNo: bill.invoice.invoiceNo,
      }).then((url) => {
        if (isMounted && url) {
          setQrUrl(url);
        }
      });
    }
    return () => {
      isMounted = false;
    };
  }, [bill.shop.upiId, bill.shop.name, bill.totals.grandTotal, bill.invoice.invoiceNo]);

  const handleFormatSelect = (f: BillFormat) => {
    setFormat(f);
    if (onFormatChange) onFormatChange(f);
  };

  return (
    <div className="w-full flex flex-col items-center">
      {/* Format Selector Pills (Hidden in Print) - tax mode is controlled exclusively by PrintInvoiceModal cards */}
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2 w-full max-w-xl bg-slate-100 p-1.5 rounded-xl border border-slate-300">
        <div className="flex items-center gap-1">
          <span className="text-xs font-bold text-slate-700 px-1">
            आकार (Size):
          </span>
          {(["A4", "A5", "A6"] as BillFormat[]).map((fmt) => (
            <button
              key={fmt}
              type="button"
              data-testid={`bill-format-btn-${fmt}`}
              onClick={() => handleFormatSelect(fmt)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                format === fmt
                  ? "bg-forest text-white shadow-xs"
                  : "bg-white text-slate-700 hover:bg-slate-50 border border-slate-200"
              }`}
            >
              {fmt}
            </button>
          ))}
        </div>
      </div>

      {/* Render selected format */}
      <div className={`bill-container bill-${format.toLowerCase()}-page flex justify-center w-full`}>
        {format === "A4" && (
          <BillA4 bill={bill} qrDataUrl={qrUrl} isPrintPreview={!isModal} />
        )}
        {format === "A5" && (
          <BillA5 bill={bill} qrDataUrl={qrUrl} isPrintPreview={!isModal} />
        )}
        {format === "A6" && (
          <BillA6 bill={bill} qrDataUrl={qrUrl} isPrintPreview={!isModal} />
        )}
      </div>
    </div>
  );
};
