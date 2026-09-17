import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { addTask, initHome, removeHome, run } from './helpers.ts';

const repos: string[] = [];

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ledge-promo-repo-'));
  repos.push(dir);
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main'], { stdio: 'pipe' });
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-C', dir, 'commit', '-q',
      '--allow-empty', '-m', 'init'],
    { stdio: 'pipe' },
  );
  return dir;
}

function commit(dir: string, name: string): void {
  writeFileSync(join(dir, name), 'work\n');
  execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'pipe' });
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-C', dir, 'commit', '-q', '-m', name],
    { stdio: 'pipe' },
  );
}

interface TaskRow {
  id: string;
  status: string;
  sessions: string[];
}

async function statusOf(id: string): Promise<TaskRow> {
  const desk = JSON.parse((await run(['--json'])).stdout) as {
    current: TaskRow[];
    backlog: TaskRow[];
  };
  const found = [...desk.current, ...desk.backlog].find((task) => task.id === id);
  assert.ok(found, `task ${id} is on the desk`);
  return found;
}

/** Parks a freshly added task so every test starts from the state the panel's Backlog shows. */
async function backlogTask(title: string, repo: string): Promise<string> {
  const id = await addTask(title, '--repo', repo);
  const parked = await run(['park', id, 'waiting for a session']);
  assert.equal(parked.code, 0, parked.stderr);
  return id;
}

describe('began and settle: promotion follows evidence, not intent', () => {
  let home: string;
  beforeEach(async () => {
    home = await initHome();
  });
  afterEach(() => {
    removeHome(home);
    for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  test('settle with no intent record does nothing and exits 0', async () => {
    const result = await run(['settle']);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Nothing to settle/);
    const json = JSON.parse((await run(['settle', '--json'])).stdout) as { decision: string };
    assert.equal(json.decision, 'none');
  });

  test('a session where nothing happened leaves the task in the backlog', async () => {
    const repo = makeRepo();
    const id = await backlogTask('Release watch banner', repo);

    const began = await run(['began', id]);
    assert.equal(began.code, 0);
    assert.match(began.stdout, /stays in the backlog/);

    const settled = await run(['settle', '--json'], repo);
    const json = JSON.parse(settled.stdout) as {
      decision: string;
      worked: boolean;
      reasons: string[];
    };
    assert.equal(json.decision, 'kept');
    assert.equal(json.worked, false);
    assert.ok(json.reasons.length >= 4, 'says everything it looked at');
    assert.equal((await statusOf(id)).status, 'backlog');
  });

  test('time passing alone never promotes, however often settle runs', async () => {
    const repo = makeRepo();
    const id = await backlogTask('Release watch banner', repo);
    await run(['began', id]);
    for (let i = 0; i < 3; i++) {
      const settled = await run(['settle', '--json'], repo);
      assert.equal((JSON.parse(settled.stdout) as { decision: string }).decision, 'kept');
    }
    assert.equal((await statusOf(id)).status, 'backlog');
  });

  test('a ticked checklist item promotes the task and says why', async () => {
    const repo = makeRepo();
    const id = await backlogTask('Release watch banner', repo);
    await run(['todo', id, 'Build step that writes version.json']);
    await run(['began', id]);
    await run(['tick', id, '1']);

    const settled = await run(['settle'], repo);
    assert.equal(settled.code, 0);
    assert.match(settled.stdout, new RegExp(`moved ${id} from the backlog`));
    assert.match(settled.stdout, /a checklist item was ticked/);
    const task = await statusOf(id);
    assert.equal(task.status, 'current');
  });

  test('a commit in the task repo promotes it, and the session id is linked', async () => {
    const repo = makeRepo();
    const id = await backlogTask('Release watch banner', repo);
    await run(['began', id]);
    await run(['began', '--repo', repo, '--session', 'b13e8b5e']);
    commit(repo, 'version.json');

    const settled = await run(['settle', '--json'], repo);
    const json = JSON.parse(settled.stdout) as { decision: string; reasons: string[] };
    assert.equal(json.decision, 'promoted');
    assert.ok(json.reasons.some((r) => r.includes('gained 1 commit')), json.reasons.join('; '));
    const task = await statusOf(id);
    assert.equal(task.status, 'current');
    assert.deepEqual(task.sessions, ['b13e8b5e']);
  });

  test('settle is safe to run again: the record is cleared once it has done its job', async () => {
    const repo = makeRepo();
    const id = await backlogTask('Release watch banner', repo);
    await run(['todo', id, 'One']);
    await run(['began', id]);
    await run(['tick', id, '1']);
    assert.equal(
      (JSON.parse((await run(['settle', '--json'], repo)).stdout) as { decision: string }).decision,
      'promoted',
    );
    const again = JSON.parse((await run(['settle', '--json'], repo)).stdout) as {
      decision: string;
    };
    assert.equal(again.decision, 'none');
    assert.equal((await statusOf(id)).status, 'current');
  });

  test('a stale intent record is ignored, so a click days ago cannot promote today', async () => {
    const repo = makeRepo();
    const id = await backlogTask('Release watch banner', repo);
    await run(['began', id]);

    const file = join(home, 'intent.json');
    const stored = JSON.parse(readFileSync(file, 'utf8')) as {
      intents: { started: string }[];
    };
    stored.intents[0]!.started = '2026-09-01T09:00:00+05:30';
    writeFileSync(file, JSON.stringify(stored, null, 2) + '\n');

    await run(['todo', id, 'One']);
    await run(['tick', id, '1']);
    const settled = JSON.parse((await run(['settle', '--json'], repo)).stdout) as {
      decision: string;
    };
    assert.equal(settled.decision, 'none');
    assert.equal((await statusOf(id)).status, 'backlog');
  });

  test('began on a task that is already current records nothing', async () => {
    const repo = makeRepo();
    const id = await addTask('Already going', '--repo', repo);
    const began = await run(['began', id]);
    assert.equal(began.code, 0);
    assert.match(began.stdout, /already current/);
    const settled = JSON.parse((await run(['settle', '--json'], repo)).stdout) as {
      decision: string;
    };
    assert.equal(settled.decision, 'none');
  });

  test('began with no id arms the session and prints the nudge, once per session', async () => {
    const repo = makeRepo();
    const id = await backlogTask('Release watch banner', repo);
    await run(['began', id]);

    const armed = await run(['began', '--repo', repo, '--session', 'b13e8b5e']);
    assert.equal(armed.code, 0);
    assert.match(armed.stdout, new RegExp(`ledge start ${id}`));
    assert.match(armed.stdout, /backlog/);

    const stored = JSON.parse(readFileSync(join(home, 'intent.json'), 'utf8')) as {
      intents: { sessionId?: string }[];
    };
    assert.equal(stored.intents[0]?.sessionId, 'b13e8b5e');
  });

  test('began with no id and no record exits 2 and prints nothing on stdout', async () => {
    const repo = makeRepo();
    const armed = await run(['began', '--repo', repo, '--session', 'b13e8b5e']);
    assert.equal(armed.code, 2);
    assert.equal(armed.stdout, '');
  });

  test('re-arming the same session keeps the evidence already earned', async () => {
    const repo = makeRepo();
    const id = await backlogTask('Release watch banner', repo);
    await run(['todo', id, 'One']);
    await run(['began', id]);
    await run(['began', '--repo', repo, '--session', 'b13e8b5e']);
    await run(['tick', id, '1']);
    // SessionStart fires again for the same session, on a resume or a clear.
    await run(['began', '--repo', repo, '--session', 'b13e8b5e']);
    const settled = JSON.parse((await run(['settle', '--json'], repo)).stdout) as {
      decision: string;
    };
    assert.equal(settled.decision, 'promoted');
  });

  test('a task started by hand during the session settles quietly', async () => {
    const repo = makeRepo();
    const id = await backlogTask('Release watch banner', repo);
    await run(['began', id]);
    await run(['start', id]);
    const settled = JSON.parse((await run(['settle', '--json'], repo)).stdout) as {
      decision: string;
    };
    assert.equal(settled.decision, 'settled');
    assert.equal((await statusOf(id)).status, 'current');
  });

  test('a record whose task was deleted clears itself', async () => {
    const repo = makeRepo();
    const id = await backlogTask('Release watch banner', repo);
    await run(['began', id]);
    await run(['delete', id, '--yes']);
    const settled = JSON.parse((await run(['settle', '--json'], repo)).stdout) as {
      decision: string;
    };
    assert.equal(settled.decision, 'gone');
  });

  test('a session in another repo cannot settle this task', async () => {
    const mine = makeRepo();
    const other = makeRepo();
    const id = await backlogTask('Release watch banner', mine);
    await run(['began', id]);
    const settled = JSON.parse((await run(['settle', '--json'], other)).stdout) as {
      decision: string;
    };
    assert.equal(settled.decision, 'none');
    assert.equal((await statusOf(id)).status, 'backlog');
  });
});
