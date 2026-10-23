import { useEffect, useRef } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function RichTextEditor({ value, onChange, placeholder, disabled }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value;
    }
  }, []);

  function command(name: string, argument?: string) {
    document.execCommand(name, false, argument);
    if (ref.current) onChange(ref.current.innerHTML);
  }

  return (
    <div className="rte">
      <div className="rte-toolbar" aria-hidden={disabled}>
        <button type="button" onClick={() => command('bold')} title="Bold">
          <strong>B</strong>
        </button>
        <button type="button" onClick={() => command('italic')} title="Italic">
          <em>I</em>
        </button>
        <button type="button" onClick={() => command('underline')} title="Underline">
          <u>U</u>
        </button>
        <button type="button" onClick={() => command('insertUnorderedList')} title="Bullets">
          •
        </button>
        <button
          type="button"
          onClick={() => {
            const url = window.prompt('URL');
            if (url) command('createLink', url);
          }}
          title="Link"
        >
          ↗
        </button>
        <button type="button" onClick={() => command('removeFormat')} title="Clear">
          ⌫
        </button>
      </div>
      <div
        ref={ref}
        className="rte-content"
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={(event) => onChange(event.currentTarget.innerHTML)}
        onBlur={(event) => onChange(event.currentTarget.innerHTML)}
      />
    </div>
  );
}
