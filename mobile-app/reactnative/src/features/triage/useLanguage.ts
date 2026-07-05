// Lightweight cross-screen language store (no backend, no extra deps).
// The profile/consent screen sets it; later screens read it. Falls back to 'en'.

import { useEffect, useState } from 'react';
import type { Language } from './types';

let current: Language = 'en';
const listeners = new Set<(l: Language) => void>();

export function getLanguage(): Language {
  return current;
}

export function setLanguageGlobal(lang: Language): void {
  current = lang;
  listeners.forEach((fn) => fn(lang));
}

/** Subscribe to the shared language. Returns [lang, setLang]. */
export function useLanguage(): [Language, (l: Language) => void] {
  const [lang, setLang] = useState<Language>(current);
  useEffect(() => {
    const fn = (l: Language) => setLang(l);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return [lang, setLanguageGlobal];
}
