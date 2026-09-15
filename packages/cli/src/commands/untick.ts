import type { CommandContext } from '../context.ts';
import { setItem } from './tick.ts';

/** `ledge untick <id> <n>`: marks checklist item n (1-based) as not done. */
export async function run(ctx: CommandContext): Promise<number> {
  return setItem(ctx, false);
}
