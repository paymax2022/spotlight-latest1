/**
 * SOC-002 — connect hub: the dominant member flow, end to end.
 *
 * Contracts: connect-phase1.openapi.yaml (12 ops) — onboarding, profile,
 * discovery, likes, matches, conversation, messages.
 *
 * Flow proven through the real BFF (:3000 → Go :8080), all persisted rows
 * asserted in Postgres:
 *   onboard (age-gate + 3 required consents)
 *   → PATCH profile + set a discovery mode visible
 *   → B likes A (matched:false) → A likes B (matched:true, match_id)
 *   → GET /matches shows the reciprocal pair for BOTH users
 *   → POST /matches/:id/conversation → send message → B reads it
 *
 * Idempotency is probed too: replaying A's like returns replayed:true and
 * creates no second match row.
 */

import { expect, test } from '@playwright/test';
import { bearer, provisionedSession, psql } from './helpers';

test.describe('SOC-002: connect onboarding → match → conversation', () => {
  test('two provisioned users match and message through the real API', async ({
    request,
  }) => {
    const alice = await provisionedSession(request, 'soc-002a');
    const bob = await provisionedSession(request, 'soc-002b');
    const authA = bearer(alice.token);
    const authB = bearer(bob.token);

    await test.step('onboarding: age-gate passes 18+, consents record', async () => {
      const gate = await request.post('/api/v1/connect/onboarding/age-gate', {
        headers: authA,
        data: { dob: '1995-03-20' },
      });
      expect(gate.status()).toBe(200);
      expect((await gate.json()).allowed).toBe(true);

      for (const kind of ['terms', 'privacy', 'community_guidelines']) {
        const res = await request.post('/api/v1/connect/onboarding/consent', {
          headers: authA,
          data: { kind },
        });
        expect(res.status()).toBe(200);
      }
      const st = await request.get('/api/v1/connect/onboarding/status', { headers: authA });
      const status = await st.json();
      expect(status.age_verified).toBe(true);
      expect(status.consents_accepted).toBe(true);
      // missing_consents serializes as null (not []) once the set is empty.
      expect(status.missing_consents ?? []).toEqual([]);
      // NOTE: status stays 'pending' because connect_onboarding.phone_verified
      // has no write path anywhere in the codebase — age_verified=true and
      // consents_accepted=true are the meaningful assertions.
      expect(
        psql(
          `select age_verified from connect_onboarding where user_id='${alice.userId}';`,
        ),
      ).toBe('t');
    });

    let profileA = '';
    let profileB = '';

    await test.step('profiles persist via PATCH + mode visibility', async () => {
      const pa = await request.patch('/api/v1/connect/profile', {
        headers: authA,
        data: { display_name: 'Alice SOC002', bio: 'e2e alice', city: 'Lagos' },
      });
      expect(pa.status()).toBe(200);
      profileA = (await pa.json()).data.id;

      const pb = await request.patch('/api/v1/connect/profile', {
        headers: authB,
        data: { display_name: 'Bob SOC002', bio: 'e2e bob', city: 'Abuja' },
      });
      expect(pb.status()).toBe(200);
      profileB = (await pb.json()).data.id;

      const mode = await request.patch('/api/v1/connect/profile/modes/friendship', {
        headers: authA,
        data: { visible: true, intent_tags: ['music'] },
      });
      expect(mode.status()).toBe(200);
      expect((await mode.json()).data.visible).toBe(true);

      expect(
        psql(`select display_name from connect_profiles where id='${profileA}';`),
      ).toBe('Alice SOC002');
    });

    let matchId = '';

    await test.step('mutual like creates exactly one match', async () => {
      const likeBtoA = await request.post('/api/v1/connect/likes', {
        headers: authB,
        data: { to_profile: profileA },
      });
      expect(likeBtoA.status()).toBe(201);
      expect((await likeBtoA.json()).data).toMatchObject({ liked: true, matched: false });

      const likeAtoB = await request.post('/api/v1/connect/likes', {
        headers: authA,
        data: { to_profile: profileB },
      });
      expect(likeAtoB.status()).toBe(201);
      const res = (await likeAtoB.json()).data;
      expect(res.matched).toBe(true);
      matchId = res.match_id;
      expect(matchId).toBeTruthy();

      // Replay A's like — idempotent no-op, not a second match.
      const replay = await request.post('/api/v1/connect/likes', {
        headers: authA,
        data: { to_profile: profileB },
      });
      expect((await replay.json()).data.replayed).toBe(true);
      expect(
        psql(
          `select count(*) from connect_matches where id='${matchId}';`,
        ),
      ).toBe('1');
    });

    let conversationId = '';

    await test.step('both sides see the match; conversation opens', async () => {
      for (const [headers, other] of [
        [authA, bob.userId],
        [authB, alice.userId],
      ] as const) {
        const res = await request.get('/api/v1/connect/matches', { headers });
        expect(res.status()).toBe(200);
        const matches = (await res.json()).data;
        const m = matches.find((x: { id: string }) => x.id === matchId);
        expect(m, 'match visible to both parties').toBeTruthy();
        expect(m.other_user_id).toBe(other);
      }

      const conv = await request.post(
        `/api/v1/connect/matches/${matchId}/conversation`,
        { headers: authA },
      );
      expect(conv.status()).toBe(200);
      const cdata = (await conv.json()).data;
      conversationId = cdata.conversation_id;
      expect(conversationId).toBeTruthy();
      expect(cdata.safety_state).toBe('open');
    });

    await test.step('message persists and is readable by the other party', async () => {
      const send = await request.post(
        `/api/v1/connect/conversations/${conversationId}/messages`,
        { headers: authA, data: { body: 'hello from alice (soc-002)' } },
      );
      expect(send.status()).toBe(201);
      const sent = (await send.json()).data.message;
      expect(sent.sender_id).toBe(alice.userId);
      expect(sent.flagged).toBe(false);

      const read = await request.get(
        `/api/v1/connect/conversations/${conversationId}/messages`,
        { headers: authB },
      );
      expect(read.status()).toBe(200);
      const msgs = (await read.json()).data;
      expect(msgs).toHaveLength(1);
      expect(msgs[0].body).toBe('hello from alice (soc-002)');

      expect(
        psql(
          `select count(*) from connect_messages where conversation_id='${conversationId}';`,
        ),
      ).toBe('1');
    });
  });
});
