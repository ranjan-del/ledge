import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { ledgeHome, defaultConfig, loadConfig, saveConfig } from '../src/index.ts';

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'ledge-core-'));
}

test('ledgeHome prefers LEDGE_HOME and falls back to ~/.ledge', () => {
  const prev = process.env.LEDGE_HOME;
  try {
    process.env.LEDGE_HOME = '/tmp/some-ledge';
    assert.equal(ledgeHome(), '/tmp/some-ledge');
    delete process.env.LEDGE_HOME;
    assert.equal(ledgeHome(), join(homedir(), '.ledge'));
  } finally {
    if (prev === undefined) delete process.env.LEDGE_HOME;
    else process.env.LEDGE_HOME = prev;
  }
});

test('defaultConfig has the documented shape and a fresh object each call', () => {
  const a = defaultConfig();
  const b = defaultConfig();
  assert.notEqual(a, b);
  assert.deepEqual(a.roots, ['~/code']);
  assert.equal(a.scan.intervalMinutes, 5);
  assert.equal(a.scan.maxDepth, 4);
  assert.equal(a.scan.staleDays, 30);
  assert.ok(a.scan.ignore.includes('node_modules'));
  assert.equal(typeof a.terminal, 'string');
  assert.deepEqual(a.claude, { command: 'claude', resumeFlag: '--resume' });
  assert.equal(a.ui.edge, 'right');
  assert.equal(a.ui.theme, 'system');
});

test('loadConfig returns defaults when the file is missing and never writes', () => {
  const home = tempHome();
  const cfg = loadConfig(home);
  assert.deepEqual(cfg, defaultConfig());
  assert.equal(existsSync(join(home, 'config.json')), false);
});

test('loadConfig deep-merges partial files over defaults', () => {
  const home = tempHome();
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, 'config.json'),
    JSON.stringify({ roots: ['~/work'], scan: { maxDepth: 2 }, ui: { y: 120 } }),
  );
  const cfg = loadConfig(home);
  assert.deepEqual(cfg.roots, ['~/work']);
  assert.equal(cfg.scan.maxDepth, 2);
  assert.equal(cfg.scan.intervalMinutes, 5);
  assert.equal(cfg.scan.staleDays, 30);
  assert.equal(cfg.ui.y, 120);
  assert.equal(cfg.ui.edge, 'right');
  assert.equal(cfg.claude.command, 'claude');
});

test('loadConfig reports the file path on invalid JSON', () => {
  const home = tempHome();
  writeFileSync(join(home, 'config.json'), '{ not json');
  assert.throws(() => loadConfig(home), /config\.json/);
});

test('saveConfig writes pretty JSON and creates the folder', () => {
  const home = join(tempHome(), 'nested');
  const cfg = defaultConfig();
  cfg.terminal = 'Ghostty';
  saveConfig(cfg, home);
  const raw = readFileSync(join(home, 'config.json'), 'utf8');
  assert.ok(raw.endsWith('\n'));
  assert.ok(raw.includes('\n  "terminal": "Ghostty"'));
  assert.deepEqual(loadConfig(home), cfg);
});
