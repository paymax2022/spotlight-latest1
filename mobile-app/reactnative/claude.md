# Project Instruction for Claude Code

This project uses a design system exported from Google Stitch.

The design system is located at:

`design.md`

## Mandatory UI Rules

- Always read and follow `design.md` before creating or modifying any UI.
- Use only the colors, fonts, spacing, radius, shadows, and component patterns defined in `design.md`.
- Do not invent new colors or random Tailwind classes.
- Do not use generic default UI styling unless it matches `design.md`.
- All pages must look consistent with the Google Stitch design.
- If building with Tailwind CSS, map the design tokens from `design.md` into `tailwind.config.js`.
- If any design rule is missing, ask before inventing a new style.

## Cross-platform dialogs (no raw `Alert.alert` for confirmations)

`react-native`'s `Alert.alert` is a **silent no-op on react-native-web** — the
dialog never renders and button `onPress` handlers never fire, so any
confirmation gate (cast vote, log out, delete account…) silently blocks its
action on the web build used for preview/QA.

- Use the promise-based helpers in `src/lib/confirm.ts` instead:
  - `await confirmAsync({ title, message?, confirmLabel?, cancelLabel?, destructive? })` → `boolean`
  - `await alertAsync({ title, message?, buttonLabel? })` → `void`
- They wrap `Alert.alert` on native and render an in-app modal (`ConfirmHost`,
  mounted at the app root) on web.
- `npm run check:confirm` fails CI if a raw multi-button `Alert.alert(...)` is
  reintroduced. Flag any raw `Alert.alert` confirmation in code review.
- `Alert.prompt` (iOS text-input) has no helper equivalent yet — keep it native.

## App Stack

- Framework: Next.js
- Styling: Tailwind CSS
- Components: Reusable React components
- Layout: Mobile-first responsive design
- Quality: Production-ready, clean, modern, premium UI