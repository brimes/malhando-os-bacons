#!/usr/bin/env node
// E2E do treino sem depender do servidor. API 100% mockada (nada toca a real).
// Cenários: offline (context.setOffline), API pendurada (nunca responde), API 503.
// Em cada um: abre o plano com a API boa (o aparelho "baixa" o plano), corta a
// rede, Iniciar treino -> 3 séries -> Finalizar, confere que a tela nunca mostra
// erro de rede e que, religada a API, start/séries/finish chegam uma vez só.
// Mais um cenário de escrita genérica (enqueueWrite) fora do treino, e um de
// troca de data de treino concluído com o servidor ainda na data antiga (e o PUT
// em 404, como o backend antigo): o Histórico mostra a data nova e a troca fica
// na fila.
// Uso: CHROME_PATH=... npm run test:offline   (BASE_URL=... para usar um servidor já de pé)
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require('playwright'); } catch { /* tenta global */ }
  return require(`${execSync('npm root -g').toString().trim()}/playwright`);
}
const { chromium } = loadPlaywright();

import net from 'node:net';
// Porta livre escolhida na hora: outro servidor de dev (de outro worktree) na
// mesma porta serviria o código errado sem ninguém perceber.
const PORT = process.env.E2E_PORT ?? await new Promise((resolve) => {
  const srv = net.createServer().listen(0, () => { const { port } = srv.address(); srv.close(() => resolve(String(port))); });
});
const BASE = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const now = new Date().toISOString();
const user = { id: 999, email: 'e2e@mob.test', name: 'E2E', created_at: now };
const exercise = { id: 70, exercise_name: 'Supino reto', sets: 3, reps: 10, tracking_type: 'reps', rest_seconds: 0, last_weight_kg: 20 };
const day = { id: 7, day_number: 1, name: 'Treino A', focus: 'Peito', instructions: '', exercises: [exercise] };
const plan = { id: 1, name: 'Plano E2E', description: '', target_date: now.slice(0, 10), days_per_week: 3, session_duration_minutes: 60, creation_method: 'automatic', adaptation_phase: false, active: true, kind: 'regular', days: [day], created_at: now };
const READS = {
  '/auth/me': user,
  '/terms': { current_version: '1', accepted: true, accepted_at: now },
  '/onboarding': { profile: { birth_date: '1990-01-01', age: 35, height_cm: 180, current_weight_kg: 80, training_experience: 'intermediate' }, messages: [], completed: true, goal: { goal_type: 'lose_weight', summary: 'x' } },
  '/dashboard': { user, workout_stats: { total_workouts: 0, workouts_this_week: 0, workouts_this_month: 0, total_sets: 0, total_volume_kg: 0, streak_days: 0 }, today_nutrition: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, meals: [] }, weekly_workouts: [], next_workout: { plan_id: 1, plan_name: plan.name, day_id: 7, day_name: 'Treino A', focus: 'Peito' } },
  '/settings': { countdown_seconds: 0, vibration_enabled: false, auto_advance: true },
  '/training-plans': [plan],
  '/training-plans/1': plan,
  '/workouts': [], '/workouts/stats': {}, '/workouts/calendar': { month: now.slice(0, 7), days: [] },
};

/** Servidor falso com a mesma deduplicação do real. */
function makeServer() {
  const s = { mode: 'up', workouts: new Map(), log: [], bodyWeights: new Map(), nextId: 100 };
  s.hist = null; // treino concluído no servidor, quando um cenário o define
  s.handle = (method, path, body, query = new URLSearchParams()) => {
    if (s.hist) {
      const day = s.hist.date.slice(0, 10);
      if (method === 'GET' && path === '/workouts') {
        const date = query.get('date'); const from = query.get('from'); const to = query.get('to');
        const fits = date ? date === day : from && to ? day >= from && day <= to : true;
        return { status: 200, body: fits ? [s.hist] : [] };
      }
      if (method === 'GET' && path === '/workouts/calendar') {
        const month = query.get('month');
        return { status: 200, body: { month, days: day.slice(0, 7) === month ? [{ date: day, count: 1 }] : [] } };
      }
      if (method === 'GET' && path === `/workouts/${s.hist.id}`) return { status: 200, body: s.hist };
      if (method === 'PUT' && path === `/workouts/${s.hist.id}/date`) { s.log.push('put-date'); return { status: s.putDateStatus ?? 404, body: { error: 'not found' } }; }
    }
    if (method === 'GET') return path === '/workouts/active' ? { status: 204 } : { status: 200, body: READS[path] ?? [] };
    if (path === '/workouts/start') {
      let w = s.workouts.get(body.client_session_id);
      if (!w) { w = { id: s.nextId++, status: 'in_progress', sets: new Map() }; s.workouts.set(body.client_session_id, w); s.log.push('start'); }
      return { status: 200, body: { workout: { id: w.id, status: w.status, sets: [] }, plan_id: 1, day_name: 'Treino A', exercises: [exercise] } };
    }
    if (path === '/body-weights') {
      if (!s.bodyWeights.has(body.client_id)) { s.bodyWeights.set(body.client_id, body); s.log.push('weight'); }
      return { status: 201, body: { id: 1, ...body } };
    }
    const m = path.match(/^\/workouts\/(\d+)\/(sets|finish|complete)$/);
    const w = m && [...s.workouts.values()].find((x) => x.id === Number(m[1]));
    if (!w || w.status !== 'in_progress') return { status: 404, body: { error: 'active workout not found' } };
    if (m[2] === 'sets') {
      if (!w.sets.has(body.client_set_id)) { w.sets.set(body.client_set_id, 1); s.log.push('set'); }
      return { status: 201, body: { id: w.sets.size + 500 } };
    }
    w.status = 'completed'; s.log.push('finish');
    return { status: 200, body: { id: w.id, status: 'completed' } };
  };
  return s;
}

async function newPage(browser, server) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  await ctx.addInitScript((u) => {
    localStorage.setItem('mob_token', 't');
    localStorage.setItem('mob_user', JSON.stringify(u));
    localStorage.setItem('mob-auth', JSON.stringify({ state: { token: 't', user: u, isAuthenticated: true }, version: 0 }));
  }, user);
  const page = await ctx.newPage();
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api/, '');
    if (path === '/health' && server.mode !== 'up') {
      return server.mode === 'hang' ? undefined : route.fulfill({ status: 503, body: '{}', contentType: 'application/json' });
    }
    if (server.mode === 'hang') return; // nunca responde
    const isWrite = req.method() !== 'GET';
    if (server.mode === '503' && (isWrite || path !== '/health')) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"indisponível"}' });
    }
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    const out = server.handle(req.method(), path, body, new URL(req.url()).searchParams);
    if (isWrite) server.requests = (server.requests ?? 0) + 1;
    return route.fulfill({ status: out.status, contentType: 'application/json', body: out.body === undefined ? '' : JSON.stringify(out.body) });
  });
  return { ctx, page };
}

const ERRO = /sem conexão|sem conexao|network error|erro de rede|tempo esgotado|timeout|falha ao|não foi enviado|não foram enviados|altera\S+ (aguardando|pendentes?)|sem internet/i;
async function semErroNaTela(page, onde) {
  const text = await page.evaluate(() => document.body.innerText);
  if (ERRO.test(text)) throw new Error(`mensagem de erro de rede visível (${onde}): ${text.match(ERRO)[0]}`);
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

async function cenario(browser, nome, mode) {
  const server = makeServer();
  const { ctx, page } = await newPage(browser, server);
  // 1) com a API boa o aparelho baixa o plano
  await page.goto(`${BASE}/training-plans/1/days/7`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Iniciar treino/ }).waitFor({ timeout: 15000 });
  // 2) a rede some (de um jeito diferente por cenário)
  server.mode = mode === 'offline' ? 'up' : mode;
  if (mode === 'offline') await ctx.setOffline(true);

  if (process.env.E2E_DEBUG) page.on('console', (m) => console.error('[console]', m.type(), m.text().slice(0, 300)));
  if (process.env.E2E_DEBUG) page.on('request', (r) => console.error('[req]', r.method(), r.url().replace(BASE, '')));
  if (process.env.E2E_DEBUG) page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  const t0 = Date.now();
  await page.getByRole('button', { name: /Iniciar treino/ }).click();
  await page.waitForURL('**/workouts/session', { timeout: 3000 }).catch(async (e) => {
    if (process.env.E2E_DEBUG) console.error(page.url(), await page.evaluate(() => Object.keys(localStorage).map((k) => k + '=' + localStorage.getItem(k).slice(0, 400))));
    throw e;
  });
  for (let n = 1; n <= 3; n += 1) {
    // Sem /settings no aparelho vale o padrão (5 s de preparo): pular, não esperar.
    await page.getByRole('button', { name: /Começar agora/ }).click({ timeout: 400 }).catch(() => {});
    await page.getByRole('button', { name: /Concluí a série/ }).click({ timeout: 9000 }).catch(async (e) => {
      if (process.env.E2E_DEBUG) { await page.screenshot({ path: `/tmp/e2e-${nome.replace(/\W+/g, '_')}.png` }); console.error(await page.evaluate(() => document.body.innerText)); }
      throw e;
    });
    await semErroNaTela(page, `série ${n}`);
  }
  await page.getByRole('button', { name: 'Finalizar treino', exact: true }).click({ timeout: 3000 });
  await page.waitForURL('**/training-plans/1', { timeout: 3000 });
  const gasto = Date.now() - t0;
  await semErroNaTela(page, 'depois de finalizar');
  // O treino aparece como feito na semana, sem esperar o servidor.
  await page.waitForFunction(() => /1\s*de 3/.test(document.body.innerText), null, { timeout: 4000 });
  assert(gasto < 6000, `fluxo esperou a rede (${gasto} ms)`);
  const fila = await page.evaluate(() => JSON.parse(localStorage.getItem('mob-offline') ?? 'null'));
  void fila;

  // 3) a API volta: tudo chega, uma vez só, na ordem
  server.mode = 'up';
  if (mode === 'offline') await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline && server.log.join() !== 'start,set,set,set,finish') {
    await page.evaluate(async () => { const m = await import('/src/lib/offline.ts'); await m.flushQueue({ force: true }); });
    await page.waitForTimeout(500);
  }
  assert(server.log.join() === 'start,set,set,set,finish', `sincronização final errada: ${server.log.join()}`);
  assert(server.workouts.size === 1, 'treino duplicado');
  console.log(`ok  ${nome}: fluxo local em ${gasto} ms, servidor recebeu ${server.log.join(' > ')}`);
  await ctx.close();
}

async function escritaGenerica(browser) {
  const server = makeServer();
  const { ctx, page } = await newPage(browser, server);
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  server.mode = 'hang';
  const t0 = Date.now();
  await page.evaluate(async () => {
    const m = await import('/src/lib/offline.ts');
    m.enqueueWrite({ method: 'POST', url: '/body-weights', body: { client_id: 'peso-1', kg: 79.5 }, idempotent: true, createsEntity: true });
  });
  assert(Date.now() - t0 < 1000, 'enqueueWrite esperou a rede');
  await page.waitForTimeout(500);
  server.mode = 'up';
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline && server.bodyWeights.size === 0) {
    await page.evaluate(async () => { const m = await import('/src/lib/offline.ts'); await m.flushQueue({ force: true }); });
    await page.waitForTimeout(500);
  }
  assert(server.bodyWeights.size === 1 && server.log.filter((x) => x === 'weight').length === 1, 'escrita genérica não chegou exatamente uma vez');
  console.log('ok  escrita genérica (API pendurada): gravou na hora e chegou uma vez');
  await ctx.close();
}

async function trocaDeData(browser) {
  const server = makeServer();
  const dia = (atras) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - atras); d.setUTCHours(12, 0, 0, 0); return d; };
  const velha = dia(2);
  const nova = dia(5);
  server.hist = { id: 55, user_id: 999, name: 'Treino E2E', date: velha.toISOString(), status: 'completed', started_at: velha.toISOString(), finished_at: new Date(velha.getTime() + 3000000).toISOString(), duration_minutes: 50, created_at: velha.toISOString() };
  const { ctx, page } = await newPage(browser, server);
  await page.goto(`${BASE}/workouts/55`, { waitUntil: 'networkidle' });
  // O servidor segue com a data antiga e recusa o PUT (backend sem a rota).
  await page.evaluate(async (iso) => {
    const { changeWorkoutDate } = await import('/src/lib/workoutDate.ts');
    const { workoutsApi } = await import('/src/api/workouts.ts');
    changeWorkoutDate(await workoutsApi.get(55), new Date(iso));
  }, nova.toISOString());
  await page.evaluate(async () => { const m = await import('/src/lib/offline.ts'); await m.flushQueue({ force: true }); });
  await page.waitForTimeout(300);
  assert(server.log.includes('put-date'), 'o PUT da troca de data nunca saiu');

  const abrirDia = async (d) => {
    await page.goto(`${BASE}/workouts/history`, { waitUntil: 'load' });
    await page.getByRole('heading', { name: 'Histórico' }).waitFor({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(800);
    const hoje = new Date();
    if (d.getUTCMonth() !== hoje.getMonth()) await page.getByRole('button', { name: 'Mês anterior' }).click();
    const botao = page.getByRole('button', { name: new RegExp(`^${d.getUTCDate()}, \\d+ trein`) });
    return botao;
  };
  const noNovo = await abrirDia(nova);
  await noNovo.waitFor({ timeout: 5000 });
  await noNovo.click();
  await page.getByText('Treino E2E').waitFor({ timeout: 5000 });
  const noVelho = await abrirDia(velha);
  assert(await noVelho.count() === 0, 'o dia antigo ainda aparece no calendário com treino');

  const fila = await page.evaluate(async () => { const m = await import('/src/lib/offlineStore.ts'); return { queue: m.getQueue().map((x) => x.url), failed: m.useOfflineStore.getState().failed.length }; });
  assert(fila.queue.join() === '/workouts/55/date' && fila.failed === 0, `a troca não ficou na fila após 404: ${JSON.stringify(fila)}`);
  console.log('ok  troca de data (servidor com data antiga, PUT 404): Histórico mostra o dia novo, some do antigo e a troca segue na fila');
  await ctx.close();
}

let dev;
if (!process.env.BASE_URL) {
  dev = spawn('npx', ['vite', '--port', PORT, '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i += 1) {
    if (await fetch(BASE).then((r) => r.ok).catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
}
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
let falhou = 0;
for (const [nome, mode] of [['offline (setOffline)', 'offline'], ['API pendurada', 'hang'], ['API 503', '503']]) {
  try { await cenario(browser, nome, mode); } catch (e) { falhou += 1; console.error(`FALHOU ${nome}: ${e.message}`); }
}
try { await escritaGenerica(browser); } catch (e) { falhou += 1; console.error(`FALHOU escrita genérica: ${e.message}`); }
try { await trocaDeData(browser); } catch (e) { falhou += 1; console.error(`FALHOU troca de data: ${e.message}`); }
await browser.close();
dev?.kill();
console.log(falhou ? `\n${falhou} cenário(s) falharam` : '\ntodos os cenários passaram');
process.exit(falhou ? 1 : 0);
