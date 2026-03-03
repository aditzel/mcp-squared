import { describe, expect, test } from "bun:test";
import { formatRatioPercent } from "@/utils/percent.js";

describe("formatRatioPercent", () => {
  test("formats non-zero ratios with one decimal place", () => {
    expect(formatRatioPercent(2, 4)).toBe("50.0");
    expect(formatRatioPercent(1, 3)).toBe("33.3");
  });

  test("returns 0.0 when denominator is zero", () => {
    expect(formatRatioPercent(0, 0)).toBe("0.0");
    expect(formatRatioPercent(5, 0)).toBe("0.0");
  });
});
