/**
 * A note or a plan step reduced to what a person can read at a glance: a one line title and a
 * one or two sentence summary. The words come from the task's insights sidecar when it holds a
 * current entry for exactly this text, and from the text itself otherwise. The original is
 * never changed and never hidden for good; every view that shows a digest keeps the full text
 * one press away.
 *
 * "Current" is decided by the content key alone. An insight is keyed by the text it was
 * written about, so an edited note or step no longer matches its old entry, and a stale title
 * is simply not shown rather than shown against words it no longer describes.
 */
import type { NoteEntry } from '@ledge/core/pure';
import { contentKey, type TaskInsights } from './insights.ts';

/** Longest title the fallback produces, ellipsis included. */
export const TITLE_CHARS = 60;

export interface Digest {
  title: string;
  /** Empty when there is nothing past the title worth a second line. */
  summary: string;
  /** True when the title and summary came from the insights sidecar. */
  fromInsight: boolean;
  /** True when the full original says more than title and summary together. */
  hasMore: boolean;
}

/**
 * Markdown prose flattened to plain words: list markers, heading hashes, emphasis and inline
 * code ticks removed, whitespace collapsed. Only for the digest; the original keeps all of it.
 */
export function plainText(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)]|>|#{1,6})\s+/, ''))
    .join(' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits prose into sentences on `.`, `!` or `?` followed by a space. Keeps the punctuation. */
export function sentences(text: string): string[] {
  const flat = plainText(text);
  if (flat === '') return [];
  return flat
    .split(/(?<=[.!?])\s+(?=\S)/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** Cuts text to at most `max` characters at a word boundary, adding an ellipsis when cut. */
export function clip(text: string, max: number = TITLE_CHARS): string {
  if (text.length <= max) return text;
  const room = text.slice(0, max - 1);
  const space = room.lastIndexOf(' ');
  const cut = space > max / 2 ? room.slice(0, space) : room;
  return `${cut.replace(/[\s,;:.]+$/, '')}…`;
}

/** At most two sentences, joined back into one line. */
function twoSentences(parts: string[]): string {
  return parts.slice(0, 2).join(' ');
}

/** The contract's note fallback: first sentence as the title, the next one or two as summary. */
export function noteFallback(body: string): { title: string; summary: string } {
  const parts = sentences(body);
  const first = parts[0] ?? '';
  return { title: clip(first), summary: twoSentences(parts.slice(1)) };
}

/**
 * The contract's plan fallback: the text up to the first `:` or ` (`, or 60 characters, as the
 * title; what follows, one or two sentences of it, as the summary.
 */
export function stepFallback(step: string): { title: string; summary: string } {
  const flat = plainText(step);
  const colon = flat.indexOf(':');
  const paren = flat.indexOf(' (');
  const cuts = [colon, paren].filter((i) => i > 0);
  const at = cuts.length > 0 ? Math.min(...cuts) : -1;
  if (at > 0 && at <= TITLE_CHARS) {
    const title = flat.slice(0, at).trim();
    let rest = flat.slice(at).replace(/^:\s*/, '').trim();
    /* A bracket that was the cut keeps its brackets in the summary only when it is the whole
       remainder; otherwise it reads as an aside, which is what it was. */
    if (rest.startsWith('(') && rest.endsWith(')') && !rest.slice(1, -1).includes('(')) {
      rest = rest.slice(1, -1).trim();
    }
    return { title, summary: twoSentences(sentences(rest)) };
  }
  if (flat.length <= TITLE_CHARS) return { title: flat, summary: '' };
  const parts = sentences(flat);
  const first = parts[0] ?? flat;
  if (first.length <= TITLE_CHARS) return { title: first, summary: twoSentences(parts.slice(1)) };
  return { title: clip(first), summary: twoSentences(parts.slice(1)) };
}

/** The content key the insights sidecar files a note under. */
export function noteKey(note: NoteEntry): string {
  return contentKey(`${note.date}\n${note.body}`);
}

function compare(digestWords: string, original: string): boolean {
  return plainText(original).length > digestWords.replace(/…$/, '').length + 1;
}

/** Title and summary for one dated note, from insights when current, else the fallback. */
export function noteDigest(note: NoteEntry, insights?: TaskInsights): Digest {
  const entry = insights?.notes[noteKey(note)];
  if (entry && entry.title.trim() !== '') {
    return {
      title: entry.title.trim(),
      summary: entry.summary.trim(),
      fromInsight: true,
      hasMore: true,
    };
  }
  const fb = noteFallback(note.body);
  return {
    ...fb,
    fromInsight: false,
    hasMore: compare(`${fb.title} ${fb.summary}`.trim(), note.body),
  };
}

/** Title and detail for one plan step, from insights when current, else the fallback. */
export function stepDigest(step: string, insights?: TaskInsights): Digest {
  const entry = insights?.plan[contentKey(step)];
  if (entry && entry.title.trim() !== '') {
    const summary = entry.detail?.trim() ?? '';
    return {
      title: entry.title.trim(),
      summary,
      fromInsight: true,
      hasMore: plainText(step) !== entry.title.trim(),
    };
  }
  const fb = stepFallback(step);
  return {
    ...fb,
    fromInsight: false,
    hasMore: compare(`${fb.title} ${fb.summary}`.trim(), step),
  };
}
