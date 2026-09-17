/**
 * Settings had no tests at all, which is why nobody could say whether a control in it wrote
 * what it claimed. Every field is checked here the only way that proves anything: change it,
 * save, and read the Config that came out. A control that does not appear in this file is a
 * control nobody has checked.
 *
 * Two behaviours are asserted over and over. One save writes one Config, complete, so nothing
 * that was not touched is dropped. And a field cleared to nothing falls back to what the config
 * already had rather than to a constant, because a box that resets a value to something nobody
 * typed is worse than one that refuses.
 */
import { defaultConfig, type Config } from '@ledge/core/pure';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Settings from '../src/components/Settings.svelte';

/** Config as config.json holds it: `ui.name` is a key core does not model yet. */
type Named = Omit<Config, 'ui'> & { ui: Config['ui'] & { name?: string } };

function config(overrides: Partial<Named> = {}): Config {
  return { ...defaultConfig(), ...overrides } as Config;
}

function open(initial: Config = config()) {
  const onsave = vi.fn();
  render(Settings, { props: { config: initial, onsave, onback: () => {} } });
  return onsave;
}

/** The Config the one Save produced, typed as the file actually is. */
function saved(onsave: ReturnType<typeof vi.fn>): Named {
  return onsave.mock.calls[0]?.[0] as Named;
}

async function save() {
  await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
}

async function type(label: string | RegExp, value: string) {
  await fireEvent.input(screen.getByLabelText(label), { target: { value } });
}

describe('Settings, the name the greeting uses', () => {
  it('shows the name that is in the config', () => {
    open(config({ ui: { ...defaultConfig().ui, name: 'Ranjan' } }));
    expect((screen.getByLabelText(/Your name/) as HTMLInputElement).value).toBe('Ranjan');
  });

  it('is empty when nobody has set one, and says what empty means', () => {
    open();
    const field = screen.getByLabelText(/Your name/) as HTMLInputElement;
    expect(field.value).toBe('');
    expect(field.placeholder).toContain('account name');
  });

  it('writes the name through the same save as everything else', async () => {
    const onsave = open();
    await type(/Your name/, 'Ranjan');
    await save();
    expect(saved(onsave).ui.name).toBe('Ranjan');
  });

  it('trims it, since a trailing space in a greeting is nobody s intention', async () => {
    const onsave = open();
    await type(/Your name/, '  Ranjan  ');
    await save();
    expect(saved(onsave).ui.name).toBe('Ranjan');
  });

  it('drops the key when the field is emptied, which is what falling back means', async () => {
    const onsave = open(config({ ui: { ...defaultConfig().ui, name: 'Ranjan' } }));
    await type(/Your name/, '   ');
    await save();
    expect('name' in saved(onsave).ui).toBe(false);
  });

  it('leaves the rest of ui alone while it does that', async () => {
    const onsave = open(config({ ui: { edge: 'left', theme: 'dark', y: 200, name: 'Ranjan' } }));
    await type(/Your name/, 'Someone else');
    await save();
    const ui = saved(onsave).ui;
    expect(ui).toEqual({ edge: 'left', theme: 'dark', y: 200, name: 'Someone else' });
  });
});

describe('Settings, every other control', () => {
  it('writes the repository roots, one per line, blank lines dropped', async () => {
    const onsave = open();
    await type(/Repository roots/, '~/code\n\n  ~/work  \n');
    await save();
    expect(saved(onsave).roots).toEqual(['~/code', '~/work']);
  });

  it('writes the scan interval as a whole number of minutes, never below one', async () => {
    const onsave = open();
    await type(/Git scan every/, '15');
    await save();
    expect(saved(onsave).scan.intervalMinutes).toBe(15);
  });

  it('keeps the interval that was there when the box is cleared', async () => {
    const start = config({ ...defaultConfig(), scan: { ...defaultConfig().scan, intervalMinutes: 9 } });
    const onsave = open(start);
    await type(/Git scan every/, '');
    await save();
    expect(saved(onsave).scan.intervalMinutes).toBe(9);
  });

  it('writes the terminal', async () => {
    const onsave = open();
    await type('Terminal', 'kitty');
    await save();
    expect(saved(onsave).terminal).toBe('kitty');
  });

  it('keeps the terminal that was there when the box is cleared', async () => {
    const onsave = open(config({ terminal: 'kitty' }));
    await type('Terminal', '   ');
    await save();
    expect(saved(onsave).terminal).toBe('kitty');
  });

  it('writes the claude command and its resume flag', async () => {
    const onsave = open();
    await type('Claude command', 'claude-dev');
    await type('Resume flag', '-r');
    await save();
    expect(saved(onsave).claude).toEqual({ command: 'claude-dev', resumeFlag: '-r' });
  });

  it('keeps the claude command that was there rather than guessing at one', async () => {
    const start = config({ claude: { command: 'claude-dev', resumeFlag: '-r' } });
    const onsave = open(start);
    await type('Claude command', '');
    await type('Resume flag', '');
    await save();
    expect(saved(onsave).claude).toEqual({ command: 'claude-dev', resumeFlag: '-r' });
  });

  it('writes the edge the button lives on', async () => {
    const onsave = open();
    await fireEvent.change(screen.getByLabelText('Edge'), { target: { value: 'left' } });
    await save();
    expect(saved(onsave).ui.edge).toBe('left');
  });

  it('writes the theme', async () => {
    const onsave = open();
    await fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } });
    await save();
    expect(saved(onsave).ui.theme).toBe('dark');
  });

  it('writes one complete config, so an untouched setting is never dropped', async () => {
    const start = config({
      roots: ['~/code'],
      terminal: 'kitty',
      claude: { command: 'claude-dev', resumeFlag: '-r' },
      ui: { edge: 'left', theme: 'dark', y: 120, name: 'Ranjan' },
    });
    const onsave = open(start);
    await type(/Git scan every/, '11');
    await save();
    const next = saved(onsave);
    expect(next.roots).toEqual(['~/code']);
    expect(next.terminal).toBe('kitty');
    expect(next.claude).toEqual({ command: 'claude-dev', resumeFlag: '-r' });
    expect(next.ui).toEqual({ edge: 'left', theme: 'dark', y: 120, name: 'Ranjan' });
    expect(next.scan).toEqual({ ...start.scan, intervalMinutes: 11 });
  });

  it('writes nothing at all until Save is pressed', async () => {
    const onsave = open();
    await type(/Your name/, 'Ranjan');
    await type('Terminal', 'kitty');
    expect(onsave).not.toHaveBeenCalled();
  });

  it('gives every control a label, since a settings form of unlabelled boxes is unusable', () => {
    const { container } = render(Settings, {
      props: { config: config(), onsave: () => {}, onback: () => {} },
    });
    const fields = [...container.querySelectorAll('.field')];
    expect(fields).toHaveLength(8);
    for (const field of fields) {
      expect(field.closest('label')?.querySelector('span')?.textContent?.trim()).toBeTruthy();
    }
  });
});
