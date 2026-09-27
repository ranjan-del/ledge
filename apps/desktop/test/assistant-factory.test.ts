import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-shell', () => ({ Command: { create: vi.fn() } }));
vi.mock('../src/lib/io.ts', () => ({
  readText: vi.fn(),
  writeText: vi.fn(),
  moveFile: vi.fn(),
  removeFile: vi.fn(),
  listDir: vi.fn(async () => [
    { name: 'a.json', isFile: true, isDirectory: false },
    { name: 'sub', isFile: false, isDirectory: true },
  ]),
  ensureDir: vi.fn(),
}));
vi.mock('../src/lib/store.svelte.ts', async () => {
  const { taskA, taskC } = await import('./fixtures.ts');
  return {
    desk: {
      home: '/h',
      ledgeHome: '/h/.ledge',
      tasks: [taskA(), { ...taskC(), status: 'done' }],
      pending: [],
      lastScan: null,
      insights: {},
      sessionRecords: [],
    },
    weekFor: (week: string) => ({ week, anytime: [], days: {}, extra: '' }),
  };
});

const mod = await import('../src/lib/assistant/index.ts');

describe('the factory', () => {
  it('gives one shared engine, and new ones on request', () => {
    const a = mod.getAssistantEngine();
    expect(mod.getAssistantEngine()).toBe(a);
    expect(mod.createAssistantEngine()).not.toBe(a);
    expect(a.status()).toBe('ready');
  });

  it('reads the desk for context and routing terms', () => {
    const terms = mod.deskTerms();
    expect(terms).toContain('release-watch-banner');
    expect(terms).not.toContain('version-file-rollout');
    const context = mod.deskContext();
    expect(context).toContain('id: release-watch-banner');
    expect(context).toContain('=== END ===');
  });

  it('lists only files as chat candidates', async () => {
    expect(await mod.pluginHistoryFs.list('/h/.ledge/chats')).toEqual(['a.json']);
  });
});
