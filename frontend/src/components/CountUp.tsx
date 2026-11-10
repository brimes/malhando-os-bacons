import { useCountUp } from '../lib/useCountUp';

// Número que conta até o valor (600 ms). Use dentro de um elemento `.num`.
export function CountUp({ value, format }: { value: number; format?: (n: number) => string }) {
  const v = useCountUp(value);
  const n = Math.round(v);
  return <>{format ? format(n) : n}</>;
}
