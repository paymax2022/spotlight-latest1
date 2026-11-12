/**
 * Admissions contact lines for the Film Academy page.
 *
 * These come from the academy's own supplied site files, not from anything the
 * platform stores, so they live in one place and are easy to confirm or replace
 * before this page is relied on publicly.
 */
export const ACADEMY_CONTACT = {
  whatsappNumber: '2348159491618',
  phoneDisplay: '0815 949 1618',
  phoneHref: 'tel:+2348159491618',
  address: ['Lekki Garden Phase 2 Estate', 'Close to Abraham Adesanya, Lagos'],
  socials: [
    { label: 'Instagram', href: 'https://www.instagram.com/timeless247/' },
    { label: 'TikTok', href: 'https://www.tiktok.com/@timeless2472' },
    { label: 'YouTube', href: 'https://www.youtube.com/@timeless247' },
  ],
} as const;

export function whatsappEnquiry(message: string): string {
  return `https://wa.me/${ACADEMY_CONTACT.whatsappNumber}?text=${encodeURIComponent(message)}`;
}
