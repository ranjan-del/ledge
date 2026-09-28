import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Assistant, { SUGGESTIONS } from '../src/components/Assistant.svelte';
import { AssistantChat } from '../src/lib/assistant-chat.svelte.ts';
import { FakeAssistantEngine, type FakeOptions } from '../src/lib/assistant/fake.ts';
import { DAY, repoStatus, taskA, taskB, taskC } from './fixtures.ts';

const FIELD = 'Message the assistant';

function setup(options: FakeOptions = {}, props: Record<string, unknown> = {}) {
  const engine = new FakeAssistantEngine(options);
  const chat = new AssistantChat(engine);
  chat.attach();
  const onselect = vi.fn();
  const view = render(Assistant, {
    props: {
      chat,
      day: DAY,
      name: 'Ranjan',
      recent: [
        taskA(),
        taskB(),
        taskC(),
        { ...taskA(), file: 'x.md', id: 'x', title: 'Fourth' },
        { ...taskA(), file: 'y.md', id: 'y', title: 'Fifth' },
        { ...taskA(), file: 'z.md', id: 'z', title: 'Sixth' },
      ].map((task) => ({
        task,
        at: task.updated,
      })),
      onselect,
      ...props,
    },
  });
  return { engine, chat, onselect, ...view };
}

async function ask(text: string) {
  const field = screen.getByLabelText(FIELD);
  await fireEvent.input(field, { target: { value: text } });
  await fireEvent.keyDown(field, { key: 'Enter' });
}

describe('Assistant, idle', () => {
  it('greets, offers the field and suggestions, and shows five recent tasks as compact cards', () => {
    const { container } = setup();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/^Good (morning|afternoon|evening), Ranjan/);
    expect(screen.getByLabelText(FIELD)).toBeTruthy();
    const chips = within(screen.getByRole('group', { name: 'Suggestions' })).getAllByRole('button');
    expect(chips.map((c) => c.textContent?.trim())).toEqual(SUGGESTIONS);
    expect(container.querySelectorAll('.mini')).toHaveLength(5);
    expect(screen.getByText('Fifth')).toBeTruthy();
    expect(screen.queryByText('Sixth')).toBeNull();
    expect(container.querySelector('.chat-head')).toBeNull();
  });

  it('opens a recent task from its card, and marks one with unsaved git work', async () => {
    const { onselect, container } = setup({}, { statusFor: () => repoStatus({ dirty: [{ path: 'a.ts', code: 'M' }] }) });
    await fireEvent.click(screen.getByRole('button', { name: /Release watch banner/ }));
    expect(onselect).toHaveBeenCalledWith(expect.objectContaining({ id: taskA().id }));
    expect(container.querySelectorAll('.mini .chip.attention').length).toBeGreaterThan(0);
  });

  it("carries Now's Today block and Pending line", async () => {
    const onpending = vi.fn();
    const onweektick = vi.fn();
    setup(
      {},
      {
        attention: 2,
        onpending,
        weekToday: [{ item: { text: 'Call the bank', done: false }, ref: { slot: DAY, index: 0 } }],
        weekMore: 1,
        onweektick,
        onopenweek: () => {},
      },
    );
    await fireEvent.click(screen.getByLabelText('Tick: Call the bank'));
    await vi.waitFor(() => expect(onweektick).toHaveBeenCalledWith({ slot: DAY, index: 0 }));
    expect(screen.getByRole('button', { name: /1 more this week/ })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /2 repositories have/ }));
    expect(onpending).toHaveBeenCalled();
  });

  it('hides the Pending line when nothing is pending, and Today when the week is empty', () => {
    const { container } = setup({}, { attention: 0, onpending: () => {} });
    expect(container.querySelector('.pending-line')).toBeNull();
    expect(container.querySelector('.week-today')).toBeNull();
  });
});

describe('Assistant, chatting', () => {
  it('moves from idle to a conversation with the field docked, and back on New chat', async () => {
    const { container, engine } = setup();
    await ask('what is an LLM');
    await waitFor(() => expect(container.querySelector('.chat-head')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy();
    expect(container.querySelector('.mini')).toBeNull();
    expect(container.querySelector('.dock')?.querySelector('textarea')).toBeTruthy();
    expect(container.querySelector('.msg.user .bubble')?.textContent).toBe('what is an LLM');
    await waitFor(() => expect(container.querySelector('.msg.assistant')?.textContent).toContain('You asked'));
    await waitFor(() => expect(container.querySelector('.msg.assistant .model')?.textContent).toBe('Opus 5.5'));
    expect(screen.getByRole('heading', { name: 'what is an LLM' })).toBeTruthy();
    expect(engine.sent).toHaveLength(1);

    await fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(container.querySelector('.chat-head')).toBeNull();
    expect(container.querySelectorAll('.mini')).toHaveLength(5);
  });

  it('goes back to the home screen from a chat, keeping the chat in history', async () => {
    const { container, chat } = setup();
    await ask('what is an LLM');
    await waitFor(() => expect(chat.running).toBe(false));
    await fireEvent.click(await screen.findByRole('button', { name: 'Home' }));
    expect(container.querySelector('.chat-head')).toBeNull();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/^Good (morning|afternoon|evening), Ranjan/);
    await chat.refreshChats();
    expect(chat.chats.map((c) => c.title)).toContain('what is an LLM');
  });

  it('sends a suggestion chip as it is written', async () => {
    const { engine } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Plan my day' }));
    expect(engine.sent[0]?.text).toBe('Plan my day');
  });

  it('adds a line on Shift+Enter instead of sending', async () => {
    const { engine } = setup();
    const field = screen.getByLabelText(FIELD);
    await fireEvent.input(field, { target: { value: 'one' } });
    await fireEvent.keyDown(field, { key: 'Enter', shiftKey: true });
    expect(engine.sent).toHaveLength(0);
  });

  it('shows only the answer and the model, not what the assistant ran', async () => {
    const { container, chat } = setup();
    await ask('add a to-do for thursday');
    await waitFor(() => expect(chat.running).toBe(false));
    expect(screen.queryByRole('button', { name: /Did \d+ thing/ })).toBeNull();
    expect(container.querySelector('.tools')).toBeNull();
    await waitFor(() => expect(container.querySelector('.msg.assistant .model')?.textContent).toBe('Opus 5.5'));
    expect(container.textContent).toContain('Added it to Thursday.');
    expect(container.textContent).not.toContain('ledge week add');
  });

  it('shows Stop while a turn runs, and Escape in the field stops it too', async () => {
    const { engine } = setup();
    const stop = vi.spyOn(engine, 'stop');
    await ask('please push it');
    await screen.findByRole('button', { name: 'Stop' });
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    await fireEvent.keyDown(screen.getByLabelText(FIELD), { key: 'Escape' });
    expect(stop).toHaveBeenCalledTimes(1);
    await screen.findByRole('button', { name: 'Send' });
    await ask('push again');
    await fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('asks before a risky action, and approves with always for this chat', async () => {
    const { engine, container } = setup();
    await ask('delete the example task');
    const card = await screen.findByRole('group', { name: /Approval needed/ });
    expect(card.textContent).toContain('ledge delete example-task');
    expect(card.textContent).toContain('Deletes a task for good.');
    await fireEvent.click(within(card).getByLabelText('Always allow this for this chat'));
    await fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: /Approval needed/ })).toBeNull());
    expect(engine.decisions[0]).toMatchObject({ decision: 'approved', always: true });
    await waitFor(() => expect(container.textContent).toContain('Done, deleted it.'));
    expect(container.textContent).not.toContain('Approved:');
  });

  it('cancels a risky action', async () => {
    const { engine, container } = setup();
    await ask('send the email');
    const card = await screen.findByRole('group', { name: /Approval needed/ });
    await fireEvent.click(within(card).getByRole('button', { name: 'Cancel' }));
    expect(engine.decisions[0]).toMatchObject({ decision: 'denied', always: false });
    await waitFor(() => expect(container.textContent).toContain('Okay, I left it alone.'));
  });

  it('sends the model picked by the field', async () => {
    const { engine } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Model: Opus 5.5' }));
    await fireEvent.click(screen.getByRole('menuitemradio', { name: /Sonnet 5/ }));
    expect(screen.getByRole('button', { name: 'Model: Sonnet 5' })).toBeTruthy();
    await ask('hello');
    expect(engine.sent[0]?.model).toBe('sonnet');
  });

  it('shows a failed answer with Retry', async () => {
    let fail = true;
    const { engine } = setup({ script: () => (fail ? [{ error: 'Claude Code crashed.' }] : [{ text: 'Back.' }]) });
    await ask('hello');
    const alert = await screen.findByText('Claude Code crashed.');
    fail = false;
    await fireEvent.click(within(alert.parentElement as HTMLElement).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(engine.sent).toHaveLength(2));
  });
});

describe('Assistant, when Claude Code cannot run', () => {
  it('says so plainly and retries by starting it again', async () => {
    const { chat, engine } = setup({ warmStatus: 'unavailable', warmDetail: 'Claude Code is not signed in. Run claude once in a terminal to sign in.' });
    chat.warm();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Claude Code is signed out');
    await fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(engine.warmed).toBe(2);
  });
});

describe('Assistant, history', () => {
  it('lists saved chats, filters them, opens one and deletes one', async () => {
    const { container, chat } = setup();
    await ask('first question');
    await waitFor(() => expect(chat.running).toBe(false));
    await fireEvent.click(await screen.findByRole('button', { name: 'New chat' }));
    await ask('second question');
    await waitFor(() => expect(chat.running).toBe(false));

    await fireEvent.click(await screen.findByRole('button', { name: 'Chat history' }));
    const history = await screen.findByRole('dialog', { name: 'Chat history' });
    await waitFor(() => expect(within(history).getAllByRole('listitem')).toHaveLength(2));
    await fireEvent.input(within(history).getByLabelText('Search chats'), { target: { value: 'first' } });
    expect(within(history).getAllByRole('listitem')).toHaveLength(1);
    await fireEvent.click(within(history).getByRole('button', { name: /^first question/ }));
    await waitFor(() => expect(container.querySelector('.msg.user .bubble')?.textContent).toBe('first question'));
    expect(screen.queryByRole('dialog', { name: 'Chat history' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Chat history' }));
    const again = await screen.findByRole('dialog', { name: 'Chat history' });
    await fireEvent.click(within(again).getByRole('button', { name: 'Delete first question' }));
    await fireEvent.click(within(again).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(container.querySelector('.chat-head')).toBeNull());
    expect(chat.chats.map((c) => c.title)).toEqual(['second question']);
  });

  it('closes on Escape', async () => {
    const { chat } = setup();
    await ask('something');
    await waitFor(() => expect(chat.running).toBe(false));
    await fireEvent.click(await screen.findByRole('button', { name: 'Chat history' }));
    const history = await screen.findByRole('dialog', { name: 'Chat history' });
    await fireEvent.keyDown(within(history).getByLabelText('Search chats'), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Chat history' })).toBeNull();
  });
});
