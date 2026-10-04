/**
 * HLT-005 — AI Care support sessions (aicare).
 *
 * FEATURE_AICARE_ENABLED=true mounts /api/finance/support/* on the finance
 * member group. Journey: create session → send message (deterministic stub
 * provider locally — no Anthropic key) → history → escalate → resolve.
 * Object-level authZ: a second user can never read/post into the session.
 */

import { expect, test } from '@playwright/test';

import { goFetch, goTrueToken, provisionVerifiedUser } from './helpers';

test.describe('HLT-005 aicare support sessions', () => {
  test('session → message → history → escalate → resolve (owner-scoped)', async ({ request }) => {
    const user = await provisionVerifiedUser(request, 'hlt005');
    const token = await goTrueToken(request, user.email, user.password);

    const sess = await goFetch(request, '/api/finance/support/sessions', {
      method: 'POST',
      token,
      data: { topic: 'E2E billing question' },
    });
    expect(sess.status).toBe(201);
    const sessionId = (sess.body.id ?? sess.body.session?.id) as string;
    expect(sessionId).toBeTruthy();

    const msg = await goFetch(request, `/api/finance/support/sessions/${sessionId}/messages`, {
      method: 'POST',
      token,
      data: { content: 'Why was my wallet debited twice?' },
    });
    expect(msg.status).toBe(201);
    expect(msg.body.user_message ?? msg.body.userMessage).toBeTruthy();

    const history = await goFetch(request, `/api/finance/support/sessions/${sessionId}/messages`, { token });
    expect(history.status).toBe(200);
    const msgs = history.body.data ?? history.body.messages ?? [];
    expect(msgs.length).toBeGreaterThanOrEqual(1);

    const escalated = await goFetch(request, `/api/finance/support/sessions/${sessionId}/escalate`, {
      method: 'POST',
      token,
      data: { reason: 'needs human review' },
    });
    expect([200, 201]).toContain(escalated.status);

    const resolved = await goFetch(request, `/api/finance/support/sessions/${sessionId}/resolve`, {
      method: 'POST',
      token,
    });
    expect([200, 201]).toContain(resolved.status);
  });

  test('object-level authZ: a second user cannot read or post into the session', async ({ request }) => {
    const a = await provisionVerifiedUser(request, 'hlt005-a');
    const aToken = await goTrueToken(request, a.email, a.password);
    const b = await provisionVerifiedUser(request, 'hlt005-b');
    const bToken = await goTrueToken(request, b.email, b.password);

    const sess = await goFetch(request, '/api/finance/support/sessions', {
      method: 'POST',
      token: aToken,
      data: { topic: 'E2E private session' },
    });
    expect(sess.status).toBe(201);
    const sessionId = (sess.body.id ?? sess.body.session?.id) as string;

    const hist = await goFetch(request, `/api/finance/support/sessions/${sessionId}/messages`, { token: bToken });
    expect([400, 403, 404]).toContain(hist.status);
    const post = await goFetch(request, `/api/finance/support/sessions/${sessionId}/messages`, {
      method: 'POST',
      token: bToken,
      data: { content: 'intrusion probe' },
    });
    expect([400, 403, 404]).toContain(post.status);
  });
});
