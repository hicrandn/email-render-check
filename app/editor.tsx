'use client';

import { useRef } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { html } from '@codemirror/lang-html';
import { EditorView } from '@codemirror/view';

export type CmView = NonNullable<ReactCodeMirrorRef['view']>;

export default function Editor({
  value,
  onChange,
  onView,
}: {
  value: string;
  onChange: (value: string) => void;
  onView: (view: CmView) => void;
}) {
  const ref = useRef<ReactCodeMirrorRef>(null);
  return (
    <CodeMirror
      ref={ref}
      value={value}
      height="100%"
      style={{ height: '100%', fontSize: 13 }}
      extensions={[html(), EditorView.lineWrapping]}
      onChange={onChange}
      onCreateEditor={(view) => onView(view)}
      basicSetup={{ lineNumbers: true, highlightActiveLine: true }}
    />
  );
}
