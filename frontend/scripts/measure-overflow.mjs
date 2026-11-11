#!/usr/bin/env node
// Mede overflow horizontal e risco de zoom (iOS) em todas as rotas, emulando iPhone.
// Uso: BASE_URL=http://localhost:5173 node scripts/measure-overflow.mjs [--widths=320,375,390,430] [--routes=/a,/b]
// Requer playwright (global ou local) + chromium. Não toca na API real: todo /api é mockado.
// Sai com código 1 se achar overflow de documento ou input < 16px.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require('playwright'); } catch { /* tenta global */ }
  const root = execSync('npm root -g').toString().trim();
  return require(`${root}/playwright`);
}
const { chromium } = loadPlaywright();

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split('=')[1];
const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const WIDTHS = arg('widths', '320,375,390,430').split(',').map(Number);
const ROUTES = arg('routes', [
  '/', '/workouts', '/workouts/new', '/workouts/1', '/workouts/history', '/workouts/session',
  '/settings', '/results', '/results/review', '/training-plans/new', '/training-plans/archived',
  '/training-plans/1', '/training-plans/1/days/1', '/gyms', '/gyms/new', '/gyms/1',
  '/nutrition', '/nutrition/plan', '/nutrition/log', '/nutrition/history', '/nutrition/photo/plate',
  '/nutrition/photo/label', '/nutrition/cheat-day', '/fitness-assessment', '/profile', '/profile/dados',
  '/onboarding', '/login',
].join(',')).split(',');

const LONG = 'Supinoretocomhalteresinclinadoextremamentelongosemespaco_e_um_email_muito_longo_mesmo@dominio-gigante-exemplo.com.br';
const now = new Date().toISOString();
const user = { id: 999, email: LONG.slice(-60), name: 'Fulano ' + LONG.slice(0, 40), created_at: now };
const profile = { birth_date: '1990-01-01', age: 35, height_cm: 180, current_weight_kg: 80, training_experience: 'intermediate' };
const today = now.slice(0, 10);
const ex = (i) => ({ id: i, exercise_name: LONG.slice(0, 48 + i), sets: 4, reps: 12, tracking_type: 'reps', rest_seconds: 60, notes: LONG, last_weight_kg: 22.5 });
const day = (i) => ({ id: i, day_number: i, name: 'Treino ' + LONG.slice(0, 30), focus: LONG.slice(0, 40), instructions: LONG, exercises: [ex(1), ex(2), ex(3)] });
const plan = { id: 1, name: 'Plano ' + LONG.slice(0, 50), description: LONG, target_date: today, days_per_week: 5, session_duration_minutes: 60, creation_method: 'automatic', adaptation_phase: false, active: true, kind: 'regular', gym_name: LONG.slice(0, 40), preferences: LONG, days: [day(1), day(2), day(3)] };
const workout = { id: 1, user_id: 999, name: 'Treino ' + LONG.slice(0, 40), date: today, notes: LONG, status: 'completed', duration_minutes: 55, set_count: 3, created_at: now, sets: [1, 2, 3].map((i) => ({ id: i, workout_id: 1, exercise_name: LONG.slice(0, 50), sets: 4, reps: 12, tracking_type: 'reps', weight_kg: 80, set_number: i, created_at: now })) };
const food = (i) => ({ id: i, user_id: 999, food_name: 'Alimento ' + LONG.slice(0, 60), meal_type: 'lunch', quantity_g: 150, calories: 420, protein_g: 30, carbs_g: 40, fat_g: 12, origin: 'manual', date: today, created_at: now, updated_at: now });
const nplan = { id: 1, user_id: 999, name: 'Dieta ' + LONG.slice(0, 40), calories_target: 2400, protein_target: 180, carbs_target: 250, fat_target: 70, rationale: LONG, creation_method: 'automatic', active: true, created_at: now, meals: [{ id: 1, name: 'Almoço ' + LONG.slice(0, 40), items: [{ id: 1, food_name: LONG.slice(0, 60), quantity_g: 150, calories: 300, protein_g: 20, carbs_g: 30, fat_g: 10 }] }] };
const mocks = {
  '/auth/me': user,
  '/terms': { current_version: '1', accepted: true, accepted_at: now },
  '/onboarding': { profile, messages: [], completed: true, goal: { goal_type: 'lose_weight', summary: LONG } },
  '/dashboard': { user, today_workout: { ...workout, status: 'in_progress' }, workout_stats: { total_workouts: 12, workouts_this_week: 3, workouts_this_month: 9, total_sets: 200, total_volume_kg: 12345, streak_days: 4 }, today_nutrition: { calories: 1200, protein_g: 80, carbs_g: 100, fat_g: 30, meals: [] }, active_plan: nplan, weekly_workouts: [workout], next_workout: { plan_id: 1, plan_name: plan.name, day_id: 1, day_name: LONG.slice(0, 40), focus: LONG }, weekly_performance: { plan_name: plan.name, target_per_week: 5, done_this_week: 2, remaining: 3, days_left_in_week: 3, on_track: true, still_possible: true } },
  '/workouts/stats': { total_workouts: 12, workouts_this_week: 3, workouts_this_month: 9, total_sets: 200, total_volume_kg: 12345, streak_days: 4 },
  '/workouts': [workout],
  '/workouts/1': workout,
  '/workouts/calendar': { month: today.slice(0, 7), days: [] },
  '/nutrition/calendar': { month: today.slice(0, 7), days: [] },
  '/nutrition/missing-days': { days: [] },
  '/nutrition/routine': { enough: false, based_on_days: 0, meals: [], totals: {} },
  '/nutrition/plans': [nplan],
  '/nutrition/logs': [food(1), food(2)],
  '/nutrition/logs/history': [],
  '/training-plans': [plan],
  '/training-plans/1': plan,
  '/gyms': [{ id: 1, name: LONG.slice(0, 50), notes: LONG, equipment: [LONG.slice(0, 40), 'halteres'], created_at: now }],
  '/gyms/1': { id: 1, name: LONG.slice(0, 50), notes: LONG, equipment: [LONG.slice(0, 40)], created_at: now },
  '/results': {
    measurements: [{ id: 1, measured_at: today, weight_kg: 76.4, body_fat_percentage: 24.1, waist_cm: 82, notes: LONG, created_at: now }],
    series: [
      { key: 'weight_kg', label: 'Peso', unit: 'kg', target: 72, points: [{ date: '2026-09-08', value: 80.9 }, { date: '2026-10-06', value: 78.2 }, { date: today, value: 76.4 }] },
      { key: 'body_fat_percentage', label: 'Gordura corporal ' + LONG.slice(0, 30), unit: '%', points: [{ date: '2026-09-08', value: 26.8 }, { date: today, value: 24.1 }] },
    ],
    conditioning: [{ distance_meters: 640, perceived_exertion: 6, performed_at: now }, { distance_meters: 585, perceived_exertion: 7, performed_at: now }],
  },
  '/progress-reviews/latest': { id: 5, status: 'ready', period_start: today, period_end: today, performance: LONG, goal_assessment: LONG, goal_status: 'needs_change', applied_training: false, applied_nutrition: false, created_at: now },
  '/settings': { countdown_seconds: 5, vibration_enabled: true, auto_advance: true },
  '/steps': { steps: 5000 },
};

async function installMocks(page) {
  await page.route((url) => url.pathname.startsWith('/api/'), (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const body = mocks[p] ?? [];
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

// Roda dentro da página.
// Em emulação mobile o Chromium alarga o layout viewport quando o conteúdo estoura
// (é o "zoom out" que o iOS mostra), então a referência é a largura do aparelho.
function probe(deviceWidth) {
  const vw = deviceWidth;
  const doc = document.documentElement;
  const out = { innerWidth: window.innerWidth, scrollWidth: doc.scrollWidth, bodyScrollWidth: document.body.scrollWidth, offenders: [], smallInputs: [] };
  const desc = (el) => {
    const c = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 6).join('.') : '';
    return `${el.tagName.toLowerCase()}${c ? '.' + c : ''}`;
  };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > vw + 0.5 || r.left < -0.5) {
      // ignora filhos de contêineres que rolam por conta própria
      let p = el.parentElement, scrolled = false;
      while (p && p !== document.body) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') { scrolled = true; break; }
        p = p.parentElement;
      }
      if (!scrolled) out.offenders.push({ el: desc(el), left: Math.round(r.left), right: Math.round(r.right), text: (el.textContent || '').trim().slice(0, 30) });
    }
  }
  // Texto sem ponto de quebra estoura o próprio caixa sem mudar seu rect: só scrollWidth entrega.
  for (const el of document.querySelectorAll('body *')) {
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && getComputedStyle(el).overflowX === 'visible' && getComputedStyle(el).position !== 'fixed' && !/^(svg|path)$/i.test(el.tagName)) {
      const r = el.getBoundingClientRect();
      if (r.left + el.scrollWidth > vw + 0.5) out.offenders.push({ el: desc(el) + ' [scrollWidth>clientWidth]', left: Math.round(r.left), right: Math.round(r.left + el.scrollWidth), text: (el.textContent || '').trim().slice(0, 30) });
    }
  }
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (el.type === 'hidden' || el.type === 'checkbox' || el.type === 'radio' || el.type === 'file' || el.type === 'range') continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 16) out.smallInputs.push({ el: desc(el), fontSize: fs });
  }
  out.offenders = out.offenders.slice(0, 10);
  return out;
}

const browser = await chromium.launch();
let bad = 0;
for (const width of WIDTHS) {
  const ctx = await browser.newContext({
    viewport: { width, height: 800 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await ctx.addInitScript((u) => {
    localStorage.setItem('mob_token', 't');
    localStorage.setItem('mob-auth', JSON.stringify({ state: { token: 't', user: u, isAuthenticated: true }, version: 0 }));
  }, user);
  for (const route of ROUTES) {
    const page = await ctx.newPage();
    await installMocks(page);
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message.slice(0, 80)));
    await page.goto(BASE + route, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(600);
    const r = await page.evaluate(probe, width);
    const overflow = r.innerWidth > width || r.scrollWidth > width || r.bodyScrollWidth > width;
    // iOS dá zoom ao focar campo < 16px; layout viewport maior que o aparelho = página "zoomada para fora"
    const tag = overflow ? 'OVERFLOW' : 'ok';
    const flags = [overflow && 'overflow', r.smallInputs.length && `inputs<16px:${r.smallInputs.length}`, errs.length && `erro-js:${errs[0]}`].filter(Boolean);
    if (overflow || r.smallInputs.length) bad++;
    console.log(`[${width}] ${route.padEnd(28)} ${tag.padEnd(8)} device=${width} inner=${r.innerWidth} scroll=${r.scrollWidth} ${flags.join(' ')}`);
    for (const o of r.offenders) console.log(`     -> ${o.el} left=${o.left} right=${o.right} "${o.text}"`);
    for (const s of r.smallInputs.slice(0, 3)) console.log(`     -> input ${s.el} font=${s.fontSize}px`);
    await page.close();
  }
  await ctx.close();
}
await browser.close();
console.log(bad ? `\n${bad} combinações com problema` : '\nsem problemas');
process.exit(bad ? 1 : 0);
