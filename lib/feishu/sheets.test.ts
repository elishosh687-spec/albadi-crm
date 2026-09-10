import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FACTORY_TYPE,
  baseQuoteNo,
  buildFactoryRow,
  hasCartonMasterData,
  parseFactoryRequestRow,
  parseFactoryResponseRow,
  parseSizeLabel,
} from "./sheets";
import {
  GOLDEN_QUOTATION_NO,
  GOLDEN_ROW,
  GOLDEN_ROW_WITH_CBM,
  PLATE_FEE_IN_T_ROW,
  SHIFTED_ROW,
  UNANSWERED_ROW,
} from "../../tests/fixtures/feishu-rows";

describe("parseFactoryResponseRow — current A..U layout", () => {
  it("reads the golden row: ¥1.85 → 1.85, carton data, supplier, notes", () => {
    const r = parseFactoryResponseRow(GOLDEN_ROW);
    expect(r.hasResponse).toBe(true);
    expect(r.unitCostCny).toBe(1.85);
    expect(r.cartonQty).toBe(500);
    expect(r.cartonLengthCm).toBe(60);
    expect(r.cartonWidthCm).toBe(40);
    expect(r.cartonHeightCm).toBe(55);
    expect(r.weightKg).toBe(11);
    expect(r.supplier).toBe("MANDY");
    expect(r.notes).toBe("备注: sample by 9/20");
  });

  it("derives CBM from L×W×H when the factory left Q blank", () => {
    const r = parseFactoryResponseRow(GOLDEN_ROW);
    expect(r.cartonCbm).toBeCloseTo((60 * 40 * 55) / 1_000_000, 6);
  });

  it("keeps the factory's own CBM when Q is filled", () => {
    const r = parseFactoryResponseRow(GOLDEN_ROW_WITH_CBM);
    expect(r.cartonCbm).toBe(0.132);
  });

  it("reads the plate fee from the unlabeled column U", () => {
    expect(parseFactoryResponseRow(GOLDEN_ROW).platePerColorCny).toBe(350);
  });

  it("falls back to 备注 (T) for the plate fee, and notes stays the raw T cell", () => {
    const r = parseFactoryResponseRow(PLATE_FEE_IN_T_ROW);
    expect(r.platePerColorCny).toBe(505);
    expect(r.notes).toBe("printing cost: RMB505/COL");
  });

  it("accepts ¥ / ￥ / RMB spellings of the plate fee", () => {
    for (const cell of ["¥ 350 / color", "￥350/COL", "RMB350/צבע"]) {
      const row = GOLDEN_ROW.map((c, i) => (i === 20 ? cell : c));
      expect(parseFactoryResponseRow(row).platePerColorCny).toBe(350);
    }
  });

  it("hasResponse is false and unitCostCny 0 when L is empty", () => {
    const r = parseFactoryResponseRow(UNANSWERED_ROW);
    expect(r.hasResponse).toBe(false);
    expect(r.unitCostCny).toBe(0);
    expect(r.cartonQty).toBeUndefined();
    expect(r.supplier).toBeUndefined();
    expect(r.platePerColorCny).toBeUndefined();
  });

  it("a ¥0 price is not a response either", () => {
    const row = GOLDEN_ROW.map((c, i) => (i === 11 ? "¥0" : c));
    expect(parseFactoryResponseRow(row).hasResponse).toBe(false);
  });

  it("does not choke on a rich-text supplier cell", () => {
    const row = GOLDEN_ROW.map((c, i) =>
      i === 18
        ? ([{ segmentStyle: {}, text: "MAN", type: "text" }, { segmentStyle: {}, text: "DY", type: "text" }] as unknown as string)
        : c
    );
    expect(parseFactoryResponseRow(row).supplier).toBe("MANDY");
  });
});

describe("parseFactoryResponseRow — column-shift tripwire", () => {
  // Incident 2026-07-02 (ba1e88f): the factory inserted 数量 at K and every
  // factory field shifted one slot; unitCost read 5000 (=qty), cbm read 55
  // (=height), weight read 0.15 (=cbm), supplier read "11" (=weight).
  it("a shifted row parses into the documented corruption signature", () => {
    const r = parseFactoryResponseRow(SHIFTED_ROW);
    expect(r.unitCostCny).toBe(5000);
    expect(r.cartonCbm).toBe(55);
    expect(r.weightKg).toBe(0.15);
    expect(r.supplier).toBe("11");
    // The two conditions the FinalizeModal's cbmWarn / the logger check:
    const dims = (r.cartonLengthCm! * r.cartonWidthCm! * r.cartonHeightCm!) / 1_000_000;
    expect(Math.abs(r.cartonCbm! - dims) / dims).toBeGreaterThan(0.25);
    expect(r.supplier).toMatch(/^\d+(\.\d+)?$/);
  });

  describe("logging (LOG_LEVEL=error in the runner hides warn — re-import at debug)", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      vi.resetModules();
    });

    async function parseWithWarnSpy(row: (string | number | null)[]) {
      vi.resetModules();
      vi.stubEnv("LOG_LEVEL", "debug");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const fresh = await import("./sheets");
      const parsed = fresh.parseFactoryResponseRow(row);
      const lines = warn.mock.calls.map((c) => String(c[0]));
      return { parsed, lines };
    }

    it('warns "sheet.column_shift_suspected" with both reasons on the shifted row', async () => {
      const { lines } = await parseWithWarnSpy(SHIFTED_ROW);
      const hit = lines.find((l) => l.includes("sheet.column_shift_suspected"));
      expect(hit).toBeDefined();
      const evt = JSON.parse(hit!);
      expect(evt.feature).toBe("feishu");
      expect(evt.level).toBe("warn");
      expect(evt.quotationNo).toBe("SHIFT001");
      expect(evt.reasons).toEqual(["cbm_vs_dims", "supplier_numeric"]);
    });

    it("stays silent on a healthy row", async () => {
      const { lines } = await parseWithWarnSpy(GOLDEN_ROW_WITH_CBM);
      expect(lines.some((l) => l.includes("sheet.column_shift_suspected"))).toBe(false);
    });
  });
});

describe("hasCartonMasterData", () => {
  it("needs cartonQty, weight AND a real CBM", () => {
    expect(hasCartonMasterData(parseFactoryResponseRow(GOLDEN_ROW))).toBe(true);
    expect(hasCartonMasterData({ cartonQty: 500, weightKg: 11 })).toBe(false);
    expect(hasCartonMasterData({ cartonQty: 500, cartonCbm: 0.1 })).toBe(false);
    expect(hasCartonMasterData({ weightKg: 11, cartonCbm: 0.1 })).toBe(false);
    expect(hasCartonMasterData({ cartonQty: 0, weightKg: 11, cartonCbm: 0.1 })).toBe(false);
    expect(hasCartonMasterData({})).toBe(false);
  });
});

describe("buildFactoryRow — the write side", () => {
  const cols = {
    customer: "יוסי גולד",
    quotationNo: "ABC12345",
    pic: "https://example.com/bag.png",
    description: "Non-woven bag with handles",
    material: "80g non-woven",
    size: "H20*D8*W25",
    printing: "3 color(s)",
    finishing: "Handles / not laminated",
    quantity: 5000,
  };

  // Incident 2026-08-11: the factory added `Type` at F; the writer still emitted
  // 10 values into A..J so every field from F on landed one column LEFT and
  // Quantity never reached K (APA1WK7G: 5,000 in the CRM vs 10,000 in the sheet).
  it("emits 11 values, Type at F and Quantity at K", () => {
    const row = buildFactoryRow(cols);
    expect(row).toHaveLength(11);
    expect(row[5]).toBe(DEFAULT_FACTORY_TYPE);
    expect(row[6]).toBe(cols.material);
    expect(row[7]).toBe(cols.size);
    expect(row[8]).toBe(cols.printing);
    expect(row[9]).toBe(cols.finishing);
    expect(row[10]).toBe(5000);
  });

  it("honours an explicit type and blanks missing optionals", () => {
    const row = buildFactoryRow({ ...cols, type: "Sewn bag", pic: "" });
    expect(row[5]).toBe("Sewn bag");
    expect(row[3]).toBe("");
  });

  it("writes today's date as an Excel serial at C", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-11T10:00:00Z"));
      // 2026-08-11 is 46,245 days after the Excel epoch (1899-12-30).
      expect(buildFactoryRow(cols)[2]).toBe(46245);
    } finally {
      vi.useRealTimers();
    }
  });

  it("round-trips through parseFactoryRequestRow", () => {
    const row = buildFactoryRow(cols);
    const back = parseFactoryRequestRow(row);
    expect(back).toEqual({
      picUrl: cols.pic,
      description: cols.description,
      material: cols.material,
      heightCm: 20,
      depthCm: 8,
      widthCm: 25,
      printing: cols.printing,
      finishing: cols.finishing,
      quantity: 5000,
    });
  });
});

describe("parseFactoryRequestRow — operator side", () => {
  it("reads the golden row, ignoring F (Type) and flattening rich text", () => {
    const r = parseFactoryRequestRow(GOLDEN_ROW);
    expect(r.picUrl).toBe("https://example.com/bag.png");
    expect(r.description).toBe("Non-woven bag with handles");
    expect(r.material).toBe("80g non-woven");
    expect(r).toMatchObject({ heightCm: 20, depthCm: 8, widthCm: 25 });
    expect(r.printing).toBe("3 color(s)");
    expect(r.finishing).toBe("With handles / laminated");
    expect(r.quantity).toBe(3000);
    expect(r).not.toHaveProperty("type");
  });

  it("only returns fields that are present, and never a non-URL pic", () => {
    const sparse: (string | number | null)[] = [];
    sparse[3] = "[object Object]";
    sparse[6] = "80g";
    expect(parseFactoryRequestRow(sparse)).toEqual({ material: "80g" });
    expect(parseFactoryRequestRow([])).toEqual({});
  });

  it("reads a quantity typed as text", () => {
    const row = GOLDEN_ROW.map((c, i) => (i === 10 ? "5,000" : c));
    expect(parseFactoryRequestRow(row).quantity).toBe(5000);
  });
});

describe("parseSizeLabel", () => {
  it("parses the label buildFactoryRow writes", () => {
    expect(parseSizeLabel("H20*D8*W25")).toEqual({ heightCm: 20, depthCm: 8, widthCm: 25 });
  });

  it("tolerates × separators, spaces, lowercase and decimals", () => {
    expect(parseSizeLabel("h 30 × d 10.5 × w 40")).toEqual({ heightCm: 30, depthCm: 10.5, widthCm: 40 });
  });

  it("returns only the parts present", () => {
    expect(parseSizeLabel("W25*H20")).toEqual({ heightCm: 20, widthCm: 25 });
    expect(parseSizeLabel("30x40 cm")).toEqual({});
    expect(parseSizeLabel("")).toEqual({});
  });
});

describe("baseQuoteNo", () => {
  it("strips a trailing revision suffix", () => {
    expect(baseQuoteNo("ABC12345-A")).toBe("ABC12345");
    expect(baseQuoteNo("EVLGTP1G-12")).toBe("EVLGTP1G");
    expect(baseQuoteNo(`  ${GOLDEN_QUOTATION_NO}  `)).toBe(GOLDEN_QUOTATION_NO);
  });

  it("leaves a plain number alone", () => {
    expect(baseQuoteNo("ABC12345")).toBe("ABC12345");
  });
});
