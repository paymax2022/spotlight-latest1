// Test-only stand-in for '@/api/client'. The real client wires axios to
// Supabase auth + expo-router, none of which resolve under plain `node --test`
// (see tests/unit/pharmacy/pharmacy-test-hooks.mjs, which redirects the
// '@/api/client' specifier here for this suite only). Handlers are set per
// test via __setPost/__setGet; calls are recorded so a test can assert on the
// request body/headers actually sent.

type Call = { method: 'get' | 'post'; url: string; body?: unknown; config?: Record<string, unknown> };

let postImpl: (url: string, body?: unknown, config?: Record<string, unknown>) => unknown = () => {
  throw new Error('stub-api-client: no post handler configured — call __setPost first');
};
let getImpl: (url: string, config?: Record<string, unknown>) => unknown = () => {
  throw new Error('stub-api-client: no get handler configured — call __setGet first');
};

const calls: Call[] = [];

export function __setPost(fn: typeof postImpl): void {
  postImpl = fn;
}
export function __setGet(fn: typeof getImpl): void {
  getImpl = fn;
}
export function __calls(): Call[] {
  return calls;
}
export function __reset(): void {
  calls.length = 0;
  postImpl = () => {
    throw new Error('stub-api-client: no post handler configured — call __setPost first');
  };
  getImpl = () => {
    throw new Error('stub-api-client: no get handler configured — call __setGet first');
  };
}

export const api = {
  post: async (url: string, body?: unknown, config?: Record<string, unknown>) => {
    calls.push({ method: 'post', url, body, config });
    return { data: postImpl(url, body, config) };
  },
  get: async (url: string, config?: Record<string, unknown>) => {
    calls.push({ method: 'get', url, config });
    return { data: getImpl(url, config) };
  },
};
