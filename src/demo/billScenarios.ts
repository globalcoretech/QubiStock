import { BillData } from "../types";
import { buildBillData } from "../utils/billBuilder";

export interface ScenarioDefinition {
  id: string;
  name: string;
  description: string;
  bill: BillData;
}

// 1. One item quick bill
export const SCENARIO_1_ITEM: BillData = buildBillData({
  invoiceDetails: {
    invoice_no: "KK/25-26/0001",
    date: "2025-05-12",
    party_name: "मोहनलाल पाटीदार",
    party_village: "ग्राम बिलकिसगंज, सीहोर",
    party_phone: "9826311001",
    party_gstin: "23AABCP1234D1Z2",
    payment_mode: "cash",
    lines: [
      {
        item_name: "यूरिया 45kg (नीम लेपित)",
        hsn: "3102",
        qty: 1000, // 1 bag
        unit: "बोरी",
        rate: 26650, // ₹266.50
        taxable: 25381,
        gst_rate: 5,
        gst_status: "taxable",
        gst_amount: 1269,
        total: 26650,
      },
    ],
  },
});

// 2. Ten items standard bill
export const SCENARIO_10_ITEMS: BillData = buildBillData({
  invoiceDetails: {
    invoice_no: "KK/25-26/0010",
    date: "2025-05-14",
    party_name: "राजेश पटेल एवं ब्रदर्स",
    party_village: "मंडी चौराहा, आष्टा",
    party_phone: "9826311010",
    party_gstin: "23BCDFP4567E1Z5",
    payment_mode: "upi_bank",
    lines: [
      { item_name: "यूरिया 45kg (इफको नीम कोटेड)", hsn: "3102", qty: 20000, unit: "बोरी", rate: 26650, taxable: 507619, gst_amount: 25381, total: 533000 },
      { item_name: "डीएपी 18:46:0 (इफको 50kg)", hsn: "3105", qty: 10000, unit: "बोरी", rate: 135000, taxable: 1285714, gst_amount: 64286, total: 1350000 },
      { item_name: "एनपीके 12:32:16 (50kg)", hsn: "3105", qty: 8000, unit: "बोरी", rate: 147000, taxable: 1120000, gst_amount: 56000, total: 1176000 },
      { item_name: "म्यूरेट ऑफ पोटाश (MOP 50kg)", hsn: "3104", qty: 4000, unit: "बोरी", rate: 165000, taxable: 628571, gst_amount: 31429, total: 660000 },
      { item_name: "जिंक सल्फेट मोनो 33% (5kg)", hsn: "2833", qty: 6000, unit: "पैकेट", rate: 45000, taxable: 241071, gst_amount: 28929, total: 270000 },
      { item_name: "क्लोरोपाइरीफॉस 20% EC (1L)", hsn: "3808", qty: 5000, unit: "लीटर", rate: 46750, taxable: 198093, gst_amount: 35657, total: 233750 },
      { item_name: "इमामेक्टिन बेंजोएट 5% SG (100g)", hsn: "3808", qty: 8000, unit: "पैकेट", rate: 38000, taxable: 257627, gst_amount: 46373, total: 304000 },
      { item_name: "साफ फफूंदनाशक (कार्बेंडाजिम+मैंकोजेब 500g)", hsn: "3808", qty: 4000, unit: "पैकेट", rate: 35000, taxable: 118644, gst_amount: 21356, total: 140000 },
      { item_name: "गेहूं बीज शरबती सी.306 (40kg)", hsn: "1209", qty: 4000, unit: "बोरी", rate: 240000, taxable: 960000, gst_amount: 0, total: 960000 },
      { item_name: "कृषि त्रिपाल 18x24 फीट (HDPE)", hsn: "3926", qty: 2000, unit: "नग", rate: 125000, taxable: 211864, gst_amount: 38136, total: 250000 },
    ],
  },
});

// 3. 45 items multi-page bill
const generated45Lines = Array.from({ length: 45 }, (_, idx) => {
  const i = idx + 1;
  const rates = [266.5, 1350, 480, 850, 320, 1150, 620, 290, 1850];
  const rate = rates[idx % rates.length];
  const hsns = ["3102", "3105", "3808", "1209", "3104", "8424"];
  const hsn = hsns[idx % hsns.length];
  const gstRate = hsn === "1209" ? 0 : hsn === "3808" ? 18 : 5;
  const qty = (idx % 5) + 1;
  const total = rate * qty;
  const taxable = gstRate > 0 ? Number((total / (1 + gstRate / 100)).toFixed(2)) : total;
  const gstAmt = Number((total - taxable).toFixed(2));

  return {
    item_name: `कृषि उत्पाद सामग्री मद सं. ${i} (${hsn === "3102" ? "उर्वरक" : hsn === "3808" ? "कीटनाशक" : "कृषि यंत्र"})`,
    hsn,
    qty: qty * 1000,
    unit: idx % 3 === 0 ? "बोरी" : idx % 3 === 1 ? "लीटर" : "नग",
    rate: Math.round(rate * 100),
    taxable: Math.round(taxable * 100),
    gst_amount: Math.round(gstAmt * 100),
    total: Math.round(total * 100),
  };
});

export const SCENARIO_45_ITEMS: BillData = buildBillData({
  invoiceDetails: {
    invoice_no: "KK/25-26/0045",
    date: "2025-05-15",
    party_name: "किसान समृद्धि स्वावलंबी सहकारी समिति",
    party_village: "कृषि उपज मंडी प्रांगण, सीहोर",
    party_phone: "9826311045",
    party_gstin: "23AAAFK9876C1Z9",
    payment_mode: "credit",
    lines: generated45Lines,
  },
});

// 4. Long Hindi names bill
export const SCENARIO_LONG_HINDI: BillData = buildBillData({
  invoiceDetails: {
    invoice_no: "KK/25-26/0014",
    date: "2025-05-16",
    party_name: "सरदार कुलदीप सिंह जी (गुरुकृपा कृषि फार्म)",
    party_village: "ग्राम श्यामपुर तहसील सीहोर",
    party_phone: "9826311099",
    party_gstin: "23AAGFS8899H1Z1",
    payment_mode: "cash",
    lines: [
      {
        item_name: "क्लोरोपाइरीफॉस 50% + साइपरमेथ्रिन 5% ईसी उच्च-क्षमता दोहरा कीटनाशक (1 लीटर पैकिंग बोतल, इफको-एमसी क्रॉप साइंस प्राइवेट लिमिटेड)",
        hsn: "3808",
        qty: 6000,
        unit: "लीटर",
        rate: 68500,
        taxable: 348305,
        gst_amount: 62695,
        total: 411000,
      },
      {
        item_name: "जिंक सल्फेट मोनोहाइड्रेट 33% कृषि ग्रेड सूक्ष्म पोषक उर्वरक (10 किग्रा सीलबंद थैली - चंबल फर्टिलाइजर्स एंड केमिकल्स लिमिटेड)",
        hsn: "2833",
        qty: 8000,
        unit: "थैली",
        rate: 85000,
        taxable: 607143,
        gst_amount: 72857,
        total: 680000,
      },
      {
        item_name: "हाइब्रिड प्रमाणित मक्का बीज पूसा एचक्यूपीएम-1 उच्च गुणवत्ता प्रोटीन युक्त संकर मक्का (4 किग्रा पाउच - राष्ट्रीय बीज निगम)",
        hsn: "1209",
        qty: 12000,
        unit: "पाउच",
        rate: 92000,
        taxable: 1104000,
        gst_amount: 0,
        total: 1104000,
      },
      {
        item_name: "बायो-ऑर्गेनिक पोटाश दानेदार बायो-फर्टिलाइजर मिट्टी सुधारक जैविक खाद (50 किग्रा जूट बोरी - नर्मदा बायो-केम)",
        hsn: "3101",
        qty: 10000,
        unit: "बोरी",
        rate: 78000,
        taxable: 742857,
        gst_amount: 37143,
        total: 780000,
      },
    ],
  },
});

// 5. Unregistered party bill (B2C cash bill to a farmer with no GSTIN)
export const SCENARIO_UNREGISTERED: BillData = buildBillData({
  partyCategory: "unregistered",
  invoiceDetails: {
    invoice_no: "KK/25-26/0015",
    date: "2025-05-18",
    party_name: "कमलकिशोर मेवाड़ा (किसान भाई)",
    party_village: "ग्राम बरखेड़ा हसन",
    party_phone: "9425098765",
    party_gstin: null, // No GSTIN
    payment_mode: "cash",
    lines: [
      { item_name: "यूरिया 45kg (नीम लेपित)", hsn: "3102", qty: 5000, unit: "बोरी", rate: 26650, taxable: 126905, gst_amount: 6345, total: 133250 },
      { item_name: "डीएपी 18:46:0 इफको (50kg)", hsn: "3105", qty: 3000, unit: "बोरी", rate: 135000, taxable: 385714, gst_amount: 19286, total: 405000 },
      { item_name: "जिंक 21% हेप्टाहाइड्रेट (5kg)", hsn: "2833", qty: 2000, unit: "पैकेट", rate: 38000, taxable: 67857, gst_amount: 8143, total: 76000 },
    ],
  },
});

// 6. IGST Interstate bill (Customer from Rajasthan, State code 08)
export const SCENARIO_IGST: BillData = buildBillData({
  partyStateCode: "08", // Rajasthan
  partyCategory: "registered",
  invoiceDetails: {
    invoice_no: "KK/25-26/0018",
    date: "2025-05-19",
    party_name: "श्री सांवरिया एग्रो एजेंसी",
    party_village: "कोटा रोड, झालावाड़ (राजस्थान)",
    party_phone: "9414012345",
    party_gstin: "08ABCDE1234F1Z8", // Rajasthan GSTIN
    payment_mode: "upi_bank",
    lines: [
      { item_name: "डीएपी 18:46:0 इफको (50kg)", hsn: "3105", qty: 40000, unit: "बोरी", rate: 135000, taxable: 5142857, gst_amount: 257143, total: 5400000 },
      { item_name: "क्लोरोपाइरीफॉस 20% EC (5L जार)", hsn: "3808", qty: 10000, unit: "जार", rate: 225000, taxable: 1906780, gst_amount: 343220, total: 2250000 },
      { item_name: "सल्फर 80% WDG (3kg)", hsn: "3808", qty: 15000, unit: "पैकेट", rate: 45000, taxable: 572034, gst_amount: 102966, total: 675000 },
    ],
  },
});

// 7. Composition Bill of Supply (Zero tax shown, exempt/composition)
export const SCENARIO_BILL_OF_SUPPLY: BillData = buildBillData({
  isComposition: true,
  explicitBillType: "BILL OF SUPPLY",
  partyCategory: "composition",
  invoiceDetails: {
    invoice_no: "KK/25-26/0022",
    date: "2025-05-20",
    party_name: "जय किसान कंपोजिट ट्रेडर्स",
    party_village: "इछावर रोड, सीहोर",
    party_phone: "9826311022",
    party_gstin: "23AABCT9988K1Z3",
    payment_mode: "cash",
    lines: [
      { item_name: "जैविक वर्मी कम्पोस्ट खाद (50kg बैग)", hsn: "3101", qty: 20000, unit: "बैग", rate: 40000, taxable: 800000, gst_amount: 0, total: 800000 },
      { item_name: "देसी चना बीज कनक (30kg बैग)", hsn: "1209", qty: 10000, unit: "बैग", rate: 220000, taxable: 2200000, gst_amount: 0, total: 2200000 },
      { item_name: "नीम का तेल जैविक कीटनाशक (1L)", hsn: "3808", qty: 5000, unit: "लीटर", rate: 55000, taxable: 275000, gst_amount: 0, total: 275000 },
      { item_name: "ट्राइकोडर्मा विरिडी जैव-कवकनाशी (1kg)", hsn: "3808", qty: 8000, unit: "पैकेट", rate: 25000, taxable: 200000, gst_amount: 0, total: 200000 },
    ],
  },
});

export const ALL_SCENARIOS: ScenarioDefinition[] = [
  { id: "1_item", name: "१ सामान (1 Item Bill)", description: "एकल सामान त्वरित नकद बिल", bill: SCENARIO_1_ITEM },
  { id: "10_items", name: "१० सामान (10 Items Standard)", description: "खाद, बीज, कीटनाशक का 10 मदों का सामान्य बिल", bill: SCENARIO_10_ITEMS },
  { id: "45_items_multipage", name: "४५ सामान (45 Items Multi-page)", description: "बहु-पृष्ठीय बिल जिसमें thead दोहराव एवं कुल योग अंतिम पृष्ठ पर होता है", bill: SCENARIO_45_ITEMS },
  { id: "long_hindi_names", name: "लंबे हिन्दी नाम (Long Hindi Names)", description: "बड़ी कृषि दवाइयों व उर्वरकों के लंबे विस्तृत हिन्दी नाम", bill: SCENARIO_LONG_HINDI },
  { id: "unregistered_party", name: "अपंजीकृत किसान (Unregistered Party)", description: "बिना GSTIN वाले स्थानीय किसान का B2C बिल", bill: SCENARIO_UNREGISTERED },
  { id: "igst_bill", name: "अंतर्राज्यीय IGST बिल (Interstate IGST)", description: "राजस्थान पार्टी का बिल जिसमें CGST/SGST शून्य व IGST लागू है", bill: SCENARIO_IGST },
  { id: "composition_bill_of_supply", name: "सप्लाई का बिल (Bill of Supply)", description: "कम्पोज़िशन डीलर हेतु कर-रहित बिल (कोई GST नहीं दिखता)", bill: SCENARIO_BILL_OF_SUPPLY },
];
