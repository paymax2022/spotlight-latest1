'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { hasAnyPermission, type AuthUser } from '@/features/auth/rbac';

// Permission keys for the delivery-fee admin module (kept here + in routeGuard).
export const DELIVERY_FEE_PERMS = {
  pricing: ['restaurant.admin.pricing'],
};

// Reads the cached admin user (same source as AdminSidebar / route guard) and
// exposes a permission check so the page can disable the Save affordance.
// Server still enforces — this only prevents dead-end UI. Mirrors
// useMobilityPermissions / useNutritionPermissions.
export function useDeliveryFeePermissions() {
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('spotlight_admin_user');
      if (raw) setUser(JSON.parse(raw) as AuthUser);
    } catch {
      /* unauthenticated handled by route guard */
    }
  }, []);
  const can = (perms: string[]) => hasAnyPermission(user, perms);
  return { user, can };
}

// ── Shared dark-theme inline styles (matches app/admin/nutrition) ────────────
export const card: CSSProperties = { border: '1px solid #2a2a2a', padding: 14, borderRadius: 6 };
export const input: CSSProperties = {
  background: '#111',
  color: '#eee',
  border: '1px solid #2a2a2a',
  padding: '4px 6px',
  borderRadius: 4,
  width: '100%',
};
export const sectionTitle: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  opacity: 0.9,
  margin: '0 0 8px',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};
export const helper: CSSProperties = { fontSize: 11, opacity: 0.55 };

// A labelled number field. When `isKobo` is set, shows a ₦ helper (kobo/100).
export function NumberField({
  label,
  value,
  onChange,
  isKobo,
  step,
  min,
  max,
  hint,
  invalid,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  isKobo?: boolean;
  step?: number;
  min?: number;
  max?: number;
  hint?: string;
  invalid?: boolean;
}) {
  return (
    <label style={{ fontSize: 12, display: 'block' }}>
      <span style={{ opacity: 0.85 }}>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step ?? (isKobo ? 100 : 1)}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ...input, borderColor: invalid ? '#b91c1c' : '#2a2a2a' }}
      />
      <span style={helper}>
        {isKobo ? `= ₦${(value / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}` : ''}
        {isKobo && hint ? ' · ' : ''}
        {hint ?? ''}
      </span>
    </label>
  );
}

// A section card wrapping a grid of fields.
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ ...card, marginTop: 12 }}>
      <p style={sectionTitle}>{title}</p>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
        {children}
      </div>
    </div>
  );
}
