// URL rules the phone depends on: what is already absolute, where an origin
// comes from, and the one query flag that decides whether the beat reader hands
// back a player or a file.
//
// These are the rules that were previously asserted nowhere and shipped wrong
// twice — a stored `/api/...` path pasted straight into a player, and a download
// URL handed to `<audio>` so that pressing play saved the beat instead.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  absolutise,
  isAbsoluteUrl,
  isPlayableHttpUrl,
  originOf,
  withDownloadFlag,
  withoutDownloadFlag,
} from '@/features/openmic/absolute-url';

describe('isAbsoluteUrl', () => {
  it('accepts any scheme-prefixed address and rejects paths', () => {
    assert.equal(isAbsoluteUrl('https://cdn.example.com/a.mp3'), true);
    assert.equal(isAbsoluteUrl('HTTP://host/a.mp3'), true);
    assert.equal(isAbsoluteUrl('/api/open-mic/songs/1'), false);
    assert.equal(isAbsoluteUrl('api/open-mic/songs/1'), false);
    assert.equal(isAbsoluteUrl(''), false);
    assert.equal(isAbsoluteUrl(null), false);
    assert.equal(isAbsoluteUrl(undefined), false);
  });
});

describe('originOf', () => {
  it('keeps scheme, host and port and drops the rest', () => {
    assert.equal(originOf('https://host:3000/deep/path?x=1#frag'), 'https://host:3000');
    assert.equal(originOf('http://localhost:3000'), 'http://localhost:3000');
  });

  it('wraps a bare host:port in https so a mis-set env var fails loudly', () => {
    assert.equal(originOf('192.168.1.9:3000'), 'https://192.168.1.9:3000');
    assert.equal(originOf('192.168.1.9:3000/'), 'https://192.168.1.9:3000');
  });

  it('returns empty for nothing', () => {
    assert.equal(originOf(''), '');
    assert.equal(originOf(null), '');
  });
});

describe('absolutise', () => {
  it('passes an absolute address through untouched', () => {
    assert.equal(absolutise('https://other.host', 'https://cdn.example.com/a.mp3'), 'https://cdn.example.com/a.mp3');
  });

  it('glues the origin onto a root-relative path', () => {
    assert.equal(absolutise('http://10.0.2.2:3000', '/api/open-mic/songs/9'), 'http://10.0.2.2:3000/api/open-mic/songs/9');
  });

  it('glues the origin onto a bare relative path too', () => {
    assert.equal(absolutise('http://host:3000', 'api/open-mic/x'), 'http://host:3000/api/open-mic/x');
  });

  it('never duplicates a trailing or leading separator', () => {
    assert.equal(absolutise('http://host:3000/', '/api/a'), 'http://host:3000/api/a');
    assert.equal(absolutise('http://host:3000///', '/api/a'), 'http://host:3000/api/a');
  });

  it('hands a relative path back unchanged when there is no origin', () => {
    // The web build resolves it against its own document, and a caller that
    // already knows the origin passes one; dropping it here would hide the link.
    assert.equal(absolutise('', '/api/open-mic/songs/9'), '/api/open-mic/songs/9');
    assert.equal(absolutise(null, '/api/a'), '/api/a');
  });

  it('turns empty and null into null so a caller can render "nothing to play"', () => {
    assert.equal(absolutise('http://host:3000', ''), null);
    assert.equal(absolutise('http://host:3000', null), null);
    assert.equal(absolutise('http://host:3000', '   '), null);
  });
});

describe('isPlayableHttpUrl', () => {
  it('is an allowlist: only http(s) reaches a player or a download', () => {
    assert.equal(isPlayableHttpUrl('https://host/a.mp3'), true);
    assert.equal(isPlayableHttpUrl('HTTP://host/a.mp3'), true);
    assert.equal(isPlayableHttpUrl('javascript:alert(1)'), false);
    assert.equal(isPlayableHttpUrl('file:///sdcard/a.mp3'), false);
    assert.equal(isPlayableHttpUrl('/api/open-mic/songs/9'), false);
    assert.equal(isPlayableHttpUrl(''), false);
    assert.equal(isPlayableHttpUrl(undefined), false);
  });
});

describe('withDownloadFlag', () => {
  it('appends the flag with the correct separator', () => {
    assert.equal(withDownloadFlag('http://h/api/beats/k'), 'http://h/api/beats/k?download=1');
    assert.equal(withDownloadFlag('http://h/api/beats/k?x=1'), 'http://h/api/beats/k?x=1&download=1');
  });

  it('is idempotent, including when the flag is already mid-query', () => {
    assert.equal(withDownloadFlag('http://h/a?download=1'), 'http://h/a?download=1');
    assert.equal(withDownloadFlag('http://h/a?download=1&x=1'), 'http://h/a?download=1&x=1');
    assert.equal(withDownloadFlag('http://h/a?x=1&download=1'), 'http://h/a?x=1&download=1');
  });

  it('leaves an empty value empty', () => {
    assert.equal(withDownloadFlag(''), '');
  });

  it('does not mistake a different parameter for the flag', () => {
    assert.equal(withDownloadFlag('http://h/a?download=0'), 'http://h/a?download=0&download=1');
    assert.equal(withDownloadFlag('http://h/a?xdownload=1'), 'http://h/a?xdownload=1&download=1');
  });
});

describe('withoutDownloadFlag', () => {
  it('removes the flag from either end of a query', () => {
    assert.equal(withoutDownloadFlag('http://h/a?download=1'), 'http://h/a');
    assert.equal(withoutDownloadFlag('http://h/a?download=1&x=1'), 'http://h/a?x=1');
  });

  it('removes a mid-query flag without leaving a dangling separator', () => {
    const out = withoutDownloadFlag('http://h/a?x=1&download=1&y=2');
    assert.equal(out, 'http://h/a?x=1&y=2');
    assert.ok(!out.includes('&&'), out);
    assert.ok(!out.endsWith('?'), out);
  });

  it('leaves an untouched URL byte-for-byte when there is no flag', () => {
    assert.equal(withoutDownloadFlag('http://h/a?x=1'), 'http://h/a?x=1');
    assert.equal(withoutDownloadFlag('http://h/a'), 'http://h/a');
    assert.equal(withoutDownloadFlag(''), '');
  });

  it('returns an unparsable value rather than editing something it cannot read', () => {
    assert.equal(withoutDownloadFlag('not a url?download=1'), 'not a url?download=1');
  });

  it('round-trips: strip after add leaves a playable address', () => {
    const saved = withDownloadFlag('http://h/api/beats/k');
    assert.equal(withoutDownloadFlag(saved), 'http://h/api/beats/k');
  });
});
