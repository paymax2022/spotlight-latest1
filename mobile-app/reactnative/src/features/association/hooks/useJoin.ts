// ── Association — Join-variants hooks (B) ─────────────────────────────────────

import { useMutation } from '@tanstack/react-query';
import { validateCode } from '../api/join.api';
import type { CodeKind } from '../types/join.types';

export function useValidateCode(kind: CodeKind) {
  return useMutation({ mutationFn: (code: string) => validateCode(kind, code) });
}
