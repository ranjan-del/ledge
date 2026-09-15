import { TaskStore } from '@ledge/core';
import type { CommandContext } from '../context.ts';
import { EXIT } from '../context.ts';
import { toJson } from '../format.ts';

/**
 * `ledge init`: creates LEDGE_HOME with tasks/, archive/, a default config.json and a sample
 * task. Safe to run twice; the second run reports that the store already exists.
 */
export async function run(ctx: CommandContext): Promise<number> {
  const store = new TaskStore();
  const result = store.init();
  if (ctx.flags.json) {
    ctx.out(toJson({ home: store.home, created: result.created }));
  } else if (result.created) {
    ctx.out(`Created Ledge store at ${store.home}`);
  } else {
    ctx.out(`Ledge store already exists at ${store.home}`);
  }
  return EXIT.ok;
}
