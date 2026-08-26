// Proves the crowdfunding draft store survives a reload (the web-reload wipe
// that produced a bare 400 from POST /crowdfunding/campaigns), and that dead
// media URIs are not carried across.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// `@/` + extensionless, resolved by tests/unit/ts-path-hooks.mjs. A relative
// '…/draftPersistence.ts' works under --experimental-strip-types but fails the
// repo-wide mobile tsc lane with TS5097 (allowImportingTsExtensions is off).
import { persistableMedia } from '@/features/crowdfunding/store/draftPersistence';

// In-memory stand-in for AsyncStorage (which is localStorage on RN web).
const mem = new Map<string, string>();
const fakeStorage = {
  getItem: async (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: async (k: string, v: string) => { mem.set(k, v); },
  removeItem: async (k: string) => { mem.delete(k); },
};
const flush = () => new Promise((r) => setTimeout(r, 0));

test('draft round-trips through storage and strips blob: media URIs', async () => {
  const { create } = await import('zustand');
  const { persist, createJSONStorage } = await import('zustand/middleware');

  const emptyDraft = { type: null as string | null, category: null as string | null, title: '', goalKobo: 0, coverImageUri: null as string | null, videoUri: null as string | null, galleryUris: [] as string[] };

  const makeStore = () =>
    create<any>()(
      persist(
        (set: any) => ({
          draft: { ...emptyDraft },
          hasHydrated: false,
          patch: (p: any) => set((s: any) => ({ draft: { ...s.draft, ...p } })),
        }),
        {
          name: 'crowdfunding-campaign-draft',
          storage: createJSONStorage(() => fakeStorage as any),
          version: 1,
          partialize: (s: any) => ({ draft: persistableMedia(s.draft) }),
          merge: (persisted: any, current: any) => ({ ...current, draft: { ...emptyDraft, ...(persisted?.draft ?? {}) } }),
          onRehydrateStorage: () => (_s: any, _e: any) => {},
        },
      ),
    );

  // Session 1: user walks the wizard, picks a web (blob:) cover.
  const s1 = makeStore();
  await flush();
  s1.getState().patch({
    type: 'DONATION',
    category: 'community',
    title: 'Save the school',
    goalKobo: 500000,
    coverImageUri: 'blob:http://localhost:8083/abc-123',
    galleryUris: ['blob:http://localhost:8083/g1', 'https://cdn.example.com/g2.jpg'],
  });
  await flush();

  // Session 2: the reload that used to wipe everything.
  const s2 = makeStore();
  await flush();
  const d = s2.getState().draft;

  assert.equal(d.type, 'DONATION', 'type must survive the reload — null here is the 400');
  assert.equal(d.category, 'community');
  assert.equal(d.title, 'Save the school');
  assert.equal(d.goalKobo, 500000);

  // Dead blob: URIs must NOT come back; a real remote URL must.
  assert.equal(d.coverImageUri, null, 'blob: cover must be dropped, not restored broken');
  assert.deepEqual(d.galleryUris, ['https://cdn.example.com/g2.jpg']);
});
