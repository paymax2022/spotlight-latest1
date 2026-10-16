// Web fallback: there is no video stage off-device.
import type { StageTrack } from './types';

export function LiveStage(_props: { stage: StageTrack | null }): null {
  return null;
}
