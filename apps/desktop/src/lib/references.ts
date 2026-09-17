/**
 * `## References`: the raw material a person pastes into a task while they work on it. A
 * message somebody sent them, a link, an error, a snippet. Free-form text, kept exactly as it
 * was pasted and never interpreted.
 *
 * WHERE IT LIVES. @ledge/core does not model this yet: there is no `references` field on
 * `Task` in `@ledge/core/pure` as of this writing, so the section is kept inside `Task.extra`,
 * which core preserves verbatim for every heading it does not know. `referencesOf` and
 * `withReferences` check for a real `references` string on the task first and only fall back to
 * the `extra` carving, so the day core lands the field this module picks it up without being
 * touched. Delete the fallback and `restOf` then; `restOf`'s only job is keeping the block out
 * of the detail view's "Also in the file".
 *
 * WHY THE BLOCK IS QUOTED ON DISK. A paste is arbitrary text and some of it looks like
 * Markdown structure. Core's section splitter is neither fence-aware nor indentation-aware: it
 * trims each line and starts a new section on anything matching `## `. So a pasted
 * `## Plan`, even one sitting inside a code fence, used to be read back as the task's OWN plan
 * on the next load, and the text after it vanished from References. That is not a display
 * nuisance, it is the file being rewritten into something nobody typed.
 *
 * The fix is to store the body as a Markdown blockquote: every line gets `> ` in front of it,
 * so no line in it can ever trim down to a `## ` heading, and core cannot mistake any part of
 * a paste for a section of the task. It is exactly reversible, it costs two characters a line,
 * and a blockquote is what pasted material is: something quoted from elsewhere. What the person
 * sees, and what `referencesOf` returns, is always the paste itself.
 *
 * One imperfection, and it is worth stating: a References block written by hand, or by the
 * earlier unquoted version of this module, is read plain unless every one of its lines is
 * already quoted. A hand-written block that happens to be nothing but a blockquote therefore
 * loses one `> ` level the first time it is read here. After the first save through Ledge every
 * paste round trips byte for byte.
 */
import type { Task } from '@ledge/core/pure';

export const REFERENCES_HEADING = '## References';

/** What core treats as the start of a new section. Matched against the trimmed line, as it is. */
const SECTION = /^##\s+\S/;
/** A line of the stored blockquote: `> something`, or a bare `>` for a blank line. */
const QUOTED = /^>( |$)/;

/** A task as it will be once core models the section. Until then `references` is absent. */
type MaybeReferenced = Task & { references?: string };

/**
 * Wraps a paste so that nothing in it can be read as structure. Blank lines become a bare `>`
 * rather than `> ` with nothing after it, so the file carries no trailing whitespace.
 */
function quote(body: string): string {
  return body
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

/**
 * Takes the quoting off, and only when the whole block is quoted. A block with one unquoted
 * line in it was not written by `quote`, so it is someone's hand-written Markdown and is
 * handed back untouched.
 */
function unquote(block: string): string {
  if (block === '') return '';
  const lines = block.split('\n');
  if (!lines.every((line) => QUOTED.test(line))) return block;
  return lines.map((line) => (line === '>' ? '' : line.slice(2))).join('\n');
}

/**
 * Cuts `extra` into the References block and everything else, both verbatim. The block runs
 * from the heading to the next `## ` heading that core would also see, which is why the test is
 * the trimmed line: core trims before matching, so an indented heading ends a section there
 * too, and a carving that disagreed with core would put the boundary in a different place
 * from the file on disk.
 */
export function carve(extra: string): { references: string; rest: string } {
  const body: string[] = [];
  const rest: string[] = [];
  let inside = false;
  let taken = false;
  for (const line of extra.split('\n')) {
    const trimmed = line.trim();
    if (SECTION.test(trimmed)) {
      inside = !taken && trimmed === REFERENCES_HEADING;
      if (inside) {
        taken = true;
        continue;
      }
    }
    (inside ? body : rest).push(line);
  }
  return { references: unquote(body.join('\n').trim()), rest: rest.join('\n').trim() };
}

/** The references on a task, however they are currently stored. '' when there are none. */
export function referencesOf(task: Task): string {
  const native = (task as MaybeReferenced).references;
  if (typeof native === 'string') return native;
  return carve(task.extra).references;
}

/** Whatever else the file holds that Ledge does not model, with the references taken out. */
export function restOf(task: Task): string {
  if (typeof (task as MaybeReferenced).references === 'string') return task.extra;
  return carve(task.extra).rest;
}

/**
 * A copy of the task with these references and nothing else changed. The text is written as
 * given apart from trailing blank lines: what was pasted is what is saved.
 */
export function withReferences(task: Task, references: string): Task {
  const body = references.replace(/\s+$/, '');
  if (typeof (task as MaybeReferenced).references === 'string') {
    return { ...task, references: body } as Task;
  }
  const { rest } = carve(task.extra);
  if (body.trim() === '') return { ...task, extra: rest };
  const block = `${REFERENCES_HEADING}\n\n${quote(body)}`;
  return { ...task, extra: rest === '' ? block : `${rest}\n\n${block}` };
}

/**
 * A copy of the task with `text` added under the references already there, separated by one
 * blank line. Appending is the common act: a second message pasted an hour later must not mean
 * re-editing the first.
 */
export function appendReference(task: Task, text: string): Task {
  const body = text.replace(/\s+$/, '');
  if (body.trim() === '') return task;
  const current = referencesOf(task);
  return withReferences(task, current === '' ? body : `${current}\n\n${body}`);
}
