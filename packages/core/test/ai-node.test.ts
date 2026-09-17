// Tests for the Claude Code provider. No model is ever reached: every case runs a throwaway
// shell script standing in for `claude`, which is enough to pin down the whole contract, since
// the provider's entire job is to start a program, feed it stdin and read what comes back.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeCodeProvider } from '../src/index.ts';

const dirs: string[] = [];

/** Writes an executable stand-in for `claude` and returns its path. */
function stub(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ledge-provider-test-'));
  dirs.push(dir);
  const file = join(dir, 'claude-stub.sh');
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

test.after(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('claudeCodeProvider', () => {
  test('asking puts the prompt on stdin and puts the provider name on the answer', async () => {
    const command = stub([
      'if [ "$1" = "auth" ]; then echo \'{"loggedIn": true}\'; exit 0; fi',
      'printf "answered: "; cat',
    ].join('\n'));
    const provider = claudeCodeProvider({ command });
    assert.equal(provider.name, 'claude-code');
    assert.equal(await provider.available(), true);
    assert.equal(provider.unavailableReason?.(), undefined);
    const result = await provider.ask('who am I');
    assert.deepEqual(result, { text: 'answered: who am I', provider: 'claude-code' });
  });

  test('a command that is not on PATH is unavailable, and says so and what to do', async () => {
    const provider = claudeCodeProvider({ command: join(tmpdir(), 'no-such-claude-binary') });
    assert.equal(await provider.available(), false);
    const reason = provider.unavailableReason?.() ?? '';
    assert.match(reason, /not on PATH/);
    assert.match(reason, /claude\.com\/claude-code/);
    assert.match(reason, /auth login/);
  });

  test('installed but signed out is unavailable, and is not confused with missing', async () => {
    const command = stub('echo \'{"loggedIn": false}\'');
    const provider = claudeCodeProvider({ command });
    assert.equal(await provider.available(), false);
    const reason = provider.unavailableReason?.() ?? '';
    assert.match(reason, /installed but not signed in/);
    assert.doesNotMatch(reason, /not on PATH/);
  });

  test('an auth check that fails or is unreadable is reported, never taken as fine', async () => {
    const broken = claudeCodeProvider({ command: stub('echo "boom" >&2; exit 4') });
    assert.equal(await broken.available(), false);
    assert.match(broken.unavailableReason?.() ?? '', /failed.*boom/);

    const garbled = claudeCodeProvider({ command: stub('echo "not json"') });
    assert.equal(await garbled.available(), false);
    assert.match(garbled.unavailableReason?.() ?? '', /could not read/);
  });

  test('the availability answer is cached, so one ledge run asks the binary once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledge-provider-count-'));
    dirs.push(dir);
    const counter = join(dir, 'calls');
    const command = stub(`echo x >> ${counter}\necho '{"loggedIn": true}'`);
    const provider = claudeCodeProvider({ command });
    assert.equal(await provider.available(), true);
    assert.equal(await provider.available(), true);
    assert.equal(readFileSync(counter, 'utf8').trim().split('\n').length, 1);
  });

  test('a failing ask throws with what the program said, rather than an empty answer', async () => {
    const provider = claudeCodeProvider({ command: stub('echo "usage: bad flag" >&2; exit 2') });
    await assert.rejects(() => provider.ask('anything'), /usage: bad flag/);
  });

  test('an ask that answers with nothing throws rather than yield an empty inference', async () => {
    const provider = claudeCodeProvider({ command: stub('exit 0') });
    await assert.rejects(() => provider.ask('anything'), /answered with nothing/);
  });

  test('an ask that hangs is killed at the timeout and says so', async () => {
    const provider = claudeCodeProvider({ command: stub('sleep 30') });
    await assert.rejects(() => provider.ask('anything', { timeoutMs: 200 }), /did not answer/);
  });
});
