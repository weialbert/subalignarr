import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOffset } from './alignment.js';
import { parseSrt, serializeSrt } from './srt.js';

test('parseSrt reads multiline cues', () => {
  const input = `1
00:00:01,000 --> 00:00:02,500
First line
Second line

2
00:00:05,000 --> 00:00:06,000
Third line
`;

  const cues = parseSrt(input);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, 'First line\nSecond line');
  assert.equal(cues[1].startMs, 5000);
});

test('applyOffset clamps negative cue starts', () => {
  const cues = applyOffset(
    [
      {
        index: 1,
        startMs: 100,
        endMs: 500,
        text: 'hello'
      }
    ],
    -500
  );

  assert.equal(cues[0].startMs, 0);
  assert.equal(cues[0].endMs, 0);
});

test('serializeSrt writes sequential cue numbers', () => {
  const output = serializeSrt([
    {
      index: 99,
      startMs: 1000,
      endMs: 2000,
      text: 'Hello'
    }
  ]);

  assert.match(output, /^1\n00:00:01,000 --> 00:00:02,000\nHello\n$/);
});
