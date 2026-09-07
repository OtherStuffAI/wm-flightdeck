import { uploadWappImage, validateWappImage } from './wapp-image-upload.js';

// File and AbortController stay outside Alpine's reactive proxies.
const selections = new WeakMap();
const contextKey = (store) => JSON.stringify([store.selectedWorkspaceKey, store.currentWorkspace?.workspaceId, store.currentWorkspace?.backendBaseUrl, store.session?.npub, store.currentPgActorId]);

export const wappImageManagerMixin = {
  personalWappImagePreview: '',
  personalWappImageName: '',
  personalWappImageError: '',
  personalWappImageStatus: '',
  personalWappImageBusy: false,
  personalWappImagePending: false,

  resetPersonalWappImage() {
    selections.get(this)?.controller?.abort();
    selections.delete(this);
    if (this.personalWappImagePreview) URL.revokeObjectURL(this.personalWappImagePreview);
    this.personalWappImagePreview = '';
    this.personalWappImageName = '';
    this.personalWappImageError = '';
    this.personalWappImageStatus = '';
    this.personalWappImageBusy = false;
    this.personalWappImagePending = false;
  },

  selectPersonalWappImage(event) {
    const file = event?.target?.files?.[0];
    if (!file || this.personalWappEditorSaving) return;
    event.target.value = '';
    this.resetPersonalWappImage();
    try {
      validateWappImage(file);
      this.personalWappImagePreview = URL.createObjectURL(file);
      this.personalWappImageName = file.name;
      this.personalWappImagePending = true;
      selections.set(this, { file });
    } catch (error) { this.personalWappImageError = error.message; }
  },

  async uploadPersonalWappImage() {
    const selection = selections.get(this);
    if (!selection || this.personalWappImageBusy || this.personalWappEditorSaving || !this.personalWappEditorOpen) return;
    const controller = new AbortController();
    selection.controller = controller;
    const context = contextKey(this);
    const current = () => selections.get(this) === selection && selection.controller === controller && this.personalWappEditorOpen && contextKey(this) === context;
    this.personalWappImageBusy = true;
    this.personalWappImageError = '';
    this.personalWappImageStatus = 'Approve the image upload in your Nostr signer, then wait for Primal.';
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const url = await uploadWappImage(selection.file, { signal: controller.signal });
      if (!current()) return;
      this.personalWappFormIconUrl = url;
      this.personalWappImagePending = false;
      this.personalWappImageStatus = 'Image uploaded. Save WApp to use it.';
    } catch (error) {
      if (!current()) return;
      this.personalWappImageError = controller.signal.aborted ? 'Image upload timed out. Retry or choose another image.' : error.message;
      this.personalWappImageStatus = '';
    } finally {
      clearTimeout(timer);
      if (current()) this.personalWappImageBusy = false;
      else if (selections.get(this) === selection) this.resetPersonalWappImage();
    }
  },
};
