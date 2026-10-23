'use client';

import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { html } from '@codemirror/lang-html';
import { EditorView } from '@codemirror/view';

export type CmView = NonNullable<ReactCodeMirrorRef['view']>;

// Let the surrounding panel colour (--panel) show through so the editor and
// its pane read as one surface.
const blend = EditorView.theme({
  '&': { backgroundColor: 'transparent', height: '100%' },
  '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
  '.cm-content': { padding: '12px 4px' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
});

export default function Editor({
  value,
  onChange,
  onView,
}: {
  value: string;
  onChange: (value: string) => void;
  onView: (view: CmView) => void;
}) {
  return (
    <CodeMirror
      value={value}
      height="100%"
      theme="light"
      style={{ height: '100%', fontSize: 14 }}
      extensions={[html(), EditorView.lineWrapping, blend]}
      onChange={onChange}
      onCreateEditor={(view) => onView(view)}
      basicSetup={{ lineNumbers: true, highlightActiveLine: false }}
    />
  );
}
