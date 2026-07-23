import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

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

export function MobAreaChart({ data, color = '#d946ef', height = 200, yUnit }: AreaChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="colorGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
        <XAxis dataKey="label" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fill: '#71717a', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => (yUnit ? `${v}${yUnit}` : v)}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '12px' }}
          labelStyle={{ color: '#a1a1aa' }}
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

export function MobBarChart({ data, color = '#d946ef', color2 = '#ea580c', height = 200 }: BarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
        <XAxis dataKey="label" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: '12px' }}
          labelStyle={{ color: '#a1a1aa' }}
        />
        <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} />
        {data[0]?.value2 !== undefined && (
          <Bar dataKey="value2" fill={color2} radius={[4, 4, 0, 0]} />
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
    { label: 'Kcal', value: Math.round(calories), target: caloriesTarget, color: 'bg-primary-500' },
    { label: 'Proteína', value: Math.round(protein), target: Math.round(proteinTarget), color: 'bg-blue-500', unit: 'g' },
    { label: 'Carbs', value: Math.round(carbs), target: Math.round(carbsTarget), color: 'bg-amber-500', unit: 'g' },
    { label: 'Gordura', value: Math.round(fat), target: Math.round(fatTarget), color: 'bg-red-500', unit: 'g' },
  ];

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.label}>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-zinc-400">{item.label}</span>
            <span className="text-white font-medium">
              {item.value}{item.unit} / {item.target}{item.unit}
            </span>
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${item.color}`}
              style={{ width: `${pct(item.value, item.target)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
