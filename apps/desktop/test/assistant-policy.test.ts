import { describe, expect, it } from 'vitest';
import {
  approvalKey,
  classify,
  classifyCommand,
  isSafeWritePath,
  splitCommands,
  tokenize,
} from '../src/lib/assistant/policy.ts';

const bash = (command: string) => classify('Bash', { command }, { home: '/Users/t' });

describe('classify: shell commands', () => {
  it.each([
    'rm -rf x',
    'rm notes.txt',
    'ledge delete old-task',
    'git push',
    'git push origin main --force',
    'git -C ~/code/app push',
    'git reset --hard HEAD~1',
    'git merge feature/x',
    'git clean -fd',
    'git branch -D old',
    'gh pr merge 12',
    'gh pr create --fill',
    'gh repo create me/new',
    'gh api -X PUT repos/o/r/collaborators/ravi',
    'bb pr-create --title x',
    'bb pr-merge 7',
    'bb repo-create thing',
    'bb api POST /repositories/ispf-india/x/permissions',
    'firebase deploy',
    'firebase deploy --only functions',
    'gcloud projects add-iam-policy-binding my-proj --member=user:a@b.c --role=roles/viewer',
    'gcloud run deploy api',
    'slack post "#general" hello',
    'slack dm ravi hi',
    'slack upload file.pdf',
    'slack --as bot post "#x" hi',
    'gws gmail +send --to a@b.c --subject hi',
    'gws calendar +insert --summary Sync',
    'jira transition TECHNOLOGY-1 Done',
    'curl -X POST https://example.com/hook -d x=1',
    'echo hi > ~/notes.txt',
    'cat a | tee /etc/hosts',
    'sudo ls',
    'ls && rm -rf /',
    'echo $(rm -rf ~)',
    'echo "$(git push)"',
    'bash -c "git push"',
    'find . -name "*.log" -delete',
    'sed -i s/a/b/ file.txt',
    'xargs rm < list.txt',
    'node script.js',
    './deploy.sh',
    'somethingunknown --flag',
  ])('%j is risky', (command) => {
    const v = bash(command);
    expect(v.risky).toBe(true);
    expect(v.reason).toBeTruthy();
  });

  it.each([
    'ledge week add "Call vendor" --day thu',
    'ledge week --json',
    'ledge week tick 2',
    'ledge week rm 3',
    'ledge add "New thing" --backlog',
    'ledge park banner "waiting on design"',
    'ledge list --json',
    'git status',
    'git -C ~/code/app status --porcelain=v2 --branch',
    'git log --oneline -5',
    'git diff HEAD~1',
    'git fetch',
    'git commit -m "wip"',
    'ls -la ~/code',
    'cat ~/.ledge/tasks/a.md | head -20',
    'grep -rn TODO src 2>/dev/null',
    'rg "pending" ~/.ledge',
    'find . -name "*.md"',
    'bb pr-list visit-tracker',
    'bb api GET /repositories/ispf-india',
    'jira search "project = TECHNOLOGY"',
    'slack history "#general"',
    'gws calendar +agenda --today',
    'gcloud projects list',
    'gcloud projects get-iam-policy my-proj',
    'firebase projects:list',
    'curl -s https://example.com/api',
    'echo done > /tmp/x.txt',
    'echo ok >> ~/.ledge/log.txt',
    'date && pwd',
    'cd ~/.ledge && ledge week',
    'echo "a > b"',
    'jq .tasks ~/.ledge/x.json',
  ])('%j is not risky', (command) => {
    expect(bash(command)).toEqual({ risky: false });
  });
});

describe('classify: other tools', () => {
  it('never holds up reads', () => {
    for (const tool of ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'TodoWrite', 'Task', 'ToolSearch']) {
      expect(classify(tool, { file_path: '/etc/passwd', pattern: 'x', url: 'https://x' })).toEqual({ risky: false });
    }
  });

  it('lets writes inside ~/.ledge and scratch through, and holds others', () => {
    expect(classify('Write', { file_path: '/Users/t/.ledge/notes/a.md' }, { home: '/Users/t' }).risky).toBe(false);
    expect(classify('Edit', { file_path: '~/.ledge/tasks/a.md' }).risky).toBe(false);
    expect(classify('Write', { file_path: '/tmp/scratch.txt' }).risky).toBe(false);
    expect(classify('Write', { file_path: '/Users/t/code/app/src/main.ts' }, { home: '/Users/t' }).risky).toBe(true);
    expect(classify('Edit', { file_path: '/Users/t/.ledge/../.zshrc' }, { home: '/Users/t' }).risky).toBe(true);
    expect(classify('Write', {}).risky).toBe(true);
  });

  it('holds MCP tools that send, share, delete or create, and lets reads through', () => {
    expect(classify('mcp__claude_ai_Slack__slack_send_message', {}).reason).toMatch(/message/i);
    expect(classify('mcp__claude_ai_Helix_Workspace__gmail_send', {}).risky).toBe(true);
    expect(classify('mcp__claude_ai_Helix_Workspace__drive_share', {}).reason).toMatch(/access/i);
    expect(classify('mcp__claude_ai_Helix_Workspace__calendar_create_event', {}).risky).toBe(true);
    expect(classify('mcp__claude_ai_Helix_Workspace__drive_delete', {}).reason).toMatch(/Deletes/);
    expect(classify('mcp__claude_ai_Slack__slack_read_channel', {}).risky).toBe(false);
    expect(classify('mcp__claude_ai_Helix_Workspace__gmail_search', {}).risky).toBe(false);
    expect(classify('mcp__plugin_claude-mem_mcp-search__search', {}).risky).toBe(false);
    expect(classify('mcp__x__frobnicate', {}).risky).toBe(true);
  });

  it('is risky when unsure', () => {
    expect(classify('SomeNewTool', {}).risky).toBe(true);
    expect(classify('Bash', {}).risky).toBe(true);
    expect(classify('CronCreate', {}).risky).toBe(true);
  });
});

describe('shell parsing', () => {
  it('splits on separators and pulls substitutions out, keeping quotes whole', () => {
    expect(splitCommands('a && b || c; d | e')).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(splitCommands('echo "a; b" && c')).toEqual(['echo "a; b"', 'c']);
    expect(splitCommands('echo $(rm x) y')).toEqual(['rm x', 'echo $(...) y']);
    expect(splitCommands('ls 2>&1 | head')).toEqual(['ls 2>&1', 'head']);
  });

  it('finds redirect targets but not descriptors or quoted arrows', () => {
    expect(tokenize('echo hi > out.txt 2>&1').redirects).toEqual(['out.txt']);
    expect(tokenize('echo "a > b"').redirects).toEqual([]);
    expect(tokenize('cmd >> "/etc/x y"').redirects).toEqual(['/etc/x y']);
    expect(tokenize('cmd &> log').redirects).toEqual(['log']);
  });

  it('knows the safe write places', () => {
    expect(isSafeWritePath('/dev/null')).toBe(true);
    expect(isSafeWritePath('/private/tmp/x')).toBe(true);
    expect(isSafeWritePath('$HOME/.ledge/a')).toBe(true);
    expect(isSafeWritePath('/Users/t/.ledgex/a', '/Users/t')).toBe(false);
    expect(isSafeWritePath('/etc/hosts')).toBe(false);
    expect(classifyCommand('echo x > /Users/t/.ledge/a', { home: '/Users/t' }).risky).toBe(false);
  });
});

describe('approvalKey', () => {
  it('remembers the tool and the command prefix', () => {
    expect(approvalKey('Bash', { command: 'git push origin main' })).toBe('Bash:git push');
    expect(approvalKey('Bash', { command: 'cd x && git push' })).toBe('Bash:git push');
    expect(approvalKey('Bash', { command: 'gh pr merge 3' })).toBe('Bash:gh pr merge');
    expect(approvalKey('Bash', { command: 'rm -rf build' })).toBe('Bash:rm');
    expect(approvalKey('Write', { file_path: '/a/b.txt' })).toBe('Write:/a/b.txt');
    expect(approvalKey('mcp__s__send', {})).toBe('mcp__s__send');
    expect(approvalKey('Bash', { command: 'git push' })).not.toBe(approvalKey('Bash', { command: 'git reset --hard' }));
  });
});
