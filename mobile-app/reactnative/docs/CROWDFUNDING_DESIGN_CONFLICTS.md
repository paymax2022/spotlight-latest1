# DESIGN-Mobile.md ⇆ Codebase Conflicts

Conflicts found between the design spec and the actual implemented design system, noted
during the crowdfunding build. The **code is treated as ground truth**; crowdfunding
matched the code, not the doc, wherever they diverged.

| # | DESIGN-Mobile.md says | Codebase reality | How crowdfunding handled it |
|---|------------------------|------------------|------------------------------|
| 1 | Typography uses **Plus Jakarta Sans** at every level | `src/constants/typography.ts` sets `FONT_FAMILY = undefined` for both iOS and Android — the Google font is **not actually loaded** (`useFonts` not called in `_layout.tsx`). The app currently renders system fonts. | Used the `Typography` tokens as-is (system font). When the font is wired up, every crowdfunding screen inherits it automatically — no per-screen `fontFamily`. |
| 2 | Background described in prose as **#F8FAFC** | Token value is **#F8F9FF** (`colors.ts` / DESIGN frontmatter). | Used `Colors.background` (#F8F9FF). Prose/frontmatter mismatch in the doc itself. |
| 3 | Elevation/glass via **`backdrop-filter: blur(20px)`** | React Native has no `backdrop-filter`; existing code approximates with `rgba(255,255,255,0.92)` fills + tinted shadows (see `(tabs)/_layout.tsx`). | Followed the codebase approximation for sticky CTA bar and bottom-sheet headers. |
| 4 | Segmented control = **"sliding background indicator"** (animated) | No animated segmented control exists in the codebase; sub-service toggles use instant active-state chips. | `SegmentedTabs` uses an instant active state (matches existing pattern). Animated slide is a possible enhancement. |
| 5 | Accent palette names **Teal/Gold** ("Gold for Elite/rewards") | `colors.ts` has **no gold token**; reward/orange + community/green accents are raw hex in `modules.ts`. | Reused the existing raw-hex convention (`#B65A00`, `#0F7A37`) for reward/community tints rather than inventing a gold token. Flagged in QA report for future tokenisation. |
| 6 | Icon enclosures = **12px rounded squares, 10% tint** | Codebase uses `Radius.md` (12px) squares with `iconBg*` tokens (8–10% tint). | Matched exactly via `Colors.iconBg*` + `Radius.md`. ✅ No conflict (listed for completeness). |

**None of these blocked the build.** Items 1 and 5 are the only ones worth a follow-up:
load Plus Jakarta Sans app-wide, and add `gold` / `success-green` / `warning-orange`
semantic tokens (then migrate both crowdfunding and the pre-existing `modules.ts` hex).
