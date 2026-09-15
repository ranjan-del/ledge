import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import GitChips from '../src/components/GitChips.svelte';
import { HOME, repoStatus } from './fixtures.ts';

const repo = `${HOME}/code/app`;

describe('GitChips', () => {
  it('renders nothing for a task with no repository', () => {
    const { container } = render(GitChips, { props: { status: repoStatus() } });
    expect(container.querySelector('.chip')).toBeNull();
  });

  it('renders nothing for a repository that has not been scanned', () => {
    const { container } = render(GitChips, { props: { repo } });
    expect(container.querySelector('.chip')).toBeNull();
  });

  it('names uncommitted and unpushed work in words', () => {
    render(GitChips, { props: { repo, status: repoStatus() } });
    expect(screen.getByText('2 uncommitted')).toBeTruthy();
    expect(screen.getByText('2 unpushed')).toBeTruthy();
    expect(screen.queryByText('clean')).toBeNull();
  });

  it('says clean when there is nothing outstanding', () => {
    render(GitChips, { props: { repo, status: repoStatus({ ahead: 0, dirty: [] }) } });
    expect(screen.getByText('clean')).toBeTruthy();
  });

  it('is not clean merely because a branch is behind: something is waiting to come in', () => {
    render(GitChips, { props: { repo, status: repoStatus({ ahead: 0, dirty: [], behind: 2 }) } });
    expect(screen.getByText('2 behind')).toBeTruthy();
    expect(screen.queryByText('clean')).toBeNull();
  });

  it('flags a side branch with no remote, and does not flag main', () => {
    render(GitChips, {
      props: { repo, status: repoStatus({ upstream: undefined, ahead: 0, dirty: [] }) },
    });
    expect(screen.getByText('no remote branch')).toBeTruthy();
    expect(screen.queryByText('clean')).toBeNull();
  });

  it('treats main with no upstream as clean, because that is normal', () => {
    render(GitChips, {
      props: {
        repo,
        status: repoStatus({ branch: 'main', upstream: undefined, ahead: 0, dirty: [] }),
      },
    });
    expect(screen.getByText('clean')).toBeTruthy();
  });

  it('shows the branch name only when asked', () => {
    const { unmount } = render(GitChips, { props: { repo, status: repoStatus() } });
    expect(screen.queryByText('feature/banner')).toBeNull();
    unmount();
    render(GitChips, { props: { repo, status: repoStatus(), branch: true } });
    expect(screen.getByText('feature/banner')).toBeTruthy();
  });

  it('prefers a connector state over the clean chip', () => {
    render(GitChips, {
      props: { repo, status: repoStatus({ ahead: 0, dirty: [] }), review: 'in review' },
    });
    expect(screen.getByText('in review')).toBeTruthy();
    expect(screen.queryByText('clean')).toBeNull();
  });
});
