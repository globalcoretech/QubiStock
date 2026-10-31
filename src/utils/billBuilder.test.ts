import { describe, it, expect } from "vitest";
import { calculateBill, buildBillData, buildBillDataWithQr } from "./billBuilder";
import { AppSettings, DEFAULT_SETTINGS, InvoicePrintDetails, BillData } from "../types";

describe("billBuilder - Comprehensive Tests & Dual Engine Calculations", () => {
  const sampleSettings: AppSettings = {
    ...DEFAULT_SETTINGS,
    shopName: "श्री राम कृषि केंद्र",
    gstin: "23AABCU9603R1ZM",
    stateCode: "23",
    bankName: "State Bank of India",
    bankAccountNo: "1234567890",
    bankIfsc: "SBIN0001234",
    upiId: "kisan@sbi",
  };

  // Requirement 3: For every test assert: sum of line amounts - discount + roundOff === grandTotal, for both modes
  function assertReconciliation(bill: BillData) {
    const lineSum = Number(
      bill.lines.reduce((acc, l) => acc + l.totalAmount, 0).toFixed(2)
    );
    const discount = bill.totals.discount || 0;
    const roundOff = bill.totals.roundOff;
    const calculatedGrandTotal = Number((lineSum - discount + roundOff).toFixed(2));
    expect(calculatedGrandTotal).toBe(bill.totals.grandTotal);
  }

  // 1. intra-state
  it("intra-state", () => {
    const inv: InvoicePrintDetails = {
      invoice_no: "KK/2026-27/0101",
      date: "2026-06-01",
      party_name: "स्थानीय किसान",
      party_phone: "9826011111",
      party_gstin: "23AABCP1111A1Z1",
      party_village: "सीहोर",
      payment_mode: "cash",
      paid_amount: 105000,
      total_amount: 105000, // Rs 1050.00
      lines: [
        {
          item_name: "डी.ए.पी.",
          qty: 1000, // 1 bag
          unit: "बोरी",
          rate: 100000, // Rs 1000.00
          taxable: 100000, // Rs 1000.00
          gst_amount: 5000, // 5% = Rs 50.00
          total: 105000,
        },
      ],
    };

    const { withGst, withoutGst } = calculateBill(inv, sampleSettings);

    // Intra-state splits into CGST 2.5% and SGST 2.5%, IGST = 0
    expect(withGst.lines[0].cgstRate).toBe(2.5);
    expect(withGst.lines[0].sgstRate).toBe(2.5);
    expect(withGst.lines[0].igstRate).toBe(0);
    expect(withGst.lines[0].cgstAmount).toBe(25);
    expect(withGst.lines[0].sgstAmount).toBe(25);
    expect(withGst.lines[0].igstAmount).toBe(0);
    expect(withGst.totals.totalCgst).toBe(25);
    expect(withGst.totals.totalSgst).toBe(25);
    expect(withGst.totals.totalIgst).toBe(0);

    assertReconciliation(withGst);
    assertReconciliation(withoutGst);
  });

  // 2. inter-state
  it("inter-state", () => {
    const inv: InvoicePrintDetails = {
      invoice_no: "KK/2026-27/0102",
      date: "2026-06-02",
      party_name: "राजस्थान किसान",
      party_phone: "9829022222",
      party_gstin: "08AABCP2222A1Z2", // State code 08 (Rajasthan) != Shop state 23 (MP)
      party_village: "कोटा",
      payment_mode: "bank",
      paid_amount: 236000,
      total_amount: 236000, // Rs 2360.00
      lines: [
        {
          item_name: "कीटनाशक स्प्रे",
          qty: 2000, // 2 units
          unit: "लीटर",
          rate: 100000, // Rs 1000.00
          taxable: 200000, // Rs 2000.00
          gst_amount: 36000, // 18% IGST = Rs 360.00
          total: 236000,
        },
      ],
    };

    const { withGst, withoutGst } = calculateBill(inv, sampleSettings);

    // Inter-state full tax goes to IGST 18%, CGST = 0, SGST = 0
    expect(withGst.lines[0].igstRate).toBe(18);
    expect(withGst.lines[0].igstAmount).toBe(360);
    expect(withGst.lines[0].cgstAmount).toBe(0);
    expect(withGst.lines[0].sgstAmount).toBe(0);
    expect(withGst.totals.totalIgst).toBe(360);
    expect(withGst.totals.totalCgst).toBe(0);
    expect(withGst.totals.totalSgst).toBe(0);

    assertReconciliation(withGst);
    assertReconciliation(withoutGst);
  });

  // 3. 0% GST
  it("0% GST", () => {
    const inv: InvoicePrintDetails = {
      invoice_no: "KK/2026-27/0103",
      date: "2026-06-03",
      party_name: "रमेश पाटीदार",
      party_phone: null,
      party_gstin: null,
      party_village: null,
      payment_mode: "cash",
      paid_amount: 50000,
      total_amount: 50000, // Rs 500.00
      lines: [
        {
          item_name: "गेहूं प्रमाणित बीज",
          qty: 10000, // 10 kg
          unit: "kg",
          rate: 5000, // Rs 50.00/kg
          taxable: 50000, // Rs 500.00
          gst_amount: 0, // 0% GST
          total: 50000,
        },
      ],
    };

    const { withGst, withoutGst } = calculateBill(inv, sampleSettings);

    expect(withGst.lines[0].gstRate).toBe(0);
    expect(withGst.lines[0].cgstAmount).toBe(0);
    expect(withGst.lines[0].sgstAmount).toBe(0);
    expect(withGst.lines[0].totalAmount).toBe(500);
    expect(withGst.totals.totalTax).toBe(0);
    expect(withGst.totals.grandTotal).toBe(500);

    assertReconciliation(withGst);
    assertReconciliation(withoutGst);
  });

  // 4. item discount
  it("item discount", () => {
    const lineItem = {
      item_name: "फर्टिलाइजर बैग",
      qty: 1000,
      unit: "बोरी",
      rate: 100000, // Rs 1000.00
      taxable: 90000, // Taxable = 1000 - 100 = Rs 900.00
      gst_amount: 4500, // 5% of 900 = Rs 45.00
      total: 94500,
      discount: 10000, // Item discount Rs 100.00
    };

    const inv: InvoicePrintDetails = {
      invoice_no: "KK/2026-27/0104",
      date: "2026-06-04",
      party_name: "कमल सिंह",
      party_phone: null,
      party_gstin: null,
      party_village: null,
      payment_mode: "cash",
      paid_amount: 94500,
      total_amount: 94500, // Rs 945.00
      lines: [lineItem as any],
    };

    const { withGst, withoutGst } = calculateBill(inv, sampleSettings);

    expect(withGst.lines[0].rate).toBe(1000);
    expect(withGst.lines[0].discount).toBe(100);
    expect(withGst.lines[0].taxableAmount).toBe(900);
    expect(withGst.lines[0].totalAmount).toBe(945);
    expect(withGst.totals.grandTotal).toBe(945);

    assertReconciliation(withGst);
    assertReconciliation(withoutGst);
  });

  // 5. bill discount
  it("bill discount", () => {
    // Line 1: Rs 2700 + 5% GST (Rs 135) = Rs 2835.00
    // Line 2: Rs 600 + 18% GST (Rs 108) = Rs 708.00
    // Sum lines total = Rs 3543.00
    // Saved total = Rs 3400.00 (Bill discount = Rs 143.00)
    const inv: InvoicePrintDetails = {
      invoice_no: "KK/2026-27/0105",
      date: "2026-06-05",
      party_name: "बलराम किसान",
      party_phone: "9826012345",
      party_gstin: null,
      party_village: "श्यामपुर",
      payment_mode: "cash",
      paid_amount: 340000,
      total_amount: 340000, // Rs 3400.00
      lines: [
        {
          item_name: "डीएपी 50kg",
          qty: 2000,
          unit: "बोरी",
          rate: 135000,
          taxable: 270000,
          gst_amount: 13500,
          total: 283500,
        },
        {
          item_name: "कीटनाशक",
          qty: 1000,
          unit: "लीटर",
          rate: 60000,
          taxable: 60000,
          gst_amount: 10800,
          total: 70800,
        },
      ],
    };

    const { withGst, withoutGst } = calculateBill(inv, sampleSettings);

    // diff = 3543 - 3400 = 143 (>= 100 paise)
    expect(withGst.totals.discount).toBe(143);
    expect(withGst.totals.grandTotal).toBe(3400);

    // In withoutGst mode: Subtotal = 3300, discount = 143, grandTotal = 3157
    expect(withoutGst.totals.discount).toBe(143);
    expect(withoutGst.totals.grandTotal).toBe(3157);

    assertReconciliation(withGst);
    assertReconciliation(withoutGst);
  });

  // 6. no discount but round-off 0.40 (no Discount line expected in both modes)
  it("no discount but round-off 0.40 (no Discount line expected in both modes)", () => {
    // Sum of taxable + GST = Rs 100.40 (10040 paise)
    // Saved total = Rs 100.00 (10000 paise) -> rounded to nearest rupee
    // diff = 10040 - 10000 = 40 paise (|diff| < 100)
    // Must be treated as round-off only (-0.40), NOT as a discount!
    const inv: InvoicePrintDetails = {
      invoice_no: "KK/2026-27/0106",
      date: "2026-06-06",
      party_name: "गोविंद वर्मा",
      party_phone: null,
      party_gstin: null,
      party_village: null,
      payment_mode: "cash",
      paid_amount: 10000,
      total_amount: 10000, // Rs 100.00 (10000 paise)
      lines: [
        {
          item_name: "सब्जी बीज",
          qty: 1000,
          unit: "पैकेट",
          rate: 9562, // Rs 95.62
          taxable: 9562, // Rs 95.62
          gst_amount: 478, // Rs 4.78 (5%)
          total: 10040, // 95.62 + 4.78 = Rs 100.40
        },
      ],
    };

    const { withGst, withoutGst } = calculateBill(inv, sampleSettings);

    // Bill with no discount must NEVER show a Discount line, in either mode
    expect(withGst.totals.discount).toBeUndefined();
    expect(withoutGst.totals.discount).toBeUndefined();

    // Round-off handles the 40 paise difference
    expect(withGst.totals.roundOff).toBe(-0.4);
    expect(withGst.totals.grandTotal).toBe(100);

    assertReconciliation(withGst);
    assertReconciliation(withoutGst);
  });

  // 7. small values (rate Rs 50, qty 0.5, qty exactly 1)
  it("small values (rate Rs 50, qty 0.5, qty exactly 1)", () => {
    // Exact units from get_invoice_details_cmd:
    // qty: milli-units (500 = 0.5, 1000 = 1.0)
    // rate: paise (5000 = Rs 50.00)
    // taxable: paise (2500 = Rs 25.00)
    const inv: InvoicePrintDetails = {
      invoice_no: "KK/2026-27/0107",
      date: "2026-06-07",
      party_name: "छोटे किसान",
      party_phone: null,
      party_gstin: null,
      party_village: null,
      payment_mode: "cash",
      paid_amount: 8125,
      total_amount: 8125, // Rs 81.25 in paise
      lines: [
        {
          item_name: "सल्फर 80% WDG",
          qty: 500, // 0.5 unit (500 milli-units)
          unit: "kg",
          rate: 5000, // Rs 50.00
          taxable: 2500, // 0.5 * 50 = Rs 25.00
          gst_amount: 125, // 5% = Rs 1.25
          total: 2625,
        },
        {
          item_name: "जिंक 33%",
          qty: 1000, // exactly 1 unit (1000 milli-units)
          unit: "kg",
          rate: 5000, // Rs 50.00
          taxable: 5000, // 1 * 50 = Rs 50.00
          gst_amount: 500, // 10% = Rs 5.00
          total: 5500,
        },
      ],
    };

    const { withGst, withoutGst } = calculateBill(inv, sampleSettings);

    // Line 1: qty 0.5, rate Rs 50
    expect(withGst.lines[0].qty).toBe(0.5);
    expect(withGst.lines[0].rate).toBe(50);
    expect(withGst.lines[0].taxableAmount).toBe(25);

    // Line 2: qty 1, rate Rs 50
    expect(withGst.lines[1].qty).toBe(1);
    expect(withGst.lines[1].rate).toBe(50);
    expect(withGst.lines[1].taxableAmount).toBe(50);

    expect(withGst.totals.totalQty).toBe(1.5);
    expect(withGst.totals.totalTaxable).toBe(75);

    assertReconciliation(withGst);
    assertReconciliation(withoutGst);
  });

  // 8. taxable under Rs 100
  it("taxable under Rs 100", () => {
    const inv: InvoicePrintDetails = {
      invoice_no: "KK/2026-27/0108",
      date: "2026-06-08",
      party_name: "दुकान ग्राहक",
      party_phone: null,
      party_gstin: null,
      party_village: null,
      payment_mode: "cash",
      paid_amount: 6300,
      total_amount: 6300, // Rs 63.00
      lines: [
        {
          item_name: "टमाटर बीज पाउच",
          qty: 1000,
          unit: "पाउच",
          rate: 6000, // Rs 60.00
          taxable: 6000, // Rs 60.00 (< Rs 100)
          gst_amount: 300, // 5% = Rs 3.00
          total: 6300,
        },
      ],
    };

    const { withGst, withoutGst } = calculateBill(inv, sampleSettings);

    expect(withGst.totals.totalTaxable).toBeLessThan(100);
    expect(withGst.totals.totalTaxable).toBe(60);
    expect(withGst.totals.grandTotal).toBe(63);

    assertReconciliation(withGst);
    assertReconciliation(withoutGst);
  });

  // 9. purity (input not mutated)
  it("purity (input not mutated)", () => {
    const inv: InvoicePrintDetails = {
      invoice_no: "KK/2026-27/0109",
      date: "2026-06-09",
      party_name: "प्योरिटी टेस्ट",
      party_phone: null,
      party_gstin: null,
      party_village: null,
      payment_mode: "cash",
      paid_amount: 50000,
      total_amount: 50000,
      lines: [
        {
          item_name: "बीज पैकेट",
          qty: 1000,
          unit: "पैकेट",
          rate: 50000,
          taxable: 50000,
          gst_amount: 0,
          total: 50000,
        },
      ],
    };

    const cloned = JSON.parse(JSON.stringify(inv));

    const { withGst, withoutGst } = calculateBill(inv, sampleSettings);
    buildBillData({ invoiceDetails: inv, settings: sampleSettings });

    // Verify input object was not mutated
    expect(inv).toEqual(cloned);

    assertReconciliation(withGst);
    assertReconciliation(withoutGst);
  });

  // 10. QR amount equals active mode grand total
  it("QR amount equals active mode grand total", async () => {
    // Invoice with tax: With GST = Rs 1050, Without GST = Rs 1000
    const inv: InvoicePrintDetails = {
      invoice_no: "KK/2026-27/0110",
      date: "2026-06-10",
      party_name: "क्यूआर ग्राहक",
      party_phone: null,
      party_gstin: null,
      party_village: null,
      payment_mode: "cash",
      paid_amount: 105000,
      total_amount: 105000, // Rs 1050.00 in paise
      lines: [
        {
          item_name: "यूरिया बैग",
          qty: 1000,
          unit: "बोरी",
          rate: 100000,
          taxable: 100000,
          gst_amount: 5000,
          total: 105000,
        },
      ],
    };

    const withGstBill = await buildBillDataWithQr({
      invoiceDetails: inv,
      settings: sampleSettings,
      taxMode: "with_tax",
    });

    const withoutGstBill = await buildBillDataWithQr({
      invoiceDetails: inv,
      settings: sampleSettings,
      taxMode: "without_tax",
    });

    expect(withGstBill.totals.grandTotal).toBe(1050);
    expect(withoutGstBill.totals.grandTotal).toBe(1000);

    // QR Data URL must be generated for each mode using that mode's active grand total
    const qrUrlWith = (withGstBill as any).qrDataUrl || "";
    const qrUrlWithout = (withoutGstBill as any).qrDataUrl || "";

    expect(qrUrlWith.startsWith("data:image/png;base64,")).toBe(true);
    expect(qrUrlWithout.startsWith("data:image/png;base64,")).toBe(true);
    // Different amounts generate distinct QR codes
    expect(qrUrlWith).not.toBe(qrUrlWithout);

    assertReconciliation(withGstBill);
    assertReconciliation(withoutGstBill);
  });

  // 11. WITHOUT_GST has no gstin/hsn/tax values
  it("WITHOUT_GST has no gstin/hsn/tax values", () => {
    const inv: InvoicePrintDetails = {
      invoice_no: "KK/2026-27/0111",
      date: "2026-06-11",
      party_name: "गोपाल दांगी",
      party_phone: "9826033333",
      party_gstin: "23AABCP9999A1Z9",
      party_village: "दौलताबाद",
      payment_mode: "cash",
      paid_amount: 210000,
      total_amount: 210000,
      lines: [
        {
          item_name: "खाद",
          qty: 2000,
          unit: "बोरी",
          rate: 100000,
          taxable: 200000,
          gst_amount: 10000,
          total: 210000,
        },
      ],
    };

    const { withGst, withoutGst } = calculateBill(inv, sampleSettings);

    // Without GST shop gstin & party gstin must be blank/null
    expect(withoutGst.shop.gstin).toBe("");
    expect(withoutGst.party.gstin).toBeNull();

    // Line items must have blank hsn and 0 tax
    withoutGst.lines.forEach((line) => {
      expect(line.hsn).toBe("");
      expect(line.gstRate).toBe(0);
      expect(line.cgstRate).toBe(0);
      expect(line.cgstAmount).toBe(0);
      expect(line.sgstRate).toBe(0);
      expect(line.sgstAmount).toBe(0);
      expect(line.igstRate).toBe(0);
      expect(line.igstAmount).toBe(0);
    });

    // Totals must have 0 tax
    expect(withoutGst.totals.totalCgst).toBe(0);
    expect(withoutGst.totals.totalSgst).toBe(0);
    expect(withoutGst.totals.totalIgst).toBe(0);
    expect(withoutGst.totals.totalTax).toBe(0);
    expect(withoutGst.hsnSummary).toEqual([]);

    assertReconciliation(withGst);
    assertReconciliation(withoutGst);
  });
});
