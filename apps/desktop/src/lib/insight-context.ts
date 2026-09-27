/**
 * How a component deep inside a list finds a task's insights without every list in between
 * growing a prop for it. The panel provides one lookup; a component that is rendered without
 * it, which is every component test, gets a lookup that finds nothing and so shows the
 * fallback digest. Nothing here reads the store: the lookup is whatever the provider hands in.
 */
import { getContext, setContext } from 'svelte';
import type { TaskInsights } from '@ledge/core/pure';

export type InsightLookup = (taskId: string) => TaskInsights | undefined;

const KEY = Symbol('ledge-insights');
const none: InsightLookup = () => undefined;

export function provideInsights(lookup: InsightLookup): void {
  setContext(KEY, lookup);
}

export function useInsights(): InsightLookup {
  return getContext<InsightLookup | undefined>(KEY) ?? none;
}
