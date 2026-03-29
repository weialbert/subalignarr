import { Cue, CuePreview } from '../../shared/types.js';

export function applyOffset(cues: Cue[], offsetMs: number): Cue[] {
  return cues.map((cue) => {
    const startMs = Math.max(0, cue.startMs + offsetMs);
    const endMs = Math.max(startMs, cue.endMs + offsetMs);

    return {
      ...cue,
      startMs,
      endMs
    };
  });
}

export function getCuePreview(cues: Cue[], timeMs: number): CuePreview {
  let previousCue: Cue | null = null;
  let activeCue: Cue | null = null;
  let nextCue: Cue | null = null;

  for (const cue of cues) {
    if (cue.endMs < timeMs) {
      previousCue = cue;
      continue;
    }

    if (cue.startMs <= timeMs && cue.endMs >= timeMs) {
      activeCue = cue;
      continue;
    }

    if (cue.startMs > timeMs) {
      nextCue = cue;
      break;
    }
  }

  return { previousCue, activeCue, nextCue };
}
