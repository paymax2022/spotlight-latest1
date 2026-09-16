// ── Vuexy UI kit ─────────────────────────────────────────────────────────────
// The single source of the Vuexy design tokens + presentational primitives for
// frontend-admin. Interactive primitives (Button/Input) render `.vx-*` classes
// defined in app/globals.css, so they get real hover/focus states; structural
// pieces (Page/Card/Badge/PageHeader) are inline. Import from '@/components/ui/vuexy'.
//
// Purely presentational — safe in server or client components; interactivity
// (onClick etc.) is supplied by the consumer.

import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode } from 'react';

// ── Tokens (mirror the CSS variables in app/globals.css) ─────────────────────
export const colors = {
  primary: '#7367f0',
  secondary: '#82868b',
  success: '#28c76f',
  warning: '#ff9f43',
  info: '#00cfe8',
  danger: '#ea5455',
  text: '#2f2b3d',
  muted: '#6f6b7d',
  border: '#ebe9f1',
  inputBorder: '#d8d6de',
  bg: '#f8f7fa',
  headBg: '#fafafc',
  card: '#ffffff',
} as const;

/** #rrggbb + alpha → rgba() string, for tinted backgrounds/badges. */
export function tint(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// ── Table cell style tokens (apply directly on <th>/<td>) ────────────────────
export const thCell: CSSProperties = {
  textAlign: 'left', padding: '11px 14px', fontSize: 11, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: 0.5, color: colors.muted,
  borderBottom: `1px solid ${colors.border}`, background: colors.headBg,
};
export const tdCell: CSSProperties = { padding: '11px 14px', fontSize: 13, borderBottom: `1px solid ${colors.border}`, color: colors.text };

export type ButtonVariant = 'primary' | 'outline' | 'danger' | 'secondary';

// ── Components ────────────────────────────────────────────────────────────────

/** Full-bleed light-bg page wrapper (offsets AdminShell's 24px main padding). */
export function Page({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ margin: -24, padding: 24, minHeight: '100%', ...style }}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>{title}</h1>
        {subtitle ? <p style={{ margin: '4px 0 0', color: colors.muted, fontSize: 13 }}>{subtitle}</p> : null}
      </div>
      {actions ? <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>{actions}</div> : null}
    </div>
  );
}

export function Card({ children, title, className, style }: { children: ReactNode; title?: string; className?: string; style?: CSSProperties }) {
  return (
    <section className={`vx-card${className ? ` ${className}` : ''}`} style={style}>
      {title ? <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: colors.text }}>{title}</h2> : null}
      {children}
    </section>
  );
}

export function Button({
  variant = 'outline', sm, className, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; sm?: boolean }) {
  const cls = ['vx-btn', `vx-btn--${variant}`, sm ? 'vx-btn--sm' : '', className ?? ''].filter(Boolean).join(' ');
  return <button {...rest} className={cls} />;
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={`vx-input${className ? ` ${className}` : ''}`} />;
}

export function Badge({ text, color = colors.primary }: { text: string; color?: string }) {
  return <span className="vx-badge" style={{ background: tint(color, 0.12), color }}>{text}</span>;
}
