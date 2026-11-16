import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clampToToday, todayLocalDate, tomorrowLocalDate } from '../date';

// 21:52 em Brasília de 15/11 já é 16/11 em UTC: o servidor erra o dia.
describe('data local', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T21:52:00-03:00'));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('hoje é 15/11 mesmo com UTC em 16/11 (Results inicia aqui)', () => {
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-11-16');
    expect(todayLocalDate()).toBe('2026-11-15');
  });

  it('amanhã local é 16/11', () => {
    expect(tomorrowLocalDate()).toBe('2026-11-16');
  });

  it('rascunho do assistente com data 16/11 vira 15/11', () => {
    expect(clampToToday('2026-11-16')).toBe('2026-11-15');
    expect(clampToToday('2026-11-14')).toBe('2026-11-14');
    expect(clampToToday('2026-11-15')).toBe('2026-11-15');
  });
});
