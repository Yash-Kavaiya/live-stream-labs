import { computeLayout, LAYOUT_IDS, LAYOUT_LABELS, type LayoutId, type LayoutStyle } from '@studio/shared';

const THUMB = { width: 160, height: 90 };

/** Which sources a thumbnail pretends are on stage, so each layout shows what makes it different. */
const SAMPLE: Record<LayoutId, string[]> = {
  solo: ['cam:a'],
  grid: ['cam:a', 'cam:b', 'cam:c', 'cam:d'],
  split: ['cam:a', 'cam:b'],
  stack: ['cam:a', 'cam:b'],
  duo: ['cam:a', 'cam:b', 'cam:c'],
  mosaic: ['cam:a', 'cam:b', 'cam:c', 'cam:d', 'cam:e', 'cam:f'],
  spotlight: ['cam:a', 'cam:b', 'cam:c'],
  pip: ['screen:a', 'cam:a'],
  screen: ['screen:a', 'cam:a', 'cam:b'],
  cinema: ['cam:a', 'cam:b', 'cam:c', 'cam:d'],
};

/**
 * A miniature of a layout, drawn by the real layout engine with the host's current spacing and
 * corners, so the picture is what the layout will actually do.
 */
export function LayoutThumb({ layout, style }: { layout: LayoutId; style?: Partial<LayoutStyle> }) {
  const tiles = computeLayout(layout, SAMPLE[layout], THUMB, style);
  return (
    <svg viewBox={`0 0 ${THUMB.width} ${THUMB.height}`} className="layout-thumb" aria-hidden="true">
      {tiles.map((tile, i) => (
        <rect
          key={tile.id}
          x={tile.x}
          y={tile.y}
          width={tile.width}
          height={tile.height}
          rx={tile.radius}
          className={i === 0 ? 'main' : undefined}
        />
      ))}
    </svg>
  );
}

/** Compact row of every layout, under the stage. */
export function LayoutPicker({ value, style, onChange }: { value: LayoutId; style: LayoutStyle; onChange(layout: LayoutId): void }) {
  return (
    <div className="layout-strip" role="group" aria-label="Layout">
      {LAYOUT_IDS.map((id) => (
        <button
          key={id}
          type="button"
          className="layout-chip"
          title={LAYOUT_LABELS[id]}
          aria-label={LAYOUT_LABELS[id]}
          aria-pressed={value === id}
          data-testid={`layout-${id}`}
          onClick={() => onChange(id)}
        >
          <LayoutThumb layout={id} style={style} />
        </button>
      ))}
    </div>
  );
}
