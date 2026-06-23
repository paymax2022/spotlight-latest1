type SupabaseResult<T = unknown> = {
  data: T;
  error: { message: string } | null;
  count?: number;
};

class QueryBuilder<T = unknown> implements PromiseLike<SupabaseResult<T>> {
  private readonly result: SupabaseResult<T>;

  constructor(result: SupabaseResult<T>) {
    this.result = result;
  }

  select(..._args: unknown[]) { return this; }
  insert(..._args: unknown[]) { return this; }
  update(..._args: unknown[]) { return this; }
  upsert(..._args: unknown[]) { return this; }
  delete(..._args: unknown[]) { return this; }
  eq(..._args: unknown[]) { return this; }
  neq(..._args: unknown[]) { return this; }
  gt(..._args: unknown[]) { return this; }
  gte(..._args: unknown[]) { return this; }
  lt(..._args: unknown[]) { return this; }
  lte(..._args: unknown[]) { return this; }
  like(..._args: unknown[]) { return this; }
  ilike(..._args: unknown[]) { return this; }
  in(..._args: unknown[]) { return this; }
  contains(..._args: unknown[]) { return this; }
  is(..._args: unknown[]) { return this; }
  order(..._args: unknown[]) { return this; }
  or(..._args: unknown[]) { return this; }
  range(..._args: unknown[]) { return this; }
  limit(..._args: unknown[]) { return this; }
  maybeSingle() { return new QueryBuilder<null>({ data: null, error: null }); }
  single() { return new QueryBuilder<null>({ data: null, error: null }); }

  then<TResult1 = SupabaseResult<T>, TResult2 = never>(
    onfulfilled?: ((value: SupabaseResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

export function createFallbackSupabaseClient() {
  return {
    auth: {
      async getUser() {
        return { data: { user: null }, error: null };
      },
      async getSession() {
        return { data: { session: null }, error: null };
      },
      async signInWithPassword(_credentials?: unknown) {
        return { data: { session: null, user: null }, error: null };
      },
      async signUp(_payload?: unknown) {
        return { data: { session: null, user: null }, error: null };
      },
      async signOut() {
        return { error: null };
      },
      onAuthStateChange(
        _callback?: (event: string, session: null) => void
      ) {
        return {
          data: {
            subscription: {
              unsubscribe() {},
            },
          },
        };
      },
    },
    from(_table?: string) {
      return new QueryBuilder<unknown[]>({ data: [], error: null });
    },
    rpc(_fn?: string, _params?: Record<string, unknown>) {
      return new QueryBuilder<unknown>({ data: null, error: null });
    },
    storage: {
      from() {
        return {
          async upload() {
            return { data: null, error: null };
          },
          async getPublicUrl(path: string) {
            return { data: { publicUrl: path }, error: null };
          },
        };
      },
    },
  };
}
