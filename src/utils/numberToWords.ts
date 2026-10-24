/**
 * Indian Number to Words converter (Hindi and English)
 * Specially designed for GST Invoices and Bills
 */

const ONES_EN = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen"
];

const TENS_EN = [
  "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"
];

const ONES_HI = [
  "", "एक", "दो", "तीन", "चार", "पांच", "छह", "सात", "आठ", "नौ",
  "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह", "सत्रह", "अट्ठारह", "उन्नीस",
  "बीस", "इक्कीस", "बाईस", "तेईस", "चौबीस", "पच्चीस", "छब्बीस", "सत्ताईस", "अट्ठाइस", "उनतीस",
  "तीस", "इकतीस", "बत्तीस", "तैंतीस", "चौंतीस", "पैंतीस", "छत्तीस", "सैंतीस", "अड़तीस", "उनतालीस",
  "चालीस", "इकतालीस", "बयालीस", "तैंतालीस", "चवालीस", "पैंतालीस", "छियालीस", "सैंतालीस", "अड़तालीस", "उनचास",
  "पचास", "इक्यावन", "बावन", "तिरेपन", "चौवन", "पचपन", "छप्पन", "सत्तावन", "अट्ठावन", "उनसठ",
  "साठ", "इकसठ", "बासठ", "तिरेसठ", "चौंसठ", "पैंसठ", "छियासठ", "सरसठ", "अड़सठ", "उनहत्तर",
  "सत्तर", "इकहत्तर", "बहत्तर", "तिहत्तर", "चौहत्तर", "पचहत्तर", "छिहत्तर", "सतहत्तर", "अठहत्तर", "उन्नासी",
  "अस्सी", "इक्यासी", "बयासी", "तिरासी", "चौरासी", "पचासी", "छियासी", "सत्तासी", "अट्ठासी", "नवासी",
  "नब्बे", "इक्यानवे", "बानवे", "तिरानवे", "चौरानवे", "पंचानवे", "छियानवे", "सत्तानवे", "अट्ठानवे", "निन्यानवे"
];

function convertTwoDigitsEn(n: number): string {
  if (n < 20) return ONES_EN[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return TENS_EN[tens] + (ones ? " " + ONES_EN[ones] : "");
}

function convertThreeDigitsEn(n: number): string {
  const hundreds = Math.floor(n / 100);
  const remainder = n % 100;
  let res = "";
  if (hundreds > 0) {
    res += ONES_EN[hundreds] + " Hundred";
  }
  if (remainder > 0) {
    if (res) res += " ";
    res += convertTwoDigitsEn(remainder);
  }
  return res;
}

export function numberToWordsEnglish(amount: number): string {
  if (amount === 0) return "Zero Rupees Only";
  
  const absAmount = Math.abs(amount);
  const rupees = Math.floor(absAmount);
  const paise = Math.round((absAmount - rupees) * 100);

  let num = rupees;
  let words = "";

  // Crores (1,00,00,000)
  const crores = Math.floor(num / 10000000);
  num %= 10000000;
  if (crores > 0) {
    words += (words ? " " : "") + convertThreeDigitsEn(crores) + " Crore";
  }

  // Lakhs (1,00,000)
  const lakhs = Math.floor(num / 100000);
  num %= 100000;
  if (lakhs > 0) {
    words += (words ? " " : "") + convertTwoDigitsEn(lakhs) + " Lakh";
  }

  // Thousands (1,000)
  const thousands = Math.floor(num / 1000);
  num %= 1000;
  if (thousands > 0) {
    words += (words ? " " : "") + convertTwoDigitsEn(thousands) + " Thousand";
  }

  // Hundreds & Below
  if (num > 0) {
    words += (words ? " " : "") + convertThreeDigitsEn(num);
  }

  let result = words ? words + " Rupees" : "";

  if (paise > 0) {
    const paiseWords = convertTwoDigitsEn(paise);
    if (result) {
      result += " and " + paiseWords + " Paise";
    } else {
      result = paiseWords + " Paise";
    }
  }

  return "INR " + (result || "Zero Rupees") + " Only";
}

export function numberToWordsHindi(amount: number): string {
  if (amount === 0) return "शून्य रुपये मात्र";

  const absAmount = Math.abs(amount);
  const rupees = Math.floor(absAmount);
  const paise = Math.round((absAmount - rupees) * 100);

  let num = rupees;
  let words = "";

  // करोड़ (1,00,00,000)
  const crores = Math.floor(num / 10000000);
  num %= 10000000;
  if (crores > 0) {
    const croreWords = crores < 100 ? ONES_HI[crores] : convertThreeDigitsEn(crores);
    words += (words ? " " : "") + croreWords + " करोड़";
  }

  // लाख (1,00,000)
  const lakhs = Math.floor(num / 100000);
  num %= 100000;
  if (lakhs > 0) {
    words += (words ? " " : "") + ONES_HI[lakhs] + " लाख";
  }

  // हज़ार (1,000)
  const thousands = Math.floor(num / 1000);
  num %= 1000;
  if (thousands > 0) {
    words += (words ? " " : "") + ONES_HI[thousands] + " हज़ार";
  }

  // सौ (100)
  const hundreds = Math.floor(num / 100);
  num %= 100;
  if (hundreds > 0) {
    words += (words ? " " : "") + ONES_HI[hundreds] + " सौ";
  }

  // इकाई व दहाई (1-99)
  if (num > 0) {
    words += (words ? " " : "") + ONES_HI[num];
  }

  let result = words ? words + " रुपये" : "";

  if (paise > 0) {
    const paiseWords = ONES_HI[paise];
    if (result) {
      result += " और " + paiseWords + " पैसे";
    } else {
      result = paiseWords + " पैसे";
    }
  }

  return (result ? result : "शून्य रुपये") + " मात्र";
}
