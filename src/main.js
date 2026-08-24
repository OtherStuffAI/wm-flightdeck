import './styles.css';
import { initApp } from './app.js';
import { maybePerformHardReset } from './hard-reset.js';
import { startVersionCheck } from './version-check.js';
import { initImageModal } from './image-modal.js';
import { installNotificationClickRouteHandler, registerBuildServiceWorker } from './service-worker-registration.js';
import { initChatThreadFlowDispatchDomBridge } from './chat-thread-flow-dispatch-dom.js';
import { initMarkdownCodeBlocks } from './markdown-code-blocks.js';
import { installWingmanIphoneWebViewMarker } from './wingman-iphone-webview.js';

installWingmanIphoneWebViewMarker();

async function boot() {
  if (await maybePerformHardReset()) return;
  initApp();
  installNotificationClickRouteHandler();
  initChatThreadFlowDispatchDomBridge();
  registerBuildServiceWorker();
  startVersionCheck();
  initImageModal();
  initMarkdownCodeBlocks();
}

void boot();
