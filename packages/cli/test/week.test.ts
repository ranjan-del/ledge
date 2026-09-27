// Tests for `ledge week` and for the week items `ledge today` and `ledge current --context`
// show. Every test runs in a fresh LEDGE_HOME, and every date is worked out from the day the
// suite runs, so the tests hold on any day of any week.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { addTask, freshHome, initHome, removeHome, run } from './helpers.ts';
import { isoDay, isoWeekOf, shiftWeek, weekDays } from '@ledge/core';

interface NumberedJson {
  n: number;
  day: string;
  text: string;
  done: boolean;
  taskId?: string;
}

interface WeekJson {
  week: string;
  today: string;
  anytime: { text: string; done: boolean; taskId?: string }[];
  days: Record<string, { text: string; done: boolean; taskId?: string }[]>;
  numbered: NumberedJson[];
}

const today = isoDay();
const thisWeek = isoWeekOf(today);
const days = weekDays(thisWeek);

async function weekJson(...extra: string[]): Promise<WeekJson> {
  const r = await run(['week', '--json', ...extra]);
  assert.equal(r.code, 0, r.stderr);
  return JSON.parse(r.stdout) as WeekJson;
}

describe('ledge week', () => {
  let home: string;
  beforeEach(async () => {
    home = await initHome();
  });
  afterEach(() => removeHome(home));

  test('an empty week prints its dates and Anytime, and reading writes nothing', async () => {
    const r = await run(['week']);
    assert.equal(r.code, 0, r.stderr);
    const lines = r.stdout.split('\n');
    assert.match(lines[0]!, new RegExp(`^Week ${thisWeek}, Mon ${days[0]} to Sun ${days[6]}$`));
    assert.match(r.stdout, /\nAnytime\n {2}\(none\)\n/);
    assert.equal(existsSync(join(home, 'weeks')), false);
    const json = await weekJson();
    assert.equal(json.week, thisWeek);
    assert.equal(json.today, today);
    assert.deepEqual(json.numbered, []);
  });

  test('add goes to Anytime by default and to a day with --day, numbered in order', async () => {
    const a = await run(['week', 'add', 'Renew the domain']);
    assert.equal(a.code, 0, a.stderr);
    assert.equal(a.stdout, `Added item 1 to ${thisWeek}, Anytime: Renew the domain\n`);
    await run(['week', 'add', 'Sunday chore', '--day', 'sun']);
    const mon = await run(['week', 'add', 'Call', 'the', 'vendor', '--day', 'Monday']);
    assert.match(mon.stdout, new RegExp(`^Added item 2 to ${thisWeek}, Mon ${days[0]}: Call the vendor`));
    await run(['week', 'add', 'Today thing', '--day', 'today']);

    const json = await weekJson();
    assert.deepEqual(json.anytime, [{ text: 'Renew the domain', done: false }]);
    assert.deepEqual(json.days[days[0]!], [{ text: 'Call the vendor', done: false }]);
    const order = json.numbered.map((item) => item.text);
    assert.equal(order[0], 'Renew the domain');
    assert.equal(order[1], 'Call the vendor');
    assert.equal(json.numbered[json.numbered.length - 1]!.day, days[6], 'Sunday is numbered last');
    assert.ok(order.indexOf('Sunday chore') > order.indexOf('Call the vendor'));
    assert.ok(order.includes('Today thing'));
    assert.deepEqual(json.numbered.map((item) => item.n), [1, 2, 3, 4]);

    const text = await run(['week']);
    assert.match(text.stdout, /^ {3}1 {2}\[ \] Renew the domain$/m);
    assert.match(text.stdout, new RegExp(`^\\w{3} ${today} \\(today\\)$`, 'm'));

    const file = readFileSync(join(home, 'weeks', `${thisWeek}.md`), 'utf8');
    assert.match(file, new RegExp(`^---\\nweek: ${thisWeek}\\nupdated: `));
    assert.match(file, /## Anytime\n\n- \[ \] Renew the domain\n/);
    assert.deepEqual(readdirSync(join(home, 'weeks')), [`${thisWeek}.md`], 'no temp file left');
  });

  test('--task links an existing task and refuses a missing one', async () => {
    const id = await addTask('Teacher Corner PR');
    const r = await run(['week', 'add', 'Review the PR', '--task', id, '--json']);
    assert.equal(r.code, 0, r.stderr);
    const json = JSON.parse(r.stdout) as WeekJson;
    assert.deepEqual(json.anytime, [{ text: 'Review the PR', done: false, taskId: id }]);
    assert.match(readFileSync(join(home, 'weeks', `${thisWeek}.md`), 'utf8'),
      new RegExp(`- \\[ \\] Review the PR \\{task: ${id}\\}`));
    assert.match((await run(['week'])).stdout, new RegExp(`Review the PR {2}\\(task: ${id}\\)`));

    const missing = await run(['week', 'add', 'Ghost', '--task', 'no-such-task']);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /Task not found: no-such-task/);
    assert.equal((await weekJson()).numbered.length, 1, 'nothing was added');
  });

  test('tick, untick and rm act on the printed number', async () => {
    await run(['week', 'add', 'First']);
    await run(['week', 'add', 'Second', '--day', 'mon']);
    const t = await run(['week', 'tick', '2']);
    assert.equal(t.code, 0, t.stderr);
    assert.equal(t.stdout, `Ticked item 2 in ${thisWeek}: Second\n`);
    assert.equal((await weekJson()).days[days[0]!]![0]!.done, true);
    assert.match(readFileSync(join(home, 'weeks', `${thisWeek}.md`), 'utf8'), /- \[x\] Second/);
    await run(['week', 'untick', '2']);
    assert.equal((await weekJson()).days[days[0]!]![0]!.done, false);

    const rm = await run(['week', 'rm', '2', '--json']);
    assert.equal(rm.code, 0, rm.stderr);
    const json = JSON.parse(rm.stdout) as WeekJson;
    assert.deepEqual(json.days, {}, 'an emptied day is dropped');
    assert.deepEqual(json.numbered.map((i) => i.text), ['First']);
  });

  test('bad and missing numbers exit 1 and 2', async () => {
    await run(['week', 'add', 'Only']);
    assert.equal((await run(['week', 'tick'])).code, 1);
    assert.equal((await run(['week', 'tick', 'x'])).code, 1);
    assert.equal((await run(['week', 'rm', '0'])).code, 1);
    const far = await run(['week', 'tick', '5']);
    assert.equal(far.code, 2);
    assert.match(far.stderr, new RegExp(`No item 5 in ${thisWeek}, which has items 1 to 1`));
    assert.equal((await run(['week', 'nonsense'])).code, 1);
    assert.equal((await run(['week', 'add'])).code, 1);
    assert.equal((await run(['week', 'add', '   '])).code, 1);
  });

  test('move puts an item under another day of the same week', async () => {
    await run(['week', 'add', 'Movable']);
    const m = await run(['week', 'move', '1', '--day', 'wed']);
    assert.equal(m.code, 0, m.stderr);
    assert.equal(m.stdout, `Moved "Movable" to Wed ${days[2]} in ${thisWeek}\n`);
    let json = await weekJson();
    assert.deepEqual(json.anytime, []);
    assert.deepEqual(json.days[days[2]!], [{ text: 'Movable', done: false }]);
    await run(['week', 'move', '1', '--day', 'anytime']);
    json = await weekJson();
    assert.deepEqual(json.anytime, [{ text: 'Movable', done: false }]);
    assert.deepEqual(json.days, {});

    assert.equal((await run(['week', 'move', '1'])).code, 1, 'move needs --day');
    const outside = await run(['week', 'move', '1', '--day', shiftDayBy(days[0]!, -1)]);
    assert.equal(outside.code, 1);
    assert.match(outside.stderr, new RegExp(`is not in ${thisWeek}`));
    assert.equal((await run(['week', 'move', '1', '--day', 'someday'])).code, 1);
  });

  test('--week and --next pick another week, and a date picks its own', async () => {
    const next = shiftWeek(thisWeek, 1);
    await run(['week', 'add', 'Next week thing', '--next']);
    assert.equal((await weekJson('--next')).numbered[0]!.text, 'Next week thing');
    assert.deepEqual((await weekJson()).numbered, [], 'this week is untouched');
    assert.equal((await weekJson('--week', next)).week, next);
    assert.equal((await weekJson('--week', next.replace('-', ''))).week, next, '2026W40 is read');

    const nextMonday = weekDays(next)[0]!;
    const dated = await run(['week', 'add', 'Dated', '--day', nextMonday, '--json']);
    assert.equal(dated.code, 0, dated.stderr);
    assert.equal((JSON.parse(dated.stdout) as WeekJson).week, next);
    assert.deepEqual((await weekJson('--next')).days[nextMonday], [{ text: 'Dated', done: false }]);

    const clash = await run(['week', 'add', 'Clash', '--day', nextMonday, '--week', thisWeek]);
    assert.equal(clash.code, 1);
    assert.equal((await run(['week', '--week', thisWeek, '--next'])).code, 1);
    assert.equal((await run(['week', '--week', '2025-W53'])).code, 1, '2025 has 52 weeks');
    assert.equal((await run(['week', '--week', 'soon'])).code, 1);
    assert.equal((await run(['week', '--day', 'mon'])).code, 1, '--day is not for printing');
    assert.ok(existsSync(join(home, 'weeks', `${next}.md`)));
  });

  test('help lists the week command', async () => {
    const r = await run(['help', 'week']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /ledge week/);
    assert.match((await run(['--help'])).stdout, /--day d {6}With week add and move/);
  });
});

describe('ledge week without a store', () => {
  test('exits 2 and says to run init', async () => {
    const home = freshHome();
    try {
      const r = await run(['week']);
      assert.equal(r.code, 2);
      assert.match(r.stderr, /ledge init/);
    } finally {
      removeHome(home);
    }
  });
});

describe('week items in today and current --context', () => {
  let home: string;
  beforeEach(async () => {
    home = await initHome();
  });
  afterEach(() => removeHome(home));

  test('today shows only its own unticked items, numbered, at most five lines', async () => {
    const quiet = await run(['today']);
    assert.doesNotMatch(quiet.stdout, /Week to-do today/, 'no section when there is nothing');

    await run(['week', 'add', 'Anytime thing']);
    await run(['week', 'add', 'Done today', '--day', 'today']);
    await run(['week', 'tick', '2']);
    await run(['week', 'add', 'Open today', '--day', 'today']);
    const r = await run(['today']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Week to-do today\n {2}3\. Open today\n\n/);
    assert.doesNotMatch(r.stdout, /Done today|Anytime thing/);
    const json = JSON.parse((await run(['today', '--json'])).stdout) as { week: NumberedJson[] };
    assert.deepEqual(json.week.map((i) => [i.n, i.text]), [[3, 'Open today']]);

    for (let i = 1; i <= 7; i++) await run(['week', 'add', `Extra ${i}`, '--day', 'today']);
    const many = await run(['today']);
    const block = many.stdout.split('Week to-do today\n')[1]!.split('\n\n')[0]!.split('\n');
    assert.equal(block.length, 5);
    assert.match(block[4]!, /^ {2}\.\.\. 4 more, see ledge week$/);
  });

  test('current --context carries today\'s items and still keeps to 40 lines', async () => {
    await addTask('Ctx week', '--repo', '/repos/ctx-week');
    await run(['week', 'add', 'Call the bank', '--day', 'today']);
    const r = await run(['current', '--repo', '/repos/ctx-week', '--context']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Week to-do today \(ledge week tick <n> when done\):\n1\. Call the bank\n/);

    for (let i = 1; i <= 60; i++) await run(['todo', 'ctx-week', `Item ${i}`]);
    for (let i = 1; i <= 9; i++) await run(['week', 'add', `More ${i}`, '--day', 'today']);
    const long = await run(['current', '--repo', '/repos/ctx-week', '--context']);
    assert.ok(long.stdout.trimEnd().split('\n').length <= 40);
  });
});

/** A calendar day moved by `n` days, in UTC, which is how the week module counts. */
function shiftDayBy(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
