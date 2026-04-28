import React, { useCallback, useEffect, useRef, useState } from "react";

function renderBold(text: string): React.ReactNode {
  const lines = text.split("\n");
  return lines.map((line, li) => {
    const parts = line.split(/\*\*([^*]+)\*\*/g);
    const nodes = parts.map((p, pi) =>
      pi % 2 === 1 ? <strong key={pi} className="font-semibold text-white">{p}</strong> : p,
    );
    return (
      <React.Fragment key={li}>
        {nodes}
        {li < lines.length - 1 && <br />}
      </React.Fragment>
    );
  });
}

interface RichTextAreaProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

export function RichTextArea({
  value,
  onChange,
  rows = 2,
  className = "",
  disabled = false,
  placeholder = "",
}: RichTextAreaProps) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && ref.current) ref.current.focus();
  }, [editing]);

  const startEdit = useCallback(() => {
    if (!disabled) setEditing(true);
  }, [disabled]);

  const stopEdit = useCallback(() => setEditing(false), []);

  if (editing) {
    return (
      <textarea
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={stopEdit}
        rows={rows}
        className={`${className} resize-y`}
        disabled={disabled}
        placeholder={placeholder}
      />
    );
  }

  return (
    <div
      role="textbox"
      aria-multiline="true"
      tabIndex={disabled ? -1 : 0}
      onClick={startEdit}
      onFocus={startEdit}
      className={`${className} whitespace-pre-wrap cursor-text${disabled ? " opacity-60 pointer-events-none" : ""}`}
      style={{ minHeight: `${rows * 1.625}rem` }}
    >
      {value
        ? renderBold(value)
        : <span className="opacity-30 select-none">{placeholder}</span>}
    </div>
  );
}
