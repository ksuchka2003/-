import { useId, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Modal, SearchField } from './shared';
import { PaletteMotif } from './PaletteMotif';
import type { Palette } from '../readerDomain';

export type PaperOption = { value: string; label: string; motif?: Palette };

/** A named button opens a scrollable choice sheet instead of the platform select popup. */
export function PaperSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: readonly PaperOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState('');
  const selectedId = useId();
  const selected = options.find((option) => option.value === value)?.label || 'Выбрать';
  const visible = options.filter((option) =>
    option.label.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')),
  );
  return (
    <div className="field paper-select">
      <span>{label}</span>
      <button
        type="button"
        className="paper-button paper-select-trigger"
        aria-label={label}
        aria-describedby={selectedId}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setQuery('');
          setOpen(true);
        }}
      >
        <span id={selectedId}>{selected}</span>
        <ChevronDown size={17} aria-hidden="true" />
        <PaletteMotif className="paper-control-motif" />
      </button>
      {open && (
        <Modal title={label} onClose={() => setOpen(false)}>
          {options.length > 7 && (
            <SearchField
              label={`Поиск: ${label}`}
              placeholder="Найти вариант"
              value={query}
              onChange={setQuery}
            />
          )}
          <div className="paper-options" role="group" aria-label={label}>
            {visible.map((option) => (
              <button
                type="button"
                className="paper-button"
                key={option.value}
                data-option-value={option.value}
                aria-pressed={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span>{option.label}</span>
                {option.motif && (
                  <PaletteMotif palette={option.motif} className="palette-option-motif" />
                )}
                {option.value === value && <Check size={18} aria-hidden="true" />}
              </button>
            ))}
          </div>
          {!visible.length && (
            <p className="muted" role="status">
              Ничего не найдено
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
