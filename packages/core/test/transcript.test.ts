// Tests for the transcript digest. The fixture is a small synthetic transcript shaped like the
// ones Claude Code writes, with no real content: every string that must be dropped says so in
// capitals, which makes a leak obvious in a failure message.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTranscript, renderDigest } from '../src/index.ts';

const fixture = readFileSync(new URL('./fixtures/transcript.jsonl', import.meta.url), 'utf8');

describe('parseTranscript', () => {
  const digest = parseTranscript(fixture);

  test('counts every non-blank line, readable or not', () => {
    assert.equal(digest.lineCount, 25);
  });

  test('takes the first and the last timestamp', () => {
    assert.equal(digest.started, '2026-09-27T04:00:00.000Z');
    assert.equal(digest.lastActivity, '2026-09-27T04:01:10.000Z');
  });

  test('keeps prompts, replies, commands, edits and todos, and drops the machinery', () => {
    const text = JSON.stringify(digest.entries);
    assert.doesNotMatch(text, /MUST NOT APPEAR/);
    assert.doesNotMatch(text, /SECRET/);
    assert.doesNotMatch(text, /private reasoning/);
    assert.doesNotMatch(text, /ignore this reminder/);
    const prompts = digest.entries.filter((e) => e.kind === 'prompt').map((e) => e.text);
    assert.deepEqual(prompts, [
      'Add the release banner that tells people a new version is out.',
      'Now commit it please.',
    ]);
    assert.ok(digest.entries.some((e) => e.kind === 'reply' && /poll version.json/.test(e.text)));
    assert.ok(digest.entries.some((e) => e.kind === 'summary' && /banner was designed/.test(e.text)));
    const ran = digest.entries.filter((e) => e.kind === 'bash').map((e) => e.text);
    assert.deepEqual(ran, [
      'npm test',
      'ledge tick release-watch-banner 1',
      'git add -A ; git commit -m "feat: banner"',
    ]);
    assert.equal(digest.commands[2], 'git add -A\ngit commit -m "feat: banner"');
  });

  test('lists each edited file once, in the order first edited', () => {
    assert.deepEqual(digest.filesChanged, [
      '/home/user/code/demo-app/src/banner.ts',
      '/home/user/code/demo-app/scripts/write-version.mjs',
      '/elsewhere/analysis.ipynb',
    ]);
  });

  test('follows TaskCreate and TaskUpdate into the session todo list', () => {
    assert.deepEqual(digest.todos, [
      { text: 'Write version.json at build time', done: true },
      { text: 'Banner component in the shell', done: false },
    ]);
  });

  test('reads a TodoWrite list in its latest state', () => {
    const line = (todos: unknown) =>
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-09-27T04:00:00.000Z',
        message: { content: [{ type: 'tool_use', id: 't', name: 'TodoWrite', input: { todos } }] },
      });
    const text = [
      line([{ content: 'one', status: 'pending', activeForm: 'x' }]),
      line([
        { content: 'one', status: 'completed', activeForm: 'x' },
        { content: 'two', status: 'in_progress', activeForm: 'y' },
      ]),
    ].join('\n');
    assert.deepEqual(parseTranscript(text).todos, [
      { text: 'one', done: true },
      { text: 'two', done: false },
    ]);
  });

  test('an empty or unreadable transcript is an empty digest, not an error', () => {
    assert.equal(parseTranscript('').lineCount, 0);
    const junk = parseTranscript('not json\n[1,2]\n"x"\n');
    assert.equal(junk.lineCount, 3);
    assert.deepEqual(junk.entries, []);
  });
});

describe('renderDigest', () => {
  const digest = parseTranscript(fixture);

  test('prints the session in order with line labels and the todo list last', () => {
    const text = renderDigest(digest);
    assert.match(text, /\[L3 04:00\] PERSON: Add the release banner/);
    assert.match(text, /RAN: npm test/);
    assert.match(text, /EDITED: Edit \/home\/user\/code\/demo-app\/src\/banner\.ts/);
    assert.ok(text.indexOf('PERSON: Add') < text.indexOf('PERSON: Now commit'));
    assert.match(text, /LATEST STATE:\n- \[x\] Write version.json at build time\n- \[ \] Banner/);
  });

  test('marks where the material since the last capture begins', () => {
    const text = renderDigest(digest, { sinceLine: 20 });
    const marker = text.indexOf('--- NEW SINCE THE LAST CAPTURE ---');
    assert.ok(marker > 0);
    assert.ok(marker < text.indexOf('PERSON: Now commit'));
    assert.ok(marker > text.indexOf('PERSON: Add'));
    assert.match(renderDigest(digest, { sinceLine: 99 }), /LAST CAPTURE --- \(nothing\)/);
  });

  test('over budget, the oldest old material goes first and new material stays', () => {
    const text = renderDigest(digest, { sinceLine: 20, maxChars: 420 });
    assert.ok(text.length < 600, `rendered ${text.length} characters`);
    assert.match(text, /PERSON: Now commit/);
    assert.doesNotMatch(text, /PERSON: Add the release banner/);
    assert.match(text, /older entries left out/);
  });
});
