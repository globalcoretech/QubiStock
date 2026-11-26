// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { PurchasePdfImportModal } from "./PurchasePdfImportModal";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("PurchasePdfImportModal", () => {
  let container: HTMLDivElement | null = null;
  let root: any = null;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it("renders import modal with drag drop zone", async () => {
    await act(async () => {
      root.render(
        <PurchasePdfImportModal
          isOpen={true}
          onClose={vi.fn()}
          onApplyToForm={vi.fn()}
          lang="hi"
        />
      );
    });

    const modal = container?.querySelector('[data-testid="purchase-pdf-import-modal"]');
    expect(modal).not.toBeNull();
    expect(container?.textContent).toContain("WhatsApp सप्लायर PDF बिल आयात करें");
    expect(container?.textContent).toContain("ड्रैग करें");
  });

  it("calls onClose when close button clicked", async () => {
    const handleClose = vi.fn();
    await act(async () => {
      root.render(
        <PurchasePdfImportModal
          isOpen={true}
          onClose={handleClose}
          onApplyToForm={vi.fn()}
          lang="hi"
        />
      );
    });

    const closeBtn = container?.querySelector('[data-testid="purchase-import-close-btn"]') as HTMLButtonElement;
    await act(async () => {
      closeBtn.click();
    });

    expect(handleClose).toHaveBeenCalled();
  });
});
