import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

async function isPortOpen(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/`, () => resolve(true));
    req.on("error", () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function run() {
  console.log("==================================================================");
  console.log("  Krishi Kendra Client Demo: Rigorous Overflow & Visibility Suite");
  console.log("  Real Viewports (No Titlebar/Taskbar): 1366x690, 1536x780, 1280x650, 1100x560");
  console.log("==================================================================");

  let chromium;
  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch (err) {
    console.error("\n[Error] Playwright is not installed:", err.message);
    process.exit(1);
  }

  let viteServer = null;
  const isRunning = await isPortOpen(5173);
  if (!isRunning) {
    console.log("[Info] Starting local Vite dev server on port 5173...");
    const { createServer } = await import("vite");
    viteServer = await createServer({
      root: rootDir,
      server: { port: 5173 },
    });
    await viteServer.listen();
    console.log("[Info] Vite server started at http://localhost:5173");
  } else {
    console.log("[Info] Detected active server at http://localhost:5173");
  }

  const appBaseUrl = "http://localhost:5173/?demo=1";

  console.log("[Info] Launching Chromium browser (headless)...");
  const browser = await chromium.launch({
    headless: true,
  });

  const languages = ["hi", "en"];
  // Exact 4 real-world viewports (excluding window titlebar & OS taskbar)
  const viewports = [
    { width: 1366, height: 690, name: "1366x690", isDefault: true },
    { width: 1536, height: 780, name: "1536x780" },
    { width: 1280, height: 650, name: "1280x650" },
    { width: 1100, height: 560, name: "1100x560" },
  ];

  const allTestResults = [];

  try {
    for (const vp of viewports) {
      console.log(`\n==================================================================`);
      console.log(`>>> VIEWPORT: ${vp.name} (${vp.width}x${vp.height})`);
      console.log(`==================================================================`);

      for (const lang of languages) {
        console.log(`\n  --- Language: ${lang.toUpperCase()} ---`);

        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: 2,
        });

        const page = await context.newPage();
        await page.goto(appBaseUrl, { waitUntil: "networkidle" });
        await page.waitForTimeout(500);

        // Switch language in UI
        const langBtn = page.locator(`[data-testid="lang-${lang}"]`);
        if (await langBtn.isVisible()) {
          await langBtn.click();
          await page.waitForTimeout(300);
        }

        const langDir = path.join(rootDir, "screenshots", lang);
        const vpDir = path.join(langDir, vp.name);
        await ensureDir(langDir);
        await ensureDir(vpDir);

        // Helper: Check Primary Button Visibility & Bounds
        const checkPrimaryButton = async (selector, expectedName) => {
          return await page.evaluate(
            ({ sel, name }) => {
              const el = document.querySelector(sel);
              if (!el) {
                return {
                  test: `Primary Button (${name})`,
                  pass: false,
                  detail: `Element not found: ${sel}`,
                };
              }
              const rect = el.getBoundingClientRect();
              const bottomFits = rect.bottom <= window.innerHeight;
              const topFits = rect.top >= 0;
              const cx = rect.left + rect.width / 2;
              const cy = rect.top + rect.height / 2;
              const hitEl = document.elementFromPoint(cx, cy);
              const isVisible = hitEl ? el === hitEl || el.contains(hitEl) : false;

              const pass = bottomFits && topFits && isVisible;
              const detail = `rect.bottom=${Math.round(rect.bottom)}px <= winH=${window.innerHeight}px | visible=${isVisible} (hit: ${hitEl ? hitEl.tagName : "none"})`;

              return {
                test: `Primary Button: ${name}`,
                pass,
                detail,
              };
            },
            { sel: selector, name: expectedName }
          );
        };

        // Helper: Check all elements with overflow: hidden for clipped content
        const checkOverflowHiddenContainers = async (screenName) => {
          return await page.evaluate((sName) => {
            const allEls = Array.from(document.querySelectorAll("*"));
            const overflowing = [];

            for (const el of allEls) {
              if (el.hasAttribute("data-scroll") || el.closest("[data-scroll]")) {
                continue;
              }
              const style = window.getComputedStyle(el);
              if (style.overflowY === "hidden" || style.overflowY === "clip") {
                // Ignore text truncate spans or elements with text-overflow: ellipsis (not layout containers)
                if (
                  style.textOverflow === "ellipsis" ||
                  el.classList.contains("truncate") ||
                  el.tagName === "SPAN" ||
                  el.tagName === "P" ||
                  el.tagName === "H1" ||
                  el.tagName === "H2" ||
                  el.tagName === "H3" ||
                  el.tagName === "INPUT" ||
                  el.tagName === "TEXTAREA" ||
                  el.tagName === "SELECT" ||
                  el.tagName === "BUTTON"
                ) {
                  continue;
                }
                if (el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1) {
                  const tag = el.tagName.toLowerCase();
                  const cls =
                    typeof el.className === "string" ? el.className.split(" ")[0] : "";
                  const id = el.id ? `#${el.id}` : "";
                  const htmlSnippet = el.outerHTML.replace(/\s+/g, ' ').slice(0, 80);
                  overflowing.push(
                    `${tag}${id}${cls ? `.${cls}` : ""} [${htmlSnippet}] (scrollHeight: ${el.scrollHeight} > clientHeight: ${el.clientHeight})`
                  );
                }
              }
            }

            const pass = overflowing.length === 0;
            return {
              test: `No Overflow-Hidden Clipping (${sName})`,
              pass,
              detail: pass
                ? "All overflow-hidden containers perfectly fit (0 clipped)"
                : `Clipped containers: ${overflowing.join("; ")}`,
            };
          }, screenName);
        };

        // Screen 1: Dashboard (घर)
        console.log("  1. Dashboard View (घर)");
        await page.locator('[data-testid="nav-Dashboard"]').click();
        await page.waitForTimeout(400);

        const dashBtn = await checkPrimaryButton(
          '[data-testid="dashboard-new-bill-btn"]',
          "नया बिल बनाओ (F1)"
        );
        allTestResults.push({
          viewport: vp.name,
          lang: lang.toUpperCase(),
          screen: "Dashboard",
          ...dashBtn,
        });

        const dashOverflow = await checkOverflowHiddenContainers("Dashboard");
        allTestResults.push({
          viewport: vp.name,
          lang: lang.toUpperCase(),
          screen: "Dashboard",
          ...dashOverflow,
        });

        // Screenshot
        await page.screenshot({ path: path.join(vpDir, "01-dashboard.png") });
        if (vp.isDefault) {
          await page.screenshot({ path: path.join(langDir, "01-dashboard.png") });
        }

        // Test "और" (More) Flyout Portal Visibility
        console.log("  1b. 'और' (More) Flyout Portal Check");
        const moreBtn = page.locator('[data-testid="nav-More"]');
        await moreBtn.click();
        await page.waitForTimeout(300);

        const flyoutCheck = await page.evaluate(() => {
          const flyout = document.querySelector('[data-testid="sidebar-more-flyout"]');
          if (!flyout) {
            return {
              test: "Flyout Portal ('और' Popup)",
              pass: false,
              detail: "Flyout element not found in DOM",
            };
          }
          const rect = flyout.getBoundingClientRect();
          const fullyVisible =
            rect.top >= 0 &&
            rect.bottom <= window.innerHeight &&
            rect.left >= 0 &&
            rect.right <= window.innerWidth;
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const hitEl = document.elementFromPoint(cx, cy);
          const isHit = hitEl ? flyout === hitEl || flyout.contains(hitEl) : false;
          const pass = fullyVisible && isHit;
          return {
            test: "Flyout Portal ('और' Popup)",
            pass,
            detail: `top=${Math.round(rect.top)}px, bottom=${Math.round(rect.bottom)}px <= ${window.innerHeight}px | isHit=${isHit}`,
          };
        });
        allTestResults.push({
          viewport: vp.name,
          lang: lang.toUpperCase(),
          screen: "Sidebar Flyout",
          ...flyoutCheck,
        });

        // Close flyout
        const flyoutEl = page.locator('[data-testid="sidebar-more-flyout"]');
        if (await flyoutEl.isVisible()) {
          await page.keyboard.press("Escape");
          await page.waitForTimeout(200);
          if (await flyoutEl.isVisible()) {
            await moreBtn.click();
            await page.waitForTimeout(200);
          }
        }

        // Screen 2: Sale View (बिल बनाओ)
        console.log("  2. Sale View (बिल बनाओ)");
        await page.locator('[data-testid="nav-Sale"]').click();
        await page.waitForTimeout(400);

        // Select party
        try {
          const partySelect = page.locator('[data-testid="transaction-party-select"]');
          if (await partySelect.isVisible()) {
            await partySelect.click();
            await page.waitForTimeout(200);
            const firstOpt = page.locator('.cursor-pointer:has-text("रमेश")').first();
            if (await firstOpt.isVisible()) await firstOpt.click();
            else await page.locator('.cursor-pointer').first().click();
          }
        } catch (e) {}

        // Add line
        try {
          const addLineBtn = page.locator('[data-testid="transaction-add-line-btn"]');
          if (await addLineBtn.isVisible()) {
            await addLineBtn.click();
            await page.waitForTimeout(150);
          }
          const qtyInput = page.locator('table tbody tr input[type="number"]').first();
          if (await qtyInput.isVisible()) await qtyInput.fill("20");
        } catch (e) {}

        // Check Primary Button on Sale Screen
        const saleBtn = await checkPrimaryButton(
          '[data-testid="transaction-submit-with-tax-btn"], [data-testid="transaction-submit-btn"]',
          "टैक्स सहित प्रिंट / बिल बनाओ"
        );
        allTestResults.push({
          viewport: vp.name,
          lang: lang.toUpperCase(),
          screen: "Sale (बिल बनाओ)",
          ...saleBtn,
        });

        const saleOverflow = await checkOverflowHiddenContainers("Sale");
        allTestResults.push({
          viewport: vp.name,
          lang: lang.toUpperCase(),
          screen: "Sale (बिल बनाओ)",
          ...saleOverflow,
        });

        // Test Item Search Dropdown Portal Visibility
        console.log("  2b. Item Search Dropdown Portal Check");
        const itemInput = page
          .locator('input[placeholder*="टाइप करके"], input[placeholder*="Type to filter"]')
          .first();
        if (await itemInput.isVisible()) {
          await itemInput.fill("यूरिया");
          await page.waitForTimeout(300);

          const ddCheck = await page.evaluate(() => {
            const dd = document.querySelector('[data-testid="item-search-dropdown"]');
            if (!dd) {
              return {
                test: "Item Search Dropdown Portal",
                pass: false,
                detail: "Dropdown not rendered in DOM",
              };
            }
            const rect = dd.getBoundingClientRect();
            const fullyVisible =
              rect.top >= 0 &&
              rect.bottom <= window.innerHeight &&
              rect.left >= 0 &&
              rect.right <= window.innerWidth &&
              rect.height > 0;
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + Math.min(20, rect.height / 2);
            const hitEl = document.elementFromPoint(cx, cy);
            const isHit = hitEl ? dd === hitEl || dd.contains(hitEl) : false;
            const pass = fullyVisible && isHit;
            return {
              test: "Item Search Dropdown Portal",
              pass,
              detail: `top=${Math.round(rect.top)}px, bottom=${Math.round(rect.bottom)}px <= ${window.innerHeight}px | isHit=${isHit}`,
            };
          });
          allTestResults.push({
            viewport: vp.name,
            lang: lang.toUpperCase(),
            screen: "Sale Search DD",
            ...ddCheck,
          });

          await itemInput.fill("");
          await page.keyboard.press("Escape");
          await page.waitForTimeout(200);
        }

        // Test 'नई पार्टी' Modal Portal Visibility
        console.log("  2c. 'नई पार्टी' Modal Portal Check");
        const newPartyBtn = page
          .locator('text="+ नया खाता"')
          .or(page.locator('text="+ नई पार्टी"'))
          .or(page.locator('text="+ New Party"'))
          .first();
        if (await newPartyBtn.isVisible()) {
          await newPartyBtn.click();
          await page.waitForTimeout(350);

          const modalCheck = await page.evaluate(() => {
            const modal = document.querySelector('[data-testid="add-party-modal"]');
            if (!modal) {
              return {
                test: "नई पार्टी Modal Portal",
                pass: false,
                detail: "Modal not rendered in DOM",
              };
            }
            const dialog = modal.querySelector(".bg-white") || modal;
            const rect = dialog.getBoundingClientRect();
            const fullyVisible =
              rect.top >= 0 &&
              rect.bottom <= window.innerHeight &&
              rect.left >= 0 &&
              rect.right <= window.innerWidth;
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + 30;
            const hitEl = document.elementFromPoint(cx, cy);
            const isHit = hitEl ? modal.contains(hitEl) : false;
            const pass = fullyVisible && isHit;
            return {
              test: "नई पार्टी Modal Portal",
              pass,
              detail: `top=${Math.round(rect.top)}px, bottom=${Math.round(rect.bottom)}px <= ${window.innerHeight}px | isHit=${isHit}`,
            };
          });
          allTestResults.push({
            viewport: vp.name,
            lang: lang.toUpperCase(),
            screen: "Add Party Modal",
            ...modalCheck,
          });

          // Close modal
          const closeBtn = page.locator('[data-testid="add-party-close-btn"]');
          if (await closeBtn.isVisible()) {
            await closeBtn.click();
          } else {
            await page.keyboard.press("Escape");
          }
          await page.waitForTimeout(400);
        }

        // Screenshot of Sale
        await page.screenshot({ path: path.join(vpDir, "02-sale.png") });
        if (vp.isDefault) {
          await page.screenshot({ path: path.join(langDir, "02-sale.png") });
        }

        // Screen 3: Reports View (रिपोर्ट - बिक्री रजिस्टर)
        console.log("  3. Reports View (रिपोर्ट)");
        await page.locator('[data-testid="nav-Reports"]').click();
        await page.waitForTimeout(400);

        const repBtn = await checkPrimaryButton(
          '[data-testid="report-csv-btn"]',
          "CSV Export"
        );
        allTestResults.push({
          viewport: vp.name,
          lang: lang.toUpperCase(),
          screen: "Reports",
          ...repBtn,
        });

        const repOverflow = await checkOverflowHiddenContainers("Reports");
        allTestResults.push({
          viewport: vp.name,
          lang: lang.toUpperCase(),
          screen: "Reports",
          ...repOverflow,
        });

        // Screenshot of Reports
        await page.screenshot({ path: path.join(vpDir, "07-reports.png") });
        if (vp.isDefault) {
          await page.screenshot({ path: path.join(langDir, "07-reports.png") });
        }

        // Screen 4: Purchase View (माल आया)
        console.log("  4. Purchase View (माल आया)");
        await page.locator('[data-testid="nav-Purchase"]').click();
        await page.waitForTimeout(400);

        const purOverflow = await checkOverflowHiddenContainers("Purchase");
        allTestResults.push({
          viewport: vp.name,
          lang: lang.toUpperCase(),
          screen: "Purchase (माल आया)",
          ...purOverflow,
        });

        await page.screenshot({ path: path.join(vpDir, "03-purchase.png") });
        if (vp.isDefault) {
          await page.screenshot({ path: path.join(langDir, "03-purchase.png") });
        }

        // Screen 5: Payment View (पैसा मिला/दिया)
        console.log("  5. Payment View (पैसा मिला/दिया)");
        await page.locator('[data-testid="nav-Payment"]').click();
        await page.waitForTimeout(400);

        const payOverflow = await checkOverflowHiddenContainers("Payment");
        allTestResults.push({
          viewport: vp.name,
          lang: lang.toUpperCase(),
          screen: "Payment (पैसा मिला/दिया)",
          ...payOverflow,
        });

        await page.screenshot({ path: path.join(vpDir, "04-payment.png") });
        if (vp.isDefault) {
          await page.screenshot({ path: path.join(langDir, "04-payment.png") });
        }

        // Screen 6: Stock View (स्टॉक)
        console.log("  6. Stock View (स्टॉक)");
        await page.locator('[data-testid="nav-Stock"]').click();
        await page.waitForTimeout(400);

        const stockOverflow = await checkOverflowHiddenContainers("Stock");
        allTestResults.push({
          viewport: vp.name,
          lang: lang.toUpperCase(),
          screen: "Stock (स्टॉक)",
          ...stockOverflow,
        });

        await page.screenshot({ path: path.join(vpDir, "05-stock.png") });
        if (vp.isDefault) {
          await page.screenshot({ path: path.join(langDir, "05-stock.png") });
        }

        // Screen 7: Len-Den View (लेना-देना)
        console.log("  7. Len-Den View (लेना-देना)");
        await page.locator('[data-testid="nav-Len-Den"]').click();
        await page.waitForTimeout(400);

        const lendenOverflow = await checkOverflowHiddenContainers("Len-Den");
        allTestResults.push({
          viewport: vp.name,
          lang: lang.toUpperCase(),
          screen: "Len-Den (लेना-देना)",
          ...lendenOverflow,
        });

        await page.screenshot({ path: path.join(vpDir, "06-len-den.png") });
        if (vp.isDefault) {
          await page.screenshot({ path: path.join(langDir, "06-len-den.png") });
        }

        // Helper to navigate via More flyout
        const navigateViaFlyout = async (targetTestId) => {
          const mBtn = page.locator('[data-testid="nav-More"]');
          await mBtn.click();
          await page.waitForTimeout(300);
          const item = page.locator(`[data-testid="${targetTestId}"]`);
          await item.click();
          await page.waitForTimeout(400);
        };

        // Screen 8: Items View (सामान सूची)
        console.log("  8. Items View (सामान सूची)");
        await navigateViaFlyout("nav-Items");
        const itemsOverflow = await checkOverflowHiddenContainers("Items");
        allTestResults.push({
          viewport: vp.name,
          lang: lang.toUpperCase(),
          screen: "Items (सामान सूची)",
          ...itemsOverflow,
        });
        await page.screenshot({ path: path.join(vpDir, "08-items.png") });
        if (vp.isDefault) {
          await page.screenshot({ path: path.join(langDir, "08-items.png") });
        }

        // Screen 9: Parties View (पार्टी खाता)
        console.log("  9. Parties View (पार्टी खाता)");
        await navigateViaFlyout("nav-Parties");
        const partiesOverflow = await checkOverflowHiddenContainers("Parties");
        allTestResults.push({
          viewport: vp.name,
          lang: lang.toUpperCase(),
          screen: "Parties (पार्टी खाता)",
          ...partiesOverflow,
        });
        await page.screenshot({ path: path.join(vpDir, "09-parties.png") });
        if (vp.isDefault) {
          await page.screenshot({ path: path.join(langDir, "09-parties.png") });
        }

        // Screen 10: Opening Stock View (ओपनिंग स्टॉक)
        console.log("  10. Opening Stock View (ओपनिंग स्टॉक)");
        await navigateViaFlyout("nav-Opening Stock");
        const opStockOverflow = await checkOverflowHiddenContainers("Opening Stock");
        allTestResults.push({
          viewport: vp.name,
          lang: lang.toUpperCase(),
          screen: "Opening Stock (ओपनिंग स्टॉक)",
          ...opStockOverflow,
        });
        await page.screenshot({ path: path.join(vpDir, "10-opening-stock.png") });
        if (vp.isDefault) {
          await page.screenshot({ path: path.join(langDir, "10-opening-stock.png") });
        }

        // Screen 11: Stock Adjustment View (स्टॉक सुधार)
        console.log("  11. Stock Adjustment View (स्टॉक सुधार)");
        await navigateViaFlyout("nav-Stock Adjustment");
        const stAdjOverflow = await checkOverflowHiddenContainers("Stock Adjustment");
        allTestResults.push({
          viewport: vp.name,
          lang: lang.toUpperCase(),
          screen: "Stock Adjustment (स्टॉक सुधार)",
          ...stAdjOverflow,
        });
        await page.screenshot({ path: path.join(vpDir, "11-stock-adjustment.png") });
        if (vp.isDefault) {
          await page.screenshot({ path: path.join(langDir, "11-stock-adjustment.png") });
        }

        // Screen 12: Tally Import View (टैली इम्पोर्ट)
        console.log("  12. Tally Import View (टैली इम्पोर्ट)");
        await navigateViaFlyout("nav-Tally Import");
        const tallyOverflow = await checkOverflowHiddenContainers("Tally Import");
        allTestResults.push({
          viewport: vp.name,
          lang: lang.toUpperCase(),
          screen: "Tally Import (टैली इम्पोर्ट)",
          ...tallyOverflow,
        });
        await page.screenshot({ path: path.join(vpDir, "12-tally-import.png") });
        if (vp.isDefault) {
          await page.screenshot({ path: path.join(langDir, "12-tally-import.png") });
        }

        // Screen 13: Settings View (सेटिंग्स)
        console.log("  13. Settings View (सेटिंग्स)");
        await navigateViaFlyout("nav-Settings");
        const genTab = page.locator('[data-testid="tab-general-settings"]');
        if (await genTab.isVisible()) {
          await genTab.click();
          await page.waitForTimeout(300);
        }
        const settingsOverflow = await checkOverflowHiddenContainers("Settings");
        allTestResults.push({
          viewport: vp.name,
          lang: lang.toUpperCase(),
          screen: "Settings (सेटिंग्स)",
          ...settingsOverflow,
        });
        await page.screenshot({ path: path.join(vpDir, "13-settings.png") });
        if (vp.isDefault) {
          await page.screenshot({ path: path.join(langDir, "13-settings.png") });
        }

        // Screen 14: Printer Setup View (प्रिंटर सेटअप)
        console.log("  14. Printer Setup View (प्रिंटर सेटअप)");
        const printerTab = page.locator('[data-testid="tab-printer-settings"]');
        if (await printerTab.isVisible()) {
          await printerTab.click();
          await page.waitForTimeout(300);
        } else {
          await navigateViaFlyout("nav-PrinterSetup");
        }
        const printerOverflow = await checkOverflowHiddenContainers("PrinterSetup");
        allTestResults.push({
          viewport: vp.name,
          lang: lang.toUpperCase(),
          screen: "Printer Setup (प्रिंटर सेटअप)",
          ...printerOverflow,
        });
        await page.screenshot({ path: path.join(vpDir, "14-printer-setup.png") });
        if (vp.isDefault) {
          await page.screenshot({ path: path.join(langDir, "14-printer-setup.png") });
        }

        // Screen 15: Bill Settings View (बिल सेटिंग्स)
        console.log("  15. Bill Settings View (बिल सेटिंग्स)");
        const billTab = page.locator('[data-testid="tab-bill-settings"]');
        if (await billTab.isVisible()) {
          await billTab.click();
          await page.waitForTimeout(300);
        }
        const billSettingsOverflow = await checkOverflowHiddenContainers("Bill Settings");
        allTestResults.push({
          viewport: vp.name,
          lang: lang.toUpperCase(),
          screen: "Bill Settings (बिल सेटिंग्स)",
          ...billSettingsOverflow,
        });
        await page.screenshot({ path: path.join(vpDir, "15-bill-settings.png") });
        if (vp.isDefault) {
          await page.screenshot({ path: path.join(langDir, "15-bill-settings.png") });
        }

        await context.close();
      }
    }

    // Print Detailed Results Table
    console.log("\n==========================================================================================");
    console.log("                          COMPREHENSIVE TEST SUITE REPORT                                  ");
    console.log("==========================================================================================");
    console.log(
      `| Viewport   | Lang | Screen          | Test Description                 | Status | Detail`
    );
    console.log(
      `|------------|------|-----------------|----------------------------------|--------|----------------------`
    );

    for (const r of allTestResults) {
      const vpCol = r.viewport.padEnd(10);
      const langCol = r.lang.padEnd(4);
      const screenCol = r.screen.padEnd(15);
      const testCol = r.test.slice(0, 32).padEnd(32);
      const statusCol = r.pass ? "PASS  " : "FAIL  ";
      console.log(
        `| ${vpCol} | ${langCol} | ${screenCol} | ${testCol} | ${statusCol} | ${r.detail}`
      );
    }

    const failures = allTestResults.filter((r) => !r.pass);
    console.log("==========================================================================================");
    if (failures.length === 0) {
      console.log(`>>> TOTAL TESTS: ${allTestResults.length} | PASSED: ${allTestResults.length} | FAILED: 0`);
      console.log(">>> [SUCCESS] All primary buttons visible, 0 clipped containers, all portals inside bounds!");
    } else {
      console.error(`>>> [FAILURE] ${failures.length} test assertions failed:`);
      for (const f of failures) {
        console.error(`    - [${f.viewport}][${f.lang}] ${f.screen} - ${f.test}: ${f.detail}`);
      }
      process.exitCode = 1;
    }
    console.log("==========================================================================================\n");
  } catch (err) {
    console.error("\n[Error during test run]:", err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    if (viteServer) {
      console.log("[Info] Closing local Vite server...");
      await viteServer.close();
    }
  }
}

run();
