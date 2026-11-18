import type { DrawerLink } from './HeaderDrawer';

/**
 * The site's own pages, offered by every marketing drawer. The pages that carry
 * the mock's chrome instead of the template header have no global menu bar, so
 * without this group the hamburger would be the only way off the page.
 */
export const SITE_LINKS: readonly DrawerLink[] = [
  { label: 'About', href: '/about' },
  { label: 'All programmes', href: '/apply' },
  { label: 'Season 2', href: '/season-2' },
  { label: 'Contact us', href: '/contact' },
];
