import { describe, it, expect } from "vitest";
import { determineBillType, buildBillData } from "./billBuilder";
import { DEFAULT_SETTINGS } from "../types";

describe("determineBillType (GST Section 31 Compliance)", () => {
  // Case 1: registered shop + unregistered customer = Tax Invoice
  it("registered shop + unregistered customer (with taxable items) produces TAX INVOICE", () => {
    const result = determineBillType({
      isShopGstRegistered: true,
      isShopComposition: false,
      partyGstin: null, // unregistered customer (no GSTIN)
      partyCategory: "unregistered",
      lines: [
        {
          name: "DAP Fertilizer",
          gst_rate: 5,
          gst_status: "taxable",
        },
      ],
    });

    expect(result).toBe("TAX INVOICE");
  });

  // Case 2: composition shop = Bill of Supply
  it("composition shop always produces BILL OF SUPPLY", () => {
    const result = determineBillType({
      isShopGstRegistered: true,
      isShopComposition: true,
      partyGstin: "23ABCDE1234F1Z5",
      lines: [
        {
          name: "Pesticide",
          gst_rate: 18,
          gst_status: "taxable",
        },
      ],
    });

    expect(result).toBe("BILL OF SUPPLY");
  });

  // Case 3: mixed bill (nil-rated beej + 5% khaad) = Tax Invoice
  it("mixed bill (nil-rated certified seeds + 5% urea/fertilizer) produces TAX INVOICE", () => {
    const result = determineBillType({
      isShopGstRegistered: true,
      isShopComposition: false,
      partyGstin: null,
      lines: [
        {
          name: "Certified Wheat Seed (Beej)",
          gst_rate: 0,
          gst_status: "nil_rated",
        },
        {
          name: "Urea Fertilizer (Khaad)",
          gst_rate: 5,
          gst_status: "taxable",
        },
      ],
    });

    expect(result).toBe("TAX INVOICE");
  });

  // Case 4: saare items nil-rated = Bill of Supply
  it("all items nil-rated produces BILL OF SUPPLY", () => {
    const result = determineBillType({
      isShopGstRegistered: true,
      isShopComposition: false,
      lines: [
        {
          name: "Certified Wheat Seed",
          gst_rate: 0,
          gst_status: "nil_rated",
        },
        {
          name: "Gram Seed (Chana Beej)",
          gst_rate: 0,
          gst_status: "nil_rated",
        },
      ],
    });

    expect(result).toBe("BILL OF SUPPLY");
  });

  // Case 5: gst-unregistered shop = Cash Memo
  it("gst-unregistered shop produces CASH MEMO", () => {
    const result = determineBillType({
      isShopGstRegistered: false,
      isShopComposition: false,
      lines: [
        {
          name: "DAP Fertilizer",
          gst_rate: 5,
          gst_status: "taxable",
        },
      ],
    });

    expect(result).toBe("CASH MEMO");
  });

  // Case 6: item ka GST khali (not_set) = bill nahi banna chahiye (throws Error)
  it("throws error when an item has GST empty or not_set", () => {
    expect(() =>
      determineBillType({
        isShopGstRegistered: true,
        lines: [
          {
            name: "New Unclassified Chemical",
            gst_rate: null,
            gst_status: "not_set",
          },
        ],
      })
    ).toThrowError(/not_set/i);
  });
});

describe("buildBillData integration with determineBillType", () => {
  it("generates complete BillData with TAX INVOICE for registered shop and unregistered farmer", () => {
    const bill = buildBillData({
      settings: {
        ...DEFAULT_SETTINGS,
        isGstRegistered: true,
        isComposition: false,
      },
      invoiceDetails: {
        invoice_no: "KK/26-27/0001",
        date: "2026-10-24",
        party_name: "Ramesh Farmer",
        party_gstin: null,
        lines: [
          {
            item_name: "Urea 45kg",
            qty: 2000, // 2 bags
            unit: "bag",
            rate: 26650, // ₹266.50
            taxable: 50762,
            gst_rate: 5,
            gst_status: "taxable",
            gst_amount: 2538,
            total: 53300,
          },
        ],
      },
    });

    expect(bill.invoice.billType).toBe("TAX INVOICE");
    expect(bill.invoice.invoiceNo).toBe("KK/26-27/0001");
    expect(bill.lines.length).toBe(1);
    expect(bill.lines[0].name).toBe("Urea 45kg");
  });

  it("fails bill generation when a line has not_set GST status", () => {
    expect(() =>
      buildBillData({
        settings: DEFAULT_SETTINGS,
        invoiceDetails: {
          invoice_no: "KK/26-27/0002",
          date: "2026-10-24",
          party_name: "Walk-in Farmer",
          lines: [
            {
              item_name: "Uncategorized Seed Packet",
              qty: 1000,
              unit: "packet",
              rate: 10000,
              taxable: 10000,
              gst_rate: null,
              gst_status: "not_set",
              gst_amount: 0,
              total: 10000,
            },
          ],
        },
      })
    ).toThrowError(/not_set/i);
  });
});
