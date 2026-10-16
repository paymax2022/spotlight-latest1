#!/usr/bin/env node
/**
 * Local stand-in for Brevo's transactional-send endpoint.
 *
 * The Go OTP service sends codes ONLY through Brevo's HTTP API, so on a local
 * stack they never reach Mailpit (which only catches Supabase's own SMTP mail).
 * Point the backend at this with BREVO_ENDPOINT (honoured only when APP_ENV
 * allows mocks) and every OTP email is re-posted into Mailpit, where the e2e
 * helpers (tests/e2e/auth/helpers.ts) already look.
 *
 *   node scripts/dev/fake-brevo.mjs            # listens on :8099
 *   BREVO_ENDPOINT=http://127.0.0.1:8099/v3/smtp/email  (backend env)
 *
 * Env: FAKE_BREVO_PORT (8099), MAILPIT_URL (http://127.0.0.1:54324).
 */
import http from 'node:http';

const PORT = Number(process.env.FAKE_BREVO_PORT || 8099);
const MAILPIT = (process.env.MAILPIT_URL || 'http://127.0.0.1:54324').replace(/\/$/, '');

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || !req.url?.startsWith('/v3/smtp/email')) {
    res.writeHead(404).end();
    return;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try {
    const p = JSON.parse(raw);
    const to = (p.to || []).map((t) => ({ Email: t.email, Name: t.name || '' }));
    const params = p.params || {};
    const text = `Your Spotlight verification code is ${params.OTP}. It expires in ${params.EXPIRY_MINUTES} minutes.`;
    const r = await fetch(`${MAILPIT}/api/v1/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        From: { Email: p.sender?.email || 'otp@fake-brevo.local', Name: p.sender?.name || 'Spotlight' },
        To: to,
        Subject: 'Your verification code',
        Text: text,
        HTML: `<p>${text}</p>`,
        Tags: p.tags || [],
      }),
    });
    if (!r.ok) throw new Error(`mailpit ${r.status}: ${await r.text()}`);
    res.writeHead(201, { 'Content-Type': 'application/json' }).end('{"messageId":"fake"}');
  } catch (err) {
    console.error('[fake-brevo]', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ code: 'fake', message: err.message }));
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`[fake-brevo] :${PORT} -> ${MAILPIT}`));
