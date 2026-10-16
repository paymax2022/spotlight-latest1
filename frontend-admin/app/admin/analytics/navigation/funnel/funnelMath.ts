/** Drop-off % from the previous step; 0 when the previous step had no users. */
export function dropOff(prev: number, cur: number): number {
  if (!prev) return 0;
  return Math.round((1 - cur / prev) * 100);
}
