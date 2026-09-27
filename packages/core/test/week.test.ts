// The weekly to-do list: the ISO week arithmetic, the file format and WeekStore. The store
// tests each run in their own temporary LEDGE_HOME, so the real ~/.ledge is never touched.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WeekStore,
  emptyWeek,
  isIsoWeek,
  isoWeekOf,
  itemsFor,
  numberWeek,
  parseWeek,
  serializeWeek,
  shiftWeek,
  weekDays,
} from '../src/index.ts';
import * as pure from '../src/pure.ts';
import type { WeekFile } from '../src/index.ts';

/** The example in the weekly to-do contract, exactly as Ledge writes it. */
const CONTRACT_EXAMPLE = [
  '---',
  'week: 2026-W39',
  'updated: 2026-09-27T12:40:00+05:30',
  '---',
  '',
  '## Anytime',
  '',
  '- [ ] Renew the domain',
  '',
  '## Mon 2026-09-21',
  '',
  '- [x] Call the vendor about invoices',
  '- [ ] Review Teacher Corner PR {task: teacher-corner-web-consolidation}',
  '',
  '## Thu 2026-09-24',
  '',
  '- [ ] Sprint demo prep',
  '',
].join('\n');

describe('ISO weeks', () => {
  test('2026-09-27 is the Sunday of 2026-W39, whose Monday is 2026-09-21', () => {
    assert.equal(isoWeekOf('2026-09-27'), '2026-W39');
    assert.equal(isoWeekOf('2026-09-21'), '2026-W39');
    assert.equal(isoWeekOf('2026-09-28'), '2026-W40');
    assert.deepEqual(weekDays('2026-W39'), [
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
    ]);
  });

  test('the week year is the year of the Thursday, across year ends', () => {
    assert.equal(isoWeekOf('2026-12-31'), '2026-W53');
    assert.equal(isoWeekOf('2027-01-01'), '2026-W53');
    assert.equal(isoWeekOf('2027-01-03'), '2026-W53');
    assert.equal(isoWeekOf('2027-01-04'), '2027-W01');
    assert.equal(isoWeekOf('2021-01-03'), '2020-W53');
    assert.equal(isoWeekOf('2021-01-04'), '2021-W01');
    assert.equal(isoWeekOf('2024-12-30'), '2025-W01');
    assert.equal(isoWeekOf('2025-12-29'), '2026-W01');
    assert.equal(isoWeekOf('2020-02-29'), '2020-W09');
  });

  test('weekDays spans two calendar years in week 1 and week 53', () => {
    assert.deepEqual(weekDays('2020-W53'), [
      '2020-12-28',
      '2020-12-29',
      '2020-12-30',
      '2020-12-31',
      '2021-01-01',
      '2021-01-02',
      '2021-01-03',
    ]);
    assert.equal(weekDays('2026-W53')[0], '2026-12-28');
    assert.equal(weekDays('2026-W53')[6], '2027-01-03');
    assert.equal(weekDays('2025-W01')[0], '2024-12-30');
    assert.equal(weekDays('2026-W01')[0], '2025-12-29');
  });

  test('every day of a long run maps back into the week that lists it', () => {
    let day = '2019-12-23';
    for (let i = 0; i < 3000; i++) {
      const week = isoWeekOf(day);
      assert.ok(weekDays(week).includes(day), `${day} is in ${week}`);
      const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000);
      day = next.toISOString().slice(0, 10);
    }
  });

  test('isIsoWeek knows which years have a week 53', () => {
    assert.equal(isIsoWeek('2020-W53'), true);
    assert.equal(isIsoWeek('2026-W53'), true);
    assert.equal(isIsoWeek('2025-W53'), false);
    assert.equal(isIsoWeek('2027-W53'), false);
    assert.equal(isIsoWeek('2026-W00'), false);
    assert.equal(isIsoWeek('2026-W5'), false);
    assert.equal(isIsoWeek('2026-w39'), false);
    assert.equal(isIsoWeek(39), false);
    assert.throws(() => weekDays('2025-W53'), RangeError);
    assert.throws(() => isoWeekOf('2026-02-30'), RangeError);
  });

  test('shiftWeek steps through week 53 and across years', () => {
    assert.equal(shiftWeek('2026-W39', 1), '2026-W40');
    assert.equal(shiftWeek('2026-W39', -1), '2026-W38');
    assert.equal(shiftWeek('2026-W52', 1), '2026-W53');
    assert.equal(shiftWeek('2026-W53', 1), '2027-W01');
    assert.equal(shiftWeek('2027-W01', -1), '2026-W53');
    assert.equal(shiftWeek('2025-W52', 1), '2026-W01');
    assert.equal(shiftWeek('2026-W39', 0), '2026-W39');
    assert.equal(shiftWeek('2026-W39', 52), '2027-W38');
  });
});

describe('parseWeek and serializeWeek', () => {
  test('reads the contract example', () => {
    const w = parseWeek(CONTRACT_EXAMPLE, '2026-W39');
    assert.equal(w.week, '2026-W39');
    assert.equal(w.updated, '2026-09-27T12:40:00+05:30');
    assert.deepEqual(w.anytime, [{ text: 'Renew the domain', done: false }]);
    assert.deepEqual(Object.keys(w.days), ['2026-09-21', '2026-09-24']);
    assert.deepEqual(itemsFor(w, '2026-09-21'), [
      { text: 'Call the vendor about invoices', done: true },
      { text: 'Review Teacher Corner PR', done: false, taskId: 'teacher-corner-web-consolidation' },
    ]);
    assert.deepEqual(itemsFor(w, '2026-09-22'), []);
    assert.equal(w.extra, '');
    assert.equal(w.meta, undefined);
  });

  test('a file Ledge wrote round trips byte for byte', () => {
    assert.equal(serializeWeek(parseWeek(CONTRACT_EXAMPLE, '2026-W39')), CONTRACT_EXAMPLE);
    const built: WeekFile = {
      week: '2020-W53',
      anytime: [],
      days: {
        '2021-01-03': [{ text: 'Sunday in the new year', done: true }],
        '2020-12-28': [{ text: 'Monday', done: false, taskId: 'a-task' }],
      },
      extra: 'Some prose the person wrote.',
      meta: { colour: 'green' },
      updated: '2021-01-01T08:00:00+05:30',
    };
    const text = serializeWeek(built);
    assert.equal(serializeWeek(parseWeek(text, '2020-W53')), text);
    assert.ok(text.indexOf('## Mon 2020-12-28') < text.indexOf('## Sun 2021-01-03'), 'days in order');
    assert.ok(text.endsWith('Some prose the person wrote.\n'));
  });

  test('sections are written Anytime first, then days in calendar order, empty days left out', () => {
    const text = serializeWeek({
      week: '2026-W39',
      anytime: [{ text: 'A', done: false }],
      days: {
        '2026-09-27': [{ text: 'Sun', done: false }],
        '2026-09-22': [],
        '2026-09-21': [{ text: 'Mon', done: false }],
      },
      extra: '',
    });
    const headings = text.split('\n').filter((line) => line.startsWith('## '));
    assert.deepEqual(headings, ['## Anytime', '## Mon 2026-09-21', '## Sun 2026-09-27']);
    assert.ok(!text.includes('updated:'), 'no updated key when there is none');
  });

  test('an empty week is only its frontmatter', () => {
    const text = serializeWeek(emptyWeek('2026-W39'));
    assert.equal(text, '---\nweek: 2026-W39\n---\n');
    assert.deepEqual(parseWeek(text, '2026-W39'), emptyWeek('2026-W39'));
    assert.deepEqual(parseWeek('', '2026-W39'), emptyWeek('2026-W39'));
  });

  test('keeps unknown text, days outside the week and unknown keys', () => {
    const text = [
      '---',
      'week: 2026-W39',
      'mood: busy',
      'tags:',
      '  - a',
      '---',
      'A line before any heading.',
      '',
      '## Mon 2026-09-21',
      '',
      '- [ ] Real item',
      'A stray line under Monday.',
      '',
      '## Mon 2026-09-28',
      '',
      '- [ ] Next week, written here by hand',
      '',
      '## Ideas',
      '',
      'Free prose.',
      '',
    ].join('\n');
    const w = parseWeek(text, '2026-W39');
    assert.deepEqual(w.meta, { mood: 'busy', tags: ['a'] });
    assert.deepEqual(Object.keys(w.days), ['2026-09-21']);
    assert.match(w.extra, /^A line before any heading\./);
    assert.match(w.extra, /A stray line under Monday\./);
    assert.match(w.extra, /## Mon 2026-09-28\n\n- \[ \] Next week, written here by hand/);
    assert.match(w.extra, /## Ideas\n\nFree prose\.$/);
    const again = serializeWeek(w);
    assert.match(again, /^---\nweek: 2026-W39\nmood: busy\ntags:\n {2}- a\n---\n/);
    assert.deepEqual(parseWeek(again, '2026-W39'), w);
    assert.equal(serializeWeek(parseWeek(again, '2026-W39')), again);
  });

  test('is lenient about what a person types', () => {
    const text = [
      '## anytime',
      '- [ ] lower case heading is not Anytime',
      '## Anytime',
      '* [X] star bullet, capital X',
      '  wrapped onto a second line',
      '## Tue 2026-09-21',
      '- [ ] the date decides the day {task: linked-one}',
      '## Anytime',
      '- [ ] a second Anytime section is merged',
    ].join('\r\n');
    const w = parseWeek(text, '2026-W39');
    assert.deepEqual(w.anytime, [
      { text: 'star bullet, capital X wrapped onto a second line', done: true },
      { text: 'a second Anytime section is merged', done: false },
    ]);
    assert.deepEqual(itemsFor(w, '2026-09-21'), [
      { text: 'the date decides the day', done: false, taskId: 'linked-one' },
    ]);
    assert.match(w.extra, /## anytime/);
    assert.match(serializeWeek(w), /## Mon 2026-09-21/);
  });

  test('a heading inside a fenced block is content, not a section', () => {
    const text = ['## Ideas', '', '```md', '## Anytime', '- [ ] not an item', '```', ''].join('\n');
    const w = parseWeek(text, '2026-W39');
    assert.deepEqual(w.anytime, []);
    assert.match(w.extra, /```md\n## Anytime\n- \[ \] not an item\n```/);
  });

  test('broken frontmatter is kept as text rather than thrown', () => {
    const text = ['---', 'week: [unclosed', '---', '## Anytime', '- [ ] still read', ''].join('\n');
    const w = parseWeek(text, '2026-W39');
    assert.deepEqual(w.anytime, [{ text: 'still read', done: false }]);
    assert.match(w.extra, /week: \[unclosed/);
  });

  test('the file name, not the frontmatter, says which week it is', () => {
    const w = parseWeek('---\nweek: 2020-W01\n---\n', '2026-W39');
    assert.equal(w.week, '2026-W39');
    assert.equal(w.meta, undefined);
  });

  test('item text with a line break is folded onto one line', () => {
    const text = serializeWeek({
      week: '2026-W39',
      anytime: [{ text: 'two\nlines ', done: false, taskId: ' t ' }],
      days: {},
      extra: '',
    });
    assert.match(text, /^- \[ \] two lines \{task: t\}$/m);
  });
});

describe('numberWeek', () => {
  test('numbers Anytime first, then days in order, items in file order', () => {
    const w = parseWeek(CONTRACT_EXAMPLE, '2026-W39');
    const numbered = numberWeek(w);
    assert.deepEqual(
      numbered.map((item) => [item.n, item.day, item.index, item.text]),
      [
        [1, 'anytime', 0, 'Renew the domain'],
        [2, '2026-09-21', 0, 'Call the vendor about invoices'],
        [3, '2026-09-21', 1, 'Review Teacher Corner PR'],
        [4, '2026-09-24', 0, 'Sprint demo prep'],
      ],
    );
    assert.equal(numbered[2]!.taskId, 'teacher-corner-web-consolidation');
  });
});

describe('the pure entry', () => {
  test('exports the week API under the same names', () => {
    for (const name of ['isoWeekOf', 'weekDays', 'shiftWeek', 'parseWeek', 'serializeWeek', 'itemsFor']) {
      assert.equal(typeof (pure as Record<string, unknown>)[name], 'function', name);
    }
    assert.equal((pure as Record<string, unknown>).WeekStore, undefined, 'the store is Node only');
  });
});

describe('WeekStore', () => {
  function tempHome(): string {
    const home = mkdtempSync(join(tmpdir(), 'ledge-week-'));
    process.env.LEDGE_HOME = home;
    return home;
  }

  test('a missing file is an empty week and nothing is created by reading', () => {
    const home = tempHome();
    try {
      const store = new WeekStore();
      assert.equal(store.home, home);
      assert.equal(store.path('2026-W39'), join(home, 'weeks', '2026-W39.md'));
      assert.deepEqual(store.get('2026-W39'), emptyWeek('2026-W39'));
      assert.equal(existsSync(join(home, 'weeks')), false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('put creates the folder, stamps updated, writes atomically and reads back', () => {
    const home = tempHome();
    try {
      const store = new WeekStore(home);
      const week = emptyWeek('2026-W39');
      week.anytime.push({ text: 'Renew the domain', done: false });
      const saved = store.put(week, new Date('2026-09-27T07:10:00Z'));
      assert.equal(week.updated, undefined, 'the argument is not changed');
      assert.ok(saved.updated, 'updated is stamped');
      assert.deepEqual(readdirSync(join(home, 'weeks')), ['2026-W39.md'], 'no temp file left');
      const text = readFileSync(store.path('2026-W39'), 'utf8');
      assert.equal(text, serializeWeek(saved));
      assert.deepEqual(store.get('2026-W39'), saved);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('reads a hand-written file and refuses a week that is not one', () => {
    const home = tempHome();
    try {
      mkdirSync(join(home, 'weeks'));
      writeFileSync(join(home, 'weeks', '2026-W39.md'), CONTRACT_EXAMPLE);
      const store = new WeekStore(home);
      assert.equal(store.get('2026-W39').anytime[0]!.text, 'Renew the domain');
      assert.throws(() => store.path('../escape'), RangeError);
      assert.throws(() => store.get('2025-W53'), RangeError);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
