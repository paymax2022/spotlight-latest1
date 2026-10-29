// A well-formed but unknown verification code gets a branded 404 rather than the
// application's generic not-found page. `notFound()` in page.tsx sets the status.

import type { CSSProperties } from 'react';

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  background: '#FAF7F0',
  color: '#1E1B16',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  padding: '48px 16px',
};

const cardStyle: CSSProperties = {
  maxWidth: 560,
  margin: '0 auto',
  background: '#FFFFFF',
  border: '1px solid #E4DCCB',
  borderRadius: 16,
  padding: 32,
  textAlign: 'center',
  boxShadow: '0 18px 50px rgba(30, 27, 22, 0.08)',
};

export default function CertificateNotFound() {
  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <p style={{ margin: '0 0 20px', fontSize: 11, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: '#B88A2E', fontWeight: 700 }}>
          Spotlight Film Academy
        </p>
        <h1 style={{ margin: 0, fontSize: 26 }}>No credential matches that code</h1>
        <p style={{ marginTop: 16, color: '#6B655C', lineHeight: 1.6 }}>
          Check the verification code or certificate number printed on the certificate and try
          again. A revoked credential is still resolvable — it shows as revoked, not missing.
        </p>
        <p style={{ marginTop: 24 }}>
          <a href="https://www.spotlightng.com" style={{ color: '#B88A2E' }}>Return to Spotlight</a>
        </p>
      </div>
    </main>
  );
}
