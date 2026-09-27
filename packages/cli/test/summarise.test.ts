// Tests for `ledge summarise`: one call per task, only the sidecar written, the task file left
// byte for byte, and nothing asked when nothing is missing.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { contentKey, noteKey } from '@ledge/core';
import { addTask, coreKind, failingProvider, fakeProvider, initHome, removeHome, run } from './helpers.ts';

describe('summarise', { skip: coreKind === 'fake' }, () => {
  let home: string;
  beforeEach(async () => {
    home = await initHome();
  });
  afterEach(() => removeHome(home));

  async function taskWithNotes(title: string): Promise<{ id: string; file: string }> {
    const id = await addTask(title, '--repo', home);
    await run(['plan', id, 'Write version.json at build time', 'Show the banner']);
    await run(['note', id, 'Decided to poll a version file rather than a service worker.']);
    const file = (await run(['open', id])).stdout.trim();
    return { id, file };
  }

  test('titles missing notes and steps in one call and never touches the task file', async () => {
    const { id, file } = await taskWithNotes('Release banner');
    const before = readFileSync(file, 'utf8');
    const today = JSON.parse((await run(['current', '--repo', home, '--json'])).stdout).notes[0];
    const nKey = noteKey(today);
    const pKey = contentKey('Write version.json at build time');
    const provider = fakeProvider(
      JSON.stringify({
        notes: { [nKey]: { title: 'Chose polling', summary: 'Over a service worker.' } },
        plan: { [pKey]: { title: 'version.json at build' } },
      }),
    );
    const r = await run(['summarise', id], home, provider);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, `${id}: titled 1 notes and 1 plan steps\n`);
    assert.equal(provider.prompts.length, 1);
    assert.equal(readFileSync(file, 'utf8'), before, 'the task file is byte for byte the same');
    const insights = JSON.parse(readFileSync(join(home, 'insights', `${id}.json`), 'utf8'));
    assert.deepEqual(insights.notes[nKey], { title: 'Chose polling', summary: 'Over a service worker.' });
    assert.deepEqual(insights.plan[pKey], { title: 'version.json at build' });

    const second = fakeProvider(
      JSON.stringify({ plan: { [contentKey('Show the banner')]: { title: 'Banner' } } }),
    );
    await run(['summarise', id], home, second);
    assert.match(second.prompts[0]!, /Show the banner/);
    assert.doesNotMatch(second.prompts[0]!, /Decided to poll/, 'a titled note is not asked again');
    const third = fakeProvider('{}');
    const r3 = await run(['summarise', '--json'], home, third);
    assert.deepEqual(JSON.parse(r3.stdout)[0].status, 'nothing');
    assert.equal(third.prompts.length, 0, 'nothing missing, nothing asked');
  });

  test('--all goes task by task, and a failure writes nothing for that task', async () => {
    const one = await taskWithNotes('First');
    const r = await run(['summarise', '--all'], home, failingProvider('overloaded'));
    assert.equal(r.code, 0);
    assert.match(r.stdout, new RegExp(`${one.id}: not summarised, model call failed: overloaded`));
    assert.equal(existsSync(join(home, 'insights', `${one.id}.json`)), false);
  });

  test('without an id, --all or a task for this folder it is a usage error', async () => {
    const r = await run(['summarise'], '/nowhere/in/particular');
    assert.equal(r.code, 1);
    assert.match(r.stderr, /summarise needs a task id/);
  });
});
