/**
 * Format a ratio as a one-decimal percentage string.
 *
 * Returns "0.0" when denominator is zero to avoid NaN/Infinity output.
 */
export function formatRatioPercent(
  numerator: number,
  denominator: number,
): string {
  if (denominator === 0) {
    return "0.0";
  }
  return ((numerator / denominator) * 100).toFixed(1);
}
