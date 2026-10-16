// Which participant's camera fills the stage. Pure so the rule is tested: a participant who is
// allowed to publish (the host) always wins, so a learner whose permissions are ever widened
// cannot take over the screen by turning a camera on.

export interface StageCandidate {
  identity: string;
  hasCamera: boolean;
  canPublish: boolean;
}

export function selectStageIdentity(candidates: StageCandidate[], selfIdentity: string): string | null {
  const remote = candidates.filter((c) => c.identity !== selfIdentity && c.hasCamera);
  const host = remote.find((c) => c.canPublish);
  if (host) return host.identity;
  if (remote.length > 0) return remote[0].identity;
  const me = candidates.find((c) => c.identity === selfIdentity && c.hasCamera);
  return me ? me.identity : null;
}
