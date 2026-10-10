// Pure helpers (no React Native imports) for turning a seller's phone number into
// tap-to-contact links. Kept dependency-free so they unit-test under node:test.

/**
 * Digits-only international form for wa.me (no "+"), or null when the value cannot
 * be a real phone number. Accepts what sellers actually type: "+234 803 123 4567",
 * "0803 123 4567", "2348031234567", "08031234567", "8031234567", "00234…".
 *
 * Numbers without a "+" are read as Nigerian (this is the Nigerian marketplace): a
 * leading 0 is the national trunk prefix and becomes 234. Anything that claims to be
 * Nigerian (234…) must be exactly 13 digits, so a mistyped number is refused here
 * rather than opening a WhatsApp chat with a stranger.
 */
export function whatsappNumber(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  const hadPlus = text.startsWith('+');
  let digits = text.replace(/\D/g, '');
  if (!digits) return null;

  if (!hadPlus) {
    if (digits.startsWith('00')) digits = digits.slice(2);
    else if (digits.startsWith('0')) digits = `234${digits.slice(1)}`;
    else if (digits.length === 10) digits = `234${digits}`;
  }

  if (digits.length < 8 || digits.length > 15) return null;
  if (digits.startsWith('234') && digits.length !== 13) return null;
  return digits;
}

/** https://wa.me link with an optional pre-filled message, or null for a bad number. */
export function whatsappUrl(raw: string | null | undefined, message?: string): string | null {
  const n = whatsappNumber(raw);
  if (!n) return null;
  const text = message?.trim();
  return text ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : `https://wa.me/${n}`;
}

/** tel: link for the dialer, or null when there is nothing dialable. */
export function dialUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[^0-9+]/g, '');
  return /\d/.test(cleaned) ? `tel:${cleaned}` : null;
}
