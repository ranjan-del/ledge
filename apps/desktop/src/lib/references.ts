/**
 * `## References`: the raw material a person pastes into a task while they work on it. A
 * message somebody sent them, a link, an error, a snippet. Free-form Markdown, kept exactly as
 * it was pasted and never interpreted.
 *
 * PLACEHOLDER, and it must be repointed. @ledge/core is gaining `Task.references: string` with
 * `## References` as a section the parser and the serializer both know. Until that lands, this
 * module reads and writes the section inside `Task.extra`, which is safe rather than clever:
 * core already keeps every unknown `## ` section verbatim in `extra` and writes it back out
 * unchanged, so a `## References` block round trips through Ledge today byte for byte. Nothing
 * else in the app reads or writes references.
 *
 * When core lands the field, `referencesOf` and `withReferences` below pick it up on their own:
 * both check for a real `references` string on the task first and only fall back to the `extra`
 * carving. Delete the fallback then, and delete `restOf`, whose only job is keeping the block
 * out of the detail view's "Also in the file".
 *
 * One known limit of the fallback, gone the moment core owns the field: a pasted line that
 * starts a Markdown section at column 0, `## like this` and outside a code fence, ends the
 * block on the next read, so text after it shows under "Also in the file" instead. Nothing is
 * lost, it is only filed elsewhere. Fences are tracked, so a pasted code fence containing `##`
 * stays inside the references where it belongs.
 */
import type { Task } from '@ledge/core/pure';

export const REFERENCES_HEADING = '## References';

const SECTION = /^##\s+\S/;
const FENCE = /^\s*(```|~~~)/;

/** A task as it will be once core models the section. Until then `references` is absent. */
type MaybeReferenced = Task & { references?: string };

/**
 * Cuts `extra` into the References block's body and everything else, both verbatim. Lines
 * inside a fenced code block never count as a heading, so a pasted fence holding `## Steps`
 * stays where it was pasted.
 */
export function carve(extra: string): { references: string; rest: string } {
  const body: string[] = [];
  const rest: string[] = [];
  let inside = false;
  let taken = false;
  let fenced = false;
  for (const line of extra.split('\n')) {
    if (FENCE.test(line)) fenced = !fenced;
    else if (!fenced && SECTION.test(line)) {
      inside = !taken && line.trim() === REFERENCES_HEADING;
      if (inside) {
        taken = true;
        continue;
      }
    }
    (inside ? body : rest).push(line);
  }
  return { references: body.join('\n').trim(), rest: rest.join('\n').trim() };
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
  const block = `${REFERENCES_HEADING}\n\n${body}`;
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
