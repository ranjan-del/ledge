// Tests for the capture commands: capture, track, sessions over session records, and brief.
// Every run uses a fresh LEDGE_HOME and a fake provider; the transcript is the sanitised core
// fixture copied into a temporary folder, so nothing here reads a real session.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { addTask, coreKind, fakeProvider, failingProvider, initHome, removeHome, run } from './helpers.ts';

const SESSION = 'b13e8b5e-4c2a-4f1e-9d3b-7a1c2e5f8a90';
const fixture = new URL('../../core/test/fixtures/transcript.jsonl', import.meta.url);

describe('capture, track, sessions and brief', { skip: coreKind === 'fake' }, () => {
  let home: string;
  let transcript: string;
  beforeEach(async () => {
    home = await initHome();
    transcript = join(home, 'transcript.jsonl');
    writeFileSync(transcript, readFileSync(fixture, 'utf8').replaceAll('/home/user/code/demo-app', home));
  });
  afterEach(() => removeHome(home));

  function answer(taskId: string | null, extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
      taskId,
      checklistAdd: [],
      checklistTick: [],
      session: { title: 'Wire the release banner', summary: 'Built the banner.' },
      ...extra,
    });
  }

  test('capture needs a session and a transcript', async () => {
    const r = await run(['capture', '--session', SESSION]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /capture needs --transcript/);
    assert.equal((await run(['capture'])).code, 1);
  });

  test('capture attributes the session, links it and prints one line', async () => {
    const id = await addTask('Release banner', '--repo', home);
    const provider = fakeProvider(answer(id, { note: { title: 'T', summary: 'S', body: 'Polled.' } }));
    const r = await run(
      ['capture', '--session', SESSION, '--transcript', transcript, '--cwd', home],
      home,
      provider,
    );
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, `Capture captured (${id}): first capture\n`);
    assert.equal(provider.prompts.length, 1);
    const task = JSON.parse((await run(['current', '--repo', home, '--json'])).stdout);
    assert.deepEqual(task.sessions, [SESSION]);
    assert.match(task.notes[0].body, /Polled\./);
    assert.ok(existsSync(join(home, 'sessions', `${SESSION}.json`)));
    assert.ok(existsSync(join(home, 'insights', `${id}.json`)));
    assert.match(readFileSync(join(home, 'capture.log'), 'utf8'), / captured session=/);
    // The weekly to-do list is only ever written when someone asks: a capture never adds to it.
    assert.equal(existsSync(join(home, 'weeks')), false, 'the capture wrote no week file');

    const again = await run(
      ['capture', '--session', SESSION, '--transcript', transcript, '--cwd', home, '--json'],
      home,
      provider,
    );
    assert.equal(JSON.parse(again.stdout).status, 'skipped');
    assert.equal(provider.prompts.length, 1, 'the debounce saved a model call');
  });

  test('capture writes nothing and still exits 0 when the model fails', async () => {
    await addTask('Release banner', '--repo', home);
    const r = await run(
      ['capture', '--session', SESSION, '--transcript', transcript, '--cwd', home],
      home,
      failingProvider('overloaded'),
    );
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^Capture failed: model call failed: overloaded/);
    assert.equal(existsSync(join(home, 'sessions', `${SESSION}.json`)), false);
  });

  test('capture never reaches a model the test did not hand it', async () => {
    const r = await run(['capture', '--session', SESSION, '--transcript', transcript, '--cwd', home]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Capture failed: No provider is configured in this test\./);
  });

  test('track writes the skeleton and marks it ended; sessions --json prints records', async () => {
    const t = await run(['track', '--session', 's-one', '--cwd', home, '--transcript', transcript]);
    assert.equal(t.code, 0);
    assert.equal(t.stdout, '');
    await run(['track', '--session', 's-two', '--cwd', home, '--ended']);
    const records = JSON.parse((await run(['sessions', '--json'])).stdout) as {
      id: string;
      repo: string;
      ended?: string;
      transcriptPath?: string;
    }[];
    assert.deepEqual(records.map((r) => r.id).sort(), ['s-one', 's-two']);
    const one = records.find((r) => r.id === 's-one')!;
    assert.equal(one.repo, home);
    assert.equal(one.transcriptPath, transcript);
    assert.equal(one.ended, undefined);
    assert.ok(records.find((r) => r.id === 's-two')!.ended);
    assert.equal((await run(['track'])).code, 1);
  });

  test('sessions as text shows recorded sessions first, then ids without a record', async () => {
    const id = await addTask('Release banner', '--repo', home);
    await run(['link', id, 'old-session-id']);
    await run(
      ['capture', '--session', SESSION, '--transcript', transcript, '--cwd', home],
      home,
      fakeProvider(answer(id)),
    );
    const r = await run(['sessions']);
    const lines = r.stdout.split('\n');
    assert.equal(lines[0], 'Sessions');
    assert.match(lines[1]!, /^ {2}b13e8b5e {2}.*Wire the release banner {2}release-banner {2}/);
    assert.match(lines[1]!, /3 files, 0 commits, 0 ticked$/);
    assert.match(r.stdout, /Linked on tasks, no record\n {2}old-session-id/);
    const only = JSON.parse((await run(['sessions', '--task', 'nope', '--json'])).stdout);
    assert.deepEqual(only, []);
  });

  test('brief prints the briefing from the file and the sidecars', async () => {
    const id = await addTask('Release banner', '--repo', home);
    await run(['todo', id, 'Banner component in the shell']);
    await run(
      ['capture', '--session', SESSION, '--transcript', transcript, '--cwd', home],
      home,
      fakeProvider(answer(id, { headline: 'Banner half done' })),
    );
    const r = await run(['brief', id]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^Resuming the Ledge task "Release banner"/);
    assert.match(r.stdout, /Where it stands: Banner half done/);
    assert.match(r.stdout, /- \[ \] Banner component in the shell/);
    assert.match(r.stdout, /Last session \(\d{4}-\d{2}-\d{2}\): Wire the release banner: Built the banner\./);
    assert.equal((await run(['brief', 'missing'])).code, 2);
    assert.equal((await run(['brief'])).code, 1);
  });
});
