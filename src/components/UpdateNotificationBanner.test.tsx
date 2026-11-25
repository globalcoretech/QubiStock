// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { UpdateNotificationBanner } from "./UpdateNotificationBanner";
import * as updaterService from "../utils/updaterService";
import * as updateScheduler from "../utils/updateScheduler";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../utils/updaterService", () => ({
  installUpdate: vi.fn(),
}));

describe("UpdateNotificationBanner", () => {
  let container: HTMLDivElement | null = null;
  let root: any = null;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it("renders banner with version info, safety assurance, and action buttons", async () => {
    const handleClose = vi.fn();
    await act(async () => {
      root.render(
        <UpdateNotificationBanner
          version="0.1.4"
          currentVersion="v0.1.3"
          notes="Speed improvements in billing"
          date="2026-11-25"
          onClose={handleClose}
          lang="hi"
        />
      );
    });

    const banner = container?.querySelector('[data-testid="update-notification-banner"]');
    expect(banner).not.toBeNull();
    expect(container?.textContent).toContain("0.1.4");
    expect(container?.textContent).toContain("100% डेटाबेस सुरक्षा");
    expect(container?.querySelector('[data-testid="whats-new-btn"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="update-later-btn"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="banner-update-now-btn"]')).not.toBeNull();
  });

  it("opens schedule dropdown when Update Later is clicked and handles snooze option selection", async () => {
    const handleClose = vi.fn();
    const handleSnoozed = vi.fn();
    const spySetSnooze = vi.spyOn(updateScheduler, "setUpdateSnooze");

    await act(async () => {
      root.render(
        <UpdateNotificationBanner
          version="0.1.4"
          currentVersion="v0.1.3"
          onClose={handleClose}
          onSnoozed={handleSnoozed}
          lang="hi"
        />
      );
    });

    const laterBtn = container?.querySelector('[data-testid="update-later-btn"]') as HTMLButtonElement;
    await act(async () => {
      laterBtn.click();
    });

    const dropdown = container?.querySelector('[data-testid="schedule-dropdown-menu"]');
    expect(dropdown).not.toBeNull();
    expect(dropdown?.textContent).toContain("15 मिनट बाद");
    expect(dropdown?.textContent).toContain("30 मिनट बाद");
    expect(dropdown?.textContent).toContain("1 घंटा बाद");
    expect(dropdown?.textContent).toContain("2 घंटे बाद");

    // Click 30 minutes option
    const opt30 = container?.querySelector('[data-testid="schedule-opt-30"]') as HTMLButtonElement;
    await act(async () => {
      opt30.click();
    });

    expect(spySetSnooze).toHaveBeenCalledWith(30);
    expect(handleSnoozed).toHaveBeenCalledWith(30);
    expect(handleClose).toHaveBeenCalled();
  });

  it("opens What's New modal with prominent database safety guarantee card", async () => {
    await act(async () => {
      root.render(
        <UpdateNotificationBanner
          version="0.1.4"
          currentVersion="v0.1.3"
          notes="Enhanced GST reports and zero-loss updates"
          onClose={vi.fn()}
          lang="hi"
        />
      );
    });

    const whatsNewBtn = container?.querySelector('[data-testid="whats-new-btn"]') as HTMLButtonElement;
    await act(async () => {
      whatsNewBtn.click();
    });

    const modal = container?.querySelector('[data-testid="whats-new-modal"]');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain("100% डेटाबेस व बही-खाता सुरक्षा गारंटी");
    expect(modal?.textContent).toContain("Zero Data Loss Guarantee");
    expect(modal?.textContent).toContain("पुराने बिल व खाते सुरक्षित");
    expect(modal?.textContent).toContain("स्वचालित सुरक्षा बैकअप");
    expect(modal?.textContent).toContain("Enhanced GST reports and zero-loss updates");

    // Close modal
    const closeBtn = container?.querySelector('[data-testid="whats-new-close-btn"]') as HTMLButtonElement;
    await act(async () => {
      closeBtn.click();
    });
    expect(container?.querySelector('[data-testid="whats-new-modal"]')).toBeNull();
  });

  it("triggers installUpdate when Update Now is clicked", async () => {
    (updaterService.installUpdate as any).mockImplementation((cb: any) => {
      cb(50, "डाउनलोड हो रहा है...");
      return Promise.resolve();
    });

    await act(async () => {
      root.render(
        <UpdateNotificationBanner
          version="0.1.4"
          currentVersion="v0.1.3"
          onClose={vi.fn()}
          lang="hi"
        />
      );
    });

    const updateNowBtn = container?.querySelector('[data-testid="banner-update-now-btn"]') as HTMLButtonElement;
    await act(async () => {
      updateNowBtn.click();
    });

    expect(updaterService.installUpdate).toHaveBeenCalled();
  });
});
