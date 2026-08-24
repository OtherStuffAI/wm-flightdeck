export const WINGMAN_IPHONE_WEBVIEW_CLASS = 'wingman-iphone-webview';

export function isWingmanIphoneWebView({ windowObject, navigatorObject }) {
  const userAgent = navigatorObject?.userAgent ?? '';
  return Boolean(windowObject?.nostr?.__wingman) && /\b(?:iPhone|iPod)\b/i.test(userAgent);
}

export function applyWingmanIphoneWebViewMarker({
  windowObject = globalThis.window,
  navigatorObject = globalThis.navigator,
  documentObject = globalThis.document,
} = {}) {
  const matches = isWingmanIphoneWebView({ windowObject, navigatorObject });
  documentObject?.documentElement?.classList.toggle(WINGMAN_IPHONE_WEBVIEW_CLASS, matches);
  return matches;
}

export function installWingmanIphoneWebViewMarker({
  windowObject = globalThis.window,
  navigatorObject = globalThis.navigator,
  documentObject = globalThis.document,
  pollIntervalMs = 50,
  maxWaitMs = 5000,
} = {}) {
  const apply = () => applyWingmanIphoneWebViewMarker({
    windowObject,
    navigatorObject,
    documentObject,
  });

  if (apply()) return () => {};

  const startedAt = Date.now();
  const intervalId = windowObject?.setInterval?.(() => {
    if (apply() || Date.now() - startedAt >= maxWaitMs) {
      windowObject.clearInterval(intervalId);
    }
  }, pollIntervalMs);

  return () => {
    if (intervalId !== undefined) windowObject?.clearInterval?.(intervalId);
  };
}
