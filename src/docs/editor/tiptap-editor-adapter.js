import { Editor } from '@tiptap/core';
import { createFlightDeckTiptapExtensions } from './prosemirror-flightdeck-schema.js';
import { resolveDocumentProseMirrorState } from './markdown-to-prosemirror.js';
import { prosemirrorToFlightDeckContentModel } from './prosemirror-to-flightdeck.js';

export function createTiptapEditorAdapter({
  element,
  document,
  editorState,
  editable = true,
  onEditIntent = () => {},
  onUpdate = () => {},
  onPaste = () => false,
  placeholder = 'Start writing...',
} = {}) {
  if (!element) throw new Error('Tiptap editor adapter requires a mount element.');
  const editor = new Editor({
    element,
    editable,
    extensions: createFlightDeckTiptapExtensions({ placeholder }),
    content: editorState || resolveDocumentProseMirrorState(document || {}),
    editorProps: {
      handlePaste: (_view, event) => onPaste(event, editor) === true,
      handleDOMEvents: {
        pointerdown: () => {
          onEditIntent('pointer');
          return false;
        },
        focus: () => {
          onEditIntent('focus');
          return false;
        },
        keydown: () => {
          onEditIntent('keyboard');
          return false;
        },
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      onUpdate(prosemirrorToFlightDeckContentModel(activeEditor.getJSON()), activeEditor);
    },
  });

  return {
    editor,
    getJSON() {
      return editor.getJSON();
    },
    getContentModel() {
      return prosemirrorToFlightDeckContentModel(editor.getJSON());
    },
    setEditable(nextEditable) {
      editor.setEditable(Boolean(nextEditable));
    },
    setContent(editorState, { emitUpdate = false } = {}) {
      editor.commands.setContent(editorState || { type: 'doc', content: [] }, { emitUpdate });
    },
    destroy() {
      editor.destroy();
    },
  };
}
