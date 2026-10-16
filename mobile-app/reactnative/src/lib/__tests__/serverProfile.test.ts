// Pure-logic tests for the runtime Remote/Local server switch.
// The security property under test: a user-typeable HOST is the only thing that
// can ever reach a request URL, and it can only name a loopback / private-LAN /
// .local machine. Anything else would send the signed-in user's tokens to a
// host an attacker chose.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  isSwitchAvailable,
  validateLocalHost,
  applyHostToTemplate,
  buildLocalProfile,
  defaultLocalHost,
  parseStoredChoice,
  serializeLocalChoice,
  resolveActiveProfile,
  type LocalEnv,
} from '../serverProfile.ts';

const ENV: LocalEnv = {
  EXPO_PUBLIC_LOCAL_API_BASE_URL: 'http://localhost:3000',
  EXPO_PUBLIC_LOCAL_CONNECT_API_HOST: 'http://localhost:8091',
  EXPO_PUBLIC_LOCAL_SUPABASE_URL: 'http://localhost:54321',
  EXPO_PUBLIC_LOCAL_SUPABASE_ANON_KEY: 'local-anon-key',
};

describe('isSwitchAvailable', () => {
  test('available in development, staging and when unset', () => {
    assert.equal(isSwitchAvailable('development'), true);
    assert.equal(isSwitchAvailable('staging'), true);
    assert.equal(isSwitchAvailable(undefined), true);
    assert.equal(isSwitchAvailable(''), true);
  });
  test('never available in production (any spelling)', () => {
    assert.equal(isSwitchAvailable('production'), false);
    assert.equal(isSwitchAvailable('PRODUCTION'), false);
    assert.equal(isSwitchAvailable(' prod '), false);
  });
});

describe('validateLocalHost: accepts', () => {
  const ok = [
    'localhost',
    '127.0.0.1',
    '127.255.255.254',
    '10.0.2.2',
    '10.0.0.0',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '192.168.1.42',
    'macbook.local',
    'my-mac.local',
    'a.b.local',
    '::1',
  ];
  for (const h of ok) {
    test(h, () => {
      const r = validateLocalHost(h);
      assert.equal(r.ok, true, JSON.stringify(r));
      if (r.ok) assert.equal(r.host, h);
    });
  }
});

describe('validateLocalHost: rejects', () => {
  const bad: Array<[string, unknown]> = [
    ['empty', ''],
    ['space only', ' '],
    ['leading space', ' 192.168.1.5'],
    ['trailing space', '192.168.1.5 '],
    ['inner space', '192.168. 1.5'],
    ['tab', '192.168.1.5\t'],
    ['newline', '192.168.1.5\n'],
    ['scheme', 'http://192.168.1.5'],
    ['scheme only host', 'https://localhost'],
    ['path', '192.168.1.5/foo'],
    ['query', '192.168.1.5?x=1'],
    ['fragment', 'localhost#a'],
    ['userinfo @', 'user@192.168.1.5'],
    ['evil via @', 'localhost@evil.com'],
    ['evil via @ 2', '192.168.1.5@evil.com'],
    ['port', '192.168.1.5:3000'],
    ['port on localhost', 'localhost:3000'],
    ['bracketed v6', '[::1]'],
    ['v6 with port', '[::1]:3000'],
    ['other v6', '::2'],
    ['v6 public', '2001:db8::1'],
    ['uppercase localhost', 'LOCALHOST'],
    ['uppercase .local', 'Mac.LOCAL'],
    ['mixed case', 'Localhost'],
    ['backslash', 'localhost\\evil.com'],
    ['underscore', 'my_mac.local'],
    ['unicode', 'mäc.local'],
    ['public ip', '8.8.8.8'],
    ['public ip near private', '172.32.0.1'],
    ['public ip near private 2', '172.15.0.1'],
    ['public 11.x', '11.0.0.1'],
    ['public 192.169', '192.169.0.1'],
    ['public 192.167', '192.167.0.1'],
    ['link-local', '169.254.169.254'],
    ['unspecified', '0.0.0.0'],
    ['broadcast', '255.255.255.255'],
    ['CGNAT', '100.64.0.1'],
    ['public hostname', 'evil.com'],
    ['public hostname with local inside', 'local.evil.com'],
    ['localhost as subdomain of public', 'localhost.evil.com'],
    ['.local lookalike', 'evil.local.com'],
    ['bare local', 'local'],
    ['dot local', '.local'],
    ['hex ip', '0x7f.0.0.1'],
    ['hex ip 2', '0x7f.1'],
    ['dword ip', '2130706433'],
    ['short ip', '127.1'],
    ['short ip 2', '127.0.1'],
    ['octal-ish leading zero', '010.0.0.1'],
    ['leading zero octet', '192.168.01.1'],
    ['leading zero 127', '127.0.0.01'],
    ['octet > 255', '10.0.0.256'],
    ['octet > 255 loop', '192.168.1.999'],
    ['5 octets', '10.0.0.1.1'],
    ['negative', '10.0.0.-1'],
    ['trailing dot', 'localhost.'],
    ['trailing dot ip', '192.168.1.5.'],
    ['trailing dot .local', 'mac.local.'],
    ['leading dot', '.localhost'],
    ['double dot', 'a..local'],
    ['label leading hyphen', '-a.local'],
    ['label trailing hyphen', 'a-.local'],
    ['NUL', 'localhost\u0000'],
    ['NUL mid', '192.168.1.5\u0000.evil.com'],
    ['zero width', 'local​host'],
    ['too long', `${'a'.repeat(250)}.local`],
    ['label too long', `${'a'.repeat(64)}.local`],
    ['null', null],
    ['undefined', undefined],
    ['number', 3232235777],
    ['object', {}],
  ];
  for (const [name, h] of bad) {
    test(name, () => {
      const r = validateLocalHost(h);
      assert.equal(r.ok, false, `expected reject: ${JSON.stringify(h)}`);
      if (!r.ok) assert.ok(r.reason.length > 0);
    });
  }

  test('exactly 253 chars ending .local is accepted only if labels are valid', () => {
    const label = 'a'.repeat(63);
    const host = `${label}.${label}.${label}.${'b'.repeat(55)}.local`; // 63*3+3+55+1+5=253
    assert.equal(host.length, 253);
    assert.equal(validateLocalHost(host).ok, true);
    assert.equal(validateLocalHost(`a${host}`).ok, false);
  });
});

describe('applyHostToTemplate', () => {
  test('replaces hostname, keeps scheme and port', () => {
    assert.equal(applyHostToTemplate('http://localhost:3000', '192.168.1.5'), 'http://192.168.1.5:3000');
    assert.equal(applyHostToTemplate('http://localhost:54321', '10.0.2.2'), 'http://10.0.2.2:54321');
    assert.equal(applyHostToTemplate('https://localhost:8443', 'mac.local'), 'https://mac.local:8443');
  });
  test('keeps a template without a port', () => {
    assert.equal(applyHostToTemplate('http://localhost', '192.168.1.5'), 'http://192.168.1.5');
  });
  test('keeps a path and drops nothing else', () => {
    assert.equal(applyHostToTemplate('http://localhost:3000/api', '10.0.2.2'), 'http://10.0.2.2:3000/api');
  });
  test('brackets an IPv6 host', () => {
    assert.equal(applyHostToTemplate('http://localhost:3000', '::1'), 'http://[::1]:3000');
  });
  test('handles an IPv6 template', () => {
    assert.equal(applyHostToTemplate('http://[::1]:3000', '192.168.1.5'), 'http://192.168.1.5:3000');
  });
  test('refuses an invalid host (defence in depth)', () => {
    assert.equal(applyHostToTemplate('http://localhost:3000', 'evil.com'), null);
    assert.equal(applyHostToTemplate('http://localhost:3000', 'a@evil.com'), null);
  });
  test('refuses a malformed or non-http template', () => {
    assert.equal(applyHostToTemplate('ftp://localhost:3000', '10.0.0.1'), null);
    assert.equal(applyHostToTemplate('localhost:3000', '10.0.0.1'), null);
    assert.equal(applyHostToTemplate('', '10.0.0.1'), null);
    assert.equal(applyHostToTemplate('http://user:pw@localhost:3000', '10.0.0.1'), null);
  });
});

describe('defaultLocalHost', () => {
  test('android defaults to the emulator alias', () => {
    assert.equal(defaultLocalHost('android', ENV), '10.0.2.2');
  });
  test('ios and web default to the template host', () => {
    assert.equal(defaultLocalHost('ios', ENV), 'localhost');
    assert.equal(defaultLocalHost('web', ENV), 'localhost');
  });
  test('uses the template host when it is not localhost', () => {
    const env = { ...ENV, EXPO_PUBLIC_LOCAL_API_BASE_URL: 'http://192.168.1.9:3000' };
    assert.equal(defaultLocalHost('ios', env), '192.168.1.9');
  });
  test('falls back to localhost with no template', () => {
    assert.equal(defaultLocalHost('web', {}), 'localhost');
  });
});

describe('buildLocalProfile', () => {
  test('builds all four values from templates + host', () => {
    const p = buildLocalProfile(ENV, '192.168.1.5');
    assert.equal(p.available, true);
    if (!p.available) return;
    assert.equal(p.host, '192.168.1.5');
    assert.equal(p.apiBase, 'http://192.168.1.5:3000');
    assert.equal(p.connectHost, 'http://192.168.1.5:8091');
    assert.equal(p.supabaseUrl, 'http://192.168.1.5:54321');
    assert.equal(p.supabaseAnonKey, 'local-anon-key');
  });
  test('uses the documented template defaults when only the anon key is set', () => {
    const p = buildLocalProfile({ EXPO_PUBLIC_LOCAL_SUPABASE_ANON_KEY: 'k' }, 'localhost');
    assert.equal(p.available, true);
    if (!p.available) return;
    assert.equal(p.apiBase, 'http://localhost:3000');
    assert.equal(p.connectHost, 'http://localhost:8091');
    assert.equal(p.supabaseUrl, 'http://localhost:54321');
  });
  test('Local is unavailable without an anon key', () => {
    for (const key of [undefined, '', '   ']) {
      const p = buildLocalProfile({ ...ENV, EXPO_PUBLIC_LOCAL_SUPABASE_ANON_KEY: key }, 'localhost');
      assert.equal(p.available, false);
      if (!p.available) assert.match(p.reason, /anon key|EXPO_PUBLIC_LOCAL_SUPABASE_ANON_KEY/);
    }
  });
  test('an invalid host makes the profile unavailable', () => {
    const p = buildLocalProfile(ENV, 'evil.com');
    assert.equal(p.available, false);
  });
  test('a malformed template makes the profile unavailable', () => {
    const p = buildLocalProfile({ ...ENV, EXPO_PUBLIC_LOCAL_API_BASE_URL: 'not a url' }, 'localhost');
    assert.equal(p.available, false);
  });
});

describe('parseStoredChoice / serializeLocalChoice', () => {
  test('round-trips a valid local choice', () => {
    const raw = serializeLocalChoice('192.168.1.5');
    assert.deepEqual(parseStoredChoice(raw), { mode: 'local', host: '192.168.1.5' });
  });
  test('malformed values parse to null', () => {
    for (const raw of [null, undefined, '', 'garbage', '{', '[]', '"local"', 'null', '123', '{"mode":"local"}', '{"mode":"wat","host":"localhost"}']) {
      assert.equal(parseStoredChoice(raw as string | null | undefined), null, String(raw));
    }
  });
  test('a tampered host parses to null', () => {
    assert.equal(parseStoredChoice('{"mode":"local","host":"evil.com"}'), null);
    assert.equal(parseStoredChoice('{"mode":"local","host":"https://evil.com"}'), null);
    assert.equal(parseStoredChoice('{"mode":"local","host":["localhost"]}'), null);
  });
  test('serializeLocalChoice refuses an invalid host', () => {
    assert.throws(() => serializeLocalChoice('evil.com'));
  });
});

describe('resolveActiveProfile', () => {
  const stored = serializeLocalChoice('192.168.1.5');

  test('nothing stored => remote', () => {
    assert.deepEqual(resolveActiveProfile({ appEnv: 'development', stored: null, env: ENV }), { mode: 'remote' });
  });
  test('valid stored local choice => local profile', () => {
    const r = resolveActiveProfile({ appEnv: 'development', stored, env: ENV });
    assert.equal(r.mode, 'local');
    if (r.mode === 'local') {
      assert.equal(r.profile.apiBase, 'http://192.168.1.5:3000');
      assert.equal(r.profile.supabaseAnonKey, 'local-anon-key');
    }
  });
  test('staging build honours it too', () => {
    assert.equal(resolveActiveProfile({ appEnv: 'staging', stored, env: ENV }).mode, 'local');
  });
  test('production IGNORES a stored override', () => {
    assert.deepEqual(resolveActiveProfile({ appEnv: 'production', stored, env: ENV }), { mode: 'remote' });
    assert.deepEqual(resolveActiveProfile({ appEnv: 'prod', stored, env: ENV }), { mode: 'remote' });
  });
  test('stored local but no anon key => remote', () => {
    const env = { ...ENV, EXPO_PUBLIC_LOCAL_SUPABASE_ANON_KEY: undefined };
    assert.deepEqual(resolveActiveProfile({ appEnv: 'development', stored, env }), { mode: 'remote' });
  });
  test('tampered or malformed stored values => remote', () => {
    for (const raw of ['{"mode":"local","host":"evil.com"}', 'garbage', '', '{"mode":"local","host":"8.8.8.8"}']) {
      assert.deepEqual(resolveActiveProfile({ appEnv: 'development', stored: raw, env: ENV }), { mode: 'remote' }, raw);
    }
  });
  test('no remote URL can ever come from the stored value', () => {
    const sneaky = JSON.stringify({
      mode: 'local',
      host: '192.168.1.5',
      apiBase: 'https://evil.example',
      connectHost: 'https://evil.example',
      supabaseUrl: 'https://evil.example',
      supabaseAnonKey: 'stolen',
    });
    const r = resolveActiveProfile({ appEnv: 'development', stored: sneaky, env: ENV });
    assert.equal(r.mode, 'local');
    if (r.mode === 'local') {
      for (const v of [r.profile.apiBase, r.profile.connectHost, r.profile.supabaseUrl]) {
        assert.match(v, /^http:\/\/192\.168\.1\.5:\d+$/);
      }
      assert.equal(r.profile.supabaseAnonKey, 'local-anon-key');
    }
  });
  test('android default host is used when asked', () => {
    const r = resolveActiveProfile({
      appEnv: 'development',
      stored: serializeLocalChoice(defaultLocalHost('android', ENV)),
      env: ENV,
    });
    assert.equal(r.mode === 'local' && r.profile.apiBase, 'http://10.0.2.2:3000');
  });
});
