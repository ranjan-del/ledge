/**
 * The weekly to-do list, Node half: WeekStore over `<home>/weeks/`, one `<YYYY>-W<ww>.md` file
 * per ISO week. The format and every rule about it live in ./week.ts; this file only finds the
 * file, reads it and writes it.
 *
 * A missing file is an empty week, never an error, because a week nobody has written anything
 * into yet is the normal case and not a fault. The folder is created on the first write, and
 * every write goes through a temporary sibling and a rename, the same as the sidecar records,
 * so the panel's watcher sees either the old list or the new one and never half of each.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expandTilde, ledgeHome } from './config.ts';
import { writeAtomic } from './sidecars-node.ts';
import { formatIso } from './task-file.ts';
import { emptyWeek, isIsoWeek, moveWeekItemToWeek, parseWeek, serializeWeek } from './week.ts';
import type { WeekFile } from './week.ts';

/**
 * One file per ISO week under `<home>/weeks/`. `home` defaults to `ledgeHome()`, which is what
 * keeps every test away from the real store. Like TaskStore it keeps no cache: every `get`
 * reads the file fresh, because the desktop panel, an editor and the CLI may all change it.
 */
export class WeekStore {
  readonly home: string;

  constructor(home?: string) {
    this.home = resolve(expandTilde(home ?? ledgeHome()));
  }

  /** Folder the week files live in. */
  get dir(): string {
    return join(this.home, 'weeks');
  }

  /**
   * Absolute path of a week's file, whether or not it exists. Throws a RangeError for anything
   * that is not a real `YYYY-Www` week, since that string becomes a file name.
   */
  path(week: string): string {
    if (!isIsoWeek(week)) throw new RangeError(`Not a YYYY-Www week: ${week}`);
    return join(this.dir, `${week}.md`);
  }

  /** The week as it stands on disk, or an empty week when there is no file for it yet. */
  get(week: string): WeekFile {
    const file = this.path(week);
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyWeek(week);
      throw error;
    }
    return parseWeek(text, week);
  }

  /**
   * Writes a week atomically, stamping `updated` with the current time, and returns what was
   * written. The argument is not changed. The week folder is created when it is missing.
   */
  put(file: WeekFile, now: Date = new Date()): WeekFile {
    const target = this.path(file.week);
    const saved: WeekFile = { ...file, updated: formatIso(now) };
    mkdirSync(this.dir, { recursive: true });
    writeAtomic(target, serializeWeek(saved));
    return saved;
  }

  /**
   * Moves item `n` of week `from` to the end of Anytime in week `to`, as moveWeekItemToWeek
   * does, and writes both files. Returns both as written. The target is written first, so a
   * failure between the two writes leaves the item in both weeks rather than in neither. Throws
   * a RangeError for a week that is not one, the same week twice, or an `n` that names no item.
   */
  moveItem(from: string, n: number, to: string, now: Date = new Date()): { from: WeekFile; to: WeekFile } {
    const moved = moveWeekItemToWeek(this.get(from), n, this.get(to));
    const target = this.put(moved.to, now);
    const source = this.put(moved.from, now);
    return { from: source, to: target };
  }
}
