#!/usr/bin/env node
/**
 * Webhook-only reverse proxy, for putting a provider callback endpoint behind a
 * public tunnel WITHOUT exposing the rest of the backend.
 *
 * WHY THIS EXISTS
 * A tunnel forwards a whole port. Pointing one at :8091 would publish the entire
 * Go API — /api/finance/*, /api/insurance/admin/*, every auth-gated route — to
 * the public internet from a developer's laptop. Those routes are authenticated,
 * but "authenticated" is a much weaker promise than "unreachable", and the dev
 * fixture password is documented in this repo.
 *
 * So the tunnel points here instead. This forwards exactly one path prefix and
 * refuses everything else, which keeps the blast radius to the one endpoint that
 * is designed to be public: a provider callback that verifies an HMAC signature
 * and fails closed without it.
 *
 *   node scripts/dev/webhook-tunnel-proxy.js [--port 8099] [--target http://localhost:8091]
 *
 * Then tunnel THIS port:
 *   cloudflared tunnel --url http://localhost:8099
 *
 * Nothing here weakens verification: the body is streamed through byte-for-byte,
 * because the signature is computed over the RAW bytes and re-serialising the
 * JSON would change them and break every signature.
 */
const http = require('node:http');

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const PORT = Number(argOf('--port', '8099'));
const TARGET = new URL(argOf('--target', 'http://localhost:8091'));
const ALLOWED_PREFIX = '/internal/webhooks/';

const server = http.createServer((req, res) => {
  const deny = (code, msg) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: msg }));
    console.log(`[proxy] ${code} ${req.method} ${req.url}`);
  };

  // Only provider callbacks. Everything else is not merely unrouted here — it is
  // deliberately refused, so a scan of the tunnel finds one endpoint.
  if (!req.url || !req.url.startsWith(ALLOWED_PREFIX)) return deny(404, 'not found');
  if (req.method !== 'POST') return deny(405, 'method not allowed');

  const upstream = http.request(
    {
      hostname: TARGET.hostname,
      port: TARGET.port || 80,
      path: req.url,
      method: 'POST',
      headers: {
        // Forward the headers the handler needs and nothing else. The signature
        // header is the one that matters; host is rewritten so the backend does
        // not see the tunnel hostname.
        'content-type': req.headers['content-type'] || 'application/json',
        'content-length': req.headers['content-length'],
        'x-mycoverai-signature': req.headers['x-mycoverai-signature'] || '',
        'x-signature': req.headers['x-signature'] || '',
        'x-webhook-signature': req.headers['x-webhook-signature'] || '',
        host: `${TARGET.hostname}:${TARGET.port}`,
      },
    },
    (up) => {
      console.log(`[proxy] ${up.statusCode} ${req.method} ${req.url}`);
      res.writeHead(up.statusCode || 502, { 'content-type': 'application/json' });
      up.pipe(res);
    },
  );

  upstream.on('error', (err) => {
    console.error(`[proxy] upstream error: ${err.message}`);
    if (!res.headersSent) deny(502, 'upstream unavailable');
  });

  // Stream the raw body straight through — never buffer-and-re-serialise, or the
  // HMAC over the original bytes will not match.
  req.pipe(upstream);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[proxy] listening on http://127.0.0.1:${PORT}`);
  console.log(`[proxy] forwarding POST ${ALLOWED_PREFIX}* -> ${TARGET.origin}`);
  console.log('[proxy] everything else is refused');
});
