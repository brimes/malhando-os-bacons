import {
  AreaChart,
  Area,
  BarChart,
  Bar as RBar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Bar } from './Ring';

interface DataPoint {
  label: string;
  value: number;
  value2?: number;
}

interface AreaChartProps {
  data: DataPoint[];
  color?: string;
  height?: number;
  yUnit?: string;
}

export function MobAreaChart({ data, color = 'rgb(var(--brand-fg))', height = 200, yUnit }: AreaChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="colorGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" />
        <XAxis dataKey="label" tick={{ fill: 'rgb(var(--dim))', fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fill: 'rgb(var(--dim))', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => (yUnit ? `${v}${yUnit}` : v)}
        />
        <Tooltip
          contentStyle={{ backgroundColor: 'rgb(var(--surface-2))', border: 'none', borderRadius: '12px' }}
          labelStyle={{ color: 'rgb(var(--muted))' }}
          itemStyle={{ color: color }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          fill="url(#colorGrad)"
          dot={false}
          activeDot={{ r: 5, fill: color }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

interface BarChartProps {
  data: DataPoint[];
  color?: string;
  color2?: string;
  height?: number;
}

export function MobBarChart({ data, color = 'rgb(var(--brand-fg))', color2 = 'rgb(var(--violet))', height = 200 }: BarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--line))" />
        <XAxis dataKey="label" tick={{ fill: 'rgb(var(--dim))', fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: 'rgb(var(--dim))', fontSize: 12 }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ backgroundColor: 'rgb(var(--surface-2))', border: 'none', borderRadius: '12px' }}
          labelStyle={{ color: 'rgb(var(--muted))' }}
        />
        <RBar dataKey="value" fill={color} radius={[4, 4, 0, 0]} />
        {data[0]?.value2 !== undefined && (
          <RBar dataKey="value2" fill={color2} radius={[4, 4, 0, 0]} />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

interface MacroProgressProps {
  calories: number;
  caloriesTarget: number;
  protein: number;
  proteinTarget: number;
  carbs: number;
  carbsTarget: number;
  fat: number;
  fatTarget: number;
}

export function MacroProgress({
  calories, caloriesTarget,
  protein, proteinTarget,
  carbs, carbsTarget,
  fat, fatTarget,
}: MacroProgressProps) {
  const pct = (val: number, target: number) => Math.min((val / (target || 1)) * 100, 100);

  const items = [
    { label: 'Kcal', value: Math.round(calories), target: caloriesTarget, color: 'bg-brand-fg' },
    { label: 'Proteína', value: Math.round(protein), target: Math.round(proteinTarget), color: 'bg-teal', unit: 'g' },
    { label: 'Carbs', value: Math.round(carbs), target: Math.round(carbsTarget), color: 'bg-sun', unit: 'g' },
    { label: 'Gordura', value: Math.round(fat), target: Math.round(fatTarget), color: 'bg-violet', unit: 'g' },
  ];

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label}>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted">{item.label}</span>
            <span className="text-fg font-medium num">
              {item.value}{item.unit} / {item.target}{item.unit}
            </span>
          </div>
          <Bar progress={pct(item.value, item.target) / 100} colorClass={item.color} />
        </div>
      ))}
    </div>
  );
}
