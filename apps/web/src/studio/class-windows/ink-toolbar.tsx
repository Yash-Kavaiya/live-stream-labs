import { Icon } from '@studio/ui';
import { useEffect } from 'react';
import type { InkSettings, InkSize, InkToolId } from './ink-canvas';

const TOOLS: { id: InkToolId; icon: string; label: string; key: string }[] = [
  { id: 'pen', icon: 'edit', label: 'Pen', key: 'p' },
  { id: 'highlighter', icon: 'ink_highlighter', label: 'Highlighter', key: 'h' },
  { id: 'line', icon: 'horizontal_rule', label: 'Line', key: 'l' },
  { id: 'arrow', icon: 'arrow_right_alt', label: 'Arrow', key: 'a' },
  { id: 'rect', icon: 'crop_square', label: 'Rectangle', key: 'r' },
  { id: 'ellipse', icon: 'circle', label: 'Ellipse', key: 'o' },
  { id: 'text', icon: 'title', label: 'Text', key: 't' },
  { id: 'eraser', icon: 'ink_eraser', label: 'Eraser (removes whole strokes)', key: 'e' },
];

export const INK_COLORS = ['#202124', '#1a73e8', '#d93025', '#188038', '#f29900', '#9334e6', '#fdd663', '#ffffff'];
const COLOR_NAMES = ['Black', 'Blue', 'Red', 'Green', 'Orange', 'Purple', 'Yellow', 'White'];
const SIZES: InkSize[] = ['S', 'M', 'L'];

interface Props {
  settings: InkSettings;
  onChange(settings: InkSettings): void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  onClear(): void;
}

/** Tools, colours, sizes, undo and clear. Single-key shortcuts work while the window is focused. */
export function InkToolbar({ settings, onChange, canUndo, canRedo, onUndo, onRedo, onClear }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) onRedo();
        else onUndo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        onRedo();
        return;
      }
      if (mod || event.altKey) return;
      const tool = TOOLS.find((t) => t.key === event.key.toLowerCase());
      if (tool) onChange({ ...settings, tool: tool.id });
      const digit = Number(event.key);
      if (digit >= 1 && digit <= INK_COLORS.length) onChange({ ...settings, color: INK_COLORS[digit - 1]!, tool: settings.tool === 'eraser' ? 'pen' : settings.tool });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settings, onChange, onUndo, onRedo]);

  return (
    <div className="ink-toolbar" role="toolbar" aria-label="Drawing tools">
      <div className="ink-group" role="group" aria-label="Tool">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="ink-tool"
            aria-pressed={settings.tool === t.id}
            title={`${t.label} (${t.key.toUpperCase()})`}
            aria-label={t.label}
            onClick={() => onChange({ ...settings, tool: t.id })}
            data-testid={`ink-tool-${t.id}`}
          >
            <Icon name={t.icon} />
          </button>
        ))}
      </div>
      <div className="ink-group" role="group" aria-label="Colour">
        {INK_COLORS.map((color, i) => (
          <button
            key={color}
            type="button"
            className="ink-swatch"
            aria-pressed={settings.color === color}
            title={`${COLOR_NAMES[i]} (${i + 1})`}
            aria-label={COLOR_NAMES[i]}
            style={{ '--swatch': color } as React.CSSProperties}
            onClick={() => onChange({ ...settings, color, tool: settings.tool === 'eraser' ? 'pen' : settings.tool })}
            data-testid={`ink-color-${i + 1}`}
          />
        ))}
      </div>
      <div className="ink-group" role="group" aria-label="Size">
        {SIZES.map((size) => (
          <button
            key={size}
            type="button"
            className="ink-tool ink-size"
            aria-pressed={settings.size === size}
            aria-label={`Size ${size}`}
            title={{ S: 'Thin', M: 'Medium', L: 'Thick' }[size]}
            onClick={() => onChange({ ...settings, size })}
          >
            <span className="ink-dot" data-size={size} />
          </button>
        ))}
      </div>
      <div className="ink-group" role="group" aria-label="History">
        <button type="button" className="ink-tool" disabled={!canUndo} onClick={onUndo} title="Undo (Ctrl+Z)" aria-label="Undo" data-testid="ink-undo">
          <Icon name="undo" />
        </button>
        <button type="button" className="ink-tool" disabled={!canRedo} onClick={onRedo} title="Redo (Ctrl+Y)" aria-label="Redo" data-testid="ink-redo">
          <Icon name="redo" />
        </button>
        <button type="button" className="ink-tool" onClick={onClear} title="Clear this page (undo brings it back)" aria-label="Clear page" data-testid="ink-clear">
          <Icon name="delete_sweep" />
        </button>
      </div>
    </div>
  );
}
