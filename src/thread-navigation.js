const INTERACTIVE_SELECTOR = [
  'input',
  'textarea',
  'select',
  'button',
  'a[href]',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="textbox"]',
  '[data-chat-composer]',
  '[data-thread-navigation-local]',
  '[data-horizontal-scroll]',
  'pre',
].join(',');

function eventElement(event) {
  const candidate = event?.target || (typeof document !== 'undefined' ? document.activeElement : null);
  return candidate?.nodeType === 3 ? candidate.parentElement : candidate;
}

export function shouldSuppressThreadNavigation(event) {
  if (!event || event.defaultPrevented || event.isComposing) return true;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return true;
  const target = eventElement(event);
  if (!target) return false;
  if (typeof target.closest === 'function' && target.closest(INTERACTIVE_SELECTOR)) return true;
  return false;
}

export function threadNavigationTimestamp(row = {}) {
  const value = row.inboxActivityAt || row.latestMessageUpdatedAt || row.activityAt || row.updated_at || '';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function resolveVisibleThreadNeighbour(rows = [], activeId = '', direction = 'older') {
  const source = Array.isArray(rows) ? rows : [];
  const index = source.findIndex((row) => String(row?.rootRecordId || row?.id || '') === String(activeId || ''));
  if (index < 0 || source.length < 2) return null;
  const firstTimestamp = threadNavigationTimestamp(source[0]);
  const lastTimestamp = threadNavigationTimestamp(source[source.length - 1]);
  const olderStep = firstTimestamp >= lastTimestamp ? 1 : -1;
  const step = direction === 'newer' ? -olderStep : olderStep;
  return source[index + step] || null;
}

export function resolveHorizontalSwipe(start = {}, end = {}, options = {}) {
  const minimumDistance = Number(options.minimumDistance || 56);
  const dominanceRatio = Number(options.dominanceRatio || 1.35);
  const edgeInset = Number(options.edgeInset || 24);
  const viewportWidth = Number(options.viewportWidth || 0);
  const deltaX = Number(end.x || 0) - Number(start.x || 0);
  const deltaY = Number(end.y || 0) - Number(start.y || 0);
  if (Number(start.x || 0) <= edgeInset) return null;
  if (viewportWidth > 0 && Number(start.x || 0) >= viewportWidth - edgeInset) return null;
  if (Math.abs(deltaX) < minimumDistance) return null;
  if (Math.abs(deltaX) < Math.abs(deltaY) * dominanceRatio) return null;
  return deltaX < 0 ? 'older' : 'newer';
}
