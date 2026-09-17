<script lang="ts">
  /**
   * Everything in config.json a person should not have to open an editor to change: which
   * folders are scanned for repositories and how often, which terminal and which `claude`
   * command to launch, which edge the button lives on, light or dark, and the name the greeting
   * uses. Saving hands a complete Config back through `onsave`; nothing is written until then.
   *
   * Every field here writes the thing it names and is read somewhere real: the roots by the
   * git scan, the interval by the scan timer, the terminal and the two claude fields by the
   * launcher, the edge by the floating button, the theme by the document, the name by the
   * greeting. A cleared field falls back to what the config already has rather than to a
   * constant, so emptying a box can never quietly set a value nobody typed. The one exception
   * is the name, where empty is a real answer: it means "use the machine account".
   */
  import type { Config } from '@ledge/core/pure';

  /**
   * Config as config.json actually is. `ui.name` is a key the file carries and the greeting
   * reads, and core's `Config` does not model it yet; this is the one place that writes it, so
   * this is where the difference is stated rather than being spread over casts.
   */
  type UiWithName = Config['ui'] & { name?: string };
  type Named = Omit<Config, 'ui'> & { ui: UiWithName };

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
  let name = $derived((config as Named).ui.name ?? '');

  function submit(e: SubmitEvent) {
    e.preventDefault();
    /* An empty name is not a missing value, it is the answer "greet me by my account name", so
       the key is dropped rather than written blank. Nothing else in the file works that way. */
    const called = name.trim();
    const { name: _old, ...rest } = (config as Named).ui;
    const ui: UiWithName = { ...rest, edge, theme };
    if (called !== '') ui.name = called;
    onsave({
      ...config,
      roots: roots.split('\n').map((r) => r.trim()).filter((r) => r !== ''),
      scan: {
        ...config.scan,
        intervalMinutes: Math.max(1, Math.round(Number(interval)) || config.scan.intervalMinutes),
      },
      terminal: terminal.trim() || config.terminal,
      claude: {
        command: claudeCommand.trim() || config.claude.command,
        resumeFlag: resumeFlag.trim() || config.claude.resumeFlag,
      },
      ui,
    } as Config);
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
    <span>Your name, for the greeting</span>
    <input
      class="field"
      type="text"
      bind:value={name}
      placeholder="Empty greets you by your account name"
      autocomplete="off"
      spellcheck="false"
    />
  </label>
  <label>
    <span>Repository roots, one per line</span>
    <textarea class="field" rows="3" bind:value={roots} spellcheck="false"></textarea>
  </label>
  <label>
    <span>Git scan every (minutes)</span>
    <input class="field" type="number" min="1" step="1" bind:value={interval} />
  </label>
  <label>
    <span>Terminal</span>
    <input class="field" type="text" bind:value={terminal} spellcheck="false" />
  </label>
  <div class="two">
    <label>
      <span>Claude command</span>
      <input class="field" type="text" bind:value={claudeCommand} spellcheck="false" />
    </label>
    <label>
      <span>Resume flag</span>
      <input class="field" type="text" bind:value={resumeFlag} spellcheck="false" />
    </label>
  </div>
  <div class="two">
    <label>
      <span>Edge</span>
      <select class="field" bind:value={edge}>
        <option value="right">Right</option>
        <option value="left">Left</option>
      </select>
    </label>
    <label>
      <span>Theme</span>
      <select class="field" bind:value={theme}>
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  </div>
  <div class="actions">
    <button type="submit" class="btn primary motion">Save</button>
  </div>
</form>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: 0 var(--space-1);
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
    /* A text input's default width is twenty characters, which is wider than half the panel at
       320 px. Without this the two paired rows below push the whole form past the glass. */
    min-width: 0;
  }
  label .field {
    min-width: 0;
    width: 100%;
  }
  .two {
    display: flex;
    gap: var(--space-2);
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
  .actions .btn {
    padding-inline: var(--space-4);
  }
</style>
