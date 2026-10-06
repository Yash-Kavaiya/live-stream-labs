import './elements';
import {
  useEffect,
  useRef,
  type CSSProperties,
  type MouseEventHandler,
  type ReactNode,
  type RefObject,
} from 'react';

/**
 * Thin, typed React wrappers over Material Web (Material Design 3) components.
 * Custom-element events are attached with addEventListener so behaviour does not depend on
 * how a given React version maps `on*` props to custom elements.
 */

function useDomEvent<E extends HTMLElement>(
  ref: RefObject<E | null>,
  type: string,
  handler: ((event: Event) => void) | undefined,
): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listener = (event: Event) => latest.current?.(event);
    el.addEventListener(type, listener);
    return () => el.removeEventListener(type, listener);
  }, [ref, type]);
}

// ---------- Icon ----------

/** A Material Symbols (Rounded) glyph. `name` is the ligature, e.g. "videocam". */
export function Icon({ name, filled, slot, style }: { name: string; filled?: boolean; slot?: string; style?: CSSProperties }) {
  return (
    <md-icon slot={slot} class={filled ? 'filled' : undefined} style={style} aria-hidden="true">
      {name}
    </md-icon>
  );
}

// ---------- Buttons ----------

export type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated';

const BUTTON_TAGS = {
  filled: 'md-filled-button',
  tonal: 'md-filled-tonal-button',
  outlined: 'md-outlined-button',
  text: 'md-text-button',
  elevated: 'md-elevated-button',
} as const;

export interface ButtonProps {
  variant?: ButtonVariant;
  icon?: string;
  disabled?: boolean;
  type?: 'button' | 'submit';
  href?: string;
  danger?: boolean;
  onClick?: MouseEventHandler<HTMLElement>;
  children: ReactNode;
  style?: CSSProperties;
  'data-testid'?: string;
}

const DANGER_STYLE = {
  '--md-filled-button-container-color': 'var(--app-live)',
  '--md-filled-button-label-text-color': 'var(--app-on-live)',
  '--md-filled-button-hover-label-text-color': 'var(--app-on-live)',
  '--md-filled-button-focus-label-text-color': 'var(--app-on-live)',
  '--md-filled-button-pressed-label-text-color': 'var(--app-on-live)',
  '--md-filled-button-icon-color': 'var(--app-on-live)',
  '--md-filled-button-hover-icon-color': 'var(--app-on-live)',
  '--md-text-button-label-text-color': 'var(--md-sys-color-error)',
} as CSSProperties;

export function Button({ variant = 'filled', icon, danger, children, style, type = 'button', ...rest }: ButtonProps) {
  const Tag = BUTTON_TAGS[variant];
  return (
    <Tag {...rest} type={type} has-icon={icon ? true : undefined} style={danger ? { ...DANGER_STYLE, ...style } : style}>
      {icon && <Icon name={icon} slot="icon" />}
      {children}
    </Tag>
  );
}

export type IconButtonVariant = 'standard' | 'filled' | 'tonal' | 'outlined';

const ICON_BUTTON_TAGS = {
  standard: 'md-icon-button',
  filled: 'md-filled-icon-button',
  tonal: 'md-filled-tonal-icon-button',
  outlined: 'md-outlined-icon-button',
} as const;

export interface IconButtonProps {
  icon: string;
  /** Accessible name; also shown as the tooltip. */
  label: string;
  variant?: IconButtonVariant;
  filledIcon?: boolean;
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLElement>;
  style?: CSSProperties;
  'data-testid'?: string;
}

export function IconButton({ icon, label, variant = 'standard', filledIcon, ...rest }: IconButtonProps) {
  const Tag = ICON_BUTTON_TAGS[variant];
  return (
    <Tag {...rest} aria-label={label} title={label}>
      <Icon name={icon} filled={filledIcon} />
    </Tag>
  );
}

// ---------- Inputs ----------

export interface TextFieldProps {
  label: string;
  value: string;
  onValue(value: string): void;
  type?: 'text' | 'email' | 'password' | 'textarea' | 'datetime-local' | 'url';
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  supportingText?: string;
  error?: string;
  maxLength?: number;
  rows?: number;
  autoFocus?: boolean;
  autoComplete?: string;
  mono?: boolean;
  onEnter?(): void;
  style?: CSSProperties;
  'data-testid'?: string;
}

export function TextField({ value, onValue, error, supportingText, mono, onEnter, style, autoFocus, autoComplete, maxLength, ...rest }: TextFieldProps) {
  const ref = useRef<HTMLElement & { value: string }>(null);
  useDomEvent(ref, 'input', () => onValue(ref.current!.value));
  useDomEvent(ref, 'keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter' && rest.type !== 'textarea') onEnter?.();
  });
  // Material Web keeps its own value; push ours in when it changes from outside (e.g. reset).
  useEffect(() => {
    if (ref.current && ref.current.value !== value) ref.current.value = value;
  }, [value]);

  return (
    <md-outlined-text-field
      ref={ref}
      {...rest}
      value={value}
      error={error ? true : undefined}
      error-text={error}
      supporting-text={supportingText}
      autofocus={autoFocus ? true : undefined}
      autocomplete={autoComplete}
      maxlength={maxLength}
      style={{ width: '100%', ...(mono ? { '--md-outlined-text-field-input-text-font': 'var(--app-font-mono)' } : {}), ...style } as CSSProperties}
    />
  );
}

export interface SelectProps<T extends string> {
  label: string;
  value: T;
  onValue(value: T): void;
  options: { value: T; label: string }[];
  disabled?: boolean;
  /** Set when the select sits in a scrolling or clipped container, so its menu is not cut off. */
  floatingMenu?: boolean;
  style?: CSSProperties;
  'data-testid'?: string;
}

export function Select<T extends string>({ value, onValue, options, style, floatingMenu, ...rest }: SelectProps<T>) {
  const ref = useRef<HTMLElement & { value: string }>(null);
  useDomEvent(ref, 'change', () => onValue(ref.current!.value as T));
  return (
    <md-outlined-select ref={ref} {...rest} value={value} menu-positioning={floatingMenu ? 'popover' : undefined} style={{ width: '100%', ...style }}>
      {options.map((option) => (
        <md-select-option key={option.value} value={option.value} selected={option.value === value ? true : undefined}>
          <div slot="headline">{option.label}</div>
        </md-select-option>
      ))}
    </md-outlined-select>
  );
}

export function Switch({ selected, onChange, label, disabled, 'data-testid': testId }: { selected: boolean; onChange(selected: boolean): void; label: string; disabled?: boolean; 'data-testid'?: string }) {
  const ref = useRef<HTMLElement & { selected: boolean }>(null);
  useDomEvent(ref, 'change', () => onChange(ref.current!.selected));
  return (
    <label className="row" style={{ justifyContent: 'space-between', cursor: 'pointer' }}>
      <span className="body-large">{label}</span>
      <md-switch ref={ref} selected={selected ? true : undefined} disabled={disabled ? true : undefined} data-testid={testId} />
    </label>
  );
}

export interface SliderProps {
  label: string;
  value: number;
  onValue(value: number): void;
  min: number;
  max: number;
  step?: number;
  /** How the current value is shown next to the label, e.g. "65%". */
  format?(value: number): string;
  'data-testid'?: string;
}

export function Slider({ label, value, onValue, min, max, step = 1, format = String, ...rest }: SliderProps) {
  const ref = useRef<HTMLElement & { value: number }>(null);
  useDomEvent(ref, 'input', () => onValue(ref.current!.value));
  return (
    <label className="col" style={{ gap: 0 }}>
      <span className="row" style={{ justifyContent: 'space-between' }}>
        <span className="body-medium">{label}</span>
        <span className="label-large muted">{format(value)}</span>
      </span>
      <md-slider ref={ref} {...rest} min={min} max={max} step={step} value={value} aria-label={label} style={{ width: '100%' }} />
    </label>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange(checked: boolean): void; label: ReactNode; disabled?: boolean }) {
  const ref = useRef<HTMLElement & { checked: boolean }>(null);
  useDomEvent(ref, 'change', () => onChange(ref.current!.checked));
  return (
    <label className="row" style={{ cursor: 'pointer', minHeight: 48 }}>
      <md-checkbox ref={ref} touch-target="wrapper" checked={checked ? true : undefined} disabled={disabled ? true : undefined} />
      <span className="grow">{label}</span>
    </label>
  );
}

// ---------- Containers ----------

export interface DialogProps {
  open: boolean;
  onClose(): void;
  headline: string;
  icon?: string;
  children: ReactNode;
  actions?: ReactNode;
}

export function Dialog({ open, onClose, headline, icon, children, actions }: DialogProps) {
  const ref = useRef<HTMLElement>(null);
  useDomEvent(ref, 'closed', onClose);
  return (
    <md-dialog ref={ref} open={open ? true : undefined}>
      {icon && <Icon name={icon} slot="icon" />}
      <div slot="headline">{headline}</div>
      <div slot="content" className="col" style={{ gap: 16 }}>
        {/* Unmount the body while closed so forms reset and effects stop. */}
        {open && children}
      </div>
      {actions && <div slot="actions">{actions}</div>}
    </md-dialog>
  );
}

export interface TabsProps<T extends string> {
  tabs: { id: T; label: string; icon?: string }[];
  active: T;
  onChange(id: T): void;
}

export function Tabs<T extends string>({ tabs, active, onChange }: TabsProps<T>) {
  const ref = useRef<HTMLElement & { activeTabIndex: number }>(null);
  useDomEvent(ref, 'change', () => {
    const tab = tabs[ref.current!.activeTabIndex];
    if (tab) onChange(tab.id);
  });
  return (
    <md-tabs ref={ref} active-tab-index={tabs.findIndex((t) => t.id === active)}>
      {tabs.map((tab) => (
        <md-primary-tab key={tab.id} active={tab.id === active ? true : undefined} data-testid={`tab-${tab.id}`}>
          {tab.icon && <Icon name={tab.icon} slot="icon" />}
          {tab.label}
        </md-primary-tab>
      ))}
    </md-tabs>
  );
}

export function Spinner({ size = 40 }: { size?: number }) {
  return <md-circular-progress indeterminate aria-label="Loading" style={{ '--md-circular-progress-size': `${size}px` } as CSSProperties} />;
}

export function Divider() {
  return <md-divider />;
}

export function EmptyState({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <Icon name={icon} />
      <div className="title-medium" style={{ color: 'var(--md-sys-color-on-surface)' }}>{title}</div>
      {children}
    </div>
  );
}
