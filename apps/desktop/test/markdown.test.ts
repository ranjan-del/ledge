import { render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Markdown from '../src/components/Markdown.svelte';
import { parseInline, parseMarkdown, safeHref } from '../src/lib/markdown.ts';

describe('parseMarkdown', () => {
  it('reads paragraphs, bullet and numbered lists, and fenced code', () => {
    const blocks = parseMarkdown('First line\nsame paragraph\n\n- one\n- two\n\n3. three\n4. four\n\n```ts\nconst a = 1;\n```');
    expect(blocks.map((b) => b.type)).toEqual(['p', 'list', 'list', 'code']);
    expect(blocks[1]).toMatchObject({ ordered: false, items: [[{ text: 'one' }], [{ text: 'two' }]] });
    expect(blocks[2]).toMatchObject({ ordered: true, start: 3 });
    expect(blocks[3]).toEqual({ type: 'code', lang: 'ts', text: 'const a = 1;' });
  });

  it('keeps a code fence that has not closed yet, since answers arrive as a stream', () => {
    expect(parseMarkdown('Look:\n```\nledge list')).toEqual([
      { type: 'p', inlines: [{ type: 'text', text: 'Look:' }] },
      { type: 'code', lang: '', text: 'ledge list' },
    ]);
  });

  it('draws a heading as a bold line', () => {
    expect(parseMarkdown('## Next up')[0]).toEqual({ type: 'heading', inlines: [{ type: 'text', text: 'Next up' }] });
  });
});

describe('parseInline', () => {
  it('reads bold, italics, inline code and links', () => {
    expect(parseInline('**Poll** on `focus`, see [docs](https://example.com) and *soon*')).toEqual([
      { type: 'strong', children: [{ type: 'text', text: 'Poll' }] },
      { type: 'text', text: ' on ' },
      { type: 'code', text: 'focus' },
      { type: 'text', text: ', see ' },
      { type: 'link', href: 'https://example.com', children: [{ type: 'text', text: 'docs' }] },
      { type: 'text', text: ' and ' },
      { type: 'em', children: [{ type: 'text', text: 'soon' }] },
    ]);
  });

  it('turns a bare web address into a link, without the full stop after it', () => {
    expect(parseInline('Go to https://ledge.dev/a.')).toEqual([
      { type: 'text', text: 'Go to ' },
      { type: 'link', href: 'https://ledge.dev/a', children: [{ type: 'text', text: 'https://ledge.dev/a' }] },
      { type: 'text', text: '.' },
    ]);
  });

  it('keeps only web and mail links, and leaves any other target as its words', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('file:///etc/passwd')).toBeUndefined();
    expect(safeHref('mailto:a@b.co')).toBe('mailto:a@b.co');
    expect(parseInline('[click](javascript:alert(1))')).toEqual([{ type: 'text', text: 'click' }, { type: 'text', text: ')' }]);
  });

  it('leaves a lone marker as the character it is', () => {
    expect(parseInline('2 * 3 and a_b_c')).toEqual([{ type: 'text', text: '2 * 3 and a_b_c' }]);
  });
});

describe('Markdown', () => {
  it('escapes every piece of HTML an answer contains', () => {
    const { container } = render(Markdown, {
      props: { text: '<script>alert(1)</script> **<img src=x onerror=alert(1)>**\n\n- <b>x</b>' },
    });
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('li b')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
    expect(container.querySelector('strong')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('draws lists, code and links, and opens a link through the caller', () => {
    const onopenlink = vi.fn();
    const { container } = render(Markdown, {
      props: { text: 'See [the PR](https://example.com/pr/1)\n\n1. a\n2. b\n\n```\nnpm test\n```', onopenlink },
    });
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
    expect(container.querySelector('pre code')?.textContent).toBe('npm test');
    const link = container.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://example.com/pr/1');
    link.click();
    expect(onopenlink).toHaveBeenCalledWith('https://example.com/pr/1');
  });
});
