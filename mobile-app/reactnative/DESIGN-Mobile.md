---
name: Paymax High-End Ecosystem
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#4a4452'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#7b7483'
  outline-variant: '#ccc3d4'
  surface-tint: '#6f46b9'
  primary: '#340075'
  on-primary: '#ffffff'
  primary-container: '#4c1d95'
  on-primary-container: '#b994ff'
  inverse-primary: '#d3bbff'
  secondary: '#0051d5'
  on-secondary: '#ffffff'
  secondary-container: '#316bf3'
  on-secondary-container: '#fefcff'
  tertiary: '#002d28'
  on-tertiary: '#ffffff'
  tertiary-container: '#00453f'
  on-tertiary-container: '#48b8ac'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ebdcff'
  primary-fixed-dim: '#d3bbff'
  on-primary-fixed: '#260059'
  on-primary-fixed-variant: '#572ba0'
  secondary-fixed: '#dbe1ff'
  secondary-fixed-dim: '#b4c5ff'
  on-secondary-fixed: '#00174b'
  on-secondary-fixed-variant: '#003ea8'
  tertiary-fixed: '#89f5e7'
  tertiary-fixed-dim: '#6bd8cb'
  on-tertiary-fixed: '#00201d'
  on-tertiary-fixed-variant: '#005049'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 48px
    fontWeight: '800'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  title-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  container-margin: 20px
  gutter: 16px
---

## Brand & Style

The design system is engineered for a premium Nigerian super-app experience, blending high-utility fintech reliability with lifestyle-centric aesthetics. The brand personality is **authoritative yet accessible**, evoking a sense of "elite convenience." 

The design style is **Corporate Modern with Glassmorphism accents**. It utilizes a "layered ecosystem" approach where surfaces appear to float over a soft, atmospheric background. The visual language prioritizes clarity and high-end polish, using subtle gradients and depth to distinguish between different service verticals (Finance, Lifestyle, Productivity) within the single app environment.

## Colors

The palette uses a sophisticated **Deep Purple** as the anchor to establish trust and premium positioning. **Electric Blue** provides functional energy for action items, while **Teal** and **Subtle Gold** serve as semantic indicators for success, wealth-building, and premium tiers.

- **Primary (Deep Purple):** Used for core branding, headers, and primary navigation states.
- **Secondary (Electric Blue):** Used for interactive elements like links and primary buttons.
- **Accent (Teal/Gold):** Teal is for growth and "Lifestyle" services; Gold is reserved for "Elite" status indicators and rewards.
- **Background:** A very light cool-grey (#F8FAFC) to ensure white cards and glass elements pop with sufficient contrast.

## Typography

This design system utilizes **Plus Jakarta Sans** across all levels to maintain a friendly, contemporary, and highly legible interface. The type scale is optimized for high-density information displays common in super-apps.

- **Headlines:** Use Bold and ExtraBold weights with tighter letter-spacing to create a strong visual hierarchy and a "premium editorial" feel.
- **Body:** Regular weight with generous line-height (1.5x) to ensure maximum readability for financial transactions and long-form service descriptions.
- **Labels:** Medium and SemiBold weights are used for utility text, navigation tabs, and micro-copy to ensure they remain distinct from body content.

## Layout & Spacing

The layout follows a **4px baseline grid** to ensure mathematical harmony. A **12-column fluid grid** is used for desktop/web views, while mobile layouts utilize a **4-column grid** with 20px side margins to provide "breathing room" for the glassmorphic cards.

- **Vertical Spacing:** Use `lg` (24px) for spacing between distinct sections and `md` (16px) for spacing between elements within a card.
- **Modular Grid:** Service icons (the "Super App Grid") should be arranged in a 4-column layout on mobile, with icons contained in soft-tinted squares.
- **Safe Areas:** Adhere to strict 20px margins on mobile to prevent content from feeling cramped against the screen edges.

## Elevation & Depth

This design system employs a multi-layered elevation strategy to organize complex information:

- **Level 0 (Background):** Soft grey (#F8FAFC) with occasional low-opacity radial gradients of Primary/Secondary colors in corners to add depth.
- **Level 1 (Cards):** Pure white surfaces with a "Standard" shadow: `0px 4px 20px rgba(0, 0, 0, 0.05)`. 
- **Level 2 (Active/Glass):** Used for top navigation bars and bottom sheets. A backdrop-filter blur of 20px with a white fill at 70% opacity. 
- **Level 3 (Modals/Pop-overs):** High-elevation surfaces with a "Deep" shadow: `0px 12px 32px rgba(76, 29, 149, 0.12)`. The shadow is slightly tinted with the Primary color to maintain brand cohesion.

## Shapes

The shape language is defined by **generous, smooth corner radii** that convey friendliness and modern polish. 

- **Base Radius:** 16px (`rounded-lg`) is the standard for all primary cards, buttons, and input fields.
- **Large Radius:** 24px (`rounded-xl`) is used for persistent containers like bottom sheets and promotional banners.
- **Icon Enclosures:** Small service icons are housed in 12px rounded squares with a 10% opacity tint of the icon's color.

## Components

### Buttons
- **Primary:** Deep Purple fill, white text, 16px radius. Height: 56px for mobile "thumb-friendly" interaction.
- **Secondary:** Electric Blue ghost-style (border only) or subtle blue tint fill with blue text.
- **Tertiary:** No border, Teal text for "add" or "positive" actions.

### Cards
- Standard white cards with 16px radius and 1px subtle border (#F1F5F9).
- **Glass Cards:** Used for premium dashboards, featuring a 1px white inner-border (stroke) at 20% opacity to define the edge.

### Input Fields
- 16px rounded corners. Background: #F1F5F9. On focus, the border transitions to 1.5px solid Electric Blue with a soft blue glow.

### Chips & Badges
- **Status Chips:** Small, pill-shaped (32px radius), high-contrast text on 10% opacity backgrounds (e.g., Teal for "Success", Gold for "Pending").

### Navigation
- **Bottom Bar:** Glassmorphic finish with 20px blur. Active icons use the Primary color with a small dot indicator below.
- **Segmented Control:** A "sliding" background indicator with 8px radius to toggle between sub-services.

### Iconography
- **Style:** Hybrid. The outer container is a soft-filled square; the inner icon is a 2px stroke line icon with solid accents in the brand's secondary colors.