import { describe, it, expect } from "vitest";
import {
  calculateInvoiceProfit,
  generateCsvWithBom,
  prepareSalesGstModeCsv,
  prepareGroupInvoicesCsv,
  prepareItemPartiesCsv,
  preparePartyItemsCsv,
} from "./reportsHelper";
import {
  SalesGstModeReport,
  SalesGstModeGroupSummary,
  ItemPartiesReport,
  PartyItemsReport,
} from "../types";

describe("reportsHelper", () => {
  describe("calculateInvoiceProfit", () => {
    it("handles round-off when diff is less than 100 paise", () => {
      // taxable: 100000 paise (Rs 1,000), gst: 5000 paise (Rs 50), total: 105040 paise (diff = -40 paise < 100)
      const res = calculateInvoiceProfit(100000, 5000, 105040, 80000);
      expect(res.billDiscount).toBe(0);
      expect(res.roundOff).toBe(40);
      expect(res.netTaxable).toBe(100000);
      expect(res.profit).toBe(20000); // 100000 - 80000
    });

    it("handles bill discount when diff is 100 paise or greater", () => {
      // taxable: 200000 paise (Rs 2,000), gst: 10000 paise (Rs 100), total: 205000 paise (saved total Rs 2,050 -> discount Rs 50)
      const res = calculateInvoiceProfit(200000, 10000, 205000, 150000);
      expect(res.billDiscount).toBe(5000); // 5000 paise (Rs 50)
      expect(res.roundOff).toBe(0);
      expect(res.netTaxable).toBe(195000); // 200000 - 5000
      expect(res.profit).toBe(45000); // 195000 - 150000
    });
  });

  describe("generateCsvWithBom", () => {
    it("prepends UTF-8 BOM byte \\uFEFF", () => {
      const csv = generateCsvWithBom(["नाम", "राशि"], [["राम", 500]]);
      expect(csv.startsWith("\uFEFF")).toBe(true);
      expect(csv).toContain('"नाम","राशि"');
      expect(csv).toContain('"राम","500"');
    });
  });

  describe("prepareSalesGstModeCsv", () => {
    it("correctly structures groups and total row", () => {
      const mockReport: SalesGstModeReport = {
        groups: [
          {
            group_key: "WITH_GST",
            group_name: "जीएसटी सहित",
            bills_count: 5,
            taxable_sales: 500000,
            gst_collected: 25000,
            bill_total: 525000,
            cost: 400000,
            profit: 100000,
            profit_margin_pct: 20.0,
            diff_vs_printed_total: 0,
            invoices: [],
          },
          {
            group_key: "WITHOUT_GST",
            group_name: "बिना जीएसटी",
            bills_count: 2,
            taxable_sales: 200000,
            gst_collected: 0,
            bill_total: 210000,
            cost: 160000,
            profit: 40000,
            profit_margin_pct: 20.0,
            diff_vs_printed_total: 10000,
            invoices: [],
          },
          {
            group_key: "NOT_PRINTED",
            group_name: "प्रिंट नहीं हुआ",
            bills_count: 1,
            taxable_sales: 100000,
            gst_collected: 5000,
            bill_total: 105000,
            cost: 80000,
            profit: 20000,
            profit_margin_pct: 20.0,
            diff_vs_printed_total: 0,
            invoices: [],
          },
        ],
        total_bills_count: 8,
        total_taxable_sales: 800000,
        total_gst_collected: 30000,
        total_bill_amount: 840000,
        total_cost: 640000,
        total_profit: 160000,
        total_profit_margin_pct: 20.0,
        total_diff_vs_printed_total: 10000,
      };

      const { headers, rows } = prepareSalesGstModeCsv(mockReport);
      expect(headers).toContain("समूह (Group)");
      expect(rows.length).toBe(4); // 3 groups + total row
      expect(rows[0][0]).toBe("जीएसटी सहित");
      expect(rows[1][8]).toBe("100.00"); // 10000 paise = 100.00 diff vs printed
      expect(rows[3][0]).toBe("कुल योग (Total)");
    });
  });

  describe("prepareItemPartiesCsv", () => {
    it("formats item-wise parties report correctly", () => {
      const mockReport: ItemPartiesReport = {
        item_id: 1,
        item_name: "DAP Fertilizer",
        base_unit: "BAG",
        direction: "purchased_from",
        parties: [
          {
            party_id: 10,
            party_name: "Kisan Trading",
            bills_count: 3,
            total_qty: 30000, // 30 bags
            unit: "BAG",
            total_amount: 3600000,
            min_rate: 110000,
            max_rate: 120000,
            average_rate: 115000,
            last_rate: 120000,
            last_date: "2026-10-15",
            bills: [],
          },
        ],
        total_bills_count: 3,
        total_qty: 30000,
        total_amount: 3600000,
      };

      const { headers, rows } = prepareItemPartiesCsv(mockReport);
      expect(headers[0]).toBe("सप्लायर का नाम");
      expect(rows.length).toBe(2); // 1 party + total row
      expect(rows[0][0]).toBe("Kisan Trading");
      expect(rows[0][2]).toBe("30");
    });
  });

  describe("prepareGroupInvoicesCsv", () => {
    it("formats group invoices into CSV table", () => {
      const mockGroup: SalesGstModeGroupSummary = {
        group_key: "WITH_GST",
        group_name: "GST सहित",
        bills_count: 1,
        taxable_sales: 100000,
        gst_collected: 18000,
        bill_total: 118000,
        cost: 80000,
        profit: 20000,
        profit_margin_pct: 20.0,
        diff_vs_printed_total: 0,
        invoices: [
          {
            invoice_no: "INV-001",
            date: "2026-10-01",
            party_name: "Ramesh Kumar",
            taxable: 100000,
            gst: 18000,
            total: 118000,
            cost: 80000,
            profit: 20000,
            printed_mode: "WITH_GST",
            last_printed_time: "2026-10-01T10:00:00",
          },
        ],
      };

      const { headers, rows } = prepareGroupInvoicesCsv(mockGroup);
      expect(headers[1]).toBe("बिल नं");
      expect(rows.length).toBe(1);
      expect(rows[0][1]).toBe("INV-001");
      expect(rows[0][3]).toBe("1000.00");
    });
  });

  describe("preparePartyItemsCsv", () => {
    it("formats party items into CSV table", () => {
      const mockPartyReport: PartyItemsReport = {
        party_id: 1,
        party_name: "Sharma Agro",
        direction: "purchased_from",
        items: [
          {
            item_id: 101,
            item_name: "DAP 50kg",
            base_unit: "BAG",
            bills_count: 2,
            total_qty: 20000,
            total_amount: 2700000,
            min_rate: 135000,
            max_rate: 135000,
            average_rate: 135000,
            last_rate: 135000,
            last_date: "2026-10-12",
            bills: [],
          },
        ],
        total_bills_count: 2,
        total_amount: 2700000,
      };

      const { headers, rows } = preparePartyItemsCsv(mockPartyReport);
      expect(headers[0]).toBe("सामान का नाम (Item)");
      expect(rows.length).toBe(2);
      expect(rows[0][0]).toBe("DAP 50kg");
    });
  });
});
