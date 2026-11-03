// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act, useState } from "react";
import { LoginModal } from "./components/LoginModal";
import { LockScreenOverlay } from "./components/LockScreenOverlay";
import { Sidebar } from "./components/Sidebar";
import { ReportsView } from "./views/ReportsView";
import { StockView } from "./views/StockView";
import { DEFAULT_SETTINGS, SessionUser } from "./types";
import { translations } from "./i18n";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function setInputValue(input: HTMLInputElement, value: string) {
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  nativeSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("Auth & Role Security Frontend Tests", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe("LoginModal", () => {
    it("renders user dropdown and allows successful login", async () => {
      const mockUsers = [
        { id: 1, name: "OwnerJi", role: "owner", is_active: true, failed_attempts: 0, locked_until: null, created_at: "" },
        { id: 2, name: "StaffJi", role: "staff", is_active: true, failed_attempts: 0, locked_until: null, created_at: "" },
      ];

      (invoke as any).mockImplementation((cmd: string, args: any) => {
        if (cmd === "get_users_cmd") {
          return Promise.resolve(mockUsers);
        }
        if (cmd === "login_cmd") {
          if (args.name === "OwnerJi" && args.password === "correctpass") {
            return Promise.resolve({ id: 1, name: "OwnerJi", role: "owner" });
          }
          return Promise.reject("पासवर्ड गलत है");
        }
        return Promise.resolve(null);
      });

      const onLoginSuccess = vi.fn();
      const root = createRoot(container);

      await act(async () => {
        root.render(<LoginModal onLoginSuccess={onLoginSuccess} />);
      });

      // Check dropdown options
      const select = container.querySelector("select") as HTMLSelectElement;
      expect(select).toBeTruthy();
      expect(select.options.length).toBe(2);
      expect(select.options[0].text).toContain("OwnerJi");

      // Enter password
      const passwordInput = container.querySelector("input[type='password']") as HTMLInputElement;
      expect(passwordInput).toBeTruthy();

      await act(async () => {
        setInputValue(passwordInput, "correctpass");
      });

      // Submit login form
      const form = container.querySelector("form") as HTMLFormElement;
      await act(async () => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });

      expect(invoke).toHaveBeenCalledWith("login_cmd", {
        name: "OwnerJi",
        password: "correctpass",
      });
      expect(onLoginSuccess).toHaveBeenCalledWith({
        id: 1,
        name: "OwnerJi",
        role: "owner",
      });
    });

    it("displays error on invalid password and supports recovery key toggle", async () => {
      const mockUsers = [
        { id: 1, name: "OwnerJi", role: "owner", is_active: true, failed_attempts: 0, locked_until: null, created_at: "" },
      ];

      (invoke as any).mockImplementation((cmd: string) => {
        if (cmd === "get_users_cmd") {
          return Promise.resolve(mockUsers);
        }
        if (cmd === "login_cmd") {
          return Promise.reject("पासवर्ड गलत है। 4 प्रयास शेष हैं।");
        }
        if (cmd === "reset_owner_with_recovery_key_cmd") {
          return Promise.resolve("RK-NEW-KEY-456");
        }
        return Promise.resolve(null);
      });

      const root = createRoot(container);

      await act(async () => {
        root.render(<LoginModal onLoginSuccess={vi.fn()} />);
      });

      const form = container.querySelector("form") as HTMLFormElement;
      const passwordInput = container.querySelector("input[type='password']") as HTMLInputElement;

      await act(async () => {
        setInputValue(passwordInput, "wrongpass");
      });

      await act(async () => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });

      // Error banner should be visible
      expect(container.textContent).toContain("पासवर्ड गलत है");

      // Click "पासवर्ड भूल गए? / Forgot?"
      const forgotBtn = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("पासवर्ड भूल गए?")
      );
      expect(forgotBtn).toBeTruthy();

      await act(async () => {
        forgotBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      // Recovery key input should appear
      expect(container.textContent).toContain("रिकवरी कुंजी");
    });

    it("renders saved usernames dropdown from localStorage even when get_users_cmd is denied", async () => {
      localStorage.setItem("krishi_remembered_users", JSON.stringify(["uday singh", "ramesh_staff"]));
      localStorage.setItem("krishi_last_username", "uday singh");

      (invoke as any).mockImplementation((cmd: string) => {
        if (cmd === "get_users_cmd") {
          return Promise.reject(new Error("Permission denied: Login required"));
        }
        return Promise.resolve(null);
      });

      const root = createRoot(container);
      await act(async () => {
        root.render(<LoginModal onLoginSuccess={vi.fn()} />);
      });

      const select = container.querySelector('[data-testid="login-user-select"]') as HTMLSelectElement;
      expect(select).toBeTruthy();
      expect(select.tagName).toBe("SELECT");
      expect(select.options.length).toBe(2); // "uday singh", "ramesh_staff"
      expect(select.value).toBe("uday singh");
    });

    it("recovers owner username on recovery key reset and displays it prominently", async () => {
      (invoke as any).mockImplementation((cmd: string) => {
        if (cmd === "get_users_cmd") return Promise.reject("Permission denied");
        if (cmd === "reset_owner_with_recovery_key_cmd") {
          return Promise.resolve({
            new_recovery_key: "RK-NEW-KEY-8888-9999",
            owner_name: "uday singh",
          });
        }
        return Promise.resolve(null);
      });

      const root = createRoot(container);
      await act(async () => {
        root.render(<LoginModal onLoginSuccess={vi.fn()} />);
      });

      // Open forgot modal
      const forgotBtn = container.querySelector('[data-testid="forgot-password-link-btn"]') as HTMLButtonElement;
      await act(async () => {
        forgotBtn.click();
      });

      // Fill in recovery key and password
      const keyInput = container.querySelector('[data-testid="recovery-key-input"]') as HTMLInputElement;
      const passInput = container.querySelector('[data-testid="recovery-new-password-input"]') as HTMLInputElement;
      const confInput = container.querySelector('[data-testid="recovery-confirm-password-input"]') as HTMLInputElement;
      const submitBtn = container.querySelector('[data-testid="submit-recovery-reset-btn"]') as HTMLButtonElement;

      await act(async () => {
        setInputValue(keyInput, "RK-TEST-RECOVERY-KEY");
        setInputValue(passInput, "BrandNewPassword123");
        setInputValue(confInput, "BrandNewPassword123");
      });

      await act(async () => {
        submitBtn.click();
      });

      // Verification: Recovered owner username is prominently shown!
      expect(container.textContent).toContain("uday singh");
      expect(container.textContent).toContain("व्यवस्थापक यूज़रनेम (Owner Username)");
      expect(container.textContent).toContain("RK-NEW-KEY-8888-9999");
      expect(localStorage.getItem("krishi_last_username")).toBe("uday singh");
    });
  });

  describe("LockScreenOverlay", () => {
    it("renders over app view while keeping dirty form state intact", async () => {
      (invoke as any).mockImplementation((cmd: string, args: any) => {
        if (cmd === "unlock_session_cmd") {
          if (args.password === "secret") {
            return Promise.resolve(true);
          }
          return Promise.reject("गलत पासवर्ड");
        }
        return Promise.resolve(null);
      });

      // Harness component simulating an active form in background with LockScreenOverlay on top
      function TestHost() {
        const [isLocked, setIsLocked] = useState(true);
        const [billNotes, setBillNotes] = useState("Unsaved draft invoice notes for farmer");

        return (
          <div>
            <div data-testid="underlying-form">
              <input
                data-testid="notes-input"
                value={billNotes}
                onChange={(e) => setBillNotes(e.target.value)}
              />
            </div>
            {isLocked && (
              <LockScreenOverlay
                currentUser={{ id: 1, name: "OwnerJi", role: "owner" }}
                hasUnsavedWork={true}
                onUnlocked={() => setIsLocked(false)}
                onSwitchUser={vi.fn()}
              />
            )}
          </div>
        );
      }

      const root = createRoot(container);
      await act(async () => {
        root.render(<TestHost />);
      });

      // Underlying form input is still mounted with its value intact
      const notesInput = container.querySelector("[data-testid='notes-input']") as HTMLInputElement;
      expect(notesInput).toBeTruthy();
      expect(notesInput.value).toBe("Unsaved draft invoice notes for farmer");

      // Lock overlay is visible
      expect(container.querySelector("[data-testid='lock-screen-overlay']")).toBeTruthy();
      expect(container.textContent).toContain("सत्र लॉक है");

      // Unlock with correct password
      const unlockPasswordInput = container.querySelector(
        "[data-testid='lock-screen-password-input']"
      ) as HTMLInputElement;
      expect(unlockPasswordInput).toBeTruthy();

      await act(async () => {
        setInputValue(unlockPasswordInput, "secret");
      });

      const unlockForm = container.querySelector("form") as HTMLFormElement;
      await act(async () => {
        unlockForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });

      // Overlay should be gone, and input value still completely intact
      expect(container.querySelector("[data-testid='lock-screen-overlay']")).toBeNull();
      const postUnlockNotes = container.querySelector("[data-testid='notes-input']") as HTMLInputElement;
      expect(postUnlockNotes).toBeTruthy();
      expect(postUnlockNotes.value).toBe("Unsaved draft invoice notes for farmer");
    });

    it("warns about unsaved work when clicking switch user", async () => {
      const onSwitchUser = vi.fn();
      const root = createRoot(container);

      await act(async () => {
        root.render(
          <LockScreenOverlay
            currentUser={{ id: 1, name: "OwnerJi", role: "owner" }}
            hasUnsavedWork={true}
            onUnlocked={vi.fn()}
            onSwitchUser={onSwitchUser}
          />
        );
      });

      const switchBtn = container.querySelector("[data-testid='lock-screen-switch-user-btn']") as HTMLButtonElement;
      expect(switchBtn).toBeTruthy();

      await act(async () => {
        switchBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      // Modal warning appears
      expect(container.querySelector("[data-testid='unsaved-switch-warning-modal']")).toBeTruthy();
      expect(container.textContent).toContain("असुरक्षित डेटा की चेतावनी");
    });
  });

  describe("Staff Role Restrictions", () => {
    it("hides restricted navigation items for Staff user in Sidebar", async () => {
      const ownerUser: SessionUser = { id: 1, name: "OwnerJi", role: "owner" };
      const staffUser: SessionUser = { id: 2, name: "StaffJi", role: "staff" };

      const root = createRoot(container);

      // Render as Owner
      await act(async () => {
        root.render(
          <Sidebar
            currentView="Dashboard"
            onNavigate={vi.fn()}
            currentUser={ownerUser}
            settings={DEFAULT_SETTINGS}
            lang="hi"
            onSelectLanguage={vi.fn()}
            t={translations["hi"]}
          />
        );
      });

      // Owner "और" count is 8
      const ownerMoreBtn = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("और") || b.textContent?.includes("More")
      );
      expect(ownerMoreBtn).toBeTruthy();
      expect(ownerMoreBtn?.textContent).toContain("8");

      // Open flyout for Owner
      await act(async () => {
        ownerMoreBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(document.body.querySelector("[data-testid='nav-Settings']")).toBeTruthy();

      // Render as Staff
      await act(async () => {
        root.render(
          <Sidebar
            currentView="Dashboard"
            onNavigate={vi.fn()}
            currentUser={staffUser}
            settings={DEFAULT_SETTINGS}
            lang="hi"
            onSelectLanguage={vi.fn()}
            t={translations["hi"]}
          />
        );
      });

      // Staff "और" count is 3
      const staffMoreBtn = Array.from(container.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("और") || b.textContent?.includes("More")
      );
      expect(staffMoreBtn).toBeTruthy();
      expect(staffMoreBtn?.textContent).toContain("3");

      // Open flyout for Staff
      await act(async () => {
        staffMoreBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      // Staff does NOT have Settings, Backup, Opening Stock, etc.
      expect(document.body.querySelector("[data-testid='nav-Settings']")).toBeNull();
      expect(document.body.querySelector("[data-testid='nav-Backup']")).toBeNull();
      expect(document.body.querySelector("[data-testid='nav-Opening Stock']")).toBeNull();
    });

    it("hides profit and cost tabs in ReportsView for Staff user", async () => {
      (invoke as any).mockImplementation((cmd: string) => {
        if (cmd === "get_items_cmd") return Promise.resolve([]);
        if (cmd === "get_parties_cmd") return Promise.resolve([]);
        if (cmd === "get_sales_register_cmd") return Promise.resolve({ entries: [], summary: {} });
        if (cmd === "get_purchase_register_cmd") return Promise.resolve({ entries: [], summary: {} });
        if (cmd === "get_gst_summary_cmd") return Promise.resolve({ output_taxable: 0, output_total_gst: 0, input_taxable_eligible: 0, input_total_gst: 0, net_total_payable: 0 });
        if (cmd === "get_hsn_summary_cmd") return Promise.resolve({ items: [] });
        if (cmd === "get_profit_report_cmd") return Promise.resolve({ items: [], summary: {} });
        return Promise.resolve(null);
      });

      const staffUser: SessionUser = { id: 2, name: "StaffJi", role: "staff" };
      const root = createRoot(container);

      await act(async () => {
        root.render(
          <ReportsView
            settings={DEFAULT_SETTINGS}
            t={translations["hi"]}
            currentUser={staffUser}
            lang="hi"
            refreshTrigger={0}
          />
        );
      });

      // Profit tabs must NOT be present for staff
      expect(container.querySelector("[data-testid='report-tab-profit_report']")).toBeNull();
      expect(container.querySelector("[data-testid='report-tab-gst_profit']")).toBeNull();
      expect(container.querySelector("[data-testid='report-tab-item_profit']")).toBeNull();
      expect(container.querySelector("[data-testid='report-tab-party_profit']")).toBeNull();

      // Allowed tabs like Sales Register should be present
      expect(container.querySelector("[data-testid='report-tab-sales_reg']")).toBeTruthy();
    });

    it("masks Cost and Valuation in StockView for Staff user", async () => {
      (invoke as any).mockImplementation((cmd: string) => {
        if (cmd === "get_stock_cmd") {
          return Promise.resolve([
            {
              id: 1,
              name: "Urea 50kg",
              category: "Fertilizer",
              current_stock: 100,
              unit: "BAG",
              cost_price: 266.5,
              selling_price: 300,
              min_stock: 10,
              total_value: 26650,
            },
          ]);
        }
        if (cmd === "get_categories_cmd") return Promise.resolve([]);
        if (cmd === "get_item_expiries_cmd") return Promise.resolve([]);
        return Promise.resolve([]);
      });

      const staffUser: SessionUser = { id: 2, name: "StaffJi", role: "staff" };
      const root = createRoot(container);

      await act(async () => {
        root.render(
          <StockView
            settings={DEFAULT_SETTINGS}
            t={translations["hi"]}
            currentUser={staffUser}
            lang="hi"
            refreshTrigger={0}
          />
        );
      });

      // Cost price and total valuation headers or cell values must NOT be revealed
      const text = container.textContent || "";
      expect(text).not.toContain("26,650");
      expect(text).not.toContain("266.50");
    });
  });
});
