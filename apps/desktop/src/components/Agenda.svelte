<script lang="ts">
  /**
   * Phase 3 stub. A calendar strip will appear here for people who configure a calendar
   * connector. Hidden until then; it renders nothing.
   */
  interface Props {
    visible?: boolean;
  }
  let { visible = false }: Props = $props();
</script>

{#if visible}
  <section class="agenda" aria-label="Agenda"></section>
{/if}

<style>
  .agenda {
    display: none;
  }
</style>
