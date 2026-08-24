// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkForUpdate,
  releasesBetweenBuilds,
  resetVersionCheckForTests,
  showUpdateBanner,
} from '../src/version-check.js';

function release(buildNumber, label = `Release ${buildNumber}`, notes = [`Change ${buildNumber}`]) {
  return { buildNumber, label, notes };
}

function metadata(overrides = {}) {
  return {
    schemaVersion: 1,
    buildId: '20260804-0300-4-104',
    buildNumber: 104,
    builtAt: '2026-08-04T03:00:00.000Z',
    releases: [release(104)],
    ...overrides,
  };
}

function response(body) {
  return { ok: true, json: vi.fn(async () => body) };
}

beforeEach(() => {
  document.body.replaceChildren();
  resetVersionCheckForTests();
});

afterEach(() => {
  resetVersionCheckForTests();
});

describe('version update banner', () => {
  it('does not show a banner for the running build', async () => {
    const fetchImpl = vi.fn(async () => response(metadata({
      buildId: 'current-build',
      buildNumber: 103,
    })));

    await checkForUpdate({
      allowInDev: true,
      fetchImpl,
      runningBuildId: 'current-build',
      runningBuildNumber: 103,
    });

    expect(document.querySelector('.update-banner')).toBeNull();
  });

  it('shows a compact accessible banner for a newer build', async () => {
    await checkForUpdate({
      allowInDev: true,
      fetchImpl: vi.fn(async () => response(metadata())),
      runningBuildId: 'running-build',
      runningBuildNumber: 103,
    });

    const banner = document.querySelector('.update-banner');
    const trigger = banner.querySelector('.update-banner-summary');
    const panel = banner.querySelector('.update-banner-panel');
    expect(banner.textContent).toContain('New version available (20260804-0300-4-104)');
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-controls')).toBe(panel.id);
    expect(panel.hidden).toBe(true);
  });

  it('expands and collapses release notes with synchronized aria-expanded state', () => {
    const banner = showUpdateBanner(metadata(), { runningBuildNumber: 103 });
    const trigger = banner.querySelector('.update-banner-summary');
    const panel = banner.querySelector('.update-banner-panel');

    trigger.click();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-label')).toContain('Hide release notes');
    expect(panel.hidden).toBe(false);

    trigger.click();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(panel.hidden).toBe(true);
  });

  it('shows exactly one intervening release when one release behind', () => {
    const banner = showUpdateBanner(metadata({ releases: [release(103), release(104)] }), {
      runningBuildNumber: 103,
    });

    expect([...banner.querySelectorAll('.update-banner-release-heading')].map((node) => node.textContent))
      .toEqual(['Build 104 · Release 104']);
  });

  it('shows three intervening releases in chronological order and excludes current and older notes', () => {
    const releases = [release(99), release(100), release(101), release(102), release(103)];
    expect(releasesBetweenBuilds(releases, 100, 103).map((entry) => entry.buildNumber))
      .toEqual([101, 102, 103]);

    const banner = showUpdateBanner(metadata({ buildNumber: 103, releases }), { runningBuildNumber: 100 });
    expect([...banner.querySelectorAll('.update-banner-release-heading')].map((node) => node.textContent))
      .toEqual([
        'Build 101 · Release 101',
        'Build 102 · Release 102',
        'Build 103 · Release 103',
      ]);
  });

  it.each([
    ['missing history', undefined],
    ['malformed history', [{ buildNumber: 104, label: 'Broken', notes: ['Okay'] }, { buildNumber: 104, label: 'Duplicate', notes: ['No'] }]],
  ])('keeps update available with a fallback for %s', (_name, releases) => {
    const refresh = vi.fn(async () => {});
    const banner = showUpdateBanner(metadata({ releases }), { runningBuildNumber: 103, refresh });

    expect(banner.querySelector('.update-banner-unavailable').textContent)
      .toContain('Release notes are unavailable');
    expect(banner.querySelector('[data-action="reload"]')).not.toBeNull();
  });

  it('renders note content as text instead of unchecked HTML', () => {
    const banner = showUpdateBanner(metadata({ releases: [release(104, 'Safe', ['<img src=x onerror=alert(1)>'])] }), {
      runningBuildNumber: 103,
    });

    expect(banner.querySelector('.update-banner-release li').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(banner.querySelector('.update-banner-release img')).toBeNull();
  });

  it('does not toggle the panel when Update now or dismiss is clicked', async () => {
    const refresh = vi.fn(async () => {});
    const banner = showUpdateBanner(metadata(), { runningBuildNumber: 103, refresh });
    const trigger = banner.querySelector('.update-banner-summary');

    banner.querySelector('[data-action="reload"]').click();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledOnce();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    resetVersionCheckForTests();
    const dismissBanner = showUpdateBanner(metadata(), { runningBuildNumber: 103, refresh });
    const dismissTrigger = dismissBanner.querySelector('.update-banner-summary');
    dismissBanner.querySelector('[data-action="dismiss"]').click();
    expect(dismissTrigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.update-banner')).toBeNull();
  });

  it('shows synchronous busy feedback and rejects duplicate update clicks', async () => {
    let finishRefresh;
    const refresh = vi.fn(() => new Promise((resolve) => { finishRefresh = resolve; }));
    const banner = showUpdateBanner(metadata(), { runningBuildNumber: 103, refresh });
    const updateButton = banner.querySelector('[data-action="reload"]');
    const dismissButton = banner.querySelector('[data-action="dismiss"]');

    updateButton.click();

    expect(updateButton.textContent).toBe('Updating…');
    expect(updateButton.disabled).toBe(true);
    expect(updateButton.classList.contains('is-updating')).toBe(true);
    expect(dismissButton.disabled).toBe(true);
    expect(banner.getAttribute('aria-busy')).toBe('true');
    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ buildNumber: 104 }));

    updateButton.click();
    expect(refresh).toHaveBeenCalledOnce();
    finishRefresh();
    await Promise.resolve();
  });

  it('shows an actionable retry state when update preparation fails', async () => {
    const refresh = vi.fn(async () => {
      throw new Error('The latest release did not become ready in time.');
    });
    const banner = showUpdateBanner(metadata(), { runningBuildNumber: 103, refresh });
    const updateButton = banner.querySelector('[data-action="reload"]');

    updateButton.click();
    await vi.waitFor(() => expect(updateButton.disabled).toBe(false));

    expect(updateButton.textContent).toBe('Retry update');
    expect(banner.getAttribute('aria-busy')).toBe('false');
    expect(banner.querySelector('.update-banner-update-error').textContent)
      .toContain('did not become ready in time');
  });

  it('does not duplicate the banner during repeated polling', async () => {
    const fetchImpl = vi.fn(async () => response(metadata()));
    const options = {
      allowInDev: true,
      fetchImpl,
      runningBuildId: 'running-build',
      runningBuildNumber: 103,
    };

    await checkForUpdate(options);
    await checkForUpdate(options);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('.update-banner')).toHaveLength(1);
  });
});
