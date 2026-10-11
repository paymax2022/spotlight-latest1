// "Ready in ~X min" for a menu item. Nothing is shown when the server sent no time, so
// an unknown prep time never reads as "ready now".
export function readyInLabel(prepMinutes: number | undefined): string | null {
  if (!prepMinutes || prepMinutes <= 0 || !Number.isFinite(prepMinutes)) return null;
  return `Ready in ~${Math.round(prepMinutes)} min`;
}
