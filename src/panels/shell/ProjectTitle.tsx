/** Inline-editable project name and revision for the menu bar. */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { store, useStore } from '@/store';
import { cn } from '@/ui/cn';
import { INPUT_CLASS } from '@/ui/Input';
import { Tooltip } from '@/ui/Tooltip';

interface InlineEditProps {
  value: string;
  onCommit: (next: string) => void;
  label: string;
  className?: string;
  inputClassName?: string;
  mono?: boolean;
}

function InlineEdit({ value, onCommit, label, className, inputClassName, mono }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const start = () => {
    setText(value);
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const next = text.trim();
    if (next && next !== value) onCommit(next);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') setEditing(false);
    else return;
    e.preventDefault();
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        spellCheck={false}
        className={cn(INPUT_CLASS, 'h-6', mono && 'mono', inputClassName)}
      />
    );
  }
  return (
    <Tooltip content={`Rename ${label.toLowerCase()}`}>
      <button
        type="button"
        onClick={start}
        aria-label={`${label}: ${value}`}
        className={cn(
          'h-6 max-w-[320px] truncate rounded px-1.5 text-left outline-none hover:bg-panel-2 focus-visible:ring-1 focus-visible:ring-accent',
          mono && 'mono',
          className,
        )}
      >
        {value}
      </button>
    </Tooltip>
  );
}

export function ProjectTitle() {
  const name = useStore((s) => s.project.name);
  const rev = useStore((s) => s.project.rev);
  const meta = () => store.getState().setProjectMeta;
  return (
    <div className="flex items-center gap-1 text-[13px]">
      <InlineEdit label="Project name" value={name} onCommit={(next) => meta()({ name: next })} className="font-medium text-fg" inputClassName="w-56" />
      <span className="text-fg-muted">rev</span>
      <InlineEdit label="Revision" value={rev} onCommit={(next) => meta()({ rev: next })} className="text-fg-muted" inputClassName="w-14" mono />
    </div>
  );
}
