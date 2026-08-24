import { forceRefreshToLatestBuild } from './service-worker-registration.js';

const RUNNING_BUILD_ID = typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : 'dev';
const RUNNING_BUILD_NUMBER = typeof __APP_BUILD_NUMBER__ !== 'undefined' ? __APP_BUILD_NUMBER__ : 0;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const IS_DEV = import.meta.env.DEV;
const NOTES_PANEL_ID = 'flightdeck-update-release-notes';

let updateBanner = null;
let dismissed = false;
let intervalId = null;

export function getRunningBuildId() {
  return RUNNING_BUILD_ID;
}

export function getRunningBuildNumber() {
  return RUNNING_BUILD_NUMBER;
}

function appendTextElement(parent, tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

export function normalizeReleaseHistory(releases) {
  if (!Array.isArray(releases)) return null;
  let previousBuildNumber = 0;
  const normalized = [];

  for (const release of releases) {
    if (!release || typeof release !== 'object' || Array.isArray(release)) return null;
    if (!Number.isSafeInteger(release.buildNumber) || release.buildNumber < 1) return null;
    if (release.buildNumber <= previousBuildNumber) return null;
    const label = typeof release.label === 'string' ? release.label.trim() : '';
    if (!label || !Array.isArray(release.notes)) return null;
    const notes = release.notes.map((note) => typeof note === 'string' ? note.trim() : '');
    if (notes.some((note) => !note)) return null;
    const noUserVisibleChanges = release.noUserVisibleChanges === true;
    if ((noUserVisibleChanges && notes.length > 0) || (!noUserVisibleChanges && notes.length === 0)) return null;

    normalized.push({
      buildNumber: release.buildNumber,
      label,
      notes,
      noUserVisibleChanges,
      buildId: typeof release.buildId === 'string' ? release.buildId.trim() : '',
      publishedAt: typeof release.publishedAt === 'string' && !Number.isNaN(Date.parse(release.publishedAt))
        ? release.publishedAt
        : '',
    });
    previousBuildNumber = release.buildNumber;
  }

  return normalized;
}

export function releasesBetweenBuilds(releases, runningBuildNumber, latestBuildNumber) {
  if (!Number.isSafeInteger(runningBuildNumber) || runningBuildNumber < 0) return [];
  if (!Number.isSafeInteger(latestBuildNumber) || latestBuildNumber < 1) return [];
  const normalized = normalizeReleaseHistory(releases);
  if (!normalized) return [];
  return normalized.filter((release) => (
    release.buildNumber > runningBuildNumber && release.buildNumber <= latestBuildNumber
  ));
}

function formatPublishedAt(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return '';
  }
}

function buildReleasePanel(metadata, runningBuildNumber) {
  const panel = document.createElement('div');
  panel.id = NOTES_PANEL_ID;
  panel.className = 'update-banner-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Available release notes');

  const latestBuildNumber = Number.isSafeInteger(metadata.buildNumber) ? metadata.buildNumber : null;
  const runningLabel = runningBuildNumber > 0 ? `Build ${runningBuildNumber}` : 'Current build';
  const latestLabel = latestBuildNumber ? `Build ${latestBuildNumber}` : metadata.buildId;
  appendTextElement(panel, 'p', 'update-banner-range', `${runningLabel} → ${latestLabel}`);

  const releases = latestBuildNumber
    ? releasesBetweenBuilds(metadata.releases, runningBuildNumber, latestBuildNumber)
    : [];
  if (releases.length === 0) {
    appendTextElement(
      panel,
      'p',
      'update-banner-unavailable',
      'Release notes are unavailable for this update. You can still update now.',
    );
    return panel;
  }

  const list = document.createElement('div');
  list.className = 'update-banner-releases';
  releases.forEach((release) => {
    const section = document.createElement('section');
    section.className = 'update-banner-release';
    const heading = appendTextElement(section, 'h2', 'update-banner-release-heading', `Build ${release.buildNumber} · ${release.label}`);
    if (release.buildId) heading.title = release.buildId;
    const publishedAt = formatPublishedAt(release.publishedAt);
    if (publishedAt) appendTextElement(section, 'p', 'update-banner-release-time', `Published ${publishedAt}`);

    if (release.noUserVisibleChanges) {
      appendTextElement(section, 'p', 'update-banner-no-visible-changes', 'No user-visible changes in this build.');
    } else {
      const notes = document.createElement('ul');
      release.notes.forEach((note) => appendTextElement(notes, 'li', '', note));
      section.append(notes);
    }
    list.append(section);
  });
  panel.append(list);
  return panel;
}

export function showUpdateBanner(metadata, options = {}) {
  if (updateBanner || typeof document === 'undefined') return updateBanner;
  const runningBuildId = options.runningBuildId ?? RUNNING_BUILD_ID;
  const runningBuildNumber = options.runningBuildNumber ?? RUNNING_BUILD_NUMBER;
  const refresh = options.refresh ?? forceRefreshToLatestBuild;

  const banner = document.createElement('aside');
  banner.className = 'update-banner';
  banner.setAttribute('aria-label', 'Application update available');

  const bar = document.createElement('div');
  bar.className = 'update-banner-bar';
  const summaryButton = document.createElement('button');
  summaryButton.type = 'button';
  summaryButton.className = 'update-banner-summary';
  summaryButton.dataset.action = 'toggle';
  summaryButton.setAttribute('aria-expanded', 'false');
  summaryButton.setAttribute('aria-controls', NOTES_PANEL_ID);
  summaryButton.setAttribute('aria-label', `Show release notes for update ${metadata.buildId}`);
  appendTextElement(summaryButton, 'span', 'update-banner-summary-text', `New version available (${metadata.buildId})`);
  appendTextElement(summaryButton, 'span', 'update-banner-disclosure', '⌄').setAttribute('aria-hidden', 'true');

  const actions = document.createElement('div');
  actions.className = 'update-banner-actions';
  const reloadButton = appendTextElement(actions, 'button', 'update-banner-btn', 'Update now');
  reloadButton.type = 'button';
  reloadButton.dataset.action = 'reload';
  const dismissButton = appendTextElement(actions, 'button', 'update-banner-btn dismiss', '×');
  dismissButton.type = 'button';
  dismissButton.dataset.action = 'dismiss';
  dismissButton.setAttribute('aria-label', 'Dismiss update notification');

  const panel = buildReleasePanel(metadata, runningBuildNumber);
  const updateError = appendTextElement(banner, 'p', 'update-banner-update-error', '');
  updateError.hidden = true;
  updateError.setAttribute('role', 'alert');
  let updateInProgress = false;

  const setUpdateInProgress = (inProgress) => {
    updateInProgress = inProgress;
    reloadButton.disabled = inProgress;
    dismissButton.disabled = inProgress;
    reloadButton.classList.toggle('is-updating', inProgress);
    reloadButton.textContent = inProgress ? 'Updating…' : 'Retry update';
    banner.setAttribute('aria-busy', String(inProgress));
    if (inProgress) {
      updateError.hidden = true;
      updateError.textContent = '';
    }
  };
  summaryButton.addEventListener('click', () => {
    const expanded = summaryButton.getAttribute('aria-expanded') === 'true';
    summaryButton.setAttribute('aria-expanded', String(!expanded));
    summaryButton.setAttribute('aria-label', `${expanded ? 'Show' : 'Hide'} release notes for update ${metadata.buildId}`);
    panel.hidden = expanded;
  });
  reloadButton.addEventListener('click', () => {
    if (updateInProgress) return;
    setUpdateInProgress(true);
    Promise.resolve(refresh(metadata)).catch((error) => {
      setUpdateInProgress(false);
      updateError.textContent = error?.message
        ? `Update could not finish: ${error.message}`
        : 'Update could not finish. Check your connection and try again.';
      updateError.hidden = false;
    });
  });
  dismissButton.addEventListener('click', () => {
    dismissed = true;
    banner.remove();
    updateBanner = null;
  });

  bar.append(summaryButton, actions);
  banner.append(bar, updateError, panel);
  document.body.prepend(banner);
  updateBanner = banner;
  return banner;
}

export async function checkForUpdate(options = {}) {
  if (dismissed || (IS_DEV && !options.allowInDev)) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  const runningBuildId = options.runningBuildId ?? RUNNING_BUILD_ID;
  const runningBuildNumber = options.runningBuildNumber ?? RUNNING_BUILD_NUMBER;
  try {
    const response = await fetchImpl('/version.json', { cache: 'no-store' });
    if (!response.ok) return null;
    const metadata = await response.json();
    if (!metadata || typeof metadata.buildId !== 'string' || !metadata.buildId.trim()) return null;
    if (metadata.buildId === runningBuildId) return null;
    if (
      Number.isSafeInteger(metadata.buildNumber)
      && Number.isSafeInteger(runningBuildNumber)
      && metadata.buildNumber <= runningBuildNumber
    ) return null;
    return showUpdateBanner(metadata, { ...options, runningBuildId, runningBuildNumber });
  } catch {
    return null;
  }
}

export function startVersionCheck() {
  if (intervalId) return;
  checkForUpdate();
  intervalId = setInterval(checkForUpdate, CHECK_INTERVAL_MS);
}

export function resetVersionCheckForTests() {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
  dismissed = false;
  updateBanner?.remove();
  updateBanner = null;
}
