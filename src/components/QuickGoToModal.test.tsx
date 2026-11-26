// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { QuickGoToModal } from "./QuickGoToModal";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("QuickGoToModal", () => {
  let container: HTMLDivElement | null = null;
  let root: any = null;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it("renders Quick Reports and Quick Editors sections in Hindi", async () => {
    await act(async () => {
      root.render(
        <QuickGoToModal
          isOpen={true}
          onClose={vi.fn()}
          onNavigate={vi.fn()}
          currentView="Sale"
          lang="hi"
        />
      );
    });

    const modal = container?.querySelector('[data-testid="quick-goto-modal"]');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain("फटाफट रिपोर्ट्स (Quick Reports)");
    expect(modal?.textContent).toContain("तुरंत सुधार व मास्टर्स (Quick Editors)");
    expect(modal?.textContent).toContain("वर्तमान स्टॉक (Stock Summary)");
    expect(modal?.textContent).toContain("प्रारंभिक स्टॉक (Opening Stock)");
  });

  it("navigates to selected view and closes modal on click", async () => {
    const handleNavigate = vi.fn();
    const handleClose = vi.fn();

    await act(async () => {
      root.render(
        <QuickGoToModal
          isOpen={true}
          onClose={handleClose}
          onNavigate={handleNavigate}
          currentView="Sale"
          lang="en"
        />
      );
    });

    const openingStockBtn = container?.querySelector(
      '[data-testid="quick-goto-item-Opening Stock"]'
    ) as HTMLButtonElement;
    expect(openingStockBtn).not.toBeNull();

    await act(async () => {
      openingStockBtn.click();
    });

    expect(handleNavigate).toHaveBeenCalledWith("Opening Stock");
    expect(handleClose).toHaveBeenCalled();
  });
});
