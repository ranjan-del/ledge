import type { Task } from './types.ts';

/**
 * Builds the text handed to a brand new Claude Code session when a person clicks Open or Resume
 * in Claude and no previous session id exists. It carries the title, the requirement and only
 * the unchecked items, so Claude starts with the same context the SessionStart hook would give
 * it, without spending tokens on work that is already done.
 */
export function buildResumePrompt(task: Task): string {
  const pending = task.checklist.filter((item) => !item.done);
  const lines: string[] = [];
  lines.push(`Resume the Ledge task "${task.title}" (id: ${task.id}).`, '');
  lines.push('Requirement:');
  const requirement = task.requirement.trim();
  lines.push(requirement === '' ? '(no requirement recorded yet)' : requirement);
  lines.push('', 'Still to do:');
  if (pending.length === 0) {
    lines.push('(nothing unchecked; review the task and decide the next step)');
  } else {
    for (const item of pending) lines.push(`- ${item.text}`);
  }
  if (task.file !== '') {
    lines.push('', `Task file: ${task.file}`);
    lines.push(
      'Tick checklist items in that file as each step finishes, and add new items as you go.',
    );
  }
  return lines.join('\n') + '\n';
}
