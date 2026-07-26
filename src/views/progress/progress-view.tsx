import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Panel, ViewHeader } from '@/components/panel'
import { ChartTooltip } from '@/components/chart-tooltip'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { usePipeline } from '@/hooks/use-pipeline'
import { formatDate, recentWeekStarts, weekEnd } from '@/lib/dates'
import { qualifiedInWeek } from '@/lib/metrics'
import {
  AXIS_TICK,
  BAR_RADIUS,
  GRID,
  MARK,
  MARK_WASH,
  MAX_BAR_SIZE,
  SURFACE,
} from '@/lib/charts'
import { RFP_STATUSES, SEGMENTS } from '@/lib/types'

const TREND_WEEKS = 8

export function ProgressView() {
  const { leads, rfps } = usePipeline()
  const [showTable, setShowTable] = useState(false)

  const trend = useMemo(
    () =>
      recentWeekStarts(TREND_WEEKS).map((start) => ({
        label: formatDate(start),
        weekStart: start,
        value: qualifiedInWeek(leads, start, weekEnd(start)),
      })),
    [leads],
  )

  const bySegment = useMemo(
    () =>
      SEGMENTS.map((segment) => ({
        label: segment,
        value: leads.filter((lead) => lead.segment === segment).length,
      })),
    [leads],
  )

  const byRfpStatus = useMemo(
    () =>
      RFP_STATUSES.map((status) => ({
        label: status,
        value: rfps.filter((rfp) => rfp.status === status).length,
      })),
    [rfps],
  )

  return (
    <>
      <ViewHeader title="Progress" />

      <Panel
        title={`Qualified leads — last ${TREND_WEEKS} weeks`}
        action={
          <button
            type="button"
            onClick={() => setShowTable((current) => !current)}
            className="cursor-pointer text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={showTable}
          >
            {showTable ? 'Hide table' : 'Show table'}
          </button>
        }
      >
        {/* Single series, so no legend — the panel title names what is plotted. */}
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={trend} margin={{ top: 8, right: 12, bottom: 0, left: -20 }}>
            <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
            <XAxis
              dataKey="label"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: GRID }}
            />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={48}
            />
            <Tooltip
              cursor={{ stroke: GRID, strokeWidth: 1 }}
              content={<ChartTooltip />}
            />
            <Area
              type="monotone"
              dataKey="value"
              name="Qualified leads"
              stroke={MARK}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              fill={MARK_WASH}
              // Ring in the surface colour keeps the dot legible where it
              // crosses the line, and widens the hover target.
              dot={{ r: 3, fill: MARK, stroke: SURFACE, strokeWidth: 2 }}
              activeDot={{ r: 5, fill: MARK, stroke: SURFACE, strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>

        {showTable && (
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Week beginning</TableHead>
                  <TableHead className="text-right">Qualified leads</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trend.map((point) => (
                  <TableRow key={point.weekStart}>
                    <TableCell>{point.label}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {point.value}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Leads by segment">
          <CategoryBars data={bySegment} height={210} />
        </Panel>
        <Panel title="RFP status distribution">
          <CategoryBars data={byRfpStatus} height={185} />
        </Panel>
      </div>
    </>
  )
}

/**
 * Horizontal bars, one hue for every bar. The category axis carries identity,
 * so colouring bars individually would double-encode length as hue — and the
 * long segment names ("Development Partner") read far better on a horizontal
 * axis than rotated under a column chart.
 */
function CategoryBars({
  data,
  height,
}: {
  data: { label: string; value: number }[]
  height: number
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        // Right margin leaves room for the tip label so it is never clipped.
        margin={{ top: 4, right: 28, bottom: 0, left: 4 }}
        barCategoryGap="22%"
      >
        <CartesianGrid stroke={GRID} strokeWidth={1} horizontal={false} />
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="label"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          width={124}
        />
        <Tooltip
          cursor={{ fill: 'rgba(201, 154, 62, 0.06)' }}
          content={<ChartTooltip />}
        />
        <Bar
          dataKey="value"
          name="Count"
          fill={MARK}
          radius={BAR_RADIUS}
          maxBarSize={MAX_BAR_SIZE}
          isAnimationActive={false}
        >
          {/* Every value is directly labelled, so the tooltip only enhances. */}
          <LabelList
            dataKey="value"
            position="right"
            offset={6}
            style={{
              fill: '#948f7e',
              fontSize: 10,
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
