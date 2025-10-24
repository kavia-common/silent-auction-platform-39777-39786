import { useMemo } from 'react';

/**
 * SimpleChart - lightweight, dependency-free inline SVG charts for small datasets.
 * Supports:
 * - type: 'line' | 'area' | 'bar'
 * - data: array of { x: number, y: number } for line/area; for bar x can be index or ordinal mapped to sequential slots
 * - width, height: pixels
 * - color: stroke/fill color
 * - bg: optional background
 * - yTicks: optional number of horizontal grid lines
 */
export default function SimpleChart({
  type = 'line',
  data = [],
  width = 320,
  height = 120,
  color = '#2563EB',
  bg = 'transparent',
  yTicks = 3,
  ariaLabel = 'Chart'
}) {
  const padding = { top: 8, right: 8, bottom: 18, left: 28 };

  const { pathD, areaD, bars, xScale, yScale, yTickVals, minY, maxY } = useMemo(() => {
    const xs = data.map(d => Number(d.x));
    const ys = data.map(d => Number(d.y));
    const minX = xs.length ? Math.min(...xs) : 0;
    const maxX = xs.length ? Math.max(...xs) : 1;
    const _minY = ys.length ? Math.min(...ys) : 0;
    const _maxY = ys.length ? Math.max(...ys) : 1;
    const rangeX = maxX - minX || 1;
    const rangeY = _maxY - _minY || 1;

    const xScaleFn = (x) => {
      const nx = (Number(x) - minX) / rangeX;
      return padding.left + nx * (width - padding.left - padding.right);
    };
    const yScaleFn = (y) => {
      const ny = (Number(y) - _minY) / rangeY;
      return height - padding.bottom - ny * (height - padding.top - padding.bottom);
    };

    let pD = '';
    let aD = '';
    let barsArr = [];

    if (type === 'bar') {
      // categories are in order of data array; bars spaced evenly
      const count = Math.max(data.length, 1);
      const barAreaWidth = width - padding.left - padding.right;
      const barWidth = Math.max(Math.floor(barAreaWidth / count) - 6, 4);
      barsArr = data.map((d, i) => {
        const x = padding.left + i * (barAreaWidth / count) + 3;
        const y = yScaleFn(d.y);
        const h = Math.max(0, height - padding.bottom - y);
        return { x, y, width: barWidth, height: h };
      });
    } else {
      data.forEach((d, i) => {
        const x = xScaleFn(d.x);
        const y = yScaleFn(d.y);
        pD += (i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`);
      });
      if (type === 'area' && data.length) {
        const firstX = xScaleFn(data[0].x);
        const lastX = xScaleFn(data[data.length - 1].x);
        const baseY = yScaleFn(_minY);
        aD = `${pD} L ${lastX} ${baseY} L ${firstX} ${baseY} Z`;
      }
    }

    const ticks = [];
    const tickCount = Math.max(0, yTicks);
    for (let i = 0; i <= tickCount; i++) {
      const t = _minY + (i / (tickCount || 1)) * rangeY;
      ticks.push(t);
    }

    return {
      pathD: pD,
      areaD: aD,
      bars: barsArr,
      xScale: xScaleFn,
      yScale: yScaleFn,
      yTickVals: ticks,
      minY: _minY,
      maxY: _maxY
    };
  }, [data, height, padding.bottom, padding.left, padding.right, padding.top, type, width, yTicks]);

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={ariaLabel}
      style={{ background: bg, borderRadius: 8, border: '1px solid var(--border)' }}
    >
      {/* Y grid lines */}
      {yTickVals.map((t, i) => {
        const y = yScale(t);
        return (
          <line
            key={i}
            x1={padding.left}
            x2={width - padding.right}
            y1={y}
            y2={y}
            stroke="rgba(0,0,0,0.06)"
            strokeWidth="1"
          />
        );
      })}
      {/* Axis labels (min/max) */}
      <text x={6} y={yScale(minY) + 4} fontSize="10" fill="var(--muted)">{Number(minY).toLocaleString()}</text>
      {maxY !== minY ? (
        <text x={6} y={yScale(maxY) + 4} fontSize="10" fill="var(--muted)">{Number(maxY).toLocaleString()}</text>
      ) : null}

      {/* Bars or line/area */}
      {type === 'bar' ? (
        <>
          {bars.map((b, i) => (
            <rect key={i} x={b.x} y={b.y} width={b.width} height={b.height} fill={color} opacity="0.9" />
          ))}
        </>
      ) : (
        <>
          {type === 'area' && areaD ? (
            <path d={areaD} fill={color} opacity="0.12" />
          ) : null}
          {pathD ? (
            <path d={pathD} stroke={color} strokeWidth="2" fill="none" />
          ) : null}
        </>
      )}
    </svg>
  );
}
