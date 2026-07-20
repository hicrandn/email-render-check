'use client';

import { useRef } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { html } from '@codemirror/lang-html';
import { EditorView } from '@codemirror/view';

export type CmView = NonNullable<ReactCodeMirrorRef['view']>;

// Let the surrounding panel colour (--panel) show through the editor so it
// reads as one continuous surface, the way the reference does.
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
  theme,
}: {
  value: string;
  onChange: (value: string) => void;
  onView: (view: CmView) => void;
  theme: 'light' | 'dark';
}) {
  const ref = useRef<ReactCodeMirrorRef>(null);

  return (
    <CodeMirror
      ref={ref}
      value={value}
      height="100%"
      theme={theme}
      style={{ height: '100%', fontSize: 14 }}
      extensions={[html(), EditorView.lineWrapping, blend]}
      onChange={onChange}
      onCreateEditor={(view) => onView(view)}
      basicSetup={{ lineNumbers: true, highlightActiveLine: false }}
    />
  );
}
