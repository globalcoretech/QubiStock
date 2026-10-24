import { BillLineItem } from "../types";

export interface PageChunk<T> {
  items: T[];
  pageIndex: number;
  totalPages: number;
  startIndex: number;
}

export function chunkBillLines(
  lines: BillLineItem[],
  format: "A4" | "A5" | "A6"
): PageChunk<BillLineItem>[] {
  if (format === "A4") {
    if (lines.length <= 14) {
      return [{ items: lines, pageIndex: 0, totalPages: 1, startIndex: 0 }];
    }

    // Multi-page A4:
    // Intermediate pages hold up to 14 items.
    // The final page holds at most 5 items so HSN Summary, Totals, Bank, and Signatures fit on 1 sheet.
    const rawChunks: BillLineItem[][] = [];
    let remaining = [...lines];

    while (remaining.length > 5) {
      if (remaining.length <= 14) {
        const take = Math.min(10, remaining.length - 4);
        rawChunks.push(remaining.slice(0, take));
        remaining = remaining.slice(take);
        break;
      }
      const take = 14;
      rawChunks.push(remaining.slice(0, take));
      remaining = remaining.slice(take);
    }
    if (remaining.length > 0) {
      rawChunks.push(remaining);
    }

    const totalPages = rawChunks.length;
    let currentStart = 0;
    return rawChunks.map((chunk, pageIndex) => {
      const startIndex = currentStart;
      currentStart += chunk.length;
      return { items: chunk, pageIndex, totalPages, startIndex };
    });
  }

  if (format === "A5") {
    if (lines.length <= 10) {
      return [{ items: lines, pageIndex: 0, totalPages: 1, startIndex: 0 }];
    }
    const rawChunks: BillLineItem[][] = [];
    let i = 0;
    while (i < lines.length) {
      rawChunks.push(lines.slice(i, i + 12));
      i += 12;
    }
    const totalPages = rawChunks.length;
    let currentStart = 0;
    return rawChunks.map((chunk, pageIndex) => {
      const startIndex = currentStart;
      currentStart += chunk.length;
      return { items: chunk, pageIndex, totalPages, startIndex };
    });
  }

  // A6: 8 items per page
  if (lines.length <= 6) {
    return [{ items: lines, pageIndex: 0, totalPages: 1, startIndex: 0 }];
  }
  const rawChunks: BillLineItem[][] = [];
  let i = 0;
  while (i < lines.length) {
    rawChunks.push(lines.slice(i, i + 8));
    i += 8;
  }
  const totalPages = rawChunks.length;
  let currentStart = 0;
  return rawChunks.map((chunk, pageIndex) => {
    const startIndex = currentStart;
    currentStart += chunk.length;
    return { items: chunk, pageIndex, totalPages, startIndex };
  });
}
