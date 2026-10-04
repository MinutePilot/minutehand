// TipTap, cut down to what the minutes document needs: plain paragraphs and
// our own blocks, undo and redo, and the ProseMirror pieces for a guard plugin.
export { Editor, Node, Extension, mergeAttributes } from '@tiptap/core';
export { default as Document } from '@tiptap/extension-document';
export { default as Paragraph } from '@tiptap/extension-paragraph';
export { default as Text } from '@tiptap/extension-text';
export { UndoRedo } from '@tiptap/extensions';
export { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
