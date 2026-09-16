// The parser that decides whether a lesson video plays INLINE or falls back to
// leaving the app. A URL shape it fails to recognise silently becomes a redirect,
// which is the behaviour being removed — so the shapes matter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { youtubeVideoId, youtubeEmbedUrl, youtubePlaylistId } from '@/features/filmAcademy/youtube';

const ID = 'wLfZL9PZI9k'; // a real id from the seeded curriculum

test('recognises every YouTube URL shape the curriculum actually stores', () => {
  for (const url of [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}`,
  ]) {
    assert.equal(youtubeVideoId(url), ID, `failed on ${url}`);
  }
});

test('survives the tracking noise real links carry', () => {
  // Search results and shares append parameters; a naive split on "v=" breaks.
  assert.equal(youtubeVideoId(`https://www.youtube.com/watch?v=${ID}&t=42s&pp=ygUQabc`), ID);
  assert.equal(youtubeVideoId(`https://youtu.be/${ID}?si=AbCdEf`), ID);
});

test('rejects non-YouTube and malformed URLs instead of guessing', () => {
  for (const bad of ['', 'not a url', 'https://vimeo.com/12345', 'https://example.com/watch?v=abc']) {
    assert.equal(youtubeVideoId(bad), null, `should reject ${bad}`);
  }
});

test('rejects an id of the wrong length rather than building a dead embed', () => {
  assert.equal(youtubeVideoId('https://www.youtube.com/watch?v=tooshort'), null);
  assert.equal(youtubeVideoId('https://youtu.be/waaaaaaytoolongforanid'), null);
});

test('builds an embed URL that keeps playback inside the app', () => {
  const embed = youtubeEmbedUrl(`https://www.youtube.com/watch?v=${ID}`);
  assert.ok(embed);
  assert.ok(embed!.includes(`/embed/${ID}`));
  // playsinline is what stops iOS handing the video to the system player.
  assert.ok(embed!.includes('playsinline=1'), 'playsinline missing — iOS would go full screen');
  // nocookie avoids setting tracking cookies for a learner who only reads.
  assert.ok(embed!.startsWith('https://www.youtube-nocookie.com/'));
});

test('embeds a playlist link as a playlist, not as a broken video', () => {
  const url = 'https://www.youtube.com/playlist?list=PLEzQZpmbzckWUQALEX8UlbyH2GtRLMrSd';
  assert.equal(youtubeVideoId(url), null);
  assert.ok(youtubePlaylistId(url));
  assert.ok(youtubeEmbedUrl(url)!.includes('videoseries?list='));
});

test('returns null for anything unembeddable so the caller can fall back', () => {
  assert.equal(youtubeEmbedUrl('https://example.com/a.pdf'), null);
});
