/*
 * `## References`: the raw material somebody pastes into a task while working on it. A message,
 * a link, an error, a snippet. Two things are proved here. One, that the section is optional and
 * that a file without it is unchanged by a round trip. Two, that what is in it comes back
 * exactly as it was written, because the parser's whole job in that section is to keep its
 * hands off.
 *
 * The last group is the migration. Before the field existed the desktop kept pasted material
 * inside `Task.extra` as a Markdown blockquote, and those files are on disk now. The decision
 * taken here is to leave that content exactly as it stands: see the group's comment for why.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskStore, appendReference, parseTask, serializeTask } from '../src/index.ts';

const HOME = homedir();

/** Minimal valid frontmatter, so a test can focus on one body section. */
function frontmatter(): string {
  return [
    '---',
    'id: t',
    'title: T',
    'status: current',
    'order: 1',
    'sessions: []',
    'created: 2026-09-16T10:00:00+05:30',
    'updated: 2026-09-16T10:00:00+05:30',
    '---',
  ].join('\n');
}

const PASTE = [
  'Sonal wrote:',
  '',
  '> the tabs are wrong for FLN, it says TnT not TNT',
  '',
  '    TypeError: cannot read tabLayout of undefined',
  '        at resource-page.ts:118',
  '',
  '```ts',
  '## not a heading, it is inside a fence',
  'const tabs = config().resourceNames;',
  '```',
].join('\n');

test('a file with no References section has an empty references and is unchanged', () => {
  const md = [frontmatter(), '', '## Requirement', '', 'Do the thing.', '', '## Checklist', '',
    '- [ ] One item', ''].join('\n');

  const task = parseTask(md, 'x.md', { home: HOME });

  assert.equal(task.references, '', 'absent means empty, the way requirement works');
  assert.equal(serializeTask(task, { home: HOME }), md, 'and no heading is invented for it');
});

test('a References section is kept exactly as written, fences and indentation included', () => {
  const md = frontmatter() + ['', '## Requirement', '', 'Do the thing.', '', '## References',
    '', PASTE, ''].join('\n');

  const task = parseTask(md, 'x.md', { home: HOME });

  assert.equal(task.references, PASTE, 'byte for byte, leading spaces and blank lines too');
  assert.deepEqual(task.plan, [], 'the fenced ## line never became a section of the task');
  assert.equal(task.extra, '', 'and none of it leaked into extra');
});

test('References is written after the checklist and before the notes', () => {
  const md = frontmatter() + ['', '## Requirement', '', 'R', '', '## Notes', '',
    '### 2026-09-16', 'A note.', '', '## References', '', 'A link.', ''].join('\n');

  const out = serializeTask(parseTask(md, 'x.md', { home: HOME }), { home: HOME });
  const lines = out.split('\n');

  assert.ok(lines.indexOf('## Checklist') < lines.indexOf('## References'), 'after the checklist');
  assert.ok(lines.indexOf('## References') < lines.indexOf('## Notes'), 'and before the notes');
});

test('a file with References round trips byte for byte', () => {
  const md = [
    frontmatter(),
    '',
    '## Requirement',
    '',
    'Do the thing.',
    '',
    '## Checklist',
    '',
    '- [ ] One item',
    '',
    '## References',
    '',
    PASTE,
    '',
    '## Notes',
    '',
    '### 2026-09-16',
    'A note.',
    '',
  ].join('\n');

  const once = serializeTask(parseTask(md, 'x.md', { home: HOME }), { home: HOME });
  assert.equal(once, md, 'the file comes back exactly as it was written');
  const twice = serializeTask(parseTask(once, 'x.md', { home: HOME }), { home: HOME });
  assert.equal(twice, once, 'and stays that way on a second pass');
});

test('appendReference adds under what is there and never rewrites it', () => {
  const base = parseTask(frontmatter() + '\n', 'x.md', { home: HOME });

  const one = appendReference(base, 'First message.');
  const two = appendReference(one, 'Second message,\nover two lines.');

  assert.equal(one.references, 'First message.');
  assert.equal(two.references, 'First message.\n\nSecond message,\nover two lines.');
  assert.equal(base.references, '', 'the task handed in is never mutated');
  assert.equal(appendReference(two, '   \n  ').references, two.references, 'blank is a no-op');
});

test('a second appended reference survives a trip through the file', () => {
  const base = parseTask(frontmatter() + '\n', 'x.md', { home: HOME });
  const task = appendReference(appendReference(base, PASTE), 'And a link: https://x.test/y');

  const back = parseTask(serializeTask(task, { home: HOME }), 'x.md', { home: HOME });

  assert.equal(back.references, `${PASTE}\n\nAnd a link: https://x.test/y`);
});

test('the store appends a reference to the file and reads it back', () => {
  const home = mkdtempSync(join(tmpdir(), 'ledge-refs-'));
  const store = new TaskStore(home);
  store.init();
  const task = store.add({ title: 'Refs' });

  store.addReference(task.id, PASTE);
  const after = store.addReference(task.id, 'A second thing to look at.');

  assert.equal(after.references, `${PASTE}\n\nA second thing to look at.`);
  assert.equal(store.get(task.id).references, after.references, 'and it is on disk');
  assert.equal(store.get(task.id).extra, '', 'nothing was duplicated into extra');
});

/*
 * MIGRATION. Before `references` existed the desktop stored pasted material inside `Task.extra`
 * under a `## References` heading, with every line of the body prefixed `> ` so that nothing in
 * a paste could be read as a section of the task. Those files exist. The decision is to LEAVE
 * THAT CONTENT ALONE: it is carried into the new field exactly as it stands, markers and all,
 * and no read and no save rewrites it.
 *
 * Why not promote it. The quoting is not decoration. Fence awareness stops a heading inside a
 * ``` block from ending a section, but a bare `## Plan` on its own line in a paste is a real
 * Markdown heading and ends the section just as it does in `## Requirement`. Unquoting a legacy
 * block would therefore hand exactly the old corruption back to the pastes that were quoted to
 * avoid it. On top of that, a wholly quoted body is indistinguishable from a paste that really
 * is a blockquote, so an automatic unquote would eat a level of someone's real quoting, and
 * doing it on every read would eat another level every time.
 *
 * Nothing is stranded and nothing is duplicated, which is what mattered: the parser now claims
 * `## References` itself, so the block leaves `extra` on the first read and can never again be
 * in both places at once.
 */

/** A task file as the desktop wrote it before the field existed: quoted block, sitting last. */
function legacyFile(quoted: string[]): string {
  return [
    frontmatter(),
    '',
    '## Requirement',
    '',
    'Fix the tabs.',
    '',
    '## Checklist',
    '',
    '- [ ] One item',
    '',
    '## Notes',
    '',
    '### 2026-09-16',
    'A note.',
    '',
    '## References',
    '',
    ...quoted,
    '',
  ].join('\n');
}

test('a legacy blockquoted block moves into references and out of extra, unchanged', () => {
  const quoted = ['> Sonal wrote:', '>', '> the tabs are wrong for FLN'];

  const task = parseTask(legacyFile(quoted), 'x.md', { home: HOME });

  assert.equal(task.references, quoted.join('\n'), 'carried over exactly, markers and all');
  assert.equal(task.extra, '', 'and it is no longer in extra, so it cannot be in both places');
});

test('a legacy block is written exactly once, and is stable from then on', () => {
  const quoted = ['> Sonal wrote:', '>', '> the tabs are wrong for FLN'];

  const out = serializeTask(parseTask(legacyFile(quoted), 'x.md', { home: HOME }), { home: HOME });

  assert.equal(out.split('\n').filter((l) => l === '## References').length, 1, 'exactly one');
  assert.ok(out.includes(quoted.join('\n')), 'the body is untouched');
  const back = parseTask(out, 'x.md', { home: HOME });
  assert.equal(back.references, quoted.join('\n'));
  assert.equal(serializeTask(back, { home: HOME }), out, 'and the file has settled');
});

test('leaving the quoting alone is what keeps a legacy pasted ## Plan out of the plan', () => {
  const quoted = ['> They sent me this:', '>', '> ## Plan', '>', '> 1. not our step'];

  const task = parseTask(legacyFile(quoted), 'x.md', { home: HOME });
  const back = parseTask(serializeTask(task, { home: HOME }), 'x.md', { home: HOME });

  assert.deepEqual(back.plan, [], 'the quoted heading is still only text');
  assert.equal(back.references, quoted.join('\n'), 'and every line of it is still there');
});

/*
 * WHAT GOES IN COMES BACK OUT. References exists to receive whole blocks pasted out of
 * documents, chat and error output, which is exactly the content most likely to hold a line
 * starting with two hashes. A free-form section has to guarantee the round trip itself, so the
 * serializer escapes the lines the reader would otherwise act on and the parser takes the
 * escapes off. Every test here goes through the real serializer and the real parser, because
 * that pairing is the only thing that proves it.
 */

/** A paste through appendReference, the file, and back: what the caller gets returned. */
function throughTheFile(paste: string): { references: string; plan: string[]; extra: string } {
  const base = parseTask(frontmatter() + '\n', 'x.md', { home: HOME });
  const md = serializeTask(appendReference(base, paste), { home: HOME });
  const back = parseTask(md, 'x.md', { home: HOME });
  return { references: back.references, plan: back.plan, extra: back.extra };
}

test('a paste of every line that could be misread comes back exactly as pasted', () => {
  const paste = [
    'From the team:',
    '',
    '## Plan',
    '',
    '1. THEIR step, not ours',
    '',
    '  ## Checklist',
    '',
    '---',
    '',
    '```md',
    '## Notes',
    '  ## Requirement',
    '---',
    '```',
    '',
    'and that is all of it.',
  ].join('\n');

  const { references, plan, extra } = throughTheFile(paste);

  assert.equal(references, paste, 'byte for byte, every line of it');
  assert.deepEqual(plan, [], "and the task's own plan was never touched");
  assert.equal(extra, '', 'and nothing was left behind in extra');
});

test('each misreadable line survives on its own as well as together', () => {
  for (const paste of [
    '## Plan\n\n1. not ours',
    'before\n\n## Plan\n\nafter',
    '  ## Checklist',
    '---',
    'a heading below\n---',
    '```md\n## Plan\n```',
    '### 2020-01-01\nnot a note of ours',
    '#### four hashes',
  ]) {
    assert.equal(throughTheFile(paste).references, paste, JSON.stringify(paste));
  }
});

test('an unterminated fence in a paste cannot swallow the sections under it', () => {
  const base = parseTask(frontmatter() + '\n', 'x.md', { home: HOME });
  const withNote = { ...base, notes: [{ date: '2026-09-16', body: 'A note of ours.' }] };

  const md = serializeTask(appendReference(withNote, '```\nhalf a code block'), { home: HOME });
  const back = parseTask(md, 'x.md', { home: HOME });

  assert.equal(back.references, '```\nhalf a code block');
  assert.deepEqual(back.notes, [{ date: '2026-09-16', body: 'A note of ours.' }], 'notes kept');
});

test('a backslash somebody pasted is given back, not eaten', () => {
  for (const paste of [
    '\\## Plan',
    '\\\\## Plan',
    '\\```',
    'C:\\temp\\## not a heading',
    '```md\n\\## Plan\n```',
  ]) {
    assert.equal(throughTheFile(paste).references, paste, JSON.stringify(paste));
  }
});

test('the escapes are in the file and not in the value', () => {
  const base = parseTask(frontmatter() + '\n', 'x.md', { home: HOME });
  const md = serializeTask(appendReference(base, 'see:\n\n## Plan\n\n```md\n## Plan\n```'), {
    home: HOME,
  });

  assert.match(md, /^\\## Plan$/m, 'the bare heading is escaped on disk');
  assert.match(md, /^```md\n## Plan\n```$/m, 'the fenced one is left exactly as it was');
  const back = parseTask(md, 'x.md', { home: HOME });
  assert.equal(back.references, 'see:\n\n## Plan\n\n```md\n## Plan\n```');
});

test('a file whose References is already escaped round trips byte for byte', () => {
  const md = [
    frontmatter(),
    '',
    '## Requirement',
    '',
    'R',
    '',
    '## Checklist',
    '',
    '- [ ] One item',
    '',
    '## References',
    '',
    'From the team:',
    '',
    '\\## Plan',
    '',
    '  \\## Checklist',
    '',
    '---',
    '',
    '```md',
    '## Notes',
    '```',
    '',
    '## Notes',
    '',
    '### 2026-09-16',
    'A note.',
    '',
  ].join('\n');

  const once = serializeTask(parseTask(md, 'x.md', { home: HOME }), { home: HOME });
  assert.equal(once, md, 'the file comes back exactly as it was written');
});
