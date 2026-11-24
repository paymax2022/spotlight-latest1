/**
 * How the registration upload route answers a body it could not parse.
 *
 * One catch-all used to answer every parse failure with
 * `415 Expected multipart/form-data`, which conflated three different faults:
 *
 *   - the request genuinely was not multipart (no Content-Type, or JSON);
 *   - it claimed multipart but carried no boundary;
 *   - it was a well-formed multipart request whose body the server CUT OFF,
 *     because Next caps the request-body clone at
 *     `experimental.proxyClientMaxBodySize` (10 MiB by default) and pushes `null`
 *     into the stream instead of rejecting the request.
 *
 * The third one was a user-facing bug: a 20 MB photo upload in the registration
 * wizard printed "Upload failed. Please try again." with no hint that the file
 * was simply too big for the pipe. These specs pin the distinction.
 */
import { describe, it, expect } from 'vitest';

import {
  MULTIPART_REQUIRED_MESSAGE,
  classifyFormDataParseFailure,
  isMultipartWithBoundary,
} from '@/src/lib/api/multipart-request';

const CAP = 100 * 1024 * 1024;
// The exact sentence undici's FormData parser throws on a truncated body.
const TRUNCATION = new TypeError('Failed to parse body as FormData.');

describe('isMultipartWithBoundary', () => {
  it('accepts a real browser Content-Type, whatever the case', () => {
    expect(isMultipartWithBoundary('multipart/form-data; boundary=----WebKitFormBoundaryAb1')).toBe(true);
    expect(isMultipartWithBoundary('Multipart/Form-Data; BOUNDARY=x')).toBe(true);
  });

  it('refuses missing, foreign, and boundary-less values', () => {
    expect(isMultipartWithBoundary(null)).toBe(false);
    expect(isMultipartWithBoundary('application/json')).toBe(false);
    expect(isMultipartWithBoundary('multipart/form-data')).toBe(false);
    expect(isMultipartWithBoundary('multipart/form-data; boundary=')).toBe(false);
  });
});

describe('classifyFormDataParseFailure', () => {
  it('keeps 415 for a request that never was multipart', () => {
    for (const contentType of [null, 'application/json', 'text/plain']) {
      const verdict = classifyFormDataParseFailure(contentType, TRUNCATION, CAP);
      expect(verdict.status).toBe(415);
      expect(verdict.message).toBe(MULTIPART_REQUIRED_MESSAGE);
    }
  });

  it('keeps 415 for a multipart request with no boundary to parse against', () => {
    const verdict = classifyFormDataParseFailure('multipart/form-data', TRUNCATION, CAP);
    expect(verdict.status).toBe(415);
  });

  it('answers 413, not 415, when a well-formed multipart body was cut off', () => {
    const contentType = 'multipart/form-data; boundary=------------------------ynDR0BC9PAgeyiwIezNjqc';
    const verdict = classifyFormDataParseFailure(contentType, TRUNCATION, CAP);
    expect(verdict.status).toBe(413);
    // The message has to say what happened and what to do about it: it is the
    // only thing the wizard shows the applicant.
    expect(verdict.message).toMatch(/cut off/i);
    expect(verdict.message).toMatch(/100/);
  });

  it('does not dress an unexpected parser fault up as a size problem', () => {
    const contentType = 'multipart/form-data; boundary=x';
    const verdict = classifyFormDataParseFailure(contentType, new RangeError('multipart parser exploded'), CAP);
    expect(verdict.status).toBe(500);
  });
});
