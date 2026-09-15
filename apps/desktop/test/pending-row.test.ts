import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import PendingRow from '../src/components/PendingRow.svelte';
import { repoStatus } from './fixtures.ts';

describe('PendingRow', () => {
  it('shows repo name, branch, unpushed and uncommitted chips and the task title', () => {
    render(PendingRow, { props: { status: repoStatus(), taskTitle: 'Release watch banner' } });
    expect(screen.getByRole('heading', { name: 'app' })).toBeTruthy();
    expect(screen.getByText('feature/banner')).toBeTruthy();
    expect(screen.getByText('2 unpushed')).toBeTruthy();
    expect(screen.getByText('2 uncommitted')).toBeTruthy();
    expect(screen.getByText('Release watch banner')).toBeTruthy();
  });

  it('flags a branch with no remote and shows the behind count', () => {
    const { container } = render(PendingRow, {
      props: { status: repoStatus({ upstream: undefined, ahead: 0, behind: 3, dirty: [] }) },
    });
    expect(screen.getByText('no remote branch')).toBeTruthy();
    expect(screen.getByText('3 behind')).toBeTruthy();
    expect(container.querySelector('.chip.late')).toBeNull();
  });

  it('renders review and deploy chips when connectors provide them', () => {
    const { container } = render(PendingRow, {
      props: { status: repoStatus(), review: 'in review', deployed: 'deployed' },
    });
    expect(container.querySelector('.chip.review')?.textContent).toBe('in review');
    expect(container.querySelector('.chip.done')?.textContent).toBe('deployed');
  });
});
