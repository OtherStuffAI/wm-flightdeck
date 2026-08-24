import { getAutopilotWappActivationCatalog, processAutopilotWappInstallIntent } from './api.js';

export function loadAutopilotWappActivationCatalog(autopilotUrl) {
  return getAutopilotWappActivationCatalog(autopilotUrl);
}

export function claimAutopilotWappInstallIntent(workspaceId, intentId, autopilotUrl) {
  return processAutopilotWappInstallIntent(workspaceId, intentId, autopilotUrl);
}
