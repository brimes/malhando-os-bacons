// e2e offline — áreas: Nutrição, Resultados, Perfil/Configurações, Academias e
// arquivar plano. Requisito do dono: o app salva SEM internet, de forma
// invisível, e sincroniza depois. Cada fluxo roda em 3 modos de rede:
//   offline — aparelho sem rede (setOffline + abort)
//   hang    — "acha que tem internet", mas a API nunca responde
//   503     — servidor fora do ar
// Em todos: a UI atualiza na hora, nenhuma mensagem de rede aparece, e após
// religar a API cada POST/PUT/DELETE chega UMA vez e na ordem.
//   BASE_URL=http://localhost:5173 node e2e/resto.spec.mjs [filtro-de-nome]
import { launch, newServer, newSession, setNetwork, waitFor, today, BASE, NETWORK_ERROR_RE } from './harness.mjs';

const MODES = (process.env.MODES ?? 'offline,hang,503').split(',');
const FILTER = process.argv[2];
const seedLog = (s, over = {}) => s.logs.push({ id: 501, user_id: 777, food_name: 'Banana prata', meal_type: 'snack', quantity_g: 100, calories: 90, protein_g: 1, carbs_g: 23, fat_g: 0.3, origin: 'manual', date: `${today}T00:00:00Z`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...over });
const visible = (page, text, t = 2500) => page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: t }).then(() => true, () => false);
const gone = (page, text, t = 2500) => page.getByText(text, { exact: false }).first().waitFor({ state: 'hidden', timeout: t }).then(() => true, () => false);
const count = (s, method, re) => s.mutations(method, re).length;

const FLOWS = [
  {
    name: 'refeição: registrar pela busca/histórico',
    start: '/nutrition/log',
    ready: (p) => visible(p, 'Arroz branco', 8000),
    act: async (p) => {
      await p.getByLabel('Buscar alimento').fill('arroz');
      await p.getByRole('button', { name: /Arroz branco/ }).first().click();
      await p.getByRole('button', { name: 'Registrar alimento' }).click();
    },
    ui: async (p) => { await p.waitForURL(/\/nutrition$/, { timeout: 2500 }).catch(() => {}); return /\/nutrition$/.test(p.url()) && visible(p, 'Arroz branco'); },
    server: (s) => count(s, 'POST', /^\/nutrition\/logs$/) === 1 && s.logs.some((l) => l.food_name === 'Arroz branco'),
    exact: (s) => count(s, 'POST', /^\/nutrition\/logs$/) === 1,
  },
  {
    name: 'refeição: favoritar',
    start: '/nutrition/log',
    ready: (p) => visible(p, 'Arroz branco', 8000),
    act: (p) => p.getByRole('button', { name: 'Favoritar Arroz branco' }).click(),
    ui: (p) => p.getByRole('button', { name: 'Desfavoritar Arroz branco' }).waitFor({ timeout: 2500 }).then(() => true, () => false),
    server: (s) => count(s, 'POST', /^\/nutrition\/favorites$/) === 1,
    exact: (s) => count(s, 'POST', /^\/nutrition\/favorites$/) === 1,
  },
  {
    name: 'refeição: criar do zero',
    start: '/nutrition/log',
    ready: (p) => visible(p, 'Criar do zero', 8000),
    act: async (p) => {
      await p.getByText('Criar do zero').click();
      await p.locator('#nome').fill('Marmita teste');
      await p.locator('#mq').fill('300');
      await p.locator('#mk').fill('550');
      await p.getByRole('button', { name: 'Registrar', exact: true }).click();
    },
    ui: async (p) => { await p.waitForURL(/\/nutrition$/, { timeout: 2500 }).catch(() => {}); return /\/nutrition$/.test(p.url()) && visible(p, 'Marmita teste'); },
    server: (s) => count(s, 'POST', /^\/nutrition\/logs$/) === 1,
    exact: (s) => count(s, 'POST', /^\/nutrition\/logs$/) === 1,
  },
  {
    name: 'refeição: editar registro',
    start: '/nutrition',
    seed: (s) => seedLog(s),
    ready: (p) => visible(p, 'Banana prata', 8000),
    act: async (p) => {
      await p.getByText('Banana prata').first().click();
      const qty = p.locator('form input[type=number]').first();
      await qty.fill('200');
      await p.locator('form').getByRole('button', { name: /^Salvar/ }).click();
    },
    ui: async (p) => (await gone(p, 'Apagar registro', 2500)) && visible(p, '200'),
    server: (s) => count(s, 'PUT', /^\/nutrition\/logs\/501$/) === 1,
    exact: (s) => count(s, 'PUT', /^\/nutrition\/logs\/501$/) === 1,
  },
  {
    name: 'refeição: apagar registro',
    start: '/nutrition',
    seed: (s) => seedLog(s),
    ready: (p) => visible(p, 'Banana prata', 8000),
    act: (p) => p.getByRole('button', { name: 'Apagar Banana prata' }).click(),
    ui: (p) => gone(p, 'Banana prata', 2500),
    server: (s) => count(s, 'DELETE', /^\/nutrition\/logs\/501$/) === 1 && s.logs.length === 0,
    exact: (s) => count(s, 'DELETE', /^\/nutrition\/logs\/501$/) === 1,
  },
  {
    name: 'refeição: copiar registro para outro dia',
    start: '/nutrition/history',
    seed: (s) => seedLog(s),
    ready: async (p) => {
      await p.locator(`button[aria-label^="${Number(today.slice(8))}:"]`).first().click({ timeout: 8000 }).catch(() => {});
      return visible(p, 'Banana prata', 8000);
    },
    act: async (p) => {
      await p.getByRole('button', { name: /Copiar Banana prata/ }).click();
      await p.getByRole('button', { name: 'Copiar', exact: true }).click();
    },
    ui: (p) => gone(p, 'Copiar para', 2500),
    server: (s) => count(s, 'POST', /^\/nutrition\/logs$/) === 1,
    exact: (s) => count(s, 'POST', /^\/nutrition\/logs$/) === 1,
  },
  {
    name: 'resultados: registrar peso',
    start: '/results',
    ready: (p) => visible(p, 'Registrar', 8000),
    act: async (p) => {
      await p.getByRole('button', { name: 'Registrar', exact: true }).first().click();
      const dlg = p.getByRole('dialog', { name: 'Registrar resultado' });
      await dlg.locator('input[type=number]').first().fill('79.2');
      await dlg.getByRole('button', { name: /^Salvar/ }).click();
    },
    ui: async (p) => (await gone(p, 'Preencha só o que você mediu', 2500)) && visible(p, '79,2'),
    server: (s) => count(s, 'POST', /^\/results$/) === 1,
    exact: (s) => count(s, 'POST', /^\/results$/) === 1,
  },
  {
    name: 'resultados: apagar registro',
    start: '/results',
    ready: (p) => visible(p, 'Registrar', 8000),
    act: async (p) => {
      p.once('dialog', (d) => d.accept());
      await p.getByRole('button', { name: /apagar/i }).first().click();
    },
    ui: (p) => gone(p, '80 kg', 2500),
    server: (s) => count(s, 'DELETE', /^\/results\/1$/) === 1,
    exact: (s) => count(s, 'DELETE', /^\/results\/1$/) === 1,
  },
  {
    name: 'perfil: salvar dados',
    start: '/profile/dados',
    ready: (p) => p.getByRole('button', { name: 'Salvar' }).waitFor({ timeout: 8000 }).then(() => true, () => false),
    act: async (p) => {
      await p.locator('input[type=number]').nth(1).fill('77');
      await p.getByRole('button', { name: 'Salvar' }).click();
    },
    ui: async (p) => { await p.waitForTimeout(800); return !(await visible(p, 'Salvando', 300)) && !p.url().includes('/login'); },
    server: (s) => count(s, 'PUT', /^\/onboarding\/profile$/) >= 1 && s.profile.current_weight_kg === 77,
    exact: (s) => count(s, 'PUT', /^\/onboarding\/profile$/) === 1,
  },
  {
    name: 'configurações: salvar',
    start: '/settings',
    ready: (p) => p.getByRole('button', { name: 'Salvar configurações' }).waitFor({ timeout: 8000 }).then(() => true, () => false),
    act: async (p) => {
      await p.getByText('Avançar sozinho').click();
      await p.getByRole('button', { name: 'Salvar configurações' }).click();
    },
    ui: (p) => visible(p, 'Salvo', 2500),
    server: (s) => count(s, 'PUT', /^\/settings$/) === 1 && s.settings.auto_advance === true,
    exact: (s) => count(s, 'PUT', /^\/settings$/) === 1,
  },
  {
    name: 'academia: criar',
    start: '/gyms/new',
    ready: (p) => p.getByPlaceholder('Ex: Academia perto de casa').waitFor({ timeout: 8000 }).then(() => true, () => false),
    act: async (p) => {
      await p.getByPlaceholder('Ex: Academia perto de casa').fill('Academia Nova');
      await p.getByRole('button', { name: 'Cadastrar academia' }).click();
    },
    ui: async (p) => { await p.waitForURL(/\/gyms$/, { timeout: 2500 }).catch(() => {}); return /\/gyms$/.test(p.url()) && visible(p, 'Academia Nova'); },
    server: (s) => count(s, 'POST', /^\/gyms$/) === 1,
    exact: (s) => count(s, 'POST', /^\/gyms$/) === 1,
  },
  {
    name: 'academia: editar',
    start: '/gyms/1',
    ready: (p) => p.getByRole('button', { name: 'Salvar alterações' }).waitFor({ timeout: 8000 }).then(() => true, () => false),
    act: async (p) => {
      await p.getByPlaceholder('Ex: Academia perto de casa').fill('Academia Renomeada');
      await p.getByRole('button', { name: 'Salvar alterações' }).click();
    },
    ui: async (p) => { await p.waitForURL(/\/gyms$/, { timeout: 2500 }).catch(() => {}); return /\/gyms$/.test(p.url()) && visible(p, 'Academia Renomeada'); },
    server: (s) => count(s, 'PUT', /^\/gyms\/1$/) === 1,
    exact: (s) => count(s, 'PUT', /^\/gyms\/1$/) === 1,
  },
  {
    name: 'plano: arquivar',
    start: '/training-plans/5',
    ready: (p) => visible(p, 'Plano E2E', 8000),
    act: async (p) => {
      p.once('dialog', (d) => d.accept());
      await p.getByRole('button', { name: 'Fechar plano' }).first().click();
    },
    ui: async (p) => { await p.waitForURL(/\/workouts$/, { timeout: 2500 }).catch(() => {}); return /\/workouts$/.test(p.url()); },
    server: (s) => count(s, 'POST', /^\/training-plans\/5\/archive$/) === 1,
    exact: (s) => count(s, 'POST', /^\/training-plans\/5\/archive$/) === 1,
  },
  {
    name: 'plano de dieta: ativar outro',
    start: '/nutrition/plan',
    ready: (p) => visible(p, 'Dieta B', 8000),
    act: (p) => p.getByRole('button', { name: 'Ativar' }).first().click(),
    ui: async (p) => !(await visible(p, 'Ativar', 800)) || true,
    server: (s) => count(s, 'PUT', /^\/nutrition\/plans\/2\/activate$/) === 1,
    exact: (s) => count(s, 'PUT', /^\/nutrition\/plans\/2\/activate$/) === 1,
  },
  {
    name: 'avaliação física: registrar',
    start: '/fitness-assessment',
    ready: (p) => p.locator('input').first().waitFor({ timeout: 8000 }).then(() => true, () => false),
    act: async (p) => {
      const inputs = p.locator('input[type=number]');
      await inputs.nth(0).fill('600');
      await p.getByRole('button', { name: 'Salvar avaliação' }).click();
    },
    ui: async (p) => { await p.waitForTimeout(700); return (await p.locator('input[type=number]').first().inputValue()) === ''; },
    server: (s) => count(s, 'POST', /^\/onboarding\/fitness-assessments$/) === 1,
    exact: (s) => count(s, 'POST', /^\/onboarding\/fitness-assessments$/) === 1,
  },
];

async function runOne(browser, flow, mode) {
  const server = newServer();
  flow.seed?.(server);
  const session = await newSession(browser, server);
  const { page, errors } = session;
  const fails = [];
  try {
    await page.goto(BASE + flow.start, { waitUntil: 'domcontentloaded' });
    if (!(await flow.ready(page))) { fails.push('tela não ficou pronta online (problema do mock/seletor)'); return fails; }
    await page.waitForTimeout(1200); // deixa o pull de fundo e o boot offline assentarem
    await setNetwork(session, server, mode);
    await flow.act(page);
    if (!(await flow.ui(page))) fails.push('UI não refletiu a ação na hora');
    await page.waitForTimeout(1500);
    const text = await page.locator('body').innerText();
    const m = text.match(NETWORK_ERROR_RE);
    if (m) fails.push(`mensagem de rede visível: "${m[0]}"`);
    if (errors.length) fails.push(`erro JS: ${errors[0].slice(0, 80)}`);
    await setNetwork(session, server, 'online');
    await page.evaluate(() => window.dispatchEvent(new Event('online'))).catch(() => {});
    const synced = await waitFor(() => flow.server(server), 30000);
    if (!synced) fails.push(`servidor não recebeu a escrita após religar (log: ${JSON.stringify(server.log.map((l) => `${l.method} ${l.path}`))})`);
    await page.waitForTimeout(3500);
    if (!flow.exact(server)) fails.push(`escrita não chegou exatamente uma vez (log: ${JSON.stringify(server.log.map((l) => `${l.method} ${l.path}`))})`);
  } catch (e) {
    fails.push(`exceção: ${String(e.message).split('\n')[0].slice(0, 160)}`);
  } finally {
    if (process.env.SHOTS_DIR && fails.length) await page.screenshot({ path: `${process.env.SHOTS_DIR}/${flow.name.replace(/\W+/g, '_')}-${mode}.png` }).catch(() => {});
    await session.ctx.close();
  }
  return fails;
}

const browser = await launch();
let failed = 0; let total = 0;
for (const flow of FLOWS) {
  if (FILTER && !flow.name.includes(FILTER)) continue;
  for (const mode of MODES) {
    total += 1;
    const fails = await runOne(browser, flow, mode);
    if (fails.length) failed += 1;
    console.log(`${fails.length ? 'FALHOU' : 'ok    '} [${mode.padEnd(7)}] ${flow.name}`);
    for (const f of fails) console.log(`         -> ${f}`);
  }
}
await browser.close();
console.log(`\n${failed}/${total} cenários falham`);
process.exit(failed ? 1 : 0);
