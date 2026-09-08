// The Film Academy pathway: five tiers, twenty-six modules.
//
// Ordering is deliberate and global: modules are numbered tier by tier, so
// order_index is continuous across the whole pathway rather than restarting at
// each tier. The learner sees one sequence.
import type { Pathway } from './types';
import { TIER_1 } from './tier1';
import { TIER_2 } from './tier2';
import { TIER_3 } from './tier3';
import { TIER_4 } from './tier4';
import { TIER_5 } from './tier5';

export const FILM_PATHWAY: Pathway = {
  name: 'Film Craft Pathway',
  summary:
    'A tiered route from first principles to a delivered short film. Five tiers, twenty-six modules, each with lecture material, a quiz and a practical assignment, plus an assessment gating each tier.',
  tiers: [TIER_1, TIER_2, TIER_3, TIER_4, TIER_5],
};

export * from './types';
