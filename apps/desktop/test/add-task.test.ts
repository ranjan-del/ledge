import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import AddTask from '../src/components/AddTask.svelte';

function titleField(): HTMLInputElement {
  return screen.getByLabelText('Task title') as HTMLInputElement;
}

async function type(value: string) {
  await fireEvent.input(titleField(), { target: { value } });
}

describe('AddTask', () => {
  it('starts as one row and becomes a field when you click it', async () => {
    render(AddTask, { props: { onadd: () => {} } });
    const row = screen.getByRole('button', { name: 'Add a task' });
    await fireEvent.click(row);
    expect(titleField()).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add a task' })).toBeNull();
  });

  it('adds a task with a title and nothing else', async () => {
    const onadd = vi.fn();
    render(AddTask, { props: { onadd, open: true } });
    await type('Write the release notes');
    await fireEvent.submit(titleField().closest('form') as HTMLFormElement);
    expect(onadd).toHaveBeenCalledWith({
      title: 'Write the release notes',
      status: 'current',
      repo: undefined,
      planned: undefined,
    });
  });

  it('trims the title and refuses an empty one', async () => {
    const onadd = vi.fn();
    render(AddTask, { props: { onadd, open: true } });
    const form = titleField().closest('form') as HTMLFormElement;
    await fireEvent.submit(form);
    expect(onadd).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add' })).toHaveProperty('disabled', true);
    await type('   Spaces around me   ');
    await fireEvent.submit(form);
    expect(onadd).toHaveBeenCalledWith({
      title: 'Spaces around me',
      status: 'current',
      repo: undefined,
      planned: undefined,
    });
  });

  it('stays open and clears itself, so two tasks in a row take two Enters', async () => {
    const onadd = vi.fn();
    render(AddTask, { props: { onadd, open: true } });
    const form = titleField().closest('form') as HTMLFormElement;
    await type('First');
    await fireEvent.submit(form);
    expect(titleField().value).toBe('');
    await type('Second');
    await fireEvent.submit(form);
    expect(onadd).toHaveBeenCalledTimes(2);
  });

  it('closes on Escape and forgets what was typed', async () => {
    render(AddTask, { props: { onadd: () => {}, open: true } });
    await type('Half a thought');
    await fireEvent.keyDown(titleField(), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Add a task' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Add a task' }));
    expect(titleField().value).toBe('');
  });

  it('reveals the repo and planned fields behind the more affordance', async () => {
    const onadd = vi.fn();
    render(AddTask, { props: { onadd, open: true, defaultRepo: '~/code/app' } });
    expect(screen.queryByLabelText('Repository')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: /More fields/ }));
    const repo = screen.getByLabelText('Repository') as HTMLInputElement;
    expect(repo.value).toBe('~/code/app');
    await fireEvent.input(screen.getByLabelText('Planned'), { target: { value: '2026-09-18' } });
    await type('Roll out the banner');
    await fireEvent.submit(titleField().closest('form') as HTMLFormElement);
    expect(onadd).toHaveBeenCalledWith({
      title: 'Roll out the banner',
      status: 'current',
      repo: '~/code/app',
      planned: '2026-09-18',
    });
  });

  it('adds to the backlog, in its own words, when asked to', async () => {
    const onadd = vi.fn();
    render(AddTask, { props: { onadd, status: 'backlog' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add to the backlog' }));
    expect(screen.getByPlaceholderText('What should wait for later?')).toBeTruthy();
    await type('Calendar connector');
    await fireEvent.submit(titleField().closest('form') as HTMLFormElement);
    expect(onadd).toHaveBeenCalledWith({
      title: 'Calendar connector',
      status: 'backlog',
      repo: undefined,
      planned: undefined,
    });
  });

  it('shows the reason when the store refuses the task', async () => {
    const onadd = vi.fn(() => {
      throw new Error('Task folder is read only');
    });
    render(AddTask, { props: { onadd, open: true } });
    await type('Doomed');
    await fireEvent.submit(titleField().closest('form') as HTMLFormElement);
    expect(await screen.findByText('Task folder is read only')).toBeTruthy();
  });
});
