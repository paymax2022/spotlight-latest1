// FOOD-UAT-C-005: pure modifier-selection logic (no React Native imports so it
// is unit-testable under node:test). Money is integer kobo throughout.
//
// Rules mirror the server's resolveLineModifiers: a REQUIRED group needs at
// least max(min_select, 1) choices; an optional group needs min_select (usually
// 0); no group may exceed max_select. The server re-validates and re-prices, so
// this only gates the UI and drives the running price.

import type { ModifierGroup, ModifierOption, CartModifier } from './types';

/** Minimum choices a group needs. A required group always needs at least one. */
export function effectiveMin(g: ModifierGroup): number {
  return Math.max(g.minSelect, g.required ? 1 : 0);
}

/** Maximum choices a group allows (>= 1). */
export function effectiveMax(g: ModifierGroup): number {
  return Math.max(g.maxSelect, 1);
}

/** Pick-exactly-one (radio) vs multi-select (checkbox). */
export function isSingleChoice(g: ModifierGroup): boolean {
  return effectiveMax(g) === 1;
}

/**
 * Toggle `optionId` in a group's selection. Single-choice groups behave as a
 * radio (replace; a required group cannot be deselected, an optional one can).
 * Multi-choice groups add up to max and remove freely.
 */
export function toggleSelection(g: ModifierGroup, selected: string[], optionId: string): string[] {
  const has = selected.includes(optionId);
  if (isSingleChoice(g)) {
    if (has) return g.required ? selected : [];
    return [optionId];
  }
  if (has) return selected.filter((x) => x !== optionId);
  if (selected.length >= effectiveMax(g)) return selected; // at the cap: ignore
  return [...selected, optionId];
}

/** Per-group error strings keyed by group id; empty object = selection is valid. */
export function validateSelection(groups: ModifierGroup[], selectedIds: string[]): Record<string, string> {
  const errs: Record<string, string> = {};
  for (const g of groups) {
    const ids = new Set(g.options.map((o) => o.id));
    const n = selectedIds.filter((id) => ids.has(id)).length;
    const min = effectiveMin(g);
    if (n < min) {
      errs[g.id] = min === 1 ? `Choose 1 for ${g.name}` : `Choose at least ${min} for ${g.name}`;
    } else if (n > effectiveMax(g)) {
      errs[g.id] = `Choose at most ${effectiveMax(g)} for ${g.name}`;
    }
  }
  return errs;
}

/** The chosen options resolved to snapshots (price delta included), in group order. */
export function resolveSelection(groups: ModifierGroup[], selectedIds: string[]): CartModifier[] {
  const out: CartModifier[] = [];
  const want = new Set(selectedIds);
  for (const g of groups) {
    for (const o of g.options) {
      if (want.has(o.id)) out.push({ id: o.id, name: o.name, priceDeltaKobo: o.priceDeltaKobo });
    }
  }
  return out;
}

/** Per-unit modifier surcharge for a selection (kobo). */
export function modifiersDeltaKobo(mods: { priceDeltaKobo: number }[] | undefined): number {
  return (mods ?? []).reduce((n, m) => n + Math.max(0, Math.trunc(m.priceDeltaKobo)), 0);
}

/** Running unit price: base + selected deltas. */
export function runningUnitPriceKobo(baseKobo: number, groups: ModifierGroup[], selectedIds: string[]): number {
  return baseKobo + modifiersDeltaKobo(resolveSelection(groups, selectedIds));
}

/**
 * Identity of a cart line. The same dish with different modifiers is a different
 * line; with no modifiers the key is the bare itemId so pre-modifier carts
 * (hydrated from storage / server) keep matching.
 */
export function lineKeyOf(line: { itemId: string; modifierIds?: string[] }): string {
  const ids = line.modifierIds;
  if (!ids || ids.length === 0) return line.itemId;
  return `${line.itemId}#${[...ids].sort().join(',')}`;
}

export function isAvailableOption(o: ModifierOption): boolean {
  return o.available !== false;
}
