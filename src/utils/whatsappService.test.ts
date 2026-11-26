import { describe, it, expect } from "vitest";
import {
  cleanPhoneNumber,
  generateWhatsAppBillMessage,
  buildWhatsAppUrl,
} from "./whatsappService";

describe("whatsappService", () => {
  describe("cleanPhoneNumber", () => {
    it("formats 10 digit Indian mobile numbers with 91 prefix", () => {
      expect(cleanPhoneNumber("9876543210")).toBe("919876543210");
      expect(cleanPhoneNumber(" 98765 43210 ")).toBe("919876543210");
      expect(cleanPhoneNumber("9876-543-210")).toBe("919876543210");
    });

    it("handles numbers with leading 0", () => {
      expect(cleanPhoneNumber("09876543210")).toBe("919876543210");
    });

    it("handles numbers already with +91 or 91", () => {
      expect(cleanPhoneNumber("+919876543210")).toBe("919876543210");
      expect(cleanPhoneNumber("919876543210")).toBe("919876543210");
    });

    it("returns empty string if null or empty", () => {
      expect(cleanPhoneNumber("")).toBe("");
      expect(cleanPhoneNumber(null)).toBe("");
    });
  });

  describe("generateWhatsAppBillMessage", () => {
    it("generates Hindi message with customer and bill details", () => {
      const msg = generateWhatsAppBillMessage({
        customerName: "रमेश पटेल",
        shopName: "श्री राम कृषि केंद्र",
        invoiceNo: "INV-2026-0042",
        date: "2026-11-25",
        totalAmount: 4850.5,
        lang: "hi",
      });

      expect(msg).toContain("नमस्ते रमेश पटेल जी");
      expect(msg).toContain("श्री राम कृषि केंद्र");
      expect(msg).toContain("INV-2026-0042");
      expect(msg).toContain("4,850.50");
      expect(msg).toContain("उन्नत खाद, बीज एवं कीटनाशक");
    });

    it("generates English message when lang is en", () => {
      const msg = generateWhatsAppBillMessage({
        customerName: "Ramesh Patel",
        shopName: "Shree Ram Krishi Kendra",
        invoiceNo: "INV-2026-0042",
        date: "2026-11-25",
        totalAmount: 1200,
        lang: "en",
      });

      expect(msg).toContain("Hello Ramesh Patel Ji");
      expect(msg).toContain("Shree Ram Krishi Kendra");
      expect(msg).toContain("Invoice No: INV-2026-0042");
      expect(msg).toContain("1,200.00");
    });
  });

  describe("buildWhatsAppUrl", () => {
    it("builds correct wa.me link with phone and encoded message", () => {
      const url = buildWhatsAppUrl("9876543210", "Hello Ramesh Ji");
      expect(url).toBe("https://wa.me/919876543210?text=Hello%20Ramesh%20Ji");
    });
  });
});
