// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { UpdateNotificationModal } from "./UpdateNotificationModal";
import * as updaterService from "../utils/updaterService";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../utils/updaterService", () => ({
  installUpdate: vi.fn(),
}));

describe("UpdateNotificationModal", () => {
  let container: HTMLDivElement | null = null;
  let root: any = null;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it("renders modal with version details, release notes, and safety guarantee", async () => {
    const handleClose = vi.fn();
    await act(async () => {
      root.render(
        <UpdateNotificationModal
          version="v0.2.0"
          currentVersion="v0.1.0"
          notes="New billing shortcuts and safety fixes"
          date="2026-11-25"
          onClose={handleClose}
          lang="hi"
        />
      );
    });

    const modal = container?.querySelector('[data-testid="update-notification-modal"]');
    expect(modal).not.toBeNull();
    expect(container?.textContent).toContain("v0.2.0");
    expect(container?.textContent).toContain("v0.1.0");
    expect(container?.textContent).toContain("New billing shortcuts and safety fixes");
    expect(container?.textContent).toContain("डेटाबेस सुरक्षा गारंटी");
  });

  it("calls onClose when close or Remind Me Later button is clicked", async () => {
    const handleClose = vi.fn();
    await act(async () => {
      root.render(
        <UpdateNotificationModal
          version="v0.2.0"
          currentVersion="v0.1.0"
          onClose={handleClose}
          lang="hi"
        />
      );
    });

    const remindBtn = Array.from(container?.querySelectorAll("button") || []).find((b) =>
      b.textContent?.includes("बाद में याद दिलाएं")
    );
    expect(remindBtn).toBeDefined();

    await act(async () => {
      remindBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("handles update flow and shows error if installUpdate fails", async () => {
    (updaterService.installUpdate as any).mockRejectedValueOnce(
      new Error("Signature verification failed")
    );

    const handleClose = vi.fn();
    await act(async () => {
      root.render(
        <UpdateNotificationModal
          version="v0.2.0"
          currentVersion="v0.1.0"
          onClose={handleClose}
          lang="hi"
        />
      );
    });

    const updateBtn = container?.querySelector('[data-testid="start-update-btn"]');
    expect(updateBtn).not.toBeNull();

    await act(async () => {
      updateBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(updaterService.installUpdate).toHaveBeenCalled();
    expect(container?.textContent).toContain("Signature verification failed");
  });
});
