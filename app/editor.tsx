'use client';

import { useEffect, useRef, useState } from 'react';
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
  // Match the editor chrome to the OS colour scheme (same signal Tailwind uses).
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => setTheme(mq.matches ? 'dark' : 'light');
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  return (
    <CodeMirror
      ref={ref}
      value={value}
      height="100%"
      theme={theme}
      style={{ height: '100%', fontSize: 13 }}
      extensions={[html(), EditorView.lineWrapping]}
      onChange={onChange}
      onCreateEditor={(view) => onView(view)}
      basicSetup={{ lineNumbers: true, highlightActiveLine: true }}
    />
  );
}
