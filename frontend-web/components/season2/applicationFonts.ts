import { Barlow_Condensed, DM_Sans, Manrope } from 'next/font/google';

/**
 * The same three families app/season-2/page.tsx declares, kept in one module so
 * the application pages and the recap page cannot drift apart. The CSS tokens
 * --display / --head live in season2.css and point at these variables.
 */
export const display = Barlow_Condensed({
  weight: ['500', '600', '700', '800'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-display',
});

export const ui = Manrope({
  weight: ['400', '500', '600', '700', '800'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-ui',
});

export const body = DM_Sans({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-body',
});

export const fontVariables = `${display.variable} ${ui.variable} ${body.variable}`;
