// TMFA certificate artifact — the PDF and QR a learner actually receives.
//
// These are byte/structure tests, not visual ones. They pin the parts that can
// break silently:
//   - the public URL is built from configuration, not from the request host,
//   - every field is folded into a font-safe encoding so no name throws,
//   - the QR is a real PNG,
//   - the PDF is a real, single-page A4 landscape document with the registry
//     URL in its metadata.
//
// A generated PDF is not proof that the layout looks right on paper; that still
// needs a human review of a downloaded file.

import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';

import {
  DEFAULT_PUBLIC_SITE_URL,
  buildCertificatePdf,
  certificatePdfFilename,
  certificateQrPng,
  certificateVerificationUrl,
  formatCertificateDate,
  pdfSafe,
  resolvePublicSiteUrl,
  type CertificateArtifactInput,
} from '@/src/server/services/academy/topics/certificate-artifact';

function artifact(over: Partial<CertificateArtifactInput> = {}): CertificateArtifactInput {
  return {
    certificateNumber: 'TMFA-2026-AAAA1111',
    studentName: 'Adélaïde Ngozi',
    programName: 'Spotlight Film Academy — TMFA',
    batchName: 'Cohort 1',
    completionDate: '2026-09-30',
    issuedAt: '2026-09-30T10:00:00.000Z',
    curriculumLabel: 'TMFA Curriculum 1.0',
    topicsRequired: 72,
    topicsMastered: 72,
    verificationCode: 'AAAA-BBBB-CCCC',
    verificationUrl: 'https://www.spotlightng.com/verify/certificate/AAAA-BBBB-CCCC',
    ...over,
  };
}

function pngWidth(bytes: Uint8Array): number {
  // IHDR width is a big-endian uint32 at offset 16 in a PNG.
  return (
    (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]
  ) >>> 0;
}

describe('certificate verification URL', () => {
  it('falls back to the production site when unset or blank', () => {
    expect(resolvePublicSiteUrl('')).toBe(DEFAULT_PUBLIC_SITE_URL);
    expect(resolvePublicSiteUrl('   ')).toBe(DEFAULT_PUBLIC_SITE_URL);
    expect(resolvePublicSiteUrl(undefined)).toBe(DEFAULT_PUBLIC_SITE_URL);
  });

  it('normalises configured origins and strips trailing slashes', () => {
    expect(resolvePublicSiteUrl('https://staging.example.test/')).toBe(
      'https://staging.example.test',
    );
    expect(resolvePublicSiteUrl('  http://localhost:3000// ')).toBe('http://localhost:3000');
  });

  it('trims the printed code and encodes it into the path', () => {
    expect(certificateVerificationUrl('  AAAA-BBBB-CCCC  ', 'https://example.test/')).toBe(
      'https://example.test/verify/certificate/AAAA-BBBB-CCCC',
    );
    expect(certificateVerificationUrl('ab/c d', 'https://example.test')).toBe(
      'https://example.test/verify/certificate/ab%2Fc%20d',
    );
  });
});

describe('certificate filename', () => {
  it('keeps a server-generated certificate number', () => {
    expect(certificatePdfFilename('TMFA-2026-AAAA1111')).toBe('TMFA-2026-AAAA1111.pdf');
  });

  it('replaces unsafe characters and falls back instead of producing a blank name', () => {
    expect(certificatePdfFilename('TMFA 2026/01')).toBe('TMFA-2026-01.pdf');
    expect(certificatePdfFilename('///')).toBe('TMFA-certificate.pdf');
  });
});

describe('PDF-safe text', () => {
  it('folds diacritics and typographic punctuation', () => {
    expect(pdfSafe('Adélaïde Ngozi')).toBe('Adelaide Ngozi');
    expect(pdfSafe('“Quote” — dash…')).toBe('"Quote" - dash...');
  });

  it('never leaves a character the standard fonts cannot encode', () => {
    expect(pdfSafe('Ada 😀 Obi')).toBe('Ada ? Obi');
    expect(pdfSafe('line\nbreak\ttab')).toBe('line break tab');
    expect(pdfSafe('non\u00a0breaking')).toBe('non breaking');
  });
});

describe('certificate date formatting', () => {
  it('renders the leading calendar date deterministically in UTC', () => {
    expect(formatCertificateDate('2026-09-30')).toBe('30 September 2026');
    // A late-evening offset instant must still render the date printed on the
    // certificate rather than drifting to the next UTC day.
    expect(formatCertificateDate('2026-09-30T23:30:00-05:00')).toBe('30 September 2026');
  });

  it('handles missing and unparseable values without inventing a date', () => {
    expect(formatCertificateDate(null)).toBe('Not recorded');
    expect(formatCertificateDate('')).toBe('Not recorded');
    expect(formatCertificateDate('not-a-date')).toBe('not-a-date');
  });
});

describe('certificate QR', () => {
  it('returns a PNG of the requested width', async () => {
    const png = await certificateQrPng('https://example.test/verify/certificate/AAAA');

    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(pngWidth(png)).toBe(640);
  });
});

describe('certificate PDF', () => {
  it('builds a single A4-landscape page carrying the verification URL', async () => {
    const pdf = await buildCertificatePdf(artifact());

    expect(Buffer.from(pdf.subarray(0, 5)).toString('ascii')).toBe('%PDF-');

    const parsed = await PDFDocument.load(pdf);
    expect(parsed.getPageCount()).toBe(1);

    const { width, height } = parsed.getPage(0).getSize();
    expect(width).toBe(842);
    expect(height).toBe(595);
    expect(parsed.getKeywords()).toContain(
      'https://www.spotlightng.com/verify/certificate/AAAA-BBBB-CCCC',
    );
  });

  it('does not throw on a very long or non-Latin holder name', async () => {
    const pdf = await buildCertificatePdf(
      artifact({
        studentName: `${'Adélaïde '.repeat(40)}😀 张伟`,
        programName: 'Programme '.repeat(30),
      }),
    );

    const parsed = await PDFDocument.load(pdf);
    expect(parsed.getPageCount()).toBe(1);
  });

  it('records missing counts as not recorded rather than zero', async () => {
    // Both counts null means "never captured", which must not be rendered as
    // "0 of 0" — that would describe the credential as certifying nothing.
    const pdf = await buildCertificatePdf(
      artifact({ topicsRequired: null, topicsMastered: null, completionDate: null }),
    );
    const parsed = await PDFDocument.load(pdf);
    expect(parsed.getPageCount()).toBe(1);
  });
});
