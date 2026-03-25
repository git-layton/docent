import { useRef, useEffect } from 'react';

export const WysiwygEditor = ({ html, onChange, disabled }: any) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && html !== ref.current.innerHTML && document.activeElement !== ref.current) ref.current.innerHTML = html ?? '';
  }, [html]);
  return <div ref={ref} contentEditable={!disabled} onInput={e => onChange(e.currentTarget.innerHTML)} className="flex-1 p-8 lg:p-12 outline-none overflow-y-auto wysiwyg-editor text-base max-w-3xl mx-auto w-full custom-scrollbar dark:text-neutral-200" data-placeholder="Start writing your document here..." />;
};
