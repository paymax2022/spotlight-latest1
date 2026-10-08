/**
 * Vitest setup — restore a working Web Storage implementation.
 *
 * Node >=22 ships an experimental global `localStorage` that resolves to
 * `undefined` unless `--localstorage-file` is passed (it prints an
 * ExperimentalWarning). That global shadows jsdom's own `window.localStorage`
 * in the vitest jsdom environment, so every spec touching
 * `localStorage` — admin session metadata, sidebar prefs — crashed with
 * "Cannot read properties of undefined (reading 'getItem')" on Node 26.
 * Install a plain in-memory Storage so specs get Web Storage semantics back.
 */

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    const k = String(key);
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(String(key));
  }

  setItem(key: string, value: string): void {
    this.map.set(String(key), String(value));
  }
}

function installStorage(name: 'localStorage' | 'sessionStorage'): void {
  const existing = (globalThis as Record<string, unknown>)[name];
  if (existing && typeof (existing as Storage).getItem === 'function') return;
  Object.defineProperty(globalThis, name, {
    value: new MemoryStorage(),
    writable: true,
    configurable: true,
  });
}

installStorage('localStorage');
installStorage('sessionStorage');
