import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  INTENT_TTL_MS,
  clearIntent,
  intentFor,
  readIntents,
  recordIntent,
  updateIntent,
} from '../src/index.ts';

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'ledge-intent-'));
  process.env.LEDGE_HOME = home;
  return home;
}

test('recordIntent writes its own file, never config.json', () => {
  const home = freshHome();
  const record = recordIntent({ taskId: 'release-watch-banner', repo: home }, { home });
  assert.equal(record.taskId, 'release-watch-banner');
  assert.match(record.started, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  assert.ok(existsSync(join(home, 'intent.json')));
  assert.equal(existsSync(join(home, 'config.json')), false, 'config.json is left to its owners');
  const written = JSON.parse(readFileSync(join(home, 'intent.json'), 'utf8'));
  assert.equal(written.intents.length, 1);
});

test('a second record for the same task replaces the first', () => {
  const home = freshHome();
  recordIntent({ taskId: 'one', repo: home }, { home });
  recordIntent({ taskId: 'one', repo: home }, { home });
  recordIntent({ taskId: 'two', repo: home }, { home });
  assert.deepEqual(readIntents({ home }).map((r) => r.taskId).sort(), ['one', 'two']);
});

test('a record older than the expiry is ignored and dropped on the next write', () => {
  const home = freshHome();
  const long = new Date(Date.now() - INTENT_TTL_MS - 60_000);
  recordIntent({ taskId: 'stale', repo: home }, { home, now: long });
  assert.deepEqual(readIntents({ home }), [], 'a stale record cannot promote anything');
  assert.equal(intentFor(home, { home }), undefined);

  recordIntent({ taskId: 'fresh', repo: home }, { home });
  const written = JSON.parse(readFileSync(join(home, 'intent.json'), 'utf8'));
  assert.deepEqual(written.intents.map((r: { taskId: string }) => r.taskId), ['fresh']);
});

test('a record dated in the future is ignored, because a clock jump is not intent', () => {
  const home = freshHome();
  recordIntent({ taskId: 'ahead', repo: home }, { home, now: new Date(Date.now() + 3_600_000) });
  assert.deepEqual(readIntents({ home }), []);
});

test('intentFor matches the deepest repo and ignores records with none', () => {
  const home = freshHome();
  const root = mkdtempSync(join(tmpdir(), 'ledge-intent-repos-'));
  const outer = join(root, 'product');
  const inner = join(outer, 'apps', 'web');
  mkdirSync(inner, { recursive: true });
  recordIntent({ taskId: 'outer', repo: outer }, { home });
  recordIntent({ taskId: 'inner', repo: inner }, { home });
  recordIntent({ taskId: 'nowhere' }, { home });
  assert.equal(intentFor(inner, { home })?.taskId, 'inner');
  assert.equal(intentFor(outer, { home })?.taskId, 'outer');
  assert.equal(intentFor(root, { home }), undefined, 'a parent folder matches nothing');
});

test('updateIntent attaches the session id and the before snapshot', () => {
  const home = freshHome();
  recordIntent({ taskId: 'one', repo: home }, { home });
  const before = { checklist: [{ text: 'a', done: false }], notes: [], plan: [] };
  const updated = updateIntent('one', { sessionId: 'b13e8b5e', before }, { home });
  assert.equal(updated?.sessionId, 'b13e8b5e');
  assert.deepEqual(readIntents({ home })[0]?.before, before);
  assert.equal(updateIntent('missing', { sessionId: 'x' }, { home }), undefined);
});

test('clearIntent removes one record and leaves the others', () => {
  const home = freshHome();
  recordIntent({ taskId: 'one', repo: home }, { home });
  recordIntent({ taskId: 'two', repo: home }, { home });
  clearIntent('one', { home });
  assert.deepEqual(readIntents({ home }).map((r) => r.taskId), ['two']);
  clearIntent('one', { home });
  assert.deepEqual(readIntents({ home }).map((r) => r.taskId), ['two'], 'clearing twice is safe');
});

test('a malformed intent file reads as no intent rather than throwing', () => {
  const home = freshHome();
  writeFileSync(join(home, 'intent.json'), '{ this is not json');
  assert.deepEqual(readIntents({ home }), []);
  assert.equal(intentFor(home, { home }), undefined);

  writeFileSync(join(home, 'intent.json'), '{"intents":[{"nope":1},{"taskId":"ok"}]}');
  assert.deepEqual(readIntents({ home }), [], 'records missing a timestamp are not live');
});

test('reading an intent file that does not exist is empty, not an error', () => {
  const home = freshHome();
  assert.deepEqual(readIntents({ home }), []);
});
