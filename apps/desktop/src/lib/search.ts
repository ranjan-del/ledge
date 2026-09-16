/**
 * What the search pill in the header actually searches: the tasks themselves and the dated
 * notes, as one flat list of hits. A hit always carries the task it came from, so choosing one
 * can open that task rather than land on a dead end.
 *
 * The note half is `searchMemory` from `@ledge/core/pure` rather than a second matcher of its
 * own, so the header search and the MEMORY surface can never disagree about what a query finds.
 * The task half uses the same rule that function documents: every term must appear, case is
 * ignored, nothing is ranked and nothing is stemmed, because a person has to be able to predict
 * what a search will return.
 *
 * There is no index. The desk is a few dozen files; a scan is instant and it cannot go stale.
 */
import { memoryFor, searchMemory, type Task } from '@ledge/core/pure';

export interface Hit {
  /** `task` means the match was in the task itself; `note` means it was in a dated note. */
  kind: 'task' | 'note';
  task: Task;
  /** The line to show. For a task hit this is the title or the matching line. */
  text: string;
  /** Which part of the task matched, shown small beside the line. */
  where: string;
  /** The note's day, for note hits only. */
  date?: string;
}

/**
 * The whitespace-separated terms of a query, lowercased, blanks dropped. Exported because the
 * command palette matches session ids, repository paths and action labels with the same rule,
 * and two definitions of "what counts as a match" would let the two surfaces disagree.
 */
export function terms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter((w) => w !== '');
}

/** True when every term appears in `haystack`, ignoring case. The whole matching rule. */
export function matches(haystack: string, words: string[]): boolean {
  const hay = haystack.toLowerCase();
  return words.every((word) => hay.includes(word));
}

/** The first line of `text` carrying every term, so a hit shows the sentence it matched. */
function matchingLine(text: string, words: string[]): string {
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line !== '' && matches(line, words)) return line;
  }
  return text.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
}

/**
 * Hits for a query, tasks before notes, capped so a broad query cannot flood the panel. An
 * empty query returns nothing at all rather than everything, because a search field that
 * answers before it is asked is noise.
 */
export function searchDesk(tasks: Task[], query: string, limit = 24): Hit[] {
  const words = terms(query);
  if (words.length === 0) return [];
  const hits: Hit[] = [];
  for (const task of tasks) {
    if (matches(task.title, words)) {
      hits.push({ kind: 'task', task, text: task.title, where: 'title' });
      continue;
    }
    const item = task.checklist.find((i) => matches(i.text, words));
    const step = task.plan.find((s) => matches(s, words));
    if (matches(task.requirement, words)) {
      hits.push({
        kind: 'task',
        task,
        text: matchingLine(task.requirement, words),
        where: 'requirement',
      });
    } else if (item) {
      hits.push({ kind: 'task', task, text: item.text, where: 'checklist' });
    } else if (step) {
      hits.push({ kind: 'task', task, text: step, where: 'plan' });
    }
  }
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const entry of searchMemory(memoryFor(tasks), query)) {
    const task = byId.get(entry.taskId);
    if (!task) continue;
    hits.push({
      kind: 'note',
      task,
      text: matchingLine(entry.body, words),
      where: entry.taskTitle,
      date: entry.date,
    });
  }
  return hits.slice(0, limit);
}
