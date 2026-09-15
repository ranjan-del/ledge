<script lang="ts">
  /**
   * Edits config.json in place: roots, scan interval, terminal, claude command, edge and theme.
   * Saving hands a complete Config back through `onsave`; nothing is written until then.
   */
  import type { Config } from '@ledge/core/pure';

  interface Props {
    config: Config;
    onsave: (config: Config) => void;
    onback: () => void;
  }

  let { config, onsave, onback }: Props = $props();

  /* Read through $derived, not $state: each field tracks the config prop until a person edits
     it, and typing overrides the derived value until the config changes again. */
  let roots = $derived(config.roots.join('\n'));
  let interval = $derived(config.scan.intervalMinutes);
  let terminal = $derived(config.terminal);
  let claudeCommand = $derived(config.claude.command);
  let resumeFlag = $derived(config.claude.resumeFlag);
  let edge = $derived(config.ui.edge);
  let theme = $derived(config.ui.theme);

  function submit(e: SubmitEvent) {
    e.preventDefault();
    onsave({
      ...config,
      roots: roots.split('\n').map((r) => r.trim()).filter((r) => r !== ''),
      scan: { ...config.scan, intervalMinutes: Math.max(1, Number(interval) || 5) },
      terminal: terminal.trim() || config.terminal,
      claude: { command: claudeCommand.trim() || 'claude', resumeFlag: resumeFlag.trim() || '--resume' },
      ui: { ...config.ui, edge, theme },
    });
  }
</script>

<form class="settings" onsubmit={submit}>
  <button type="button" class="back" onclick={onback}>
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M8 1 3 6l5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    Back
  </button>
  <h2>Settings</h2>

  <label>
    <span>Repository roots, one per line</span>
    <textarea rows="3" bind:value={roots} spellcheck="false"></textarea>
  </label>
  <label>
    <span>Git scan every (minutes)</span>
    <input type="number" min="1" step="1" bind:value={interval} />
  </label>
  <label>
    <span>Terminal</span>
    <input type="text" bind:value={terminal} spellcheck="false" />
  </label>
  <div class="two">
    <label>
      <span>Claude command</span>
      <input type="text" bind:value={claudeCommand} spellcheck="false" />
    </label>
    <label>
      <span>Resume flag</span>
      <input type="text" bind:value={resumeFlag} spellcheck="false" />
    </label>
  </div>
  <div class="two">
    <label>
      <span>Edge</span>
      <select bind:value={edge}>
        <option value="right">Right</option>
        <option value="left">Left</option>
      </select>
    </label>
    <label>
      <span>Theme</span>
      <select bind:value={theme}>
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  </div>
  <div class="actions">
    <button type="submit" class="primary">Save</button>
  </div>
</form>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: 0 var(--space-1);
  }
  .back {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 3px var(--space-2) 3px var(--space-1);
    border-radius: var(--radius-sm);
    color: var(--accent);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  h2 {
    margin: 0;
    font-size: var(--fs-lg);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--fs-sm);
    color: var(--text-muted);
    flex: 1;
  }
  .two {
    display: flex;
    gap: var(--space-2);
  }
  input,
  textarea,
  select {
    padding: 5px var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--surface-border);
    background: var(--surface);
    color: var(--text);
    font-size: var(--fs-base);
    user-select: text;
    -webkit-user-select: text;
  }
  textarea {
    resize: vertical;
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
  }
  .primary {
    padding: 5px var(--space-4);
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--accent-text);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
</style>
