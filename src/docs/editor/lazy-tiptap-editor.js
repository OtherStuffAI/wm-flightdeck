let adapterModulePromise;

export async function loadTiptapEditorAdapter() {
  adapterModulePromise ||= import('./tiptap-editor-adapter.js');
  return adapterModulePromise;
}
