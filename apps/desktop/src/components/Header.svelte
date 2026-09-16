<script lang="ts">
  /**
   * The top line of the panel: the wordmark with the live dot beside it, and on the right the
   * search pill and the gear. It exists so the panel's identity and its two global actions sit
   * in one fixed strip that never scrolls and never changes shape between surfaces, which is
   * what lets the four tabs below it carry all of the navigation.
   *
   * The dot is the app saying it is still watching your files, and a spinner for as long as a
   * git scan is actually running. The pin is here rather than in a menu because the panel hides
   * when it loses focus, so keeping it open has to be one click away wherever you are.
   *
   * The bell carries the number of changes Ledge has noticed and you have not read. It is a
   * count and not a dot, because "three things happened" and "something happened" are different
   * sentences, and it disappears entirely at zero rather than sitting there saying nothing.
   */
  import LiveDot from './LiveDot.svelte';

  interface Props {
    /** A git scan is in flight. */
    scanning?: boolean;
    /** The panel is on screen, so the dot may animate. */
    awake?: boolean;
    /** The panel is pinned open. */
    pinned?: boolean;
    /** The settings sheet is open, so the gear reads as pressed. */
    settingsOpen?: boolean;
    /** The search overlay is open. */
    searchOpen?: boolean;
    /** Unread notifications. Zero hides the count. */
    unread?: number;
    /** The notification centre is open, so the bell reads as pressed. */
    notifyOpen?: boolean;
    /** The modifier shown in the search pill: `⌘` on macOS, `Ctrl` elsewhere. */
    modifier?: string;
    onpin: () => void;
    onsearch: () => void;
    onsettings: () => void;
    /** Absent where there is no centre to open, which is how the bell is left out. */
    onnotify?: () => void;
  }

  let {
    scanning = false,
    awake = true,
    pinned = false,
    settingsOpen = false,
    searchOpen = false,
    unread = 0,
    notifyOpen = false,
    modifier = '⌘',
    onpin,
    onsearch,
    onsettings,
    onnotify,
  }: Props = $props();
</script>

<header class="header">
  <h1 class="brand">Ledge</h1>
  <LiveDot {scanning} {awake} />
  <span class="spacer"></span>

  <button
    type="button"
    class="tool motion"
    aria-pressed={pinned}
    aria-label={pinned ? 'Unpin panel' : 'Pin panel'}
    title={pinned ? 'Unpin' : 'Pin'}
    onclick={onpin}
  >
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M9 1.5 12.5 5 9.5 6 8 9.5 4.5 6 8 4.5z M4.5 9.5 1.5 12.5"
        fill={pinned ? 'currentColor' : 'none'}
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
    </svg>
  </button>

  <button
    type="button"
    class="search motion"
    aria-pressed={searchOpen}
    aria-label="Search tasks and notes"
    title="Search tasks and notes"
    onclick={onsearch}
  >
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="5.2" cy="5.2" r="3.4" fill="none" stroke="currentColor" stroke-width="1.4" />
      <path d="M7.8 7.8 10.6 10.6" stroke="currentColor" stroke-width="1.4"
        stroke-linecap="round" />
    </svg>
    <span class="key">{modifier}K</span>
  </button>

  {#if onnotify}
    <button
      type="button"
      class="tool motion bell"
      aria-pressed={notifyOpen}
      aria-label={unread > 0
        ? `Notifications, ${unread} unread`
        : 'Notifications, nothing unread'}
      title="Notifications"
      onclick={onnotify}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path
          d="M3.4 9.6V6.4a3.6 3.6 0 0 1 7.2 0v3.2l1 1.4H2.4zM5.7 12a1.4 1.4 0 0 0 2.6 0"
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      {#if unread > 0}
        <span class="count pip" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>
      {/if}
    </button>
  {/if}

  <button
    type="button"
    class="tool motion"
    aria-label="Settings"
    title="Settings"
    aria-pressed={settingsOpen}
    onclick={onsettings}
  >
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="1.4" />
      <path
        d="M7 1v2M7 11v2M1 7h2M11 7h2M2.8 2.8l1.4 1.4M9.8 9.8l1.4 1.4
           M2.8 11.2l1.4-1.4M9.8 4.2l1.4-1.4"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
      />
    </svg>
  </button>
</header>

<style>
  .header {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-3) var(--space-2);
  }
  .brand {
    margin: 0;
    font-size: var(--fs-lg);
    font-weight: 700;
    letter-spacing: -0.015em;
  }
  .spacer {
    flex: 1;
  }
  .tool {
    flex: none;
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-pill);
    color: var(--text-muted);
  }
  .tool:hover,
  .tool[aria-pressed="true"] {
    background: var(--control);
    color: var(--text);
  }
  /* A pill, not an icon: it has to read as a field you can type into, which is the whole
     promise the shortcut in it is making. */
  .search {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px var(--space-2) 3px 7px;
    border-radius: var(--radius-pill);
    background: var(--control);
    color: var(--text-muted);
  }
  .search:hover,
  .search[aria-pressed="true"] {
    background: var(--control-active);
    color: var(--text);
  }
  /* The count rides on the bell's upper right rather than beside it, so the strip's shape is
     the same whether or not there is anything unread. */
  .bell {
    position: relative;
  }
  .bell .count {
    top: -1px;
    right: -2px;
    min-width: 13px;
    height: 13px;
    padding: 0 3px;
    font-size: 9px;
    line-height: 13px;
  }
  .key {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
  }
</style>
