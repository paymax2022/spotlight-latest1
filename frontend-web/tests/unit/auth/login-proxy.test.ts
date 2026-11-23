import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// /api/auth/login is a PROXY: Go owns the verdict, this route owns not losing it.
//
// It used to document the opposite — "It answers 401 with a DELIBERATELY generic
// message so a wrong password and an unknown account are indistinguishable; do
// not enrich it here." Since ADR-PR802 Go names the cause (locked / suspended /
// closed / wrong password / no such account / unusable or ambiguous identifier),
// each with its own status, `code` and sentence. These tests pin the seam so a
// future edit cannot re-flatten them on the way to the browser.

const ORIGINAL_FETCH = globalThis.fetch;

async function callRoute(body: unknown) {
  const { POST } = await import('@/app/api/auth/login/route');
  return POST(new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

function mockUpstream(status: number, payload: unknown) {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(payload), {
    status, headers: { 'Content-Type': 'application/json' },
  })) as unknown as typeof fetch;
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; vi.restoreAllMocks(); });

// Mirrors the table in backend/internal/handlers/auth_login_error_classes_test.go.
const CAUSES: Array<[number, string, string]> = [
  [400, 'invalid_identifier', 'Enter a valid email address or phone number.'],
  [400, 'ambiguous_identifier', 'That phone number is linked to more than one account. Sign in with your email address instead.'],
  [401, 'account_not_found', 'No account found for 08035550111. Check you typed it correctly, or create an account.'],
  [401, 'incorrect_password', 'Incorrect password for 08035550111. 3 attempts left before the account locks. Use Forgot password to reset it.'],
  [423, 'account_locked', 'Account locked for 08035550111 after too many failed sign-in attempts. Try again in 12 minutes.'],
  [423, 'account_locked_by_support', 'Your account is locked by our team. Contact support to have it reviewed.'],
  [403, 'account_suspended', 'This account is suspended. Contact support to have it reviewed.'],
  [403, 'account_closed', 'This account was closed. You can create a new one with the same email address.'],
  [500, 'account_record_missing', "We can't load your account right now. Try again, or contact support."],
];

describe('POST /api/auth/login — refusal passthrough', () => {
  it.each(CAUSES)('forwards the %s refusal with its status and code untouched',
    async (status, code, error) => {
      mockUpstream(status, { success: false, error, code });
      const res = await callRoute({ identifier: '08035550111', password: 'correct-horse-battery' });
      const body = await res.json();
      expect(res.status).toBe(status);
      expect(body.error).toBe(error);
      expect(body.code).toBe(code);
    });

  it('keeps a coded 400 a 400 — the input verdict must not masquerade as a credential one', async () => {
    mockUpstream(400, { success: false, error: 'Enter a valid email address or phone number.', code: 'invalid_identifier' });
    const res = await callRoute({ identifier: '080', password: 'correct-horse-battery' });
    expect(res.status).toBe(400);
  });

  it('still coerces an UNCODED 400 to 401 (the legacy bind-failure reading)', async () => {
    mockUpstream(400, { success: false, error: 'invalid payload' });
    const res = await callRoute({ identifier: 'ada@example.test', password: 'x' });
    expect(res.status).toBe(401);
  });

  it('keeps email_not_confirmed routing to the code screen', async () => {
    mockUpstream(403, { success: false, error: 'Your email address has not been verified yet.', code: 'email_not_confirmed' });
    const res = await callRoute({ identifier: 'ada@example.test', password: 'correct-horse-battery' });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('email_not_confirmed');
  });

  it('preserves the historic generic 401 for an unclassified refusal', async () => {
    mockUpstream(401, { success: false, error: 'invalid credentials' });
    const res = await callRoute({ identifier: 'ada@example.test', password: 'x' });
    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.error).toBe('invalid credentials');
    expect(body.code).toBeUndefined();
  });
});
