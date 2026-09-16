/**
 * Turning Markdown prose from a task file into paragraphs the panel can set at its own width.
 * It lives outside the components because both the task detail and the card's disclosure show
 * the same notes, and two copies of this rule would eventually disagree about a note.
 */

/**
 * Markdown prose from a file is hard-wrapped by whoever wrote it, and `white-space: pre-wrap`
 * turns those wraps into breaks in the middle of sentences. This rejoins each paragraph so it
 * reflows at the panel's width, keeping blank lines as paragraph breaks and keeping the line
 * break before a list item, a quote or a heading, which are the only lines that mean it.
 */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split('\n')
        .reduce<string[]>((lines, raw) => {
          const line = raw.trim();
          if (lines.length === 0 || /^([-*+]|\d+[.)]|>|#)/.test(line)) lines.push(line);
          else lines[lines.length - 1] = `${lines[lines.length - 1]} ${line}`.trim();
          return lines;
        }, [])
        .join('\n')
        .trim(),
    )
    .filter((block) => block !== '');
}
