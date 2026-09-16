import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import CommandPalette from '../src/components/CommandPalette.svelte';
import { DAY, taskA, taskB, taskC } from './fixtures.ts';

const base = {
  tasks: [taskA(), taskB(), taskC()],
  surface: 'now' as const,
  day: DAY,
  onrun: () => {},
  onclose: () => {},
};

const FIELD = 'Search tasks, sessions and notes, or run a command';

function rows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="option"]')];
}

function highlighted(container: HTMLElement): string {
  const row = container.querySelector<HTMLElement>('[aria-selected="true"]');
  return row?.querySelector('.what')?.textContent?.trim() ?? '';
}

async function type(text: string) {
  await fireEvent.input(screen.getByLabelText(FIELD), { target: { value: text } });
}

describe('CommandPalette', () => {
  it('takes the focus the moment it opens, with nothing typed', () => {
    render(CommandPalette, { props: { ...base } });
    const field = screen.getByLabelText(FIELD) as HTMLInputElement;
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe('');
  });

  it('shows the recent tasks and a couple of actions before it is asked anything', () => {
    const { container } = render(CommandPalette, { props: { ...base } });
    const groups = [...container.querySelectorAll('.section-label')].map((el) => el.textContent);
    expect(groups).toEqual(['Recent tasks', 'Actions']);
    expect(rows(container).length).toBe(5);
  });

  it('highlights the first row, so Enter always has a subject', () => {
    const { container } = render(CommandPalette, { props: { ...base } });
    expect(highlighted(container)).toBe('Release watch banner for stale tabs');
  });

  it('moves the highlight with the arrow keys and wraps at both ends', async () => {
    const { container } = render(CommandPalette, { props: { ...base } });
    const field = screen.getByLabelText(FIELD);
    await fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(highlighted(container)).toBe('Roll the version file out to every app');
    await fireEvent.keyDown(field, { key: 'ArrowUp' });
    expect(highlighted(container)).toBe('Release watch banner for stale tabs');
    await fireEvent.keyDown(field, { key: 'ArrowUp' });
    expect(highlighted(container)).toBe('Go to Sessions');
    await fireEvent.keyDown(field, { key: 'Home' });
    expect(highlighted(container)).toBe('Release watch banner for stale tabs');
    await fireEvent.keyDown(field, { key: 'End' });
    expect(highlighted(container)).toBe('Go to Sessions');
  });

  it('walks straight through the group headings rather than stopping on them', async () => {
    const { container } = render(CommandPalette, { props: { ...base } });
    const field = screen.getByLabelText(FIELD);
    for (let i = 0; i < 3; i += 1) await fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(highlighted(container)).toBe('Refresh the git scan');
  });

  it('runs the highlighted row on Enter and never anything else', async () => {
    const onrun = vi.fn();
    render(CommandPalette, { props: { ...base, onrun } });
    const field = screen.getByLabelText(FIELD);
    await fireEvent.keyDown(field, { key: 'ArrowDown' });
    await fireEvent.keyDown(field, { key: 'Enter' });
    expect(onrun).toHaveBeenCalledTimes(1);
    expect(onrun).toHaveBeenCalledWith({ type: 'open-task', file: taskC().file });
  });

  it('is usable end to end without the mouse: type, arrow, Enter', async () => {
    const onrun = vi.fn();
    render(CommandPalette, { props: { ...base, onrun } });
    await type('version file');
    const field = screen.getByLabelText(FIELD);
    await fireEvent.keyDown(field, { key: 'ArrowDown' });
    await fireEvent.keyDown(field, { key: 'Enter' });
    expect(onrun).toHaveBeenCalledWith({ type: 'open-task', file: taskC().file });
  });

  it('groups what it finds by kind, with a label on each group', async () => {
    const { container } = render(CommandPalette, { props: { ...base } });
    await type('version file');
    const groups = [...container.querySelectorAll('.section-label')].map((el) => el.textContent);
    expect(groups).toEqual(['Tasks', 'Sessions', 'Notes', 'Actions']);
  });

  it('sends the highlight back to the top when the query changes', async () => {
    const { container } = render(CommandPalette, { props: { ...base } });
    await fireEvent.keyDown(screen.getByLabelText(FIELD), { key: 'ArrowDown' });
    await type('optimistic');
    expect(highlighted(container)).toBe('Optimistic CRUD for the admin grid');
  });

  it('offers to create the typed text as a task, and says so in those words', async () => {
    const onrun = vi.fn();
    const { container } = render(CommandPalette, { props: { ...base, onrun } });
    await type('kubernetes upgrade');
    expect(rows(container)).toHaveLength(1);
    expect(highlighted(container)).toBe('Create task "kubernetes upgrade"');
    await fireEvent.keyDown(screen.getByLabelText(FIELD), { key: 'Enter' });
    expect(onrun).toHaveBeenCalledWith({ type: 'add-task', title: 'kubernetes upgrade' });
  });

  it('closes on Escape', async () => {
    const onclose = vi.fn();
    render(CommandPalette, { props: { ...base, onclose } });
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('closes when the ground behind it is clicked', async () => {
    const onclose = vi.fn();
    const { container } = render(CommandPalette, { props: { ...base, onclose } });
    await fireEvent.click(container.querySelector('.scrim') as HTMLElement);
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('lets the pointer move the same highlight the keys move', async () => {
    const onrun = vi.fn();
    const { container } = render(CommandPalette, { props: { ...base, onrun } });
    await fireEvent.mouseMove(rows(container)[2] as HTMLElement);
    expect(highlighted(container)).toBe('Optimistic CRUD for the admin grid');
    await fireEvent.keyDown(screen.getByLabelText(FIELD), { key: 'Enter' });
    expect(onrun).toHaveBeenCalledWith({ type: 'open-task', file: taskB().file });
  });

  it('names the highlighted row on the field, so a reader is told what Enter will do', () => {
    const { container } = render(CommandPalette, { props: { ...base } });
    const field = screen.getByLabelText(FIELD);
    const row = container.querySelector('[aria-selected="true"]');
    expect(field.getAttribute('aria-activedescendant')).toBe(row?.id);
  });
});
