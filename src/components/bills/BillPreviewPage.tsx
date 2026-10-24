import React, { useState, useEffect } from "react";
import { ALL_SCENARIOS } from "../../demo/billScenarios";
import { BillFormat } from "../../types";
import { BillA4 } from "./BillA4";
import { BillA5 } from "./BillA5";
import { BillA6 } from "./BillA6";
import { generateUpiQrDataUrl } from "../../utils/qrCode";
import "./BillStyles.css";

export const BillPreviewPage: React.FC = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const scenarioParam = urlParams.get("scenario") || "10_items";
  const formatParam = (urlParams.get("format") || "A4") as BillFormat;

  const [activeScenarioId, setActiveScenarioId] = useState(scenarioParam);
  const [activeFormat, setActiveFormat] = useState<BillFormat>(formatParam);
  const [qrUrl, setQrUrl] = useState<string>("");

  const currentScenario =
    ALL_SCENARIOS.find((s) => s.id === activeScenarioId) || ALL_SCENARIOS[0];

  useEffect(() => {
    let isMounted = true;
    const bill = currentScenario.bill;
    if (bill.shop.upiId) {
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
  }, [currentScenario]);

  return (
    <div className="min-h-screen bg-slate-200/60 p-4 sm:p-6 print:p-0 print:bg-white print:block print:min-h-0 print:m-0 flex flex-col items-center">
      {/* Top Scenario & Format Switcher Bar (Hidden in Print) */}
      <div className="no-print w-full max-w-4xl bg-white p-3 rounded-xl border border-slate-300 shadow-sm mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold text-slate-700">परिदृश्य (Scenario):</label>
          <select
            value={activeScenarioId}
            onChange={(e) => setActiveScenarioId(e.target.value)}
            className="text-xs font-bold px-3 py-1.5 border border-slate-300 rounded-lg bg-slate-50 focus:ring-1 focus:ring-forest outline-none"
          >
            {ALL_SCENARIOS.map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-bold text-slate-700">साइज (Size):</label>
          <div className="flex rounded-lg border border-slate-300 bg-slate-100 p-0.5">
            {(["A4", "A5", "A6"] as BillFormat[]).map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => setActiveFormat(fmt)}
                className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                  activeFormat === fmt
                    ? "bg-slate-900 text-white shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {fmt}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => window.print()}
            className="btn-primary text-xs py-1.5 px-3.5 ml-2"
          >
            प्रिंट करें (Print)
          </button>
        </div>
      </div>

      {/* Render Document */}
      <div
        id="bill-print-target"
        className={`bill-container bill-${activeFormat.toLowerCase()}-page print:block print:w-full flex justify-center w-full`}
      >
        {activeFormat === "A4" && (
          <BillA4
            bill={currentScenario.bill}
            qrDataUrl={qrUrl}
            isPrintPreview={true}
          />
        )}
        {activeFormat === "A5" && (
          <BillA5
            bill={currentScenario.bill}
            qrDataUrl={qrUrl}
            isPrintPreview={true}
          />
        )}
        {activeFormat === "A6" && (
          <BillA6
            bill={currentScenario.bill}
            qrDataUrl={qrUrl}
            isPrintPreview={true}
          />
        )}
      </div>
    </div>
  );
};
