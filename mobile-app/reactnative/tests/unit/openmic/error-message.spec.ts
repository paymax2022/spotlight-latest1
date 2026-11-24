/**
 * The phone has to say what the server said.
 *
 * A refused hand-in arrived on the artist's screen as
 * "Uploading song (mp3) failed: request failed with status code 400". The 400
 * itself was the server explaining itself — `app/api/open-mic/submissions/route.ts`
 * answers a refusal with `{ success: false, errors: { <field>: "a sentence" } }`
 * — but the message picker only looked for a top-level `error` or `message` key,
 * found neither, and fell through to axios's transport sentence. The artist read
 * a status code, which is not a thing they can act on.
 *
 * So: the server's own words, in the order a server actually writes them, and
 * the transport's words only when there were no server words at all.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fieldErrors, messageOf, serverMessageOf } from '@/features/openmic/error-body';

function httpError(status: number, data: unknown, transportMessage = 'Request failed with status code 400') {
  return { response: { status, data }, message: transportMessage } as unknown as unknown;
}

describe('the hand-in refusal the server actually sent', () => {
  it('reads the sentence out of `errors` when there is no top-level one', () => {
    const error = httpError(400, {
      success: false,
      errors: { duplicateApplication: 'You already have an active submission for this contest.' },
    });

    assert.equal(messageOf(error, 'Upload failed'), 'You already have an active submission for this contest.');
  });

  it('keeps a top-level sentence ahead of the field map', () => {
    const body = { error: 'Song submission is currently closed for this contest.', errors: { submissionWindow: 'closed' } };

    assert.equal(serverMessageOf(body), 'Song submission is currently closed for this contest.');
    assert.equal(messageOf(httpError(400, body), 'Upload failed'), 'Song submission is currently closed for this contest.');
  });

  it('takes the field sentences in the order the server sent them', () => {
    const body = { success: false, errors: { song: 'A song file is required.', declarations: 'Rights declarations are required.' } };

    assert.equal(serverMessageOf(body), 'A song file is required.');
    assert.deepEqual(Object.keys(fieldErrors(body)), ['song', 'declarations']);
  });

  it('falls back to the transport only when the server said nothing usable', () => {
    assert.equal(messageOf(httpError(400, { success: false, errors: {} }), 'Upload failed'), 'Request failed with status code 400');
    assert.equal(messageOf(httpError(500, null), 'Upload failed'), 'Request failed with status code 400');
    assert.equal(messageOf(new Error('Network Error'), 'Upload failed'), 'Network Error');
    assert.equal(messageOf({}, 'Upload failed'), 'Upload failed');
  });

  it('ignores a field map whose values are not sentences', () => {
    const body = { errors: { song: '   ', other: 7 } };

    assert.deepEqual(fieldErrors(body), {});
    assert.equal(serverMessageOf(body), null);
  });
});
