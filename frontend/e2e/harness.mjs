// Infra dos e2e offline: servidor de API simulado em memória (via page.route),
// com modos de rede (online / offline / hang / 503) e registro de tudo que o
// "servidor" realmente processou — é nele que se confere "exatamente uma vez e
// na ordem". Requer playwright (global ou local) e um Chrome:
//   BASE_URL=http://localhost:5173 CHROME_PATH=".../Google Chrome" node e2e/<spec>.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require('playwright'); } catch { /* tenta global */ }
  return require(`${execSync('npm root -g').toString().trim()}/playwright`);
}
export const { chromium } = loadPlaywright();

export const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
export const CHROME_PATH = process.env.CHROME_PATH
  || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);

const now = new Date().toISOString();
export const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const user = { id: 777, email: 'e2e@mob.test', name: 'E2E', created_at: now };

/** Texto que NUNCA pode aparecer numa tela de registro (só IA pode pedir internet). */
export const NETWORK_ERROR_RE = /sem conex[aã]o|network error|precisa de internet|esta a[cç][aã]o precisa|n[aã]o foi sincronizado|timeout|falha ao/i;

export function newServer() {
  let seq = 1000;
  const s = {
    mode: 'online',            // online | offline | hang | 503
    log: [],                   // mutações processadas: { method, path, body }
    hung: [],                  // rotas penduradas, abortadas ao religar
    logs: [],                  // food_logs
    results: [{ id: 1, measured_at: today, weight_kg: 80, notes: '', created_at: now }],
    gyms: [{ id: 1, name: 'Academia Velha', notes: '', equipment: ['halteres'], created_at: now }],
    settings: { countdown_seconds: 5, vibration_enabled: true, auto_advance: false },
    profile: { birth_date: '1990-01-01', age: 35, height_cm: 180, current_weight_kg: 80, training_experience: 'intermediate' },
    favorites: [],
    foods: [],
    nPlans: [{ id: 1, user_id: 777, name: 'Dieta A', calories_target: 2000, protein_target: 150, carbs_target: 200, fat_target: 60, creation_method: 'manual', active: true, created_at: now, meals: [] },
             { id: 2, user_id: 777, name: 'Dieta B', calories_target: 2200, protein_target: 160, carbs_target: 220, fat_target: 70, creation_method: 'manual', active: false, created_at: now, meals: [] }],
    plan: { id: 5, name: 'Plano E2E', description: '', target_date: '2020-01-01', days_per_week: 3, session_duration_minutes: 60, creation_method: 'manual', adaptation_phase: false, active: true, kind: 'regular', archived_at: null, days: [{ id: 51, day_number: 1, name: 'Treino A', focus: 'Peito', instructions: '', exercises: [] }] },
    assessments: [],
    clientLogIds: new Set(),
  };
  s.mutations = (method, re) => s.log.filter((m) => m.method === method && re.test(m.path));
  return s;
}

function history(s) {
  const base = [{ group_key: 'arroz', food_name: 'Arroz branco', quantity_g: 150, meal_type: 'lunch', calories: 195, protein_g: 4, carbs_g: 42, fat_g: 0.4, times_logged: 3 }];
  return base.map((e) => {
    const fav = s.favorites.find((f) => f.group_key === e.group_key);
    return fav ? { ...e, favorite_id: fav.id } : e;
  });
}

/** Resposta do "backend" a uma requisição — só chamada quando a rede está de pé. */
function respond(s, method, path, params, body) {
  const m = (re) => path.match(re);
  const ok = (data, status = 200) => ({ status, body: data });
  if (method !== 'GET') s.log.push({ method, path, body });

  if (path === '/health') return ok({ status: 'ok' });
  if (path === '/auth/me') return ok(user);
  if (path === '/terms') return ok({ current_version: '1', accepted: true, accepted_at: now });
  if (path === '/onboarding' && method === 'GET') return ok({ profile: s.profile, messages: [], completed: true, goal: { goal_type: 'lose_weight', summary: 'x' } });
  if (path === '/onboarding/profile' && method === 'PUT') { s.profile = { ...s.profile, ...body }; return ok(s.profile); }
  if (path === '/onboarding/fitness-assessments') {
    if (method === 'POST') { const a = { id: next(s), ...body, performed_at: now }; s.assessments.unshift(a); return ok(a, 201); }
    return ok(s.assessments);
  }
  if (path === '/settings') { if (method === 'PUT') s.settings = body; return ok(s.settings); }

  if (path === '/nutrition/logs' && method === 'GET') {
    const { date, from, to } = params;
    return ok(s.logs.filter((l) => {
      const d = l.date.slice(0, 10);
      if (date) return d === date;
      if (from && to) return d >= from && d <= to;
      return true;
    }));
  }
  if (path === '/nutrition/logs' && method === 'POST') {
    if (body.client_log_id && s.clientLogIds.has(body.client_log_id)) return ok(s.logs.find((l) => l.client_log_id === body.client_log_id), 200);
    if (body.client_log_id) s.clientLogIds.add(body.client_log_id);
    const l = { id: next(s), user_id: 777, origin: 'manual', ...body, date: `${body.date ?? today}T00:00:00Z`, created_at: now, updated_at: now };
    s.logs.push(l); return ok(l, 201);
  }
  let r = m(/^\/nutrition\/logs\/(\d+)$/);
  if (r && method === 'PUT') { const l = s.logs.find((x) => x.id === Number(r[1])); if (!l) return ok({ error: 'not found' }, 404); Object.assign(l, body); return ok(l); }
  if (r && method === 'DELETE') { s.logs = s.logs.filter((x) => x.id !== Number(r[1])); return ok(null, 204); }
  if (path === '/nutrition/logs/history') return ok(history(s));
  if (path === '/nutrition/favorites' && method === 'POST') { const f = { id: next(s), ...body }; s.favorites.push(f); return ok(f, 201); }
  r = m(/^\/nutrition\/favorites\/(\d+)$/);
  if (r && method === 'DELETE') { s.favorites = s.favorites.filter((f) => f.id !== Number(r[1])); return ok(null, 204); }
  if (path === '/nutrition/foods/search') return ok([]);
  if (path === '/nutrition/foods') { if (method === 'POST') { const f = { id: next(s), ...body }; s.foods.push(f); return ok(f, 201); } return ok(s.foods); }
  if (path === '/nutrition/routine') return ok({ enough: false, based_on_days: 0, meals: [], totals: {} });
  if (path === '/nutrition/missing-days') return ok({ days: [] });
  if (path === '/nutrition/calendar') {
    const byDay = {};
    for (const l of s.logs) { const d = l.date.slice(0, 10); byDay[d] = (byDay[d] ?? 0) + l.calories; }
    return ok({ month: params.month ?? today.slice(0, 7), days: Object.entries(byDay).filter(([d]) => d.startsWith(params.month ?? today.slice(0, 7))).map(([date, calories]) => ({ date, calories })) });
  }
  if (path === '/nutrition/plans') {
    if (method === 'POST') { const p = { id: next(s), user_id: 777, creation_method: 'manual', active: true, created_at: now, meals: [], ...body }; s.nPlans = s.nPlans.map((x) => ({ ...x, active: false })); s.nPlans.unshift(p); return ok(p, 201); }
    return ok(s.nPlans);
  }
  r = m(/^\/nutrition\/plans\/(\d+)\/activate$/);
  if (r) { s.nPlans = s.nPlans.map((x) => ({ ...x, active: x.id === Number(r[1]) })); return ok(null, 204); }

  if (path === '/results') {
    if (method === 'POST') { s.results.unshift({ id: next(s), created_at: now, ...body }); }
    return ok(resultsPayload(s));
  }
  r = m(/^\/results\/(\d+)$/);
  if (r && method === 'DELETE') { s.results = s.results.filter((x) => x.id !== Number(r[1])); return ok(null, 204); }

  if (path === '/gyms') {
    if (method === 'POST') { const g = { id: next(s), created_at: now, ...body }; s.gyms.push(g); return ok(g, 201); }
    return ok(s.gyms);
  }
  r = m(/^\/gyms\/(\d+)$/);
  if (r) {
    const id = Number(r[1]);
    if (method === 'PUT') { s.gyms = s.gyms.map((g) => (g.id === id ? { ...g, ...body } : g)); return ok(s.gyms.find((g) => g.id === id)); }
    if (method === 'DELETE') { s.gyms = s.gyms.filter((g) => g.id !== id); return ok(null, 204); }
    return ok(s.gyms.find((g) => g.id === id) ?? { error: 'nf' }, s.gyms.some((g) => g.id === id) ? 200 : 404);
  }

  if (path === '/training-plans') return ok(params.archived ? [] : (s.plan.archived_at ? [] : [s.plan]));
  r = m(/^\/training-plans\/(\d+)$/);
  if (r && method === 'GET') return ok(s.plan);
  if (m(/^\/training-plans\/\d+\/archive$/)) { s.plan = { ...s.plan, archived_at: now, active: false }; return ok(s.plan); }
  if (m(/^\/training-plans\/\d+\/unarchive$/)) { s.plan = { ...s.plan, archived_at: null, active: true }; return ok(s.plan); }
  if (path === '/workouts/active') return ok(null, 204);
  if (path === '/training-plans/compensation') return ok(null, 204);
  if (path === '/dashboard') return ok({ user, today_workout: null, workout_stats: { total_workouts: 0, workouts_this_week: 0, workouts_this_month: 0, total_sets: 0, total_volume_kg: 0, streak_days: 0 }, today_nutrition: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, meals: [] }, weekly_workouts: [] });
  if (path === '/workouts/stats') return ok({ total_workouts: 0, workouts_this_week: 0, workouts_this_month: 0, total_sets: 0, total_volume_kg: 0, streak_days: 0 });
  if (method === 'GET') return ok([]);
  return ok({});
}

function next(s) { s._seq = (s._seq ?? 1000) + 1; return s._seq; }

function resultsPayload(s) {
  const withWeight = s.results.filter((x) => x.weight_kg != null);
  return {
    measurements: s.results,
    series: withWeight.length ? [{ key: 'weight_kg', label: 'Peso', unit: 'kg', points: withWeight.map((x) => ({ date: x.measured_at, value: x.weight_kg })).reverse() }] : [],
    conditioning: [],
  };
}

export async function launch() {
  return chromium.launch({ executablePath: CHROME_PATH });
}

/** Cria um contexto "iPhone logado" com a API simulada ligada ao `server`. */
export async function newSession(browser, server) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript((u) => {
    if (localStorage.getItem('mob_token')) return;
    localStorage.setItem('mob_token', 't');
    localStorage.setItem('mob_user', JSON.stringify(u));
    localStorage.setItem('mob-auth', JSON.stringify({ state: { token: 't', user: u, isAuthenticated: true }, version: 0 }));
  }, user);
  await ctx.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const path = u.pathname.replace(/^\/api/, '');
    if (server.mode === 'offline') return route.abort('internetdisconnected').catch(() => {});
    if (server.mode === 'hang') { server.hung.push(route); return; }
    if (server.mode === '503') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'indisponível' }) });
    let body;
    try { body = req.postData() ? JSON.parse(req.postData()) : undefined; } catch { body = undefined; }
    const params = Object.fromEntries(u.searchParams);
    const out = respond(server, req.method(), path, params, body);
    if (out.status === 204) return route.fulfill({ status: 204, body: '' });
    return route.fulfill({ status: out.status, contentType: 'application/json', body: JSON.stringify(out.body) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}

/** Aplica o modo de rede: liga/desliga o "offline" do navegador e a API simulada. */
export async function setNetwork(session, server, mode) {
  const prev = server.mode;
  server.mode = mode;
  await session.ctx.setOffline(mode === 'offline');
  if (mode === 'online' && prev !== 'online') {
    const hung = server.hung.splice(0);
    for (const r of hung) await r.abort('failed').catch(() => {});
  }
}

export async function waitFor(fn, timeout = 20000, step = 250) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, step));
  }
}
