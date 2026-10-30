import { afterEach, describe, expect, it, vi } from 'vitest';

async function load() {
  vi.resetModules();
  process.env.NEXT_PUBLIC_TELEMEDICINE_ADMIN_USE_MOCK = 'false';
  return import('./telemedicineAdminService');
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('listConsultations (live)', () => {
  it('sends filters and paging to the server and returns its total', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'a1', patient_id: '12345678-aaaa', doctor_id: 'd', doctor_name: 'Dr X', scheduled_at: 's', status: 'booked', fee_kobo: 500000, platform_fee_kobo: 0, total_kobo: 500000, created_at: 'c' }], total: 77 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const svc = await load();
    const page = await svc.listConsultations({ status: 'booked', search: ' dr x ', from: '2026-10-01', to: '2026-11-01', limit: 25, offset: 50 });
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://x');
    expect(url.pathname.endsWith('/telemedicine/admin/appointments')).toBe(true);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: '25', offset: '50', status: 'booked', search: 'dr x', from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z',
    });
    expect(page.total).toBe(77);
    expect(page.items[0].patient_masked).toBe('12345678…');
  });

  it('sends an entity-derived Idempotency-Key on cancel', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { status: 'cancelled', refunded: true } }) });
    vi.stubGlobal('fetch', fetchMock);
    const svc = await load();
    await svc.cancelConsultation('appt-1', 'patient asked');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('admin:telemed:appointment-cancel:appt-1');
    expect(JSON.parse(String(init.body))).toEqual({ reason: 'patient asked' });
  });
});
