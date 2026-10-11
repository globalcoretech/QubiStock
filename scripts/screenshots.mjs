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
  console.log("=================================================");
  console.log("  Krishi Kendra Client-Ready Screenshot Generator");
  console.log("=================================================");

  // 1. Check Playwright availability
  let chromium;
  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch (err) {
    console.error("\n[Error] Playwright is not installed.");
    console.error("Please run the following commands in your terminal:");
    console.error("  npm install -D playwright");
    console.error("  npx playwright install chromium");
    console.error("  node scripts/screenshots.mjs\n");
    process.exit(1);
  }

  // 2. Ensure or start Vite dev server
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

  // 3. Launch Chromium
  console.log("[Info] Launching Chromium browser (headless)...");
  const browser = await chromium.launch({
    headless: true,
  });

  const languages = ["hi", "en"];
  const viewports = [
    { width: 1920, height: 1080, name: "1920x1080", isDefault: true },
    { width: 1366, height: 768, name: "1366x768", isDefault: false },
  ];

  try {
    for (const vp of viewports) {
      console.log(`\n>>> Processing Viewport: ${vp.name} (${vp.width}x${vp.height})`);

      for (const lang of languages) {
        console.log(`\n  --- Language: ${lang.toUpperCase()} ---`);

        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: 2, // 2x sharp Retina rendering
        });

        const page = await context.newPage();
        await page.goto(appBaseUrl, { waitUntil: "networkidle" });
        await page.waitForTimeout(600);

        // Switch language in UI
        const langBtn = page.locator(`[data-testid="lang-${lang}"]`);
        if (await langBtn.isVisible()) {
          await langBtn.click();
          await page.waitForTimeout(400);
        }

        // Directories for saving
        const langDir = path.join(rootDir, "screenshots", lang);
        const vpDir = path.join(langDir, vp.name);
        await ensureDir(langDir);
        await ensureDir(vpDir);

        const takeShot = async (filename) => {
          const filePathVp = path.join(vpDir, filename);
          await page.screenshot({ path: filePathVp, fullPage: false });
          // If default 1920x1080, also save directly into screenshots/hi/ or screenshots/en/
          if (vp.isDefault) {
            const filePathRoot = path.join(langDir, filename);
            await page.screenshot({ path: filePathRoot, fullPage: false });
          }
          console.log(`    [Saved] ${lang}/${filename}`);
        };

        // 1. Dashboard
        console.log("  1. Dashboard View");
        await page.locator('[data-testid="nav-Dashboard"]').click();
        await page.waitForTimeout(500);
        await takeShot("01-dashboard.png");

        // 2. Sale View (Filled with 3 items)
        console.log("  2. Sale View (Filled Form)");
        await page.locator('[data-testid="nav-Sale"]').click();
        await page.waitForTimeout(500);

        // Select party
        try {
          const partySelect = page.locator('[data-testid="transaction-party-select"]');
          await partySelect.click();
          await page.waitForTimeout(200);
          const firstPartyOption = page.locator('.cursor-pointer:has-text("रमेश")').first();
          if (await firstPartyOption.isVisible()) {
            await firstPartyOption.click();
          } else {
            await page.locator('.cursor-pointer').first().click();
          }
        } catch (e) {
          console.warn("    Party selection note:", e.message);
        }

        // Add 3 Lines
        const addLineBtn = page.locator('[data-testid="transaction-add-line-btn"]');
        for (let i = 0; i < 3; i++) {
          await addLineBtn.click();
          await page.waitForTimeout(200);
        }

        // Fill Line items
        const qtyInputs = page.locator('table tbody tr input[type="number"]');
        const count = await qtyInputs.count();
        if (count >= 1) await qtyInputs.nth(0).fill("20");
        if (count >= 2) await qtyInputs.nth(1).fill("6");
        if (count >= 3) await qtyInputs.nth(2).fill("2");

        // Select items in lines
        const itemSelects = page.locator('table tbody tr td:first-child');
        const itemCount = await itemSelects.count();
        if (itemCount >= 1) {
          await itemSelects.nth(0).click();
          await page.waitForTimeout(150);
          const opt = page.locator('.cursor-pointer:has-text("यूरिया")').first();
          if (await opt.isVisible()) await opt.click();
          else await page.keyboard.press("Enter");
        }
        if (itemCount >= 2) {
          await itemSelects.nth(1).click();
          await page.waitForTimeout(150);
          const opt = page.locator('.cursor-pointer:has-text("डीएपी")').first();
          if (await opt.isVisible()) await opt.click();
          else await page.keyboard.press("Enter");
        }
        if (itemCount >= 3) {
          await itemSelects.nth(2).click();
          await page.waitForTimeout(150);
          const opt = page.locator('.cursor-pointer:has-text("क्लोरोपाइरीफॉस")').first();
          if (await opt.isVisible()) await opt.click();
          else await page.keyboard.press("Enter");
        }

        await page.waitForTimeout(500);
        await takeShot("02-sale.png");

        // 3. Sale Print Bill Preview Modal
        console.log("  3. Sale Print Bill Preview Modal");
        await page.evaluate(() => {
          if (window.__openPrintInvoice) {
            window.__openPrintInvoice("INV-2024-089");
          }
        });
        await page.waitForTimeout(500);
        await takeShot("03-sale-bill-preview.png");
        await page.evaluate(() => {
          if (window.__closePrintInvoice) {
            window.__closePrintInvoice();
          }
        });
        await page.waitForTimeout(300);

        // 4. Purchase View (Filled Form)
        console.log("  4. Purchase View (Filled Form)");
        await page.locator('[data-testid="nav-Purchase"]').click();
        await page.waitForTimeout(500);

        try {
          const purPartySelect = page.locator('[data-testid="transaction-party-select"]');
          await purPartySelect.click();
          await page.waitForTimeout(200);
          const supplierOpt = page.locator('.cursor-pointer:has-text("इफको")').first();
          if (await supplierOpt.isVisible()) {
            await supplierOpt.click();
          } else {
            await page.locator('.cursor-pointer').first().click();
          }
        } catch (e) {
          console.warn("    Supplier selection note:", e.message);
        }

        const purAddBtn = page.locator('[data-testid="transaction-add-line-btn"]');
        await purAddBtn.click();
        await page.waitForTimeout(200);
        await purAddBtn.click();
        await page.waitForTimeout(200);

        const purQtys = page.locator('table tbody tr input[type="number"]');
        if ((await purQtys.count()) >= 1) await purQtys.nth(0).fill("100");
        if ((await purQtys.count()) >= 2) await purQtys.nth(1).fill("50");

        const purItemSelects = page.locator('table tbody tr td:first-child');
        if ((await purItemSelects.count()) >= 1) {
          await purItemSelects.nth(0).click();
          await page.waitForTimeout(150);
          const opt = page.locator('.cursor-pointer:has-text("यूरिया")').first();
          if (await opt.isVisible()) await opt.click();
          else await page.keyboard.press("Enter");
        }
        if ((await purItemSelects.count()) >= 2) {
          await purItemSelects.nth(1).click();
          await page.waitForTimeout(150);
          const opt = page.locator('.cursor-pointer:has-text("डीएपी")').first();
          if (await opt.isVisible()) await opt.click();
          else await page.keyboard.press("Enter");
        }

        await page.waitForTimeout(500);
        await takeShot("04-purchase.png");

        // 5. Payment View (Filled Form with Outstanding & Match)
        console.log("  5. Payment View (Filled Entry)");
        await page.locator('[data-testid="nav-Payment"]').click();
        await page.waitForTimeout(500);

        try {
          const payPartySelect = page.locator('[data-testid="payment-party-select"]');
          await payPartySelect.click();
          await page.waitForTimeout(200);
          const vikramOpt = page.locator('.cursor-pointer:has-text("विक्रम सिंह")').first();
          if (await vikramOpt.isVisible()) {
            await vikramOpt.click();
          } else {
            await page.locator('.cursor-pointer').first().click();
          }
        } catch (e) {
          console.warn("    Payment party note:", e.message);
        }

        const amtInput = page.locator('[data-testid="payment-amount-input"]');
        if (await amtInput.isVisible()) {
          await amtInput.fill("15000");
        }
        await page.waitForTimeout(500);
        await takeShot("05-payment.png");

        // 6. Stock Report
        console.log("  6. Stock Report View");
        await page.locator('[data-testid="nav-Stock"]').click();
        await page.waitForTimeout(500);
        await takeShot("06-stock-report.png");

        // 7. Len-Den (Parties Ledger)
        console.log("  7. Len-Den (Khaata Ledger) View");
        await page.locator('[data-testid="nav-Len-Den"]').click();
        await page.waitForTimeout(500);
        await takeShot("07-len-den.png");

        // 8-16. Reports View & All Tabs
        console.log("  8. Reports View (All Tabs)");
        await page.locator('[data-testid="nav-Reports"]').click();
        await page.waitForTimeout(500);

        // Sales Register with GST & without GST
        await page.locator('[data-testid="report-toggle-with-gst"]').click();
        await page.waitForTimeout(300);
        await takeShot("08-sales-register-with-gst.png");

        await page.locator('[data-testid="report-toggle-no-gst"]').click();
        await page.waitForTimeout(300);
        await takeShot("09-sales-register-without-gst.png");

        // Purchase Register with GST & without GST
        await page.locator('[data-testid="report-tab-purchase_reg"]').click();
        await page.waitForTimeout(300);
        await page.locator('[data-testid="report-toggle-with-gst"]').click();
        await page.waitForTimeout(300);
        await takeShot("10-purchase-register-with-gst.png");

        await page.locator('[data-testid="report-toggle-no-gst"]').click();
        await page.waitForTimeout(300);
        await takeShot("11-purchase-register-without-gst.png");

        // GST Summary
        await page.locator('[data-testid="report-tab-gst_summary"]').click();
        await page.waitForTimeout(400);
        await takeShot("12-gst-summary.png");

        // HSN Summary with GST & without GST
        await page.locator('[data-testid="report-tab-hsn_summary"]').click();
        await page.waitForTimeout(300);
        await page.locator('[data-testid="report-toggle-with-gst"]').click();
        await page.waitForTimeout(300);
        await takeShot("13-hsn-summary-with-gst.png");

        await page.locator('[data-testid="report-toggle-no-gst"]').click();
        await page.waitForTimeout(300);
        await takeShot("14-hsn-summary-without-gst.png");

        // Profit Report with GST & without GST
        await page.locator('[data-testid="report-tab-profit_report"]').click();
        await page.waitForTimeout(300);
        await page.locator('[data-testid="report-toggle-with-gst"]').click();
        await page.waitForTimeout(300);
        await takeShot("15-profit-report-with-gst.png");

        await page.locator('[data-testid="report-toggle-no-gst"]').click();
        await page.waitForTimeout(300);
        await takeShot("16-profit-report-without-gst.png");

        // 17. Items
        console.log("  17. Items View");
        await page.locator('[data-testid="nav-Items"]').click();
        await page.waitForTimeout(500);
        await takeShot("17-items.png");

        // 18. Parties
        console.log("  18. Parties View");
        await page.locator('[data-testid="nav-Parties"]').click();
        await page.waitForTimeout(500);
        await takeShot("18-parties.png");

        // 19. Tally Import (with Preview)
        console.log("  19. Tally Import View");
        await page.locator('[data-testid="nav-Tally Import"]').click();
        await page.waitForTimeout(400);

        try {
          const sampleXmlPath = path.join(rootDir, "temp_sample_tally.xml");
          fs.writeFileSync(
            sampleXmlPath,
            `<?xml version="1.0"?><ENVELOPE><BODY><DATA><TALLYMESSAGE><LEDGER NAME="Farmer Ramesh"><PARENT>Sundry Debtors</PARENT></LEDGER></TALLYMESSAGE></DATA></BODY></ENVELOPE>`
          );
          const fileInput = page.locator('[data-testid="tally-file-input"]');
          await fileInput.setInputFiles(sampleXmlPath);
          await page.waitForTimeout(300);
          const previewBtn = page.locator('[data-testid="tally-preview-btn"]');
          if (await previewBtn.isEnabled()) {
            await previewBtn.click();
            await page.waitForTimeout(400);
          }
          if (fs.existsSync(sampleXmlPath)) fs.unlinkSync(sampleXmlPath);
        } catch (e) {
          console.warn("    Tally preview note:", e.message);
        }

        await takeShot("19-tally-import.png");

        // 20. Settings
        console.log("  20. Settings View");
        await page.locator('[data-testid="nav-Settings"]').click();
        await page.waitForTimeout(500);
        await takeShot("20-settings.png");

        await context.close();
      }
    }

    console.log("\n=================================================");
    console.log("  All screenshots captured successfully!");
    console.log(`  Output directories:`);
    console.log(`    - ${path.join(rootDir, "screenshots", "hi")}`);
    console.log(`    - ${path.join(rootDir, "screenshots", "en")}`);
    console.log("=================================================");
  } catch (err) {
    console.error("\n[Error during screenshot capture]:", err);
  } finally {
    await browser.close();
    if (viteServer) {
      console.log("[Info] Closing local Vite server...");
      await viteServer.close();
    }
  }
}

run();
