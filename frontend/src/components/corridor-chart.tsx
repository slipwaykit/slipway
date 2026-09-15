'use client';

import { useId, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SnapshotView } from '@/lib/api';
import { formatAmount } from '@/lib/format';

/**
 * Categorical slots in fixed order, from the validated reference palette.
 * Checked with the dataviz validator against the white card surface: every
 * adjacent pair clears CVD ΔE 9.1 and normal-vision ΔE 22.9. Aqua and yellow
 * sit below 3:1 contrast, so the legend and the table view are required, not
 * optional.
 */
const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'] as const;

/** Past four lines the palette stops being distinguishable; the table keeps the rest. */
const MAX_SERIES = SERIES_COLORS.length;

const INK = { grid: '#e1e0d9', axis: '#6b6a66', surface: '#ffffff' };

/** Props for {@link CorridorChart}. */
export interface CorridorChartProps {
  /** Snapshots oldest first, failures included. */
  readonly history: readonly SnapshotView[];
  /** Currency the landed amount is denominated in. */
  readonly currency: string;
}

interface Series {
  readonly adapterId: string;
  readonly name: string;
  readonly color: string;
  readonly answered: number;
  readonly asked: number;
  readonly latest: string | undefined;
}

/**
 * Landed amount over time, one line per provider.
 *
 * A poll where a provider failed is a **gap** in its line, not a dropped point
 * that the line quietly bridges. Bridging would draw a provider as steady
 * through the hours it was down. Colours follow the provider, never its rank,
 * so a provider keeps its colour as the window changes.
 *
 * Plotting converts decimal strings to numbers, which is fine for pixels; every
 * figure a person reads — the legend, tooltip and table — uses the exact string.
 *
 * @example
 * ```tsx
 * <CorridorChart history={data.history} currency="NGN" />
 * ```
 */
export function CorridorChart({ history, currency }: CorridorChartProps) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  const { rows, series, overflow, silent } = useMemo(() => {
    const times = [...new Set(history.map((row) => row.createdAt))].sort((a, b) => a - b);
    const byAdapter = new Map<string, SnapshotView[]>();
    for (const row of history) {
      const list = byAdapter.get(row.adapterId) ?? [];
      list.push(row);
      byAdapter.set(row.adapterId, list);
    }

    // Stable identity order: alphabetical by id, so colour never tracks value.
    const answering = [...byAdapter.entries()]
      .filter(([, list]) => list.some((row) => row.landedAmount !== null))
      .sort(([a], [b]) => a.localeCompare(b));
    const silent = byAdapter.size - answering.length;

    const series: Series[] = answering.slice(0, MAX_SERIES).map(([adapterId, list], index) => {
      const successes = list.filter((row) => row.landedAmount !== null);
      return {
        adapterId,
        name: list[0]?.adapterName ?? adapterId,
        color: SERIES_COLORS[index] ?? SERIES_COLORS[0],
        answered: successes.length,
        asked: list.length,
        latest: successes.at(-1)?.landedAmount ?? undefined,
      };
    });

    const rows = times.map((time) => {
      const row: Record<string, number | string | null> = { time };
      for (const { adapterId } of series) {
        const snapshot = history.find((s) => s.createdAt === time && s.adapterId === adapterId);
        row[adapterId] = snapshot?.landedAmount == null ? null : Number(snapshot.landedAmount);
        row[`${adapterId}:exact`] = snapshot?.landedAmount ?? null;
      }
      return row;
    });

    return { rows, series, overflow: Math.max(0, answering.length - MAX_SERIES), silent };
  }, [history]);

  if (series.length === 0) {
    return (
      <p className="rounded-lg border border-dashed bg-muted p-6 text-sm text-muted-foreground">
        No provider returned a quote on this corridor in this window
        {history.length > 0 ? `, across ${history.length} attempts` : ''}.
      </p>
    );
  }

  // Ticks must tell adjacent values apart. A span of minutes needs clock times,
  // not a date repeated on every tick; a narrow value band needs full figures,
  // not "156K" on every line.
  const times = rows.map((row) => Number(row.time));
  const span = times.length > 1 ? Math.max(...times) - Math.min(...times) : 0;
  const tickTime = new Intl.DateTimeFormat(
    'en',
    span < 30 * 60_000
      ? { hour: 'numeric', minute: '2-digit', second: '2-digit' }
      : span < 36 * 3_600_000
        ? { hour: 'numeric', minute: '2-digit' }
        : { month: 'short', day: 'numeric' },
  );
  const timeFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });
  const values = rows.flatMap((row) => series.map((s) => row[s.adapterId])).filter((v): v is number => typeof v === 'number');
  const valueSpan = values.length > 0 ? Math.max(...values) - Math.min(...values) : 0;
  const tickValue = new Intl.NumberFormat('en', { maximumFractionDigits: valueSpan < 10 ? 2 : 0 });

  return (
    <figure className="space-y-3">
      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="Legend">
        {series.map((s) => (
          <li key={s.adapterId} className="flex items-center gap-2">
            <svg width="16" height="8" aria-hidden className="shrink-0">
              <line x1="0" y1="4" x2="16" y2="4" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>
              <span className="font-medium">{s.name}</span>
              <span className="text-muted-foreground">
                {s.latest === undefined ? '' : ` · latest ${formatAmount(s.latest, currency)}`} · answered{' '}
                {s.answered}/{s.asked}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <div className="h-64 w-full sm:h-80" role="img" aria-label={`Landed amount in ${currency} over time, by provider. A table of the same data follows.`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={INK.grid} strokeWidth={1} vertical={false} />
            <XAxis
              dataKey="time"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(value: number) => tickTime.format(value)}
              stroke={INK.grid}
              tick={{ fill: INK.axis, fontSize: 12 }}
              tickLine={false}
              minTickGap={32}
            />
            <YAxis
              width={72}
              stroke={INK.grid}
              tick={{ fill: INK.axis, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              domain={['auto', 'auto']}
              tickFormatter={(value: number) => tickValue.format(value)}
              tickCount={4}
            />
            <Tooltip
              cursor={{ stroke: INK.axis, strokeWidth: 1 }}
              content={({ active, label, payload }) => (
                <ChartTooltip
                  active={active}
                  label={label}
                  payload={payload}
                  series={series}
                  currency={currency}
                  format={timeFormat}
                />
              )}
            />
            {series.map((s) => (
              <Line
                key={s.adapterId}
                dataKey={s.adapterId}
                name={s.name}
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                type="linear"
                connectNulls={false}
                // A handful of polls is a handful of dots; a lone point with no
                // marker would draw nothing at all.
                dot={rows.length <= 24 ? { r: 4, fill: s.color, stroke: INK.surface, strokeWidth: 2 } : false}
                activeDot={{ r: 4, fill: s.color, stroke: INK.surface, strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <figcaption className="text-sm text-muted-foreground">
        Gaps are polls where that provider did not return a quote.
        {overflow > 0 && ` ${overflow} more ${overflow === 1 ? 'provider is' : 'providers are'} in the table.`}
        {silent > 0 && ` ${silent} ${silent === 1 ? 'provider' : 'providers'} never quoted in this window.`}
      </figcaption>

      <button
        type="button"
        onClick={() => setShowTable((value) => !value)}
        aria-expanded={showTable}
        aria-controls={tableId}
        className="min-h-11 text-sm text-primary underline underline-offset-4"
      >
        {showTable ? 'Hide table' : 'Show as table'}
      </button>
      {showTable && <HistoryTable id={tableId} history={history} currency={currency} />}
    </figure>
  );
}

function ChartTooltip({
  active,
  label,
  payload,
  series,
  currency,
  format,
}: {
  readonly active: boolean | undefined;
  readonly label: unknown;
  readonly payload: readonly { readonly payload?: unknown }[] | undefined;
  readonly series: readonly Series[];
  readonly currency: string;
  readonly format: Intl.DateTimeFormat;
}) {
  if (!active || typeof label !== 'number') return null;
  const row = payload?.[0]?.payload as Record<string, string | null> | undefined;
  return (
    <div className="rounded-md border bg-card p-3 text-sm shadow-md">
      <p className="mb-2 text-xs text-muted-foreground">{format.format(label)}</p>
      <ul className="space-y-1">
        {series.map((s) => {
          const exact = row?.[`${s.adapterId}:exact`] ?? null;
          return (
            <li key={s.adapterId} className="flex items-center gap-2">
              <svg width="12" height="8" aria-hidden>
                <line x1="0" y1="4" x2="12" y2="4" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span className="font-semibold">{exact === null ? 'No quote' : formatAmount(exact, currency)}</span>
              <span className="text-muted-foreground">{s.name}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function HistoryTable({
  id,
  history,
  currency,
}: {
  readonly id: string;
  readonly history: readonly SnapshotView[];
  readonly currency: string;
}) {
  const format = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });
  const rows = [...history].reverse();
  return (
    <div id={id} className="max-h-96 overflow-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Every recorded snapshot, newest first</caption>
        <thead className="sticky top-0 bg-muted">
          <tr>
            <th scope="col" className="p-2 font-medium">Time</th>
            <th scope="col" className="p-2 font-medium">Provider</th>
            <th scope="col" className="p-2 text-right font-medium">Lands</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((row) => (
            <tr key={row.id} className="border-t">
              <td className="whitespace-nowrap p-2">{format.format(row.createdAt)}</td>
              <td className="p-2">{row.adapterName}</td>
              <td className="whitespace-nowrap p-2 text-right">
                {row.landedAmount === null ? (
                  <span className="text-muted-foreground">{row.errorCode ?? 'No quote'}</span>
                ) : (
                  formatAmount(row.landedAmount, currency)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
