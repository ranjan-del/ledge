// Tests for `ledge ask`, `ledge standup` and `ledge handoff`. Every one runs against an injected
// provider, so the suite never starts a program, never reaches a model and never depends on
// whether the machine running it has Claude Code installed. What is asserted is the wiring and
// the honesty: that the prompt carried the real records, that observed facts and inference are
// printed apart, and that a missing provider costs the command nothing but the inference.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  addTask,
  failingProvider,
  fakeProvider,
  initHome,
  noProvider,
  removeHome,
  run,
} from './helpers.ts';

interface AssistJson {
  kind: string;
  day: string;
  question?: string;
  task?: { id: string; title: string };
  observed: {
    day: string;
    tasks: {
      id: string;
      title: string;
      done: number;
      total: number;
      noteCount: number;
      nextAction?: { text: string; source: string };
    }[];
    repos: { repo: string }[];
  };
  inference?: { text: string; provider: string };
  noInference?: string;
  saved?: string;
}

// The fake core keeps tasks in memory, so the file it names is not on disk. Assertions about
// bytes in a file run only against the real core; every assertion about behaviour runs on both.
const onDisk = process.env.LEDGE_FAKE_CORE !== '1';

let home: string;

/** Builds a task with a plan, a part-done checklist and a note, the shape these commands read. */
async function seed(): Promise<string> {
  await emptyStore();
  const id = await addTask('Release watch banner', '--repo', '/repos/banner');
  await run(['plan', id, 'Write version.json', 'Poll it from the shell']);
  await run(['todo', id, 'Investigate caching']);
  await run(['todo', id, 'Build step writes version.json']);
  await run(['todo', id, 'Banner component']);
  await run(['tick', id, '1']);
  await run(['note', id, 'Ruled out a service worker. Decision taken, do not revisit.']);
  return id;
}

/** Removes the sample task `ledge init` plants, so a test reasons about its own tasks only. */
async function emptyStore(): Promise<void> {
  const r = await run(['delete', 'try-ledge', '--yes']);
  if (r.code !== 0) throw new Error(`could not remove the sample task: ${r.stderr}`);
}

/** Absolute path of a task's file, read back through `ledge open` rather than guessed. */
async function fileOf(id: string): Promise<string> {
  const r = await run(['open', id]);
  if (r.code !== 0) throw new Error(`open failed: ${r.stderr}`);
  return r.stdout.trim();
}

const scratch: string[] = [];

/** Builds a throwaway git repo with one commit and, optionally, an untracked file. */
function makeRepo(dirty: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'ledge-assist-repo-'));
  scratch.push(dir);
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
      cwd: dir,
      stdio: 'pipe',
    });
  };
  git('init', '-q', '-b', 'work');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  if (dirty) writeFileSync(join(dir, 'scratch.txt'), 'wip\n');
  return dir;
}

/** Points the store's scan at the given roots. */
function setRoots(roots: string[]): void {
  const file = join(home, 'config.json');
  const config = JSON.parse(readFileSync(file, 'utf8')) as { roots: string[] };
  config.roots = roots;
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
}

beforeEach(async () => {
  home = await initHome();
});
afterEach(() => {
  removeHome(home);
  for (const dir of scratch.splice(0)) removeHome(dir);
});

describe('ask', () => {
  test('sends the real records and prints the answer apart from the facts', async () => {
    const id = await seed();
    const provider = fakeProvider('Inferred: you dropped it for polling.');
    const r = await run(['ask', 'Why did I drop the service worker?'], home, provider);

    assert.equal(r.code, 0);
    assert.match(r.stdout, /Question\n {2}Why did I drop the service worker\?/);
    assert.match(r.stdout, new RegExp(`Observed \\d{4}-\\d{2}-\\d{2}\\n {2}${id}`));
    assert.match(r.stdout, /1\/3/);
    assert.match(r.stdout, /next \(checklist\): Build step writes version\.json/);
    assert.match(r.stdout, /Inference \(from test-fake, not from your files\)/);
    assert.match(r.stdout, /Inferred: you dropped it for polling\./);
    // The facts come first and the inference after, never merged under one heading.
    assert.ok(r.stdout.indexOf('Observed') < r.stdout.indexOf('Inference'));

    assert.equal(provider.prompts.length, 1);
    const prompt = provider.prompts[0]!;
    assert.match(prompt, /Why did I drop the service worker\?/);
    assert.match(prompt, /Ruled out a service worker\. Decision taken, do not revisit\./);
    assert.match(prompt, /- Banner component/);
    assert.match(prompt, /1\. Write version\.json/);
    assert.match(prompt, /Use only the context/);
  });

  test('with no provider it still prints the same observed facts and exits 0', async () => {
    const id = await seed();
    const withModel = await run(['ask', 'What now?'], home, fakeProvider('an answer'));
    const without = await run(['ask', 'What now?'], home, noProvider('claude is not on PATH.'));

    assert.equal(without.code, 0);
    assert.match(without.stdout, new RegExp(`Observed \\d{4}-\\d{2}-\\d{2}\\n {2}${id}`));
    assert.match(without.stdout, /next \(checklist\): Build step writes version\.json/);
    assert.match(without.stdout, /Inference \(none\)\n {2}claude is not on PATH\./);
    assert.match(without.stdout, /The rows above were read from your files and are unaffected\./);
    assert.doesNotMatch(without.stdout, /an answer/);

    // The observed half is identical with and without a model: inference is an addition to
    // Ledge, never a thing the rest of the output depends on.
    const facts = (text: string) => text.slice(0, text.indexOf('Inference'));
    assert.equal(facts(without.stdout), facts(withModel.stdout));
  });

  test('a provider that fails when asked says so rather than printing nothing', async () => {
    await seed();
    const r = await run(['ask', 'What now?'], home, failingProvider('exit code 2'));
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Inference \(none\)/);
    assert.match(r.stdout, /test-broken provider was asked but could not answer: exit code 2/);
  });

  test('an empty store is asked nothing at all, and says why', async () => {
    await emptyStore();
    const provider = fakeProvider('should never be asked');
    const r = await run(['ask', 'What now?'], home, provider);
    assert.equal(r.code, 0);
    assert.equal(provider.prompts.length, 0);
    assert.match(r.stdout, /no tasks in the store, so there was nothing to ask about/);
  });

  test('--json carries the facts, the question and the labelled answer', async () => {
    const id = await seed();
    const r = await run(['ask', 'Why?'], home, fakeProvider('because of polling'));
    const view = JSON.parse((await run(['ask', 'Why?', '--json'], home,
      fakeProvider('because of polling'))).stdout) as AssistJson;

    assert.equal(r.code, 0);
    assert.equal(view.kind, 'ask');
    assert.equal(view.question, 'Why?');
    assert.equal(view.observed.tasks.length, 1);
    assert.equal(view.observed.tasks[0]!.id, id);
    assert.equal(view.observed.tasks[0]!.done, 1);
    assert.equal(view.observed.tasks[0]!.total, 3);
    assert.equal(view.observed.tasks[0]!.noteCount, 1);
    assert.deepEqual(view.inference, { text: 'because of polling', provider: 'test-fake' });
    assert.equal(view.noInference, undefined);
  });

  test('a question is required', async () => {
    const r = await run(['ask']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /ask needs a question/);
  });
});

describe('standup', () => {
  test('quotes every task, current first, and labels the summary with the provider', async () => {
    const current = await seed();
    const parked = await addTask('Old idea');
    await run(['park', parked, 'waiting on design']);
    const provider = fakeProvider('Start here: do the build step.');

    const r = await run(['standup'], home, provider);
    assert.equal(r.code, 0);
    assert.ok(r.stdout.indexOf(current) < r.stdout.indexOf(parked), 'current tasks come first');
    assert.match(r.stdout, /Inference \(from test-fake, not from your files\)\n {2}Start here:/);

    const prompt = provider.prompts[0]!;
    assert.match(prompt, /Cover every task whose status is current/);
    assert.match(prompt, /parked because: waiting on design/);
    assert.ok(prompt.indexOf(`id: ${current}`) < prompt.indexOf(`id: ${parked}`));
  });

  test('with no provider it prints the rows and the reason, and exits 0', async () => {
    await seed();
    const r = await run(['standup'], home, noProvider('claude is installed but not signed in.'));
    assert.equal(r.code, 0);
    assert.match(r.stdout, /next \(checklist\): Build step writes version\.json/);
    assert.match(r.stdout, /Inference \(none\)\n {2}claude is installed but not signed in\./);
  });

  test('an empty store is summarised as empty without asking anything', async () => {
    await emptyStore();
    const provider = fakeProvider('should never be asked');
    const r = await run(['standup'], home, provider);
    assert.equal(r.code, 0);
    assert.equal(provider.prompts.length, 0);
    assert.match(r.stdout, /Observed \d{4}-\d{2}-\d{2}\n {2}\(none\)/);
    assert.match(r.stdout, /nothing to summarise/);
  });
});

describe('handoff', () => {
  test('writes the handoff for one task and does not touch the file without --save', async () => {
    const id = await seed();
    const file = await fileOf(id);
    const before = onDisk ? readFileSync(file, 'utf8') : '';
    const provider = fakeProvider('What happened\n- a thing\n\nWhat remains\n- another thing');

    const r = await run(['handoff', id], home, provider);
    assert.equal(r.code, 0);
    assert.match(r.stdout, new RegExp(`Handoff for ${id}: Release watch banner`));
    assert.match(r.stdout, /Inference \(from test-fake, not from your files\)/);
    assert.match(r.stdout, /What happened\n {2}- a thing/);
    assert.doesNotMatch(r.stdout, /Saved to/);
    if (onDisk) {
      assert.equal(readFileSync(file, 'utf8'), before, 'the file is untouched without --save');
    }

    const prompt = provider.prompts[0]!;
    assert.match(prompt, /handoff note for the task "Release watch banner"/);
    assert.match(prompt, /Ruled out a service worker/);
    // Only the named task is quoted, so a handoff can never blend two pieces of work.
    assert.match(prompt, /TASK 1 of 1/);

    const view = JSON.parse((await run(['handoff', id, '--json'], home,
      fakeProvider('x'))).stdout) as AssistJson;
    assert.equal(view.saved, undefined);
    assert.equal(view.task?.id, id);
  });

  test('--save appends it to the notes, attributed, with headings stripped', async () => {
    const id = await seed();
    const answer = '## What happened\n- built the store\n### What remains\n- the tab list';
    const r = await run(['handoff', id, '--save', '--json'], home, fakeProvider(answer));
    const view = JSON.parse(r.stdout) as AssistJson;

    assert.equal(r.code, 0);
    assert.equal(view.saved, await fileOf(id));
    if (onDisk) {
      const text = readFileSync(view.saved!, 'utf8');
      assert.match(text, /Session handoff, written by test-fake from this file\./);
      assert.match(text, /^What happened$/m);
      assert.match(text, /^- built the store$/m);
      assert.match(text, /^What remains$/m);
      // A `##` line would have been read back as a new section and split the file in two.
      assert.doesNotMatch(text, /^#+ What/m);
      // The note the person already wrote is still there, above the appended handoff.
      assert.match(text, /Ruled out a service worker/);
    }

    // The file still parses, which is the only proof that appending model text was safe.
    const reread = await run(['current', '--repo', '/repos/banner', '--json']);
    assert.equal(reread.code, 0);
    const notes = (JSON.parse(reread.stdout) as { notes: { body: string }[] }).notes;
    assert.equal(notes.length, 1);
    assert.match(notes[0]!.body, /Session handoff, written by test-fake/);
    assert.match(notes[0]!.body, /^What happened$/m);
    assert.doesNotMatch(notes[0]!.body, /^#/m);
  });

  test('--save with no provider saves nothing, says so and still exits 0', async () => {
    const id = await seed();
    const file = await fileOf(id);
    const before = onDisk ? readFileSync(file, 'utf8') : '';
    const r = await run(['handoff', id, '--save'], home, noProvider('claude is not on PATH.'));

    assert.equal(r.code, 0);
    assert.match(r.stdout, /Observed \d{4}-\d{2}-\d{2}/);
    assert.match(r.stdout, /next \(checklist\): Build step writes version\.json/);
    assert.match(r.stdout, /claude is not on PATH\. Nothing was saved to the task file\./);
    assert.doesNotMatch(r.stdout, /Saved to/);
    if (onDisk) assert.equal(readFileSync(file, 'utf8'), before);
  });

  test('an unknown task is not found, and a missing id is a usage error', async () => {
    assert.equal((await run(['handoff', 'nope'])).code, 2);
    const missing = await run(['handoff']);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /handoff needs a task id/);
  });
});

describe('git in the context', () => {
  test('a desk-wide view carries other dirty repos, a handoff carries only its own', async () => {
    if (!onDisk) return;
    await emptyStore();
    const mine = makeRepo(false);
    const elsewhere = makeRepo(true);
    setRoots([mine, elsewhere]);
    const id = await addTask('Banner work', '--repo', mine);
    const provider = fakeProvider('an answer');

    const desk = JSON.parse(
      (await run(['standup', '--json'], home, provider)).stdout,
    ) as AssistJson;
    assert.deepEqual(desk.observed.repos.map((r) => r.repo).sort(), [elsewhere, mine].sort());

    const one = JSON.parse(
      (await run(['handoff', id, '--json'], home, provider)).stdout,
    ) as AssistJson;
    assert.deepEqual(one.observed.repos.map((r) => r.repo), [mine]);
    // The prompt sees exactly what the rows show, never more.
    assert.doesNotMatch(provider.prompts[1]!, new RegExp(elsewhere));
    assert.match(provider.prompts[1]!, new RegExp(`${mine}: branch work`));
  });
});

describe('help', () => {
  test('the three commands and --save appear in the help', async () => {
    const r = await run(['help']);
    assert.match(r.stdout, /ledge ask "question"/);
    assert.match(r.stdout, /ledge standup/);
    assert.match(r.stdout, /ledge handoff <id> \[--save\]/);
    assert.match(r.stdout, /--save/);
    assert.match(r.stdout, /Claude Code command line tool/);
    const one = await run(['help', 'handoff']);
    assert.match(one.stdout, /--save appends it to the task's notes/);
    assert.doesNotMatch(one.stdout, /ledge standup/);
  });
});
