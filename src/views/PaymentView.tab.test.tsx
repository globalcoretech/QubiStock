// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { PaymentView } from "./PaymentView";
import { translations } from "../i18n";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("PaymentView Party Filtering & Tab Switching", () => {
  const t = translations["hi"];
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);

    (invoke as any).mockImplementation((cmd: string, args?: any) => {
      if (cmd === "get_parties_cmd") {
        if (args?.partyType === "customer") {
          return Promise.resolve([
            { id: 1, name: "Customer 1", party_type: "customer" },
            { id: 2, name: "Both 1", party_type: "both" },
          ]);
        }
        if (args?.partyType === "supplier") {
          return Promise.resolve([
            { id: 3, name: "Supplier 1", party_type: "supplier" },
            { id: 2, name: "Both 1", party_type: "both" },
          ]);
        }
        return Promise.resolve([]);
      }
      if (cmd === "get_party_balances_cmd") {
        return Promise.resolve([]);
      }
      if (cmd === "get_pending_bills_cmd") {
        return Promise.resolve([]);
      }
      return Promise.resolve(null);
    });
  });

  it("passes partyType 'customer' on Payment Received tab, switches to 'supplier' on Payment Made tab", async () => {
    const root = createRoot(container);

    // Initial mount on receipt tab
    await act(async () => {
      root.render(
        <PaymentView
          refreshTrigger={0}
          t={t}
          lang="hi"
          initialType="receipt"
        />
      );
    });

    // Check that get_parties_cmd was called with partyType: "customer"
    const receiptCalls = (invoke as any).mock.calls.filter(
      (c: any[]) => c[0] === "get_parties_cmd"
    );
    expect(receiptCalls.length).toBeGreaterThanOrEqual(1);
    expect(receiptCalls[receiptCalls.length - 1][1]).toEqual({ partyType: "customer" });

    // Find tab button for Payment Made ("पैसा दिया (सप्लायर को)")
    const buttons = Array.from(container.querySelectorAll("button"));
    const paymentMadeBtn = buttons.find(b => b.textContent?.includes("पैसा दिया"));
    expect(paymentMadeBtn).toBeDefined();

    // Click Payment Made tab
    await act(async () => {
      paymentMadeBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Verify invoke was called with partyType: "supplier"
    const supplierCalls = (invoke as any).mock.calls.filter(
      (c: any[]) => c[0] === "get_parties_cmd"
    );
    expect(supplierCalls[supplierCalls.length - 1][1]).toEqual({ partyType: "supplier" });

    // Switch back to Payment Received tab
    const paymentReceivedBtn = buttons.find(b => b.textContent?.includes("पैसा मिला"));
    expect(paymentReceivedBtn).toBeDefined();

    await act(async () => {
      paymentReceivedBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const finalCalls = (invoke as any).mock.calls.filter(
      (c: any[]) => c[0] === "get_parties_cmd"
    );
    expect(finalCalls[finalCalls.length - 1][1]).toEqual({ partyType: "customer" });

    root.unmount();
  });
});
