import { isTowerPgBackendMode } from './backend-mode.js';
import { getTaskById } from './db.js';

export function taskOpenErrorMessage(error = null) {
  const status = Number(error?.status || 0);
  if (status === 401 || status === 403 || status === 404) {
    return 'You do not have permission to read this task, or it no longer exists.';
  }
  if (error) return `Could not open task: ${error?.message || String(error)}`;
  return 'This task is not available in the current workspace.';
}

export async function resolveTaskForDetail(store, taskId, deps = {}) {
  const recordId = String(taskId || '').trim();
  if (!recordId) return null;

  const readLocalTask = deps.getTaskById || getTaskById;
  const hydrateTask = deps.hydrateTowerPgTask
    || ((target, id) => target.requestTowerSyncFamily?.('task', id, { force: true }));
  const pgMode = typeof deps.isTowerPgBackendMode === 'function'
    ? deps.isTowerPgBackendMode()
    : isTowerPgBackendMode();
  let task = (store.tasks || []).find((item) => item?.record_id === recordId) || null;
  if (!task) task = await readLocalTask(recordId);

  let hydrationError = null;
  if (!task && pgMode) {
    try {
      task = await hydrateTask(store, recordId);
    } catch (error) {
      hydrationError = error;
      console.warn('[flightdeck] task hydration failed before opening task detail', error);
    }
    task = (store.tasks || []).find((item) => item?.record_id === recordId)
      || await readLocalTask(recordId)
      || task;
  }

  if (!task || task.record_state === 'deleted') {
    store.error = taskOpenErrorMessage(hydrationError);
    return null;
  }

  if (!(store.tasks || []).some((item) => item?.record_id === recordId)) {
    await store.applyTasks?.([...(store.tasks || []), task]);
    task = (store.tasks || []).find((item) => item?.record_id === recordId) || task;
  }
  store.error = null;
  return task;
}

export async function openTaskLinkFromChat(store, taskId, deps = {}) {
  const task = await resolveTaskForDetail(store, taskId, deps);
  if (!task) return false;
  store.chatTaskModalTitle = '';
  store.chatTaskModalFullScreen = false;
  store.chatTaskModalOpen = false;
  store.openTaskDetail(task.record_id);
  if (!store.editingTask) {
    store.error = taskOpenErrorMessage();
    return false;
  }
  return true;
}
