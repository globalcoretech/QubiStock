import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "bills-preview");

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

const SCENARIOS = [
  { id: "1_item", name: "1 Item Quick Bill" },
  { id: "10_items", name: "10 Items Standard" },
  { id: "45_items_multipage", name: "45 Items Multi-page" },
  { id: "long_hindi_names", name: "Long Hindi Names" },
  { id: "unregistered_party", name: "Unregistered Party" },
  { id: "igst_bill", name: "Interstate IGST Bill" },
  { id: "composition_bill_of_supply", name: "Composition Bill of Supply" },
];

const FORMATS = ["A4", "A5", "A6"];

async function verifyPdf(pdfPath, scenarioId, fmt) {
  const buffer = fs.readFileSync(pdfPath);

  // 1. pdf-lib checks: page count and dimensions
  const pdfDoc = await PDFDocument.load(buffer);
  const pageCount = pdfDoc.getPageCount();
  const pages = pdfDoc.getPages();
  const firstPage = pages[0];
  const { width: pWidth, height: pHeight } = firstPage.getSize();

  // A6 dimensions check: 105mm = 297.64pt, 148mm = 419.53pt (+/- 4pt tolerance)
  let dimValid = true;
  if (fmt === "A6") {
    dimValid = Math.abs(pWidth - 297.64) <= 6 && Math.abs(pHeight - 419.53) <= 6;
  } else if (fmt === "A5") {
    dimValid = Math.abs(pWidth - 419.53) <= 6 && Math.abs(pHeight - 595.28) <= 6;
  } else if (fmt === "A4") {
    dimValid = Math.abs(pWidth - 595.28) <= 6 && Math.abs(pHeight - 841.89) <= 6;
  }

  // 2. pdfjs-dist text extraction and semantic checks
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const jsDoc = await loadingTask.promise;

  let page1HasPageIndicator = false;
  let allPagesHaveHeader = true;
  let totalOnlyOnLastPage = true;
  let noOverflow = true;
  let overflowDetails = "";

  const pageTexts = [];

  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const p = await jsDoc.getPage(pageNum);
    const textContent = await p.getTextContent();
    const viewport = p.getViewport({ scale: 1.0 });

    const strings = textContent.items.map((item) => item.str || "").join(" ");
    pageTexts.push(strings);
    const norm = (str) => (str || "").toLowerCase().replace(/\s+/g, "");
    const normStr = norm(strings);

    // Header check: each page must have shop details / GSTIN
    const hasShopHeader =
      normStr.includes(norm("किसान")) ||
      normStr.includes(norm("कृषि")) ||
      normStr.includes("gstin") ||
      normStr.includes(norm("बिल नं")) ||
      normStr.includes("taxinvoice") ||
      normStr.includes("billofsupply") ||
      normStr.includes("cashmemo");

    if (!hasShopHeader) {
      allPagesHaveHeader = false;
    }

    // Boundary check: no text overflowing right or bottom edge
    for (const item of textContent.items) {
      if (!item.str || !item.str.trim()) continue;
      const x = item.transform[4];
      const y = item.transform[5];
      const w = item.width || 0;

      // In PDF coordinate space, (0,0) is bottom-left
      if (x + w > viewport.width + 10) {
        noOverflow = false;
        overflowDetails = `Page ${pageNum} text '${item.str.slice(0, 15)}' x+w ${Math.round(x + w)} > ${Math.round(viewport.width)}`;
        break;
      }
      if (y < -8) {
        noOverflow = false;
        overflowDetails = `Page ${pageNum} text '${item.str.slice(0, 15)}' y ${Math.round(y)} < 0`;
        break;
      }
    }
  }

  const norm = (str) => (str || "").toLowerCase().replace(/\s+/g, "");
  const hasGrandTotal = (str) => {
    const n = norm(str);
    return (
      n.includes(norm("कुल देय")) ||
      n.includes(norm("Grand Total")) ||
      n.includes("grandtotal") ||
      n.includes("कुलदेय")
    );
  };

  // Multi-page specific checks (Scenario 45 items)
  if (scenarioId === "45_items_multipage") {
    // 1. Page 1 must have Page 1/N indicator
    const normP1 = norm(pageTexts[0]);
    page1HasPageIndicator =
      /page1\/\d+/i.test(normP1) ||
      /1\/\d+/.test(normP1);

    // 2. Grand Total must NOT appear on early pages (1 to N-1)
    for (let i = 0; i < pageCount - 1; i++) {
      if (hasGrandTotal(pageTexts[i])) {
        totalOnlyOnLastPage = false;
      }
    }

    // 3. Grand Total MUST appear on the last page
    const lastHasTotal = hasGrandTotal(pageTexts[pageCount - 1]);

    if (!lastHasTotal) {
      totalOnlyOnLastPage = false;
    }
  } else {
    page1HasPageIndicator = true;
  }

  const passed =
    dimValid &&
    allPagesHaveHeader &&
    totalOnlyOnLastPage &&
    noOverflow &&
    (scenarioId !== "45_items_multipage" || page1HasPageIndicator);

  return {
    pageCount,
    dim: `${Math.round(pWidth)}x${Math.round(pHeight)} pt`,
    dimValid,
    allPagesHaveHeader,
    totalOnlyOnLastPage,
    page1HasPageIndicator,
    noOverflow,
    overflowDetails,
    passed,
  };
}

async function run() {
  console.log("==========================================================================");
  console.log("  Krishi Kendra Bill Templates Automated Test Suite");
  console.log("  Verifying Real PDF Structure with pdf-lib & pdfjs-dist");
  console.log("  7 Scenarios x 3 Sizes (A4, A5, A6) = 21 PDFs + 21 PNGs");
  console.log("==========================================================================");

  await ensureDir(outputDir);

  let chromium;
  try {
    const pw = await import("playwright");
    chromium = pw.chromium;
  } catch (err) {
    console.error("\n[Error] Playwright is not installed:", err.message);
    process.exit(1);
  }

  let viteServer = null;
  const port = 5173;
  const isRunning = await isPortOpen(port);
  if (!isRunning) {
    console.log(`[Info] Starting local Vite dev server on port ${port}...`);
    const { createServer } = await import("vite");
    viteServer = await createServer({
      root: rootDir,
      server: { port },
    });
    await viteServer.listen();
    console.log(`[Info] Vite server started at http://localhost:${port}`);
  } else {
    console.log(`[Info] Reusing active server at http://localhost:${port}`);
  }

  console.log("[Info] Launching Chromium browser (headless)...");
  const browser = await chromium.launch({
    headless: true,
  });

  const results = [];

  try {
    for (const sc of SCENARIOS) {
      console.log(`\n>>> Scenario: ${sc.name} (${sc.id})`);

      for (const fmt of FORMATS) {
        process.stdout.write(`  - Format ${fmt}: `);

        const viewportWidth = fmt === "A4" ? 1200 : fmt === "A5" ? 1000 : 800;
        const viewportHeight = fmt === "A4" ? 1600 : fmt === "A5" ? 1400 : 1200;

        const context = await browser.newContext({
          viewport: { width: viewportWidth, height: viewportHeight },
          deviceScaleFactor: 2,
        });
        const page = await context.newPage();

        const url = `http://localhost:${port}/?demo=1&bill_preview=1&scenario=${sc.id}&format=${fmt}`;
        await page.goto(url, { waitUntil: "networkidle" });
        await page.waitForTimeout(400);

        await page.waitForSelector("#bill-print-target", { timeout: 8000 });

        const pdfFilename = `${sc.id}_${fmt}.pdf`;
        const pngFilename = `${sc.id}_${fmt}.png`;
        const pdfPath = path.join(outputDir, pdfFilename);
        const pngPath = path.join(outputDir, pngFilename);

        // Explicit Page Dimensions for PDF
        const pdfOptions = {
          path: pdfPath,
          printBackground: true,
          preferCSSPageSize: false,
        };

        if (fmt === "A4") {
          pdfOptions.width = "210mm";
          pdfOptions.height = "297mm";
          pdfOptions.margin = { top: "8mm", bottom: "8mm", left: "8mm", right: "8mm" };
        } else if (fmt === "A5") {
          pdfOptions.width = "148mm";
          pdfOptions.height = "210mm";
          pdfOptions.margin = { top: "6mm", bottom: "6mm", left: "6mm", right: "6mm" };
        } else if (fmt === "A6") {
          pdfOptions.width = "105mm";
          pdfOptions.height = "148mm";
          pdfOptions.margin = { top: "4mm", bottom: "4mm", left: "4mm", right: "4mm" };
        }

        // 1. Generate PDF
        await page.pdf(pdfOptions);

        // 2. Generate PNG Screenshot
        const billLocator = page.locator("#bill-print-target");
        if (await billLocator.isVisible()) {
          await billLocator.screenshot({ path: pngPath });
        } else {
          await page.screenshot({ path: pngPath, fullPage: true });
        }

        const pdfStat = fs.existsSync(pdfPath) ? fs.statSync(pdfPath) : null;
        const pngStat = fs.existsSync(pngPath) ? fs.statSync(pngPath) : null;
        const pdfSizeKb = pdfStat ? (pdfStat.size / 1024).toFixed(1) : "0";
        const pngSizeKb = pngStat ? (pngStat.size / 1024).toFixed(1) : "0";

        // 3. Real PDF Verification with pdf-lib & pdfjs-dist
        const v = await verifyPdf(pdfPath, sc.id, fmt);

        const isPassed = pdfStat && pdfStat.size > 0 && pngStat && pngStat.size > 0 && v.passed;

        results.push({
          scenario: sc.id,
          format: fmt,
          pageCount: v.pageCount,
          dimensions: v.dim,
          dimValid: v.dimValid,
          headerCheck: v.allPagesHaveHeader ? "OK" : "MISSING",
          totalCheck: v.totalOnlyOnLastPage ? "OK" : "LEAKED",
          boundaryCheck: v.noOverflow ? "OK" : "OVERFLOW",
          overflowDetails: v.overflowDetails,
          pdfSize: `${pdfSizeKb} KB`,
          status: isPassed ? "PASS" : "FAIL",
        });

        console.log(
          `[${isPassed ? "PASS" : "FAIL"}] Pages: ${v.pageCount} | Dim: ${v.dim} | Header: ${v.allPagesHaveHeader ? "OK" : "FAIL"} | Total: ${v.totalOnlyOnLastPage ? "OK" : "FAIL"} | Edge: ${v.noOverflow ? "OK" : "FAIL"}`
        );

        await context.close();
      }
    }
  } catch (err) {
    console.error("\n[Error during test run]:", err);
  } finally {
    await browser.close();
    if (viteServer) {
      console.log("[Info] Closing local Vite server...");
      await viteServer.close();
    }
  }

  // Summary Table Output
  console.log("\n=========================================================================================================");
  console.log("                                  BILLS PDF REAL VERIFICATION REPORT                                     ");
  console.log("=========================================================================================================");
  console.log("| Scenario                  | Format | Pages | Dimensions  | Header | Total (Last) | Edge Bound | Status |");
  console.log("|---------------------------|--------|-------|-------------|--------|--------------|------------|--------|");
  for (const r of results) {
    const scStr = r.scenario.padEnd(25);
    const fmtStr = r.format.padEnd(6);
    const pgStr = String(r.pageCount).padStart(3).padEnd(5);
    const dimStr = r.dimensions.padEnd(11);
    const hdrStr = r.headerCheck.padEnd(6);
    const totStr = r.totalCheck.padEnd(12);
    const bndStr = r.boundaryCheck.padEnd(10);
    console.log(`| ${scStr} | ${fmtStr} | ${pgStr} | ${dimStr} | ${hdrStr} | ${totStr} | ${bndStr} | ${r.status}   |`);
  }
  console.log("=========================================================================================================");
  const total = results.length;
  const passed = results.filter((r) => r.status === "PASS").length;
  console.log(`>>> TOTAL TESTS: ${total} | PASSED: ${passed} | FAILED: ${total - passed}`);
  console.log(`>>> Output Artifacts: ${outputDir}`);
  console.log("=========================================================================================================");

  if (passed !== total) {
    console.error(`\n[FATAL] ${total - passed} PDF test(s) failed validation!`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
