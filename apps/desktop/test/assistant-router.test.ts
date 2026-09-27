import { describe, expect, it } from 'vitest';
import { modelLabel, resolveModel, route } from '../src/lib/assistant/router.ts';

describe('route', () => {
  it.each([
    'what is an llm',
    'What is an LLM?',
    'hi',
    'thanks!',
    'how are you',
    'who wrote Hamlet?',
    'what does HTTP stand for',
    'explain recursion in one line',
    'capital of France?',
    "what's the difference between TCP and UDP",
  ])('sends the short general question %j to Haiku', (text) => {
    expect(route(text)).toBe('haiku');
  });

  it.each([
    'what is pending on unLab',
    'what is pending',
    'add call vendor to thursday',
    'Add "call vendor" to Thursday',
    'park the banner task, waiting on design',
    'grant ravi access to the visit-tracker repo',
    'give priya access to the firebase project',
    'deploy the functions',
    'fix the failing test',
    'how far is unLab',
    'what did I do yesterday',
    'what am I working on',
    'summarise this week',
    'Summarise this week',
    'clear my done tasks',
    'which branch is ledge-wt-ui on',
    'what changed in apps/desktop',
    'status of TECHNOLOGY-123',
    'remind me to call the bank tomorrow',
    'tick the second to-do',
    'what should I focus on today',
    'please add "review PR" to friday',
  ])('sends the desk question or action %j to Sonnet', (text) => {
    expect(route(text)).toBe('sonnet');
  });

  it.each([
    'plan the next phase and review the architecture',
    'Plan my day',
    'review the architecture of the store',
    'compare the two approaches for syncing',
    'audit our firebase rules',
    'analyse why the scan is slow',
    'design a better onboarding flow',
    'can you review the release plan',
  ])('sends the analysis or planning request %j to Opus', (text) => {
    expect(route(text)).toBe('opus');
  });

  it('sends anything over 400 characters to Opus', () => {
    expect(route(`what is ${'a very long question '.repeat(25)}`)).toBe('opus');
  });

  it('does not count a review inside a quoted to-do as analysis', () => {
    expect(route('add "review the architecture doc" to thursday')).toBe('sonnet');
  });

  it('treats names on the desk as desk questions', () => {
    expect(route('how is Helios doing', [], { deskTerms: ['Helios rollout', 'helios'] })).toBe('sonnet');
    expect(route('how is Helios doing')).toBe('haiku');
  });

  it('keeps a short follow-up to a desk answer on the same thread model', () => {
    const history = [
      { role: 'user' as const, text: 'what is pending' },
      { role: 'assistant' as const, text: 'Two things.', model: 'sonnet' as const },
    ];
    expect(route('and why is that?', history)).toBe('sonnet');
    expect(route('why is the sky blue?', history)).toBe('haiku');
    const chat = [{ role: 'assistant' as const, text: 'Paris.', model: 'haiku' as const }];
    expect(route('and why is that?', chat)).toBe('haiku');
  });
});

describe('resolveModel', () => {
  it('lets an explicit choice win, and routes on Auto', () => {
    expect(resolveModel('opus', 'what is an llm')).toBe('opus');
    expect(resolveModel('haiku', 'add call vendor to thursday')).toBe('haiku');
    expect(resolveModel('auto', 'what is an llm')).toBe('haiku');
    expect(resolveModel(undefined, 'add call vendor to thursday')).toBe('sonnet');
  });

  it('labels models for the UI', () => {
    expect([modelLabel('haiku'), modelLabel('sonnet'), modelLabel('opus')]).toEqual(['Haiku', 'Sonnet', 'Opus']);
  });
});
