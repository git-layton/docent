import { useRef, useEffect } from 'react';

function sanitizeEditorHtml(value: string) {
  if (typeof window === 'undefined') return value;
  const template = document.createElement('template');
  template.innerHTML = value ?? '';
  template.content.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach(node => node.remove());
  template.content.querySelectorAll('*').forEach(node => {
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      const val = attr.value.trim().toLowerCase();
      if (name.startsWith('on') || val.startsWith('javascript:')) {
        node.removeAttribute(attr.name);
      }
    }
  });
  return template.innerHTML;
}

export const WysiwygEditor = ({ html, onChange, disabled }: any) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && html !== ref.current.innerHTML && document.activeElement !== ref.current) ref.current.innerHTML = sanitizeEditorHtml(html ?? '');
  }, [html]);
  return <div ref={ref} contentEditable={!disabled} onInput={e => onChange(sanitizeEditorHtml(e.currentTarget.innerHTML))} className="flex-1 p-8 lg:p-12 outline-none overflow-y-auto wysiwyg-editor text-base max-w-3xl mx-auto w-full custom-scrollbar text-ink" data-placeholder="Start writing your document here..." />;
};
