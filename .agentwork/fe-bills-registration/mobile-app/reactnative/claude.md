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

## App Stack

- Framework: Next.js
- Styling: Tailwind CSS
- Components: Reusable React components
- Layout: Mobile-first responsive design
- Quality: Production-ready, clean, modern, premium UI