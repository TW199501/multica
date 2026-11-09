"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { Input } from "@multica/ui/components/ui/input";
import { cn } from "@multica/ui/lib/utils";

interface ModelComboboxProps {
  id: string;
  value: string;
  options: readonly string[];
  placeholder?: string;
  onChange: (value: string) => void;
}

/**
 * Free text with a list of known models. Opening it shows every option, even
 * with a model already filled in; the list only narrows once the person types.
 */
export function ModelCombobox({ id, value, options, placeholder, onChange }: ModelComboboxProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(-1);

  const needle = value.trim().toLowerCase();
  const visible = typed && needle ? options.filter((option) => option.toLowerCase().includes(needle)) : options;
  const expanded = open && visible.length > 0;

  const show = () => {
    setOpen(true);
    setTyped(false);
    setActive(-1);
  };

  const choose = (option: string) => {
    onChange(option);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!expanded) {
        show();
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + visible.length) % visible.length);
    } else if (event.key === "Enter" && expanded && visible[active]) {
      event.preventDefault();
      choose(visible[active]);
    }
  };

  return (
    <div className="relative min-w-0 flex-1">
      <Input
        id={id}
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onFocus={show}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setTyped(true);
          setActive(-1);
        }}
      />
      {expanded ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {visible.map((option, index) => (
            <li
              key={option}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option === value}
              // Mouse down, not click: the input's blur would close the list first.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(option);
              }}
              className={cn(
                "cursor-default truncate rounded-md px-2 py-1.5 text-body",
                index === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
                option === value && "font-medium",
              )}
              title={option}
            >
              {option}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
