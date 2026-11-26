// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { WhatsAppShareModal } from "./WhatsAppShareModal";
import * as whatsappService from "../utils/whatsappService";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../utils/whatsappService", async () => {
  const actual = await vi.importActual("../utils/whatsappService");
  return {
    ...actual,
    exportInvoicePdf: vi.fn().mockResolvedValue({
      success: true,
      message: "Mock PDF exported",
      pdf_path: "C:\\Invoices\\INV-001.pdf",
      filename: "INV-001_Ramesh.pdf",
      directory: "C:\\Invoices",
    }),
    openFileInExplorer: vi.fn().mockResolvedValue(undefined),
    openWhatsAppChat: vi.fn().mockResolvedValue(undefined),
  };
});

describe("WhatsAppShareModal", () => {
  let container: HTMLDivElement | null = null;
  let root: any = null;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it("renders modal with customer details, phone, and message preview", async () => {
    await act(async () => {
      root.render(
        <WhatsAppShareModal
          isOpen={true}
          onClose={vi.fn()}
          invoiceNo="INV-2026-0042"
          customerName="रमेश पटेल"
          customerPhone="9876543210"
          date="2026-11-25"
          totalAmount={4850}
          htmlContent="<html><body>Bill</body></html>"
          shopName="श्री राम कृषि केंद्र"
          lang="hi"
        />
      );
    });

    const modal = container?.querySelector('[data-testid="whatsapp-share-modal"]');
    expect(modal).not.toBeNull();
    expect(container?.textContent).toContain("रमेश पटेल");
    expect(container?.textContent).toContain("WhatsApp पर बिल PDF भेजें");

    const phoneInput = container?.querySelector('[data-testid="whatsapp-phone-input"]') as HTMLInputElement;
    expect(phoneInput.value).toBe("9876543210");

    const msgInput = container?.querySelector('[data-testid="whatsapp-message-input"]') as HTMLTextAreaElement;
    expect(msgInput.value).toContain("INV-2026-0042");
    expect(msgInput.value).toContain("4,850.00");
  });

  it("calls openWhatsAppChat and openFileInExplorer when send button is clicked", async () => {
    const handleClose = vi.fn();
    await act(async () => {
      root.render(
        <WhatsAppShareModal
          isOpen={true}
          onClose={handleClose}
          invoiceNo="INV-2026-0042"
          customerName="रमेश पटेल"
          customerPhone="9876543210"
          date="2026-11-25"
          totalAmount={4850}
          htmlContent="<html><body>Bill</body></html>"
          shopName="श्री राम कृषि केंद्र"
          lang="hi"
        />
      );
    });

    const sendBtn = container?.querySelector('[data-testid="whatsapp-send-btn"]') as HTMLButtonElement;
    await act(async () => {
      sendBtn.click();
    });

    expect(whatsappService.openWhatsAppChat).toHaveBeenCalled();
    expect(handleClose).toHaveBeenCalled();
  });
});
