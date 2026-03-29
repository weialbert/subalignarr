import { Cue } from '../../shared/types.js';

const TIMESTAMP_PATTERN = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/;

function parseTimestamp(value: string): number {
  const match = value.trim().match(TIMESTAMP_PATTERN);
  if (!match) {
    throw new Error(`Invalid SRT timestamp: ${value}`);
  }

  const [, hours, minutes, seconds, milliseconds] = match;

  return (
    Number(hours) * 60 * 60 * 1000 +
    Number(minutes) * 60 * 1000 +
    Number(seconds) * 1000 +
    Number(milliseconds)
  );
}

function formatTimestamp(value: number): string {
  const safe = Math.max(0, Math.floor(value));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const milliseconds = safe % 1_000;

  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':') + `,${String(milliseconds).padStart(3, '0')}`;
}

export function parseSrt(input: string): Cue[] {
  const normalized = input.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const blocks = normalized.split(/\n{2,}/);

  return blocks.map((block, blockIndex) => {
    const lines = block.split('\n');
    let cursor = 0;

    if (/^\d+$/.test(lines[0]?.trim() ?? '')) {
      cursor = 1;
    }

    const timing = lines[cursor];
    if (!timing) {
      throw new Error(`Missing timing line in cue block ${blockIndex + 1}`);
    }

    const [startText, endText] = timing.split(/\s+-->\s+/);
    if (!startText || !endText) {
      throw new Error(`Invalid timing line in cue block ${blockIndex + 1}`);
    }

    const text = lines.slice(cursor + 1).join('\n').trimEnd();

    return {
      index: blockIndex + 1,
      startMs: parseTimestamp(startText),
      endMs: parseTimestamp(endText),
      text
    };
  });
}

export function serializeSrt(cues: Cue[]): string {
  return cues
    .map((cue, index) => {
      return [
        String(index + 1),
        `${formatTimestamp(cue.startMs)} --> ${formatTimestamp(cue.endMs)}`,
        cue.text.trimEnd()
      ].join('\n');
    })
    .join('\n\n') + '\n';
}
