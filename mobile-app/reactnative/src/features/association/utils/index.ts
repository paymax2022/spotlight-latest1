import type { AdminAccess, EventSummary } from '../types';
import type { MembershipCard } from '../types/association.types';
import type { DeviceInput } from '../types/authoring.types';
import * as Device from 'expo-device';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Platform, Share } from 'react-native';
import { captureRef } from 'react-native-view-shot';


// All money is in kobo (integer minor units). Display helpers convert to ₦.

/** ₦ from kobo, grouped thousands. e.g. 2_000_000 → "₦20,000". */
export function formatNaira(kobo: number, opts?: { decimals?: boolean }): string {
  const naira = kobo / 100;
  return `₦${naira.toLocaleString('en-NG', {
    minimumFractionDigits: opts?.decimals ? 2 : 0,
    maximumFractionDigits: opts?.decimals ? 2 : 0,
  })}`;
}

/** Compact ₦ for cards: 25_000_000 → "₦250K". */
export function formatNairaCompact(kobo: number): string {
  const naira = kobo / 100;
  if (naira >= 1_000_000) return `₦${(naira / 1_000_000).toFixed(naira % 1_000_000 === 0 ? 0 : 1)}M`;
  if (naira >= 1_000) return `₦${(naira / 1_000).toFixed(naira % 1_000 === 0 ? 0 : 1)}K`;
  return `₦${naira.toLocaleString('en-NG')}`;
}

/** Compact member count: 42180 → "42.2k members". */
export function formatCount(n: number, noun: string): string {
  const label = n === 1 ? noun.replace(/s$/, '') : noun;
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k ${label}`;
  return `${n.toLocaleString('en-NG')} ${label}`;
}

/**
 * Naira text → integer kobo. Returns null for anything that is not a clean,
 * non-negative amount with at most two decimal places.
 *
 * Deliberately parsed digit-by-digit rather than `parseFloat(x) * 100`: the
 * float route turns ₦1,234.35 into 123434.99999999999 and then a wrong
 * integer, which is a real money bug the moment it is rounded the other way.
 */
export function nairaToKobo(input: string): number | null {
  const cleaned = input.replace(/[₦,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  const kobo = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return Number.isSafeInteger(kobo) ? kobo : null;
}

/**
 * Parse a server timestamp defensively. Returns null instead of an Invalid Date
 * or the epoch.
 *
 * Two shapes reach the client and neither is guaranteed to be present:
 *   • RFC3339 from the JSON DTOs ("2026-06-28T17:00:00Z")
 *   • Postgres `::text` from the admin listings ("2026-06-28 17:00:00+00")
 *
 * `new Date(null)` is 1 Jan 1970, not an error — which is exactly how the
 * membership card came to read "Valid thru 1 Jan 1970" for a card with no
 * expiry, and how a now-nullable invoice `dueDate` would render as an epoch
 * date. Every formatter below goes through here, so a missing date can never be
 * displayed as a real one.
 */
export function parseDateSafe(value?: string | null): Date | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  // normalise both so the platform Date parser accepts it.
  const normalised = /^\d{4}-\d{2}-\d{2} /.test(raw)
    ? raw.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
    : raw;
  const d = new Date(normalised);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "28 Jun 2026", or `fallback` when the date is missing or unparseable. */
export function formatDate(iso?: string | null, fallback = '—'): string {
  const d = parseDateSafe(iso);
  if (!d) return fallback;
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "Sat 28 Jun · 5:00 PM", or `fallback` when the date is missing/unparseable. */
export function formatDateTime(iso?: string | null, fallback = '—'): string {
  const d = parseDateSafe(iso);
  if (!d) return fallback;
  const date = d.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

/** Days until a date; negative when overdue. Null when there is no usable date. */
export function daysUntil(iso?: string | null): number | null {
  const d = parseDateSafe(iso);
  if (!d) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

/**
 * Human due label: "Due in 5 days" / "Overdue by 12 days" / "Due today".
 * An invoice with no due date says so, rather than claiming it is twenty
 * thousand days overdue.
 */
export function dueLabel(iso?: string | null, fallback = 'No due date'): string {
  const d = daysUntil(iso);
  if (d === null) return fallback;
  if (d === 0) return 'Due today';
  if (d > 0) return d === 1 ? 'Due tomorrow' : `Due in ${d} days`;
  const od = Math.abs(d);
  return od === 1 ? 'Overdue by 1 day' : `Overdue by ${od} days`;
}

export function relativeTime(iso?: string | null, fallback = '—'): string {
  const parsed = parseDateSafe(iso);
  if (!parsed) return fallback;
  const diff = Date.now() - parsed.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

/** Initials from a full name, max 2 letters. "Dr. Chidinma Okeke" → "CO". */
export function initials(name: string): string {
  const parts = name.replace(/^(Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Engr\.?|Prof\.?)\s+/i, '').trim().split(/\s+/);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

export type AuthoringCapability = keyof AdminAccess['can'];

/**
 * The capability the SERVER requires to author content.
 *
 * It reads like "any admin role", but it is not: content creates go through
 * `requireOrgAdmin`, which is `requireCapInOrg(… ManageMembers)`. Of the roles
 * that exist, SUPER_ADMIN / NATIONAL_ADMIN / CHAPTER_ADMIN carry ManageMembers;
 * FINANCE_ADMIN and SECRETARY do NOT. Gating this screen on `isAdmin` would let
 * a finance admin or a secretary fill in a whole form and then meet an
 * unexplained 403 on save.
 */
export const CONTENT_CAPABILITY: AuthoringCapability = 'manageMembers';

/**
 * The capability the server requires to raise dues:
 * `requireCapInOrg(… ManageFinance)` — SUPER_ADMIN, NATIONAL_ADMIN and
 * FINANCE_ADMIN, but NOT a chapter admin.
 */
export const DUES_CAPABILITY: AuthoringCapability = 'manageFinance';

/** Fail-closed: no admin flag, or no `can` block, grants nothing. */
export function hasAuthoringCapability(access: AdminAccess | undefined, capability: AuthoringCapability): boolean {
  if (!access?.isAdmin) return false;
  return Boolean(access.can?.[capability]);
}

// The Download button used to open an Alert saying it was "not available in this
// preview build" — which on react-native-web is a silent no-op, so the button
// did nothing at all.
// The card is captured from the rendered view rather than redrawn, so what is
// saved is exactly what the member sees, including the QR code, and the card
// design has only one definition.

export type SaveOutcome = 'saved' | 'shared' | 'dismissed' | 'unsupported' | 'failed';

/** Filesystem-safe file name for a member's card. */
export function cardFileName(memberId: string): string {
  const safe = (memberId || 'card').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `membership-card-${safe || 'card'}.png`;
}

/**
 * Capture the card view and hand it to the platform's save flow.
 *
 * Web and native diverge because there is no single mechanism:
 *   • web    — capture to a data URI and click a synthetic <a download>. This is
 *              the surface the app is previewed on, so it must not be the
 *              branch that degrades.
 *   • native — capture to a temp file, rename it so the share sheet shows
 *              "membership-card-<id>.png" rather than a random capture name,
 *              then open the share sheet, which is what "Save to Files" and
 *              "Save Image" live behind on both platforms.
 *
 * `ref` is the captured view; pass the card view, not the screen.
 */
export async function saveMembershipCard(ref: unknown, memberId: string): Promise<SaveOutcome> {
  const fileName = cardFileName(memberId);
  try {
    if (Platform.OS === 'web') {
      // react-native-view-shot ships a web implementation, but its exported
      // captureRef cannot reach it: captureRef calls findNodeHandle on anything
      // that is not already a node handle, and findNodeHandle throws outright on
      // react-native-web ("findNodeHandle is not supported on web"). So the web
      // path goes straight to html2canvas — which is what that web build uses
      // anyway — against the DOM element the ref holds.
      const node = ((ref as { current?: unknown } | null)?.current ?? ref) as HTMLElement | null;
      if (typeof document === 'undefined' || !node) return 'unsupported';
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(node, { backgroundColor: null, scale: 2, useCORS: true });
      const dataUri = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUri;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return 'saved';
    }

    const tmpUri = await captureRef(ref as never, { format: 'png', quality: 1, result: 'tmpfile' });

    // Lazily required so the web bundle never pulls in the native modules.
    const Sharing = require('expo-sharing');
    if (!(await Sharing.isAvailableAsync())) return 'unsupported';

    let shareUri = tmpUri;
    try {
      const { File, Paths } = require('expo-file-system');
      const named = new File(Paths.cache, fileName);
      // purely so the save dialog shows something a member would recognise. A
      // failure here must not lose the capture, so it falls back to the temp
      // file rather than aborting the save.
      new File(tmpUri).copy(named);
      shareUri = named.uri;
    } catch { /* keep tmpUri */ }

    await Sharing.shareAsync(shareUri, {
      mimeType: 'image/png',
      dialogTitle: 'Save membership card',
      UTI: 'public.png',
    });
    return 'shared';
  } catch (err) {
    // Logged rather than swallowed: a capture failure is silent to the user
    // apart from a generic message, and the cause (a tainted canvas, a missing
    // node, a permissions prompt) is only visible here.
    console.warn('[association] membership card save failed', err);
    return 'failed';
  }
}

// The card screen's Share button used to open an Alert saying sharing was "not
// available in this preview build" — and on react-native-web a single-button
// Alert.alert is a silent no-op (see the module CLAUDE.md), so on the web build
// the button did visibly nothing at all.

/**
 * Build the text shared for a membership card.
 *
 * DELIBERATELY OMITS card.qrPayload. That token is what /association/verify-card
 * accepts to confirm a membership, so anyone holding it can pass verification as
 * this member. Showing the QR to a person in front of you is a bounded
 * disclosure; pasting the token into a chat is not, and it would outlive the
 * conversation. The shared text is a claim of membership — verification stays
 * with the QR, in person.
 */
export function buildCardShareMessage(card: MembershipCard): string {
  const org = card.organisationAcronym
    ? `${card.organisationName} (${card.organisationAcronym})`
    : card.organisationName;

  const lines = [
    `${card.fullName} — ${org}`,
    `Member ID: ${card.memberId}`,
    `Category: ${card.categoryLabel}`,
  ];
  if (card.chapterName) lines.push(`Chapter: ${card.chapterName}`);
  lines.push(`Status: ${card.status}${card.paymentStanding ? ` · ${card.paymentStanding}` : ''}`);
  if (card.validThrough) {
    // validThrough is nullable and was once formatted unguarded, which printed
    // "Valid thru 1 Jan 1970" for a card with no expiry.
    const d = new Date(card.validThrough);
    if (!Number.isNaN(d.getTime())) {
      lines.push(`Valid through: ${d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}`);
    }
  }
  lines.push('', 'Scan the QR code on the card in the Spotlight app to verify this membership.');
  return lines.join('\n');
}

export type ShareOutcome = 'shared' | 'dismissed' | 'copied' | 'failed';

/**
 * Share the card, falling back to the clipboard.
 *
 * The fallback is not defensive padding: on the web build React Native's Share
 * maps to navigator.share, which desktop Chrome does not implement, so without
 * it the button would still do nothing on the surface this is most often tested.
 * expo-clipboard is already a dependency and works everywhere.
 */
export async function shareMembershipCard(card: MembershipCard): Promise<ShareOutcome> {
  const message = buildCardShareMessage(card);
  try {
    const res = await Share.share({ message });
    if (res.action === Share.dismissedAction) return 'dismissed';
    return 'shared';
  } catch {
    try {
      const Clipboard = require('expo-clipboard');
      if (Clipboard?.setStringAsync) {
        await Clipboard.setStringAsync(message);
        return 'copied';
      }
    } catch { /* fall through */ }
    return 'failed';
  }
}

// Who may do what with a committee, on the client.
// This mirrors the server's split (association requireCommitteeAdmin vs
// requireOrgAdmin) so the UI shows the actions a caller will actually be
// allowed to perform. It is NOT the authorisation — hiding a button is not a
// regardless of what the client renders.

export interface CommitteeAccess {
  isAdmin?: boolean;
  organisationId?: string | null;
  can?: {
    manageMembers?: boolean;
    manageCommittees?: boolean;
  } | null;
}

/**
 * Create / rename / delete a committee — the organisation owner only.
 *
 * Requires organisationId as well as the capability: creating a committee POSTs
 * to /admin/organisations/:id/committees, and with no org id there is nothing
 * to post to. An older backend that does not report manageCommittees yields
 * false rather than an accidental true.
 */
export function canManageCommittees(access?: CommitteeAccess | null): boolean {
  if (!access) return false;
  return Boolean(access.can?.manageCommittees) && Boolean(access.organisationId);
}

/**
 * Run a committee's roster — add, approve, decline, remove, set role.
 * Deliberately wider: chapter admins do this day-to-day work without being
 * able to create or destroy a committee.
 */
export function canManageCommitteeRoster(access?: CommitteeAccess | null): boolean {
  if (!access) return false;
  return Boolean(access.isAdmin);
}

/**
 * Describe the current device for `POST /me/devices`.
 *
 * The server is idempotent on (user, name, platform), so both fields MUST be
 * stable across launches — a name that varied per session (a timestamp, a
 * random id) would insert a new row every time the app opened and turn the
 * devices screen into an append-only log the member cannot clean up.
 */
export function describeThisDevice(): DeviceInput {
  const osName = Device.osName?.trim() || Platform.OS;
  const osVersion = Device.osVersion?.trim() ?? '';

  if (Platform.OS === 'web') {
    // The devices list renders a monitor icon for the exact string "Web".
    return { name: Device.deviceName?.trim() || `${osName} browser`, platform: 'Web' };
  }

  const name = Device.deviceName?.trim() || Device.modelName?.trim() || `${osName} device`;
  return { name, platform: osVersion ? `${osName} ${osVersion}` : String(osName) };
}

// Thin wrapper around expo-image-picker for membership document uploads, so the
// screen stays declarative and permission/cancel handling lives in one place.

export interface PickedFile {
  uri:       string;
  name:      string;
  sizeLabel: string;
  /** Present for files picked with `pickSpreadsheet` (needed for multipart). */
  mimeType?: string;
}

/** MIME types accepted by the bulk member import (.xlsx / .xls / .csv). */
const SPREADSHEET_TYPES = [
  'text/csv',
  'text/comma-separated-values',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

function mimeFromName(name: string): string {
  if (/\.csv$/i.test(name)) return 'text/csv';
  if (/\.xlsx$/i.test(name)) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (/\.xls$/i.test(name)) return 'application/vnd.ms-excel';
  return 'application/octet-stream';
}

function sizeLabel(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  const { status } = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (status === 'granted') return true;
  const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (req.status === 'granted') return true;
  Alert.alert('Permission needed', 'Allow photo access in Settings to upload your documents.');
  return false;
}

/** Pick a single document/photo from the library. Returns null on cancel/denied. */
export async function pickDocument(): Promise<PickedFile | null> {
  try {
    if (!(await ensurePermission())) return null;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets?.length) return null;
    const a = result.assets[0];
    return {
      uri: a.uri,
      name: a.fileName ?? `document-${Date.now()}.jpg`,
      sizeLabel: sizeLabel(a.fileSize),
    };
  } catch {
    Alert.alert('Couldn’t open photos', 'Something went wrong. Please try again.');
    return null;
  }
}

/**
 * Pick a spreadsheet / CSV for the bulk member import. Uses
 * expo-document-picker (the photo library cannot surface .xlsx / .csv).
 * Returns null on cancel or error.
 */
export async function pickSpreadsheet(): Promise<PickedFile | null> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: SPREADSHEET_TYPES,
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets?.length) return null;
    const f = result.assets[0];
    const name = f.name ?? `members-${Date.now()}.csv`;
    return {
      uri: f.uri,
      name,
      sizeLabel: sizeLabel(f.size ?? undefined),
      mimeType: f.mimeType ?? mimeFromName(name),
    };
  } catch {
    Alert.alert('Couldn’t open the file picker', 'Something went wrong. Please try again.');
    return null;
  }
}

// Same shape as the membership-card share: the platform sheet where it exists,
// the clipboard where it does not. On the web build Share maps to
// navigator.share, which desktop Chrome does not implement, so without the
// fallback the button would do nothing on the surface this is tested on.



/** Naira from kobo, for the fee line. */
function naira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG')}`;
}

export function buildEventShareMessage(e: Pick<EventSummary, 'title' | 'startsAt' | 'location' | 'paid' | 'feeKobo'>): string {
  const lines = [e.title];
  const when = new Date(e.startsAt);
  if (!Number.isNaN(when.getTime())) {
    lines.push(when.toLocaleString('en-NG', { dateStyle: 'full', timeStyle: 'short' }));
  }
  if (e.location) lines.push(e.location);
  // A free event says so rather than saying nothing — "no price" reads as
  // "price not stated", which is the wrong impression to give about a ticket.
  lines.push(e.paid && e.feeKobo > 0 ? `Tickets ${naira(e.feeKobo)}` : 'Free to attend');
  lines.push('', 'Shared from Spotlight.');
  return lines.join('\n');
}

export async function shareEvent(e: Parameters<typeof buildEventShareMessage>[0]): Promise<ShareOutcome> {
  const message = buildEventShareMessage(e);
  try {
    const res = await Share.share({ message });
    return res.action === Share.dismissedAction ? 'dismissed' : 'shared';
  } catch {
    try {
      const Clipboard = require('expo-clipboard');
      if (Clipboard?.setStringAsync) {
        await Clipboard.setStringAsync(message);
        return 'copied';
      }
    } catch { /* fall through */ }
    return 'failed';
  }
}

// `AdminContentRow.meta` is whatever `jsonb_build_object` the server chose for
// that content type, so it is `Record<string, unknown>` by construction. The
// column (or a renamed key) become the string "null" in an input box, or crash
// a `.map()` on a missing array.

/** A trimmed string, or null when the value is absent/blank/not a string. */
export function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/** A boolean; anything else is false. */
export function bool(v: unknown): boolean {
  return v === true;
}

/**
 * A finite number, or null. Accepts the numeric strings Postgres `jsonb` can
 * produce for bigint columns — `feeKobo` must survive that round trip as an
 * exact integer, never a parsed float.
 */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) {
    const n = Number(v.trim());
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

/** An integer amount in minor units; 0 when absent. Never a float. */
export function kobo(v: unknown): number {
  const n = num(v);
  return n === null || !Number.isInteger(n) ? 0 : n;
}

/** A list of non-empty strings; [] for anything else. */
export function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
}

/** A value from a known union, or the given fallback. */
export function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

// One home for the rules the wizard enforces, so the step that collects a field
// and the step that publishes it cannot disagree. The server enforces the same
// these exist to fail on the screen rather than after a round trip.

/** Earliest founding year accepted, matching the admin console's org editor. */
export const MIN_FOUNDED_YEAR = 1800;

/** Latest accepted founding year — an organisation cannot be founded ahead of now. */
export function maxFoundedYear(): number {
  return new Date().getFullYear();
}

/**
 * Validate the founded-year text. Returns an error string, or undefined when
 * the value is acceptable.
 *
 * Deliberately strict about the shape before the range: `Number('')` is 0 and
 * `Number('19 99')` is NaN, so a bare numeric coercion would either accept
 * blank as year zero or report a confusing range error for a typo.
 */
export function foundedYearError(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return 'Enter the year this organisation was founded';
  if (!/^\d{4}$/.test(value)) return 'Enter a 4-digit year, e.g. 2015';
  const year = Number(value);
  const max = maxFoundedYear();
  if (year < MIN_FOUNDED_YEAR || year > max) return `Enter a year between ${MIN_FOUNDED_YEAR} and ${max}`;
  return undefined;
}

/**
 * Validate an optional website. Blank is fine; anything present must look like
 * a URL the server can store and a browser can open, so a bare "nma.org.ng"
 * is corrected rather than silently saved as an unopenable string.
 */
export function websiteError(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  if (!/^https?:\/\/\S+\.\S+/i.test(value)) return 'Enter a full URL starting with https://';
  return undefined;
}

/**
 * Validate the logo. Required, and satisfied by EITHER a pasted URL or an
 * uploaded image — the wizard writes both into the same draft field.
 *
 * A picked image is uploaded to R2 first and stored as its object key, so a
 * device-local file:// URI must never survive to submission: it would be stored
 * verbatim and resolve on the founder's phone and nowhere else. Treat one as
 * "no logo yet" rather than accepting it.
 */
export function logoError(logoUri: string | null): string | undefined {
  const value = (logoUri ?? '').trim();
  if (!value) return 'Add a logo — paste a URL or upload an image';
  if (value.startsWith('file://')) return 'That image has not finished uploading yet';
  return undefined;
}

/** True when a pasted string is usable as a remote logo URL. */
export function isRemoteLogoUrl(value: string): boolean {
  return /^https?:\/\/\S+/i.test(value.trim());
}

/**
 * True when the stored logo is an uploaded object key rather than a pasted URL.
 * Mirrors IsStoredObjectKey in backend/internal/association/presign.go — the
 * key prefix is minted there, and the two must agree on what a key looks like.
 */
export function isUploadedLogoKey(value: string | null): boolean {
  const v = (value ?? '').trim();
  return Boolean(v) && !v.includes('://') && v.startsWith('association/');
}
