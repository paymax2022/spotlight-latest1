// Certificate artifact: the PDF a learner downloads and the QR both the PDF and
// the mobile screen use to reach the public registry.
//
// The PDF carries only what the public registry already exposes — holder display
// name, programme, completion date, certificate number, curriculum and topic
// counts. It never embeds an email, phone, user id or enrollment id.
//
// Standard PDF fonts use WinAnsi, which cannot encode every Unicode name. Text is
// folded to Latin-1 with common punctuation mapped and anything else replaced, so
// a name can never make certificate generation throw.

import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import QRCode from 'qrcode';

export const DEFAULT_PUBLIC_SITE_URL = 'https://www.spotlightng.com';

export interface CertificateArtifactInput {
  certificateNumber: string;
  studentName: string;
  programName: string;
  batchName: string;
  completionDate: string | null;
  issuedAt: string | null;
  curriculumLabel: string;
  topicsRequired: number | null;
  topicsMastered: number | null;
  verificationCode: string;
  verificationUrl: string;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Normalises the configured site origin; an empty value falls back to production. */
export function resolvePublicSiteUrl(value = process.env.NEXT_PUBLIC_SITE_URL): string {
  const configured = (value ?? '').trim();
  return (configured || DEFAULT_PUBLIC_SITE_URL).replace(/\/+$/, '');
}

/** The public HTML page a verifier opens (or scans). */
export function certificateVerificationUrl(
  identifier: string,
  siteUrl = resolvePublicSiteUrl(),
): string {
  return `${resolvePublicSiteUrl(siteUrl)}/verify/certificate/${encodeURIComponent(identifier.trim())}`;
}

/** A filesystem-safe download name; the certificate number is server-generated. */
export function certificatePdfFilename(certificateNumber: string): string {
  const safe = certificateNumber.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${safe || 'TMFA-certificate'}.pdf`;
}

/**
 * Fold text into the WinAnsi range accepted by the standard PDF fonts.
 * Diacritics decompose and drop, common typography becomes ASCII, and a
 * character with no Latin-1 equivalent becomes "?" rather than throwing.
 */
export function pdfSafe(value: string): string {
  const typography: Record<string, string> = {
    '\u2013': '-',
    '\u2014': '-',
    '\u2018': "'",
    '\u2019': "'",
    '\u201c': '"',
    '\u201d': '"',
    '\u2026': '...',
    '\u00a0': ' ',
  };
  const folded = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2013\u2014\u2018\u2019\u201c\u201d\u2026\u00a0]/g, (char) => typography[char] ?? char);

  let out = '';
  for (const char of folded) {
    const code = char.codePointAt(0) ?? 0;
    if (char === '\n' || char === '\r' || char === '\t') {
      out += ' ';
    } else if (code >= 32 && code <= 255) {
      out += char;
    } else {
      out += '?';
    }
  }
  return out;
}

/** Deterministic UTC formatting so the same row renders the same date everywhere. */
export function formatCertificateDate(value: string | null | undefined): string {
  if (!value) return 'Not recorded';
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  let date: Date;
  if (dateOnly) {
    date = new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])));
  } else {
    date = new Date(value);
  }
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** PNG QR of the public verification URL. */
export async function certificateQrPng(url: string): Promise<Uint8Array> {
  return QRCode.toBuffer(url, {
    type: 'png',
    margin: 1,
    width: 640,
    errorCorrectionLevel: 'M',
  });
}

function fitLine(
  font: PDFFont,
  text: string,
  maxWidth: number,
  startSize: number,
  minSize: number,
): { text: string; size: number } {
  let size = startSize;
  while (size > minSize && font.widthOfTextAtSize(text, size) > maxWidth) size -= 1;
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return { text, size };

  let truncated = text;
  while (truncated.length > 1 && font.widthOfTextAtSize(`${truncated}...`, size) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return { text: `${truncated}...`, size };
}

const PAGE_WIDTH = 842; // A4 landscape
const PAGE_HEIGHT = 595;

/**
 * Build the single-page certificate. A revoked credential is never rendered:
 * the download route refuses it, and the public page shows the revocation.
 */
export async function buildCertificatePdf(input: CertificateArtifactInput): Promise<Uint8Array> {
  const gold = rgb(0.72, 0.55, 0.2);
  const ink = rgb(0.13, 0.12, 0.1);
  const muted = rgb(0.42, 0.4, 0.36);

  const doc = await PDFDocument.create();
  doc.setTitle(`TMFA Certificate ${pdfSafe(input.certificateNumber)}`);
  doc.setAuthor('Spotlight Film Academy');
  doc.setSubject('Timeless Movies Film Academy programme completion');
  doc.setKeywords([input.verificationUrl]);
  doc.setCreator('Spotlight Film Academy');

  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const body = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);

  const centered = (font: PDFFont, text: string, size: number, y: number, color = ink) => {
    page.drawText(text, {
      x: (PAGE_WIDTH - font.widthOfTextAtSize(text, size)) / 2,
      y,
      size,
      font,
      color,
    });
  };

  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: rgb(0.995, 0.99, 0.975) });
  page.drawRectangle({ x: 26, y: 26, width: 790, height: 543, borderColor: gold, borderWidth: 1.25 });
  page.drawRectangle({ x: 34, y: 34, width: 774, height: 527, borderColor: gold, borderWidth: 0.5 });

  centered(bold, 'SPOTLIGHT FILM ACADEMY', 10, 543, gold);
  centered(serifBold, 'Certificate of Completion', 32, 494, ink);
  centered(italic, 'Timeless Movies Film Academy', 13, 470, muted);

  page.drawLine({ start: { x: 311, y: 452 }, end: { x: 531, y: 452 }, color: gold, thickness: 0.75 });

  centered(body, 'This certifies that', 11.5, 416, muted);

  const name = fitLine(serifBold, pdfSafe(input.studentName || 'Film Academy Learner'), 620, 28, 14);
  centered(serifBold, name.text, name.size, 372, ink);
  const nameWidth = serifBold.widthOfTextAtSize(name.text, name.size);
  page.drawLine({
    start: { x: (PAGE_WIDTH - nameWidth) / 2, y: 364 },
    end: { x: (PAGE_WIDTH + nameWidth) / 2, y: 364 },
    color: gold,
    thickness: 0.6,
  });

  centered(body, 'has successfully completed the programme requirements of', 11.5, 338, muted);
  const program = fitLine(serifBold, pdfSafe(input.programName || 'Spotlight Film Academy - TMFA'), 620, 17, 12);
  centered(serifBold, program.text, program.size, 306, ink);
  if (input.batchName.trim()) {
    centered(italic, pdfSafe(input.batchName), 10, 286, muted);
  }

  const topics = input.topicsRequired !== null && input.topicsMastered !== null
    ? `${Math.max(0, Math.trunc(input.topicsMastered))} of ${Math.max(0, Math.trunc(input.topicsRequired))}`
    : 'Not recorded';
  const meta: Array<[string, string]> = [
    ['Completion date', formatCertificateDate(input.completionDate)],
    ['Certificate no.', pdfSafe(input.certificateNumber)],
    ['Topics mastered', topics],
  ];
  meta.forEach(([label, value], index) => {
    const centerX = [170, 421, 672][index];
    const labelText = fitLine(bold, label.toUpperCase(), 200, 7.5, 6);
    page.drawText(labelText.text, {
      x: centerX - bold.widthOfTextAtSize(labelText.text, labelText.size) / 2,
      y: 248,
      size: labelText.size,
      font: bold,
      color: muted,
    });
    const valueLine = fitLine(body, value, 210, 11, 8);
    page.drawText(valueLine.text, {
      x: centerX - body.widthOfTextAtSize(valueLine.text, valueLine.size) / 2,
      y: 230,
      size: valueLine.size,
      font: body,
      color: ink,
    });
  });

  page.drawLine({ start: { x: 70, y: 208 }, end: { x: 772, y: 208 }, color: gold, thickness: 0.4 });

  page.drawText('VERIFY THIS CREDENTIAL', { x: 70, y: 184, size: 8.5, font: bold, color: gold });
  const url = fitLine(body, pdfSafe(input.verificationUrl), 480, 9, 6.5);
  page.drawText(url.text, { x: 70, y: 168, size: url.size, font: body, color: ink });

  page.drawText('VERIFICATION CODE', { x: 70, y: 142, size: 7.5, font: bold, color: muted });
  page.drawText(pdfSafe(input.verificationCode || 'Not recorded'), {
    x: 70, y: 124, size: 12, font: bold, color: ink,
  });
  if (input.issuedAt) {
    page.drawText(`Issued ${formatCertificateDate(input.issuedAt)}`, {
      x: 70, y: 102, size: 8.5, font: body, color: muted,
    });
  }
  if (input.curriculumLabel.trim()) {
    page.drawText(pdfSafe(input.curriculumLabel), {
      x: 70, y: 86, size: 8, font: italic, color: muted,
    });
  }

  const qr = await doc.embedPng(await certificateQrPng(input.verificationUrl));
  const qrSize = 104;
  const qrX = 700;
  const qrY = 96;
  page.drawImage(qr, { x: qrX, y: qrY, width: qrSize, height: qrSize });
  const qrLabel = 'Scan to verify';
  page.drawText(qrLabel, {
    x: qrX + (qrSize - body.widthOfTextAtSize(qrLabel, 7.5)) / 2,
    y: 82,
    size: 7.5,
    font: body,
    color: muted,
  });

  centered(
    body,
    'This credential is valid only while the public registry lists it as issued. Revoked credentials remain verifiable.',
    7.5,
    52,
    muted,
  );

  return doc.save();
}
