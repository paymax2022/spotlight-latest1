/** Telemetry emits only when the flag is exactly 'true' AND a user is signed in. */
export function shouldEmit(flagValue: string | undefined, hasUser: unknown): boolean {
  return flagValue === 'true' && !!hasUser;
}
