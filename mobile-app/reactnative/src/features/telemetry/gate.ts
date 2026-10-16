/** Telemetry emits only when the flag is exactly 'true' AND a user is signed in. */
export function shouldEmit(flag: string | undefined, user: unknown): boolean {
  return flag === 'true' && !!user;
}
