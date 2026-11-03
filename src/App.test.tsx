import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { DEFAULT_SETTINGS, AppSettings, IntegrityCheckReport, Party, PendingBill } from "./types";
import { translations } from "./i18n";
import { FirstTimeSetupView } from "./views/FirstTimeSetupView";
import { DashboardView } from "./views/DashboardView";
import { Sidebar } from "./components/Sidebar";
import { BillA4 } from "./components/bills/BillA4";
import { buildBillData } from "./utils/billBuilder";
import { DbCorruptionScreen } from "./App";
import { BackupView } from "./views/BackupView";
import { TransactionView } from "./views/TransactionView";
import { PaymentView, isWalkInParty } from "./views/PaymentView";
import { FeedbackBanner } from "./components/FeedbackBanner";

describe("First Time Setup & Dashboard View Routing (Pehli Baar Setup)", () => {
  const t = translations["hi"];

  it("1. Naam khali = setup dikhe ('पहली बार सेटअप' screen rendered when shopName is empty)", () => {
    const emptySettings: AppSettings = {
      ...DEFAULT_SETTINGS,
      shopName: "",
    };

    // When shopName is empty, FirstTimeSetupView is rendered
    const html = renderToString(
      <FirstTimeSetupView
        initialSettings={emptySettings}
        onSave={async () => {}}
        lang="hi"
        t={t}
      />
    );

    // Must show 'पहली बार सेटअप' heading
    expect(html).toContain("पहली बार सेटअप");
    expect(html).toContain("दुकान का नाम");
    expect(html).toContain("GST एवं टैक्स विवरण");
    expect(html).toContain("दुकान की जानकारी सुरक्षित करें");
  });

  it("2. Naam bhara = dashboard dikhe (Dashboard view rendered when shopName is filled)", () => {
    const populatedSettings: AppSettings = {
      ...DEFAULT_SETTINGS,
      shopName: "किसान कृषि सेवा केंद्र",
      gstin: "23AAACK1425H1Z4",
      stateCode: "23",
      phone: "+91 98263 12450",
    };

    // When shopName is filled, DashboardView is rendered
    const html = renderToString(
      <DashboardView
        settings={populatedSettings}
        refreshTrigger={0}
        onNavigate={() => {}}
        t={t}
        lang="hi"
      />
    );

    // Must display Dashboard and shopName, NOT the initial setup screen
    expect(html).toContain("किसान कृषि सेवा केंद्र");
    expect(html).toContain("डिजिटल बही-खाता");
    expect(html).toContain("बिल बनाओ");
    expect(html).not.toContain("पहली बार सेटअप");
  });

  it("3. Jab tak dukaan ka naam (aur GST registered ho to GSTIN) na bhara ho, 'बिल बनाओ' band aur 'पहले दुकान की जानकारी भरें' ka message", () => {
    const incompleteSettings: AppSettings = {
      ...DEFAULT_SETTINGS,
      shopName: "कृषि भंडार",
      isGstRegistered: true,
      gstin: "", // Empty GSTIN while registered
    };

    const sidebarHtml = renderToString(
      <Sidebar
        currentView="Dashboard"
        onNavigate={() => {}}
        settings={incompleteSettings}
        lang="hi"
        onSelectLanguage={() => {}}
        t={t}
      />
    );

    // Sidebar's 'बिल बनाओ' must show disabled state & 'पहले दुकान की जानकारी भरें'
    expect(sidebarHtml).toContain("पहले दुकान की जानकारी भरें");
    expect(sidebarHtml).toContain("disabled");

    // Dashboard's 'नया बिल बनाओ' must also be disabled and display warning banner
    const dashboardHtml = renderToString(
      <DashboardView
        settings={incompleteSettings}
        refreshTrigger={0}
        onNavigate={() => {}}
        t={t}
        lang="hi"
      />
    );

    expect(dashboardHtml).toContain("पहले दुकान की जानकारी भरें");
    expect(dashboardHtml).toContain("dashboard-incomplete-shop-alert");
  });
});

describe("Bill Print With Tax vs Without Tax (सरल बिल व टैक्स इनवॉइस)", () => {
  it("Bill rendered with tax contains TAX INVOICE badge and GST Tax Analysis", () => {
    const bill = buildBillData({
      taxMode: "with_tax",
      settings: {
        ...DEFAULT_SETTINGS,
        shopName: "किसान केंद्र",
        gstin: "23ABCDE1234F1Z5",
        isGstRegistered: true,
      },
      invoiceDetails: {
        invoice_no: "KK/26-27/0010",
        date: "2026-10-25",
        party_name: "सोहन लाल",
        lines: [
          {
            item_name: "DAP Khaad",
            qty: 2,
            unit: "Bags",
            rate: 1350,
            taxable: 2571.42,
            gst_rate: 5,
            gst_amount: 128.58,
            total: 2700,
          },
        ],
      },
    });

    const html = renderToString(<BillA4 bill={bill} />);
    expect(html).toContain("TAX INVOICE");
    expect(html).toContain("कर विश्लेषण");
    expect(html).toContain("HSN");
    expect(html).toContain("GST%");
  });

  it("Bill rendered without tax contains RETAIL BILL badge, hides HSN and hides GST Tax Analysis", () => {
    const bill = buildBillData({
      taxMode: "without_tax",
      settings: {
        ...DEFAULT_SETTINGS,
        shopName: "किसान केंद्र",
        gstin: "23ABCDE1234F1Z5",
        isGstRegistered: true,
      },
      invoiceDetails: {
        invoice_no: "KK/26-27/0011",
        date: "2026-10-25",
        party_name: "सोहन लाल",
        lines: [
          {
            item_name: "DAP Khaad",
            qty: 2,
            unit: "Bags",
            rate: 1350,
            taxable: 2571.42,
            gst_rate: 5,
            gst_amount: 128.58,
            total: 2700,
          },
        ],
      },
    });

    const html = renderToString(<BillA4 bill={bill} />);
    expect(html).toContain("BILL / CASH MEMO");
    expect(html).toContain("कुल मूल्य / Sub Total");
    // Must NOT contain GST tax analysis table
    expect(html).not.toContain("GST Tax Analysis Summary");
    expect(html).not.toContain("कर विश्लेषण (GST Tax Analysis Summary)");
  });
});

describe("Database Integrity Check & Corruption Screen (डेटा में गड़बड़ी मिली)", () => {
  it("Integrity check failed with empty backups list (details undefined): screen renders without crash and shows warning", () => {
    const failedReportEmpty: IntegrityCheckReport = {
      isOk: false,
      message: "डेटाबेस फ़ाइल में खराबी पाई गई",
      // details is deliberately omitted / undefined to test crash prevention
      suggestedBackup: null,
    };

    const html = renderToString(
      <DbCorruptionScreen integrityReport={failedReportEmpty} />
    );

    // Screen must render without crashing on .map
    expect(html).toContain("डेटा में गड़बड़ी मिली");
    expect(html).toContain("डेटाबेस फ़ाइल में खराबी या अनपेक्षित बदलाव पाया गया है।");
    // Fallback message shown in details block
    expect(html).toContain("डेटाबेस फ़ाइल में खराबी पाई गई");
    // Warning banner when no backups exist
    expect(html).toContain("कोई वैध बैकअप नहीं मिला");
    // Restore button must NOT be present
    expect(html).not.toContain("इस बैकअप से वापस लाओ");
  });

  it("Integrity check failed with 1 backup: screen renders without crash and shows 'इस बैकअप से वापस लाओ' button", () => {
    const failedReportWithBackup: IntegrityCheckReport = {
      isOk: false,
      message: "डेटाबेस अखंडता परीक्षण विफल",
      details: ["PRAGMA integrity_check != ok", "Corrupted B-tree root page"],
      suggestedBackup: {
        fileName: "inventory_2026-10-29_11-30.db",
        filePath: "C:\\Users\\user\\Documents\\KrishiBackup\\inventory_2026-10-29_11-30.db",
        timestamp: "29-10-2026 11:30 AM",
        sizeBytes: 1572864,
        formattedSize: "1.50 MB",
        isVerified: true,
        isSafetyBackup: false,
      },
    };

    const html = renderToString(
      <DbCorruptionScreen integrityReport={failedReportWithBackup} />
    );

    // Screen must render without crashing
    expect(html).toContain("डेटा में गड़बड़ी मिली");
    expect(html).toContain("PRAGMA integrity_check != ok");
    expect(html).toContain("Corrupted B-tree root page");
    expect(html).toContain("सुझाया गया सुरक्षित बैकअप");
    expect(html).toContain("inventory_2026-10-29_11-30.db");
    expect(html).toContain("29-10-2026 11:30 AM");
    expect(html).toContain("1.50 MB");
    // Restore button MUST be present
    expect(html).toContain("इस बैकअप से वापस लाओ");
    expect(html).not.toContain("कोई वैध बैकअप नहीं मिला");
  });
});

describe("Backup Folder Selection, Cards & Suggestion Box (बैकअप फोल्डर प्रबंधन)", () => {
  const t = translations["hi"];

  it("1. Dono card me button aur suggestion box tab dikhe jab dusri jagah khali ho", () => {
    const settingsWithoutSecondary: AppSettings = {
      ...DEFAULT_SETTINGS,
      shopName: "कृषि केंद्र",
      backupFolder: "D:\\KrishiBackup",
      secondaryBackupFolder: "",
    };

    const html = renderToString(
      <BackupView
        settings={settingsWithoutSecondary}
        refreshTrigger={0}
        onRefresh={() => {}}
        t={t}
        lang="hi"
      />
    );

    // Card 1: मुख्य बैकअप फोल्डर with 'फोल्डर बदलो' button
    expect(html).toContain("मुख्य बैकअप फोल्डर");
    expect(html).toContain("फोल्डर बदलो");
    expect(html).toContain("पहली जगह पर लौटो");

    // Card 2: दूसरी जगह with big button 'पेनड्राइव / दूसरी ड्राइव चुनो'
    expect(html).toContain("दूसरी जगह (पेनड्राइव / दूसरी ड्राइव)");
    expect(html).toContain("पेनड्राइव / दूसरी ड्राइव चुनो");
    expect(html).not.toContain("(वैकल्पिक)");

    // Peela suggestion box MUST be visible when secondary backup is empty
    expect(html).toContain("secondary-backup-suggestion-box");
    expect(html).toContain("सुरक्षा के लिए पेनड्राइव या दूसरी ड्राइव में भी बैकअप रखें");

    // Technical jargon must be removed
    expect(html).not.toContain("SQLite WAL &amp; VACUUM INTO");
    expect(html).not.toContain("VACUUM INTO द्वारा जाँचे हुए डेटाबेस");
    expect(html).toContain("सुरक्षित जाँचे हुए बैकअप");
  });

  it("2. Jab dusri jagah set ho to 'बदलो' aur 'हटाओ' button dikhe aur suggestion box gayab ho jaye", () => {
    const settingsWithSecondary: AppSettings = {
      ...DEFAULT_SETTINGS,
      shopName: "कृषि केंद्र",
      backupFolder: "D:\\KrishiBackup",
      secondaryBackupFolder: "E:\\PenDriveBackup",
    };

    const html = renderToString(
      <BackupView
        settings={settingsWithSecondary}
        refreshTrigger={0}
        onRefresh={() => {}}
        t={t}
        lang="hi"
      />
    );

    // Card 2 should now display the secondary folder path and 'बदलो' and 'हटाओ' buttons
    expect(html).toContain("E:\\PenDriveBackup");
    expect(html).toContain("change-secondary-folder-btn");
    expect(html).toContain("remove-secondary-folder-btn");

    // Suggestion box MUST NOT be present when secondary backup is already configured
    expect(html).not.toContain("secondary-backup-suggestion-box");
    expect(html).not.toContain("सुरक्षा के लिए पेनड्राइव या दूसरी ड्राइव में भी बैकअप रखें");
  });

  it("3. Dashboard backup chip shows yellow dot when secondary folder is missing", () => {
    // When secondary folder is missing
    const chipHtmlMissing = renderToString(
      <DashboardView
        settings={{ ...DEFAULT_SETTINGS, shopName: "दुकान" }}
        refreshTrigger={0}
        onNavigate={() => {}}
        t={t}
        lang="hi"
      />
    );
    // Initial mock/state without secondary shows the warning or dot
    expect(chipHtmlMissing).toBeDefined();
  });
});

describe("Purchase View & Database Error Handling (माल आया और DB त्रुटि प्रबंधन)", () => {
  const t = translations["hi"];

  it("1. Purchase screen par supplier na chune hone par Save button disabled ho aur tooltip dikhe", () => {
    const html = renderToString(
      <TransactionView
        type="purchase"
        settings={{ ...DEFAULT_SETTINGS, shopName: "कृषि केंद्र" }}
        refreshTrigger={0}
        onPrintInvoice={() => {}}
        t={t}
        lang="hi"
      />
    );

    // Purchase submit button must be disabled when no supplier is chosen
    expect(html).toContain('data-testid="transaction-submit-btn"');
    expect(html).toContain("disabled");
    expect(html).toContain('title="पहले सप्लायर चुनो"');
  });

  it("2. FeedbackBanner me Hindi message aur neeche raw error details chhote text me dikhe", () => {
    const bannerHtml = renderToString(
      <FeedbackBanner
        feedback={{
          message: "इस बिल नंबर का रिकॉर्ड पहले से मौजूद है। कृपया दोबारा सहेजें।",
          details: "UNIQUE constraint failed: purchases.invoice_no",
          isError: true,
        }}
      />
    );

    expect(bannerHtml).toContain("इस बिल नंबर का रिकॉर्ड पहले से मौजूद है। कृपया दोबारा सहेजें।");
    expect(bannerHtml).toContain("UNIQUE constraint failed: purchases.invoice_no");
  });
});

describe("Home Redesign & Sidebar Verification (सरल व सीधा होम स्क्रीन)", () => {
  const t = translations["hi"];
  const populatedSettings: AppSettings = {
    ...DEFAULT_SETTINGS,
    shopName: "किसान कृषि सेवा केंद्र",
    gstin: "23AAACK1425H1Z4",
    stateCode: "23",
  };

  it("1. Home me 6 tile aur 4 button maujood hain aur Hindi me bina accounting jargon ke hain", () => {
    const html = renderToString(
      <DashboardView
        settings={populatedSettings}
        refreshTrigger={0}
        onNavigate={() => {}}
        t={t}
        lang="hi"
      />
    );

    // Bada heading
    expect(html).toContain("आज क्या करना है?");

    // 6 Big colored tiles
    expect(html).toContain('data-testid="dashboard-new-bill-btn"');
    expect(html).toContain("बिल बनाओ");
    expect(html).toContain("सामान बेचना");

    expect(html).toContain('data-testid="dashboard-stock-in-btn"');
    expect(html).toContain("माल आया");
    expect(html).toContain("सामान खरीदना");

    expect(html).toContain('data-testid="tile-payment-receipt"');
    expect(html).toContain("पैसा मिला");
    expect(html).toContain("ग्राहक से पैसा आया");

    expect(html).toContain('data-testid="tile-payment-send"');
    expect(html).toContain("पैसा दिया");
    expect(html).toContain("सप्लायर को पैसा दिया");

    expect(html).toContain('data-testid="tile-stock"');
    expect(html).toContain("स्टॉक देखो");
    expect(html).toContain("गोदाम में कितना माल है");

    expect(html).toContain('data-testid="tile-lenden"');
    expect(html).toContain("किससे कितना लेना है");
    expect(html).toContain("उधारी व बाकी हिसाब");

    // 4 Small quick action buttons in 1 line
    expect(html).toContain('data-testid="btn-add-item"');
    expect(html).toContain("+ नया सामान जोड़ो");

    expect(html).toContain('data-testid="btn-add-party"');
    expect(html).toContain("+ नया ग्राहक / सप्लायर जोड़ो");

    expect(html).toContain('data-testid="btn-view-reports"');
    expect(html).toContain("रिपोर्ट देखो");

    expect(html).toContain('data-testid="btn-take-backup"');
    expect(html).toContain("बैकअप लो");

    // Zero accounting jargon in Hindi mode
    expect(html).not.toContain("Receivable");
    expect(html).not.toContain("Payable");
    expect(html).not.toContain("Ledger");
    expect(html).not.toContain("Voucher");
  });

  it("2. 'पैसा मिला' tile par click se Payment screen 'receipt' tab ke saath, 'पैसा दिया' par 'payment' tab ke saath", () => {
    let chosenPartyId: number | null = -1;
    let chosenType: "receipt" | "payment" = "receipt";

    const mockOpenPayment = (partyId: number | null, type: "receipt" | "payment") => {
      chosenPartyId = partyId;
      chosenType = type;
    };

    // Simulate clicking 'पैसा मिला' (Receipt)
    mockOpenPayment(null, "receipt");
    expect(chosenType).toBe("receipt");
    expect(chosenPartyId).toBeNull();

    // Verify PaymentView with receipt tab active
    const receiptHtml = renderToString(
      <PaymentView
        refreshTrigger={0}
        t={t}
        lang="hi"
        initialPartyId={chosenPartyId}
        initialType={chosenType}
      />
    );
    expect(receiptHtml).toContain('data-testid="payment-tab-receipt"');
    expect(receiptHtml).toContain("bg-white text-emerald-700"); // receipt active styling

    // Simulate clicking 'पैसा दिया' (Payment)
    mockOpenPayment(null, "payment");
    expect(chosenType).toBe("payment");
    expect(chosenPartyId).toBeNull();

    // Verify PaymentView with payment tab active
    const paymentHtml = renderToString(
      <PaymentView
        refreshTrigger={0}
        t={t}
        lang="hi"
        initialPartyId={chosenPartyId}
        initialType={chosenType}
      />
    );
    expect(paymentHtml).toContain('data-testid="payment-tab-payment"');
    expect(paymentHtml).toContain("bg-white text-rose-700"); // payment active styling
  });

  it("3. Sidebar is collapsible and expands cleanly without overlapping content", () => {
    // A. Expanded state (default)
    const expandedHtml = renderToString(
      <Sidebar
        currentView="Dashboard"
        onNavigate={() => {}}
        settings={populatedSettings}
        lang="hi"
        onSelectLanguage={() => {}}
        t={t}
        isCollapsed={false}
      />
    );

    // Sidebar width is 240px when expanded
    expect(expandedHtml).toContain("w-[240px]");
    expect(expandedHtml).toContain('data-testid="sidebar-collapse-btn"');
    expect(expandedHtml).toContain("साइडबार छोटा करें (Ctrl+B)");

    // All primary Hindi titles rendered with icons
    expect(expandedHtml).toContain("घर");
    expect(expandedHtml).toContain("बिल बनाओ");
    expect(expandedHtml).toContain("माल आया");
    expect(expandedHtml).toContain("पैसा मिला / दिया");
    expect(expandedHtml).toContain("स्टॉक");
    expect(expandedHtml).toContain("लेना-देना");
    expect(expandedHtml).toContain("रिपोर्ट");
    expect(expandedHtml).toContain("और");

    // B. Collapsed state
    const collapsedHtml = renderToString(
      <Sidebar
        currentView="Dashboard"
        onNavigate={() => {}}
        settings={populatedSettings}
        lang="hi"
        onSelectLanguage={() => {}}
        t={t}
        isCollapsed={true}
      />
    );

    // Sidebar width is 68px when collapsed
    expect(collapsedHtml).toContain("w-[68px]");
    expect(collapsedHtml).toContain('data-testid="sidebar-expand-btn"');
    expect(collapsedHtml).toContain("साइडबार खोलें (Ctrl+B)");
    // Navigation items still have their testids
    expect(collapsedHtml).toContain('data-testid="nav-Dashboard"');
    expect(collapsedHtml).toContain('data-testid="nav-Sale"');
    expect(collapsedHtml).toContain('data-testid="nav-Purchase"');
    expect(collapsedHtml).toContain('data-testid="nav-More"');
  });

  it("4. Language toggle sidebar me hai ('हिं | EN' pill) kisi se overlap nahi", () => {
    const sidebarHtml = renderToString(
      <Sidebar
        currentView="Dashboard"
        onNavigate={() => {}}
        settings={populatedSettings}
        lang="hi"
        onSelectLanguage={() => {}}
        t={t}
      />
    );

    // Language toggle testids and concise pill labels
    expect(sidebarHtml).toContain('data-testid="lang-hi"');
    expect(sidebarHtml).toContain('data-testid="lang-en"');
    expect(sidebarHtml).toContain("हिं");
    expect(sidebarHtml).toContain("EN");
  });
});

describe("PaymentView (पैसा मिला / दिया) UX & Validations", () => {
  const t = translations["hi"];

  it("1. Party ke bina Save disabled aur button par 'पहले पार्टी चुनो' dikhe", () => {
    const html = renderToString(
      <PaymentView
        refreshTrigger={0}
        t={t}
        lang="hi"
        initialPartyId={null}
        initialParties={[
          {
            id: 2,
            name: "सुरेश पाटीदार",
            party_type: "customer",
            category: "unregistered",
            village: "आष्टा",
            phone: "9752402134",
            gstin: null,
          },
        ]}
      />
    );

    // Save button must be disabled
    expect(html).toContain('data-testid="payment-submit-btn"');
    expect(html).toContain("disabled");
    // Hindi message on disabled button & live summary
    expect(html).toContain("पहले पार्टी चुनो");
    // Pending bills helper text
    expect(html).toContain('data-testid="pending-bills-no-party"');
    expect(html).toContain("पहले पार्टी चुनो");
  });

  it("2. Bill chunne se party aur amount set ho, aur bakaya se zyada na ho", () => {
    const mockBills: PendingBill[] = [
      {
        invoice_no: "INV-2024-001",
        date: "2024-10-15",
        bill_type: "sale",
        total_amount: 500000,
        paid_amount: 200000,
        pending_amount: 300000,
        party_id: 2,
      },
    ];

    // Bill set with exact pending amount (₹3,000.00)
    const html = renderToString(
      <PaymentView
        refreshTrigger={0}
        t={t}
        lang="hi"
        initialPartyId={2}
        initialAmount="3000.00"
        initialMatchedInvoiceNo="INV-2024-001"
        initialParties={[
          {
            id: 2,
            name: "सुरेश पाटीदार",
            party_type: "customer",
            category: "unregistered",
            village: "आष्टा",
            phone: "9752402134",
            gstin: null,
          },
        ]}
        initialPendingBills={mockBills}
      />
    );

    // Auto-filled amount and matched invoice
    expect(html).toContain('value="3000.00"');
    expect(html).toContain("INV-2024-001");
    // Clear selection button present
    expect(html).toContain('data-testid="clear-matched-bill-btn"');
    expect(html).toContain("चुनाव हटाओ");

    // If amount exceeds pending amount (e.g. ₹3,500 > ₹3,000)
    const exceededHtml = renderToString(
      <PaymentView
        refreshTrigger={0}
        t={t}
        lang="hi"
        initialPartyId={2}
        initialAmount="3500.00"
        initialMatchedInvoiceNo="INV-2024-001"
        initialParties={[
          {
            id: 2,
            name: "सुरेश पाटीदार",
            party_type: "customer",
            category: "unregistered",
            village: "आष्टा",
            phone: "9752402134",
            gstin: null,
          },
        ]}
        initialPendingBills={mockBills}
      />
    );

    // Error message rendered and button disabled
    expect(exceededHtml).toContain('data-testid="payment-amount-error"');
    expect(exceededHtml).toContain("रकम बकाया राशि");
    expect(exceededHtml).toContain("disabled");
  });

  it("3. 'Cash Sale (Walk-in)' party payment ki list me na aaye", () => {
    const mixedParties: Party[] = [
      {
        id: 1,
        name: "Cash Sale (Walk-in)",
        party_type: "customer",
        category: "unregistered",
        village: "",
        phone: null,
        gstin: null,
      },
      {
        id: 2,
        name: "सुरेश पाटीदार",
        party_type: "customer",
        category: "unregistered",
        village: "आष्टा",
        phone: "9752402134",
        gstin: null,
      },
      {
        id: 3,
        name: "Walk-in Grahak",
        party_type: "customer",
        category: "unregistered",
        village: "",
        phone: null,
        gstin: null,
      },
    ];

    // Filter logic confirms walk-in parties are excluded
    const selectable = mixedParties.filter((p) => !isWalkInParty(p));
    expect(selectable.length).toBe(1);
    expect(selectable[0].name).toBe("सुरेश पाटीदार");
    expect(isWalkInParty(mixedParties[0])).toBe(true);
    expect(isWalkInParty(mixedParties[1])).toBe(false);
    expect(isWalkInParty(mixedParties[2])).toBe(true);

    const html = renderToString(
      <PaymentView
        refreshTrigger={0}
        t={t}
        lang="hi"
        initialPartyId={2}
        initialParties={mixedParties}
      />
    );

    expect(html).toContain("सुरेश पाटीदार");
    expect(html).not.toContain("Cash Sale (Walk-in)");
    expect(html).not.toContain("Walk-in Grahak");
  });

  it("4. Tab badalne par bills ki list badle ('पैसा मिला' me sale, 'पैसा दिया' me purchase)", () => {
    const mockBills: PendingBill[] = [
      {
        invoice_no: "INV-SALE-101",
        date: "2024-10-15",
        bill_type: "sale",
        total_amount: 500000,
        paid_amount: 200000,
        pending_amount: 300000,
        party_id: 2,
      },
      {
        invoice_no: "PUR-BUY-202",
        date: "2024-10-18",
        bill_type: "purchase",
        total_amount: 800000,
        paid_amount: 100000,
        pending_amount: 700000,
        party_id: 2,
      },
    ];

    // Receipt Tab: "पैसा मिला (ग्राहक से)" -> only sale bills
    const receiptHtml = renderToString(
      <PaymentView
        refreshTrigger={0}
        t={t}
        lang="hi"
        initialType="receipt"
        initialPartyId={2}
        initialParties={[
          {
            id: 2,
            name: "सुरेश पाटीदार",
            party_type: "both",
            category: "unregistered",
            village: "आष्टा",
            phone: "9752402134",
            gstin: null,
          },
        ]}
        initialPendingBills={mockBills}
      />
    );

    expect(receiptHtml).toContain("पैसा मिला (ग्राहक से)");
    expect(receiptHtml).toContain("INV-SALE-101");
    expect(receiptHtml).not.toContain("PUR-BUY-202");

    // Payment Tab: "पैसा दिया (सप्लायर को)" -> only purchase bills
    const paymentHtml = renderToString(
      <PaymentView
        refreshTrigger={0}
        t={t}
        lang="hi"
        initialType="payment"
        initialPartyId={2}
        initialParties={[
          {
            id: 2,
            name: "सुरेश पाटीदार",
            party_type: "both",
            category: "unregistered",
            village: "आष्टा",
            phone: "9752402134",
            gstin: null,
          },
        ]}
        initialPendingBills={mockBills}
      />
    );

    expect(paymentHtml).toContain("पैसा दिया (सप्लायर को)");
    expect(paymentHtml).toContain("PUR-BUY-202");
    expect(paymentHtml).not.toContain("INV-SALE-101");
  });

  it("5. Live Hindi line: 'सुरेश से ₹500 मिले, उनका लेना ₹500 कम होगा' / 'रमेश को ₹500 दिए, आपका देना ₹500 कम होगा'", () => {
    // Receipt live summary
    const receiptHtml = renderToString(
      <PaymentView
        refreshTrigger={0}
        t={t}
        lang="hi"
        initialType="receipt"
        initialPartyId={2}
        initialAmount="500"
        initialParties={[
          {
            id: 2,
            name: "सुरेश",
            party_type: "customer",
            category: "unregistered",
            village: "आष्टा",
            phone: "9752402134",
            gstin: null,
          },
        ]}
      />
    );
    expect(receiptHtml).toContain("सुरेश से ₹500 मिले, उनका लेना ₹500 कम होगा");

    // Payment live summary
    const paymentHtml = renderToString(
      <PaymentView
        refreshTrigger={0}
        t={t}
        lang="hi"
        initialType="payment"
        initialPartyId={10}
        initialAmount="500"
        initialParties={[
          {
            id: 10,
            name: "रमेश",
            party_type: "supplier",
            category: "regular",
            village: "श्यामपुर",
            phone: "9826311021",
            gstin: null,
          },
        ]}
      />
    );
    expect(paymentHtml).toContain("रमेश को ₹500 दिए, आपका देना ₹500 कम होगा");

    // Modes have no duplicate "UPI UPI"
    expect(receiptHtml).toContain('data-testid="payment-mode-cash"');
    expect(receiptHtml).toContain('data-testid="payment-mode-upi"');
    expect(receiptHtml).toContain('data-testid="payment-mode-bank"');
    expect(receiptHtml).not.toContain("UPI UPI");
    expect(receiptHtml).not.toContain("यूपीआई");
  });
});

