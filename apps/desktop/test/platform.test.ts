import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'macos' }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({ homeDir: vi.fn(async () => '/home/t') }));
vi.mock('@tauri-apps/plugin-fs', () => ({}));
vi.mock('@tauri-apps/plugin-shell', () => ({ Command: { create: vi.fn() } }));

import { claudeCommand, detectOs, shellQuote, terminalLaunch } from '../src/lib/platform.ts';
import { taskA } from './fixtures.ts';

const claude = { command: 'claude', resumeFlag: '--resume' };

describe('platform', () => {
  it('detects the os from the plugin', () => {
    expect(detectOs()).toBe('macos');
  });

  it('quotes for sh', () => {
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`);
  });

  it('resumes the newest session when asked, otherwise briefs a new one', () => {
    const task = taskA();
    expect(claudeCommand(task, true, claude)).toBe(`claude --resume '071729a1'`);
    const fresh = claudeCommand(task, false, claude);
    expect(fresh.startsWith(`claude '`)).toBe(true);
    expect(fresh).toContain('Release watch banner for stale tabs');
    expect(fresh).toContain('- [ ] Build step'.replace('- [ ] ', '- '));
    expect(fresh).not.toContain('Investigated caching');
    expect(claudeCommand({ ...task, sessions: [] }, true, claude).startsWith(`claude '`)).toBe(true);
  });

  it('builds Terminal.app, wt and x-terminal-emulator launches that match the capability', () => {
    const mac = terminalLaunch('macos', 'Terminal.app', '/home/t/code/app', 'claude');
    expect(mac.name).toBe('osascript');
    expect(mac.args[0]).toBe('-e');
    expect(mac.args[1]).toContain(`do script "cd '/home/t/code/app' && claude"`);
    expect(mac.args[2]).toBe('-e');
    expect(mac.args[3]).toBe('tell application "Terminal" to activate');

    const win = terminalLaunch('windows', 'wt', 'C:\\code\\app', 'claude');
    expect(win.name).toBe('wt');
    expect(win.args).toEqual(['-d', 'C:\\code\\app', 'cmd', '/k', 'claude']);

    const lin = terminalLaunch('linux', 'x-terminal-emulator', '/home/t/code/app', 'claude');
    expect(lin.name).toBe('x-terminal-emulator');
    expect(lin.args.slice(0, 3)).toEqual(['-e', 'sh', '-c']);
    expect(lin.args[3]).toContain(`cd '/home/t/code/app' && claude`);
  });

  it('escapes quotes and newlines inside the AppleScript string', () => {
    const spec = terminalLaunch('macos', 'Terminal.app', '/d', `claude 'a "b"\nc'`);
    expect(spec.args[1]).toContain('\\"b\\"');
    expect(spec.args[1]).toContain('\\n');
    expect(spec.args[1]).not.toContain('\n');
  });
});
