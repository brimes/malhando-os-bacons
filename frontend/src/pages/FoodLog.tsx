import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNutritionStore } from '../stores/useNutritionStore';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { CountUp } from '../components/CountUp';
import { MealPicker } from '../components/nutricao/MealPicker';
import { ChatIcon, ChevronIcon, PlusIcon } from '../components/nutricao/icons';
import { SkeletonBlock } from '../components/nutricao/States';
import { getErrorMessage } from '../api/client';
import { FoodLogAssistant } from '../components/FoodLogAssistant';
import { isNetworkOnline } from '../lib/offline';
import { createFoodLog } from '../lib/local/repo/foodLogs';
import { todayLocalDate } from '../lib/date';
import type {
  FoodItem,
  FoodLogHistoryEntry,
  MealType,
  NutritionLogDraftEntry,
} from '../types';
import { MEAL_TYPE_LABELS } from '../types';

/**
 * Common shape a row (catalog food, past registration, or favorite) is
 * turned into once tapped, so a single form handles all three sources.
 * `baseQuantity`/`baseCalories`/... are the reference the quantity input
 * scales against: 100g for a catalog food (macros are per-100g), or the
 * exact quantity of the most recent registration for a history/favorite row.
 */
interface Selection {
  foodItemId?: number;
  name: string;
  baseQuantity: number;
  baseCalories: number;
  baseProtein: number;
  baseCarbs: number;
  baseFat: number;
  servingGrams?: number;
  servingLabel?: string;
}

function selectionFromFoodItem(food: FoodItem): Selection {
  return {
    foodItemId: food.id,
    name: food.name,
    baseQuantity: 100,
    baseCalories: food.calories_per_100g,
    baseProtein: food.protein_g,
    baseCarbs: food.carbs_g,
    baseFat: food.fat_g,
    servingGrams: food.serving_grams,
    servingLabel: food.serving_label,
  };
}

function selectionFromHistory(entry: FoodLogHistoryEntry): Selection {
  return {
    foodItemId: entry.food_item_id,
    name: entry.food_name,
    baseQuantity: entry.quantity_g,
    baseCalories: entry.calories,
    baseProtein: entry.protein_g,
    baseCarbs: entry.carbs_g,
    baseFat: entry.fat_g,
  };
}

// Same char-for-char translate() table as migration 017's search_text and
// nutrition_favorites.go's historyQuery ORDER BY — kept identical so
// "Ávocado" and "avocado" sort next to each other here exactly like they do
// server-side, not at opposite ends of the list.
const ACCENTED = 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ';
const PLAIN = 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC';

function normalizeNameForSort(name: string): string {
  let normalized = '';
  for (const char of name.trim()) {
    const index = ACCENTED.indexOf(char);
    normalized += index === -1 ? char : PLAIN[index];
  }
  return normalized.toLowerCase();
}

/**
 * Favorites first, alphabetically; then the rest of the history,
 * alphabetically too — overriding an earlier cut sorted by frequency, which
 * the person using it in practice wanted changed. Mirrors the backend's own
 * ordering (GetLogHistory) so a local favorite toggle — which never triggers
 * a refetch — still lands the row in the right place instead of wherever it
 * happened to sit in the array before.
 */
function sortHistory(entries: FoodLogHistoryEntry[]): FoodLogHistoryEntry[] {
  return [...entries].sort((a, b) => {
    const aFav = Boolean(a.favorite_id);
    const bFav = Boolean(b.favorite_id);
    if (aFav !== bFav) return aFav ? -1 : 1;
    const aName = normalizeNameForSort(a.food_name);
    const bName = normalizeNameForSort(b.food_name);
    if (aName < bName) return -1;
    if (aName > bName) return 1;
    return 0;
  });
}

function EmptyNote({ text }: { text: string }) {
  return <p className="px-1 py-3 text-[15px] leading-[1.45] text-muted">{text}</p>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="flex min-h-[40px] items-center text-[17px] font-bold text-fg">{title}</h2>
      <ul className="overflow-hidden rounded-lg bg-surface shadow-card">{children}</ul>
    </section>
  );
}

const Kcal = ({ v }: { v: number }) => (
  <div className="shrink-0 text-right">
    <p className="num text-[22px] leading-[1.1] text-fg">{Math.round(v)}</p>
    <p className="text-[13px] text-dim">kcal</p>
  </div>
);

function HistoryRow({
  entry,
  onSelect,
  onToggleFavorite,
  isTogglingFavorite,
}: {
  entry: FoodLogHistoryEntry;
  onSelect: () => void;
  onToggleFavorite: () => void;
  isTogglingFavorite: boolean;
}) {
  const favorited = Boolean(entry.favorite_id);
  return (
    <li className="flex min-h-[64px] items-center gap-1 pl-[18px] pr-2">
      <button type="button" onClick={onSelect} className="press flex min-h-[64px] min-w-0 flex-1 items-center gap-3 text-left">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-fg">{entry.food_name}</p>
          <p className="text-[13px] text-muted"><span className="num text-[15px]">{Math.round(entry.quantity_g)} g</span>, {MEAL_TYPE_LABELS[entry.meal_type]}</p>
        </div>
        <Kcal v={entry.calories} />
      </button>
      <button
        type="button"
        onClick={onToggleFavorite}
        disabled={isTogglingFavorite}
        aria-pressed={favorited}
        aria-label={favorited ? `Desfavoritar ${entry.food_name}` : `Favoritar ${entry.food_name}`}
        className={`press flex h-12 w-12 shrink-0 items-center justify-center rounded-md disabled:opacity-[.45] ${favorited ? 'text-sun' : 'text-dim'}`}
      >
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill={favorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
        </svg>
      </button>
    </li>
  );
}

function FoodItemRow({ food, onSelect }: { food: FoodItem; onSelect: () => void }) {
  return (
    <li>
      <button type="button" onClick={onSelect} className="press flex min-h-[64px] w-full items-center gap-3 px-[18px] text-left">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-fg">{food.name}</p>
          <p className="truncate text-[13px] text-muted">{food.brand ? `${food.brand}, ` : ''}P {food.protein_g} g, C {food.carbs_g} g, G {food.fat_g} g</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="num text-[22px] leading-[1.1] text-fg">{Math.round(food.calories_per_100g)}</p>
          <p className="text-[13px] text-dim">kcal/100 g</p>
        </div>
      </button>
    </li>
  );
}

export function FoodLogPage() {
  const navigate = useNavigate();
  const {
    searchFoods,
    searchResults,
    isSearching,
    searchHistory,
    historyResults,
    clearSearch,
    logHistory,
    isLoadingHistory,
    fetchLogHistory,
    toggleFavorite,
  } = useNutritionStore();

  const [query, setQuery] = useState('');
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  const [selection, setSelection] = useState<Selection | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [aiMode, setAiMode] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Selection form (catalog food, past registration or favorite).
  const [useServing, setUseServing] = useState(false);
  const [quantity, setQuantity] = useState('100');
  const [mealType, setMealType] = useState<MealType>('lunch');
  const [date, setDate] = useState(() => todayLocalDate());

  // "Criar do zero" form.
  const [manualName, setManualName] = useState('');
  const [manualMealType, setManualMealType] = useState<MealType>('lunch');
  const [manualDate, setManualDate] = useState(() => todayLocalDate());
  const [manualQuantity, setManualQuantity] = useState('');
  const [manualCalories, setManualCalories] = useState('');
  const [manualProtein, setManualProtein] = useState('');
  const [manualCarbs, setManualCarbs] = useState('');
  const [manualFat, setManualFat] = useState('');

  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [pendingFavoriteKey, setPendingFavoriteKey] = useState<string | null>(null);

  useEffect(() => {
    fetchLogHistory();
  }, [fetchLogHistory]);

  useEffect(() => {
    clearTimeout(searchTimeout.current);
    if (query.trim().length >= 2) {
      searchTimeout.current = setTimeout(() => {
        const termo = query.trim();
        // As duas fontes são consultadas juntas: o catálogo (food_items) e o
        // histórico da pessoa. Só o segundo alcança o que ela registrou
        // digitando, que não tem linha no catálogo.
        searchFoods(termo);
        searchHistory(termo);
      }, 400);
    } else {
      clearSearch();
    }
  }, [query, searchFoods, searchHistory, clearSearch]);

  const sortedHistory = useMemo(() => sortHistory(logHistory ?? []), [logHistory]);
  const favorites = useMemo(() => sortedHistory.filter((e) => e.favorite_id), [sortedHistory]);
  const rest = useMemo(() => sortedHistory.filter((e) => !e.favorite_id), [sortedHistory]);

  const trimmedQuery = query.trim();
  const isSearchingQuery = trimmedQuery.length > 0;
  const normalizedQuery = trimmedQuery.toLowerCase();
  // A busca do servidor varre o histórico inteiro; o filtro local só cobre a
  // lista padrão, que vem cortada em 50. Ele continua aqui como resposta
  // imediata enquanto o servidor não voltou, e como única resposta offline —
  // mas quando o servidor responde, é ele que manda.
  const localMatches = useMemo(
    () => sortedHistory.filter((e) => e.food_name.toLowerCase().includes(normalizedQuery)),
    [sortedHistory, normalizedQuery]
  );
  const matchingHistory = (historyResults ?? []).length > 0 ? historyResults : localMatches;

  const openFromFoodItem = (food: FoodItem) => {
    setSubmitError(null);
    setManualMode(false);
    setSelection(selectionFromFoodItem(food));
    setUseServing(Boolean(food.serving_grams));
    setQuantity(food.serving_grams ? String(food.serving_grams) : '100');
    setMealType('lunch');
    setDate(todayLocalDate());
  };

  const openFromHistory = (entry: FoodLogHistoryEntry) => {
    setSubmitError(null);
    setManualMode(false);
    setSelection(selectionFromHistory(entry));
    setUseServing(false);
    setQuantity(String(entry.quantity_g));
    setMealType(entry.meal_type);
    setDate(todayLocalDate());
  };

  const openManual = () => {
    setSubmitError(null);
    setSelection(null);
    setManualMode(true);
    setManualName('');
    setManualMealType('lunch');
    setManualDate(todayLocalDate());
    setManualQuantity('');
    setManualCalories('');
    setManualProtein('');
    setManualCarbs('');
    setManualFat('');
  };

  const backToList = () => {
    setSelection(null);
    setManualMode(false);
    setSubmitError(null);
  };

  const handleToggleFavorite = async (entry: FoodLogHistoryEntry) => {
    setFavoriteError(null);
    setPendingFavoriteKey(entry.group_key);
    try {
      await toggleFavorite(entry);
    } catch (err) {
      setFavoriteError(getErrorMessage(err));
    } finally {
      setPendingFavoriteKey(null);
    }
  };

  const ratio = selection && selection.baseQuantity > 0 ? Number(quantity || 0) / selection.baseQuantity : 0;
  const computedMacros = selection
    ? {
        calories: selection.baseCalories * ratio,
        protein: selection.baseProtein * ratio,
        carbs: selection.baseCarbs * ratio,
        fat: selection.baseFat * ratio,
      }
    : null;

  const handleSelectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selection || !computedMacros) return;
    setSubmitError(null);
    try {
      // `food_name`/macros are always sent, even for a catalog pick: the
      // server recomputes and overwrites them itself when `food_item_id` is
      // set (see `CreateLog` in `backend/internal/handlers/nutrition.go`), but
      // the local-first write needs *something* to show on screen the instant
      // it lands, before that response comes back — see `createFoodLog`.
      await createFoodLog({
        food_item_id: selection.foodItemId,
        food_name: selection.name,
        meal_type: mealType,
        quantity_g: Number(quantity),
        date,
        origin: selection.foodItemId ? undefined : 'manual',
        calories: computedMacros.calories,
        protein_g: computedMacros.protein,
        carbs_g: computedMacros.carbs,
        fat_g: computedMacros.fat,
      });
      navigate('/nutrition');
    } catch (err) {
      setSubmitError(getErrorMessage(err));
    }
  };

  const manualQuantityNumber = Number(manualQuantity);
  const manualCaloriesNumber = Number(manualCalories);
  // Name, quantity and calories are required — an empty calorie value would
  // lie in three places at once (today's progress rings, "rest of the day",
  // and the calendar), quietly closing out the day's target for free. P/C/G
  // default to 0 when left blank.
  const manualValid = manualName.trim() !== '' && manualQuantityNumber > 0 && manualCaloriesNumber > 0;

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualValid) return;
    setSubmitError(null);
    try {
      await createFoodLog({
        food_name: manualName.trim(),
        meal_type: manualMealType,
        quantity_g: manualQuantityNumber,
        date: manualDate,
        origin: 'manual',
        calories: manualCaloriesNumber,
        protein_g: Number(manualProtein) || 0,
        carbs_g: Number(manualCarbs) || 0,
        fat_g: Number(manualFat) || 0,
      });
      navigate('/nutrition');
    } catch (err) {
      setSubmitError(getErrorMessage(err));
    }
  };

  // Registra tudo que o assistente propôs, cada item no dia e na refeição que
  // ele identificou — é para isso que a data viaja em cada entrada em vez de
  // uma só para o conjunto: "comi pizza ontem à noite e um lanche hoje" são
  // dois dias numa conversa só.
  const registrarDoAssistente = async (entries: NutritionLogDraftEntry[]) => {
    for (const entry of entries) {
      await createFoodLog({
        food_name: entry.food_name,
        meal_type: entry.meal_type,
        quantity_g: entry.quantity_g,
        date: entry.date,
        origin: 'assistant',
        calories: entry.calories,
        protein_g: entry.protein_g,
        carbs_g: entry.carbs_g,
        fat_g: entry.fat_g,
      });
    }
    navigate('/nutrition');
  };

  const showList = !selection && !manualMode && !aiMode;
  const inputCls = 'h-[52px] w-full rounded-md border-2 border-transparent bg-surface-2 px-4 text-base text-fg placeholder:text-dim focus:border-brand-fg focus:outline-none';
  const bigNum = 'h-[64px] w-full rounded-md border-2 border-transparent bg-surface-2 px-4 text-center input-num text-fg focus:border-brand-fg focus:outline-none';
  const lbl = 'mb-2 block text-[13px] font-semibold uppercase tracking-[0.06em] text-muted';
  const back = (
    <button type="button" onClick={backToList} className="press -ml-2 flex min-h-[48px] items-center gap-1 px-2 text-[15px] font-semibold text-muted">
      <ChevronIcon className="h-5 w-5 rotate-180" /> Voltar à lista
    </button>
  );
  const macroCells = (m: { calories: number; protein: number; carbs: number; fat: number }) => (
    <div className="mt-3 grid grid-cols-3 gap-3">
      {[['Proteína', m.protein, 'text-violet'], ['Carboidrato', m.carbs, 'text-sun'], ['Gordura', m.fat, 'text-brand-fg']].map(([l, v, c]) => (
        <div key={l as string} className="min-w-0">
          <p className="truncate text-[13px] text-muted">{l}</p>
          <p className={`num text-[24px] leading-[1.1] ${c}`}>{Math.round(v as number)}<span className="font-sans text-[13px] font-medium text-muted"> g</span></p>
        </div>
      ))}
    </div>
  );

  return (
    <>
      <Header title="Registrar" showBack />
      <div className="space-y-[14px] px-5 pb-24 pt-2">
        {aiMode && (
          <>
            <button type="button" onClick={() => setAiMode(false)} className="press -ml-2 flex min-h-[48px] items-center gap-1 px-2 text-[15px] font-semibold text-muted">
              <ChevronIcon className="h-5 w-5 rotate-180" /> Voltar para a busca
            </button>
            <FoodLogAssistant onRegistrar={registrarDoAssistente} />
          </>
        )}

        {showList && (
          <>
            <div className="relative">
              <svg className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-dim" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar alimento"
                aria-label="Buscar alimento"
                autoFocus
                className="h-14 w-full rounded-md border-2 border-transparent bg-surface pl-12 pr-12 text-base text-fg shadow-card placeholder:text-dim focus:border-brand-fg focus:outline-none"
              />
              {isSearching && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-fg border-t-transparent" />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
              <button type="button" onClick={() => { setSubmitError(null); setAiMode(true); }} className="press tint-teal flex min-h-[72px] items-center gap-2.5 rounded-lg bg-surface px-3 text-left shadow-card">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-teal-soft text-teal"><ChatIcon /></span>
                <span className="text-[15px] font-semibold leading-[1.25] text-fg">Descrever conversando</span>
              </button>
              <button type="button" onClick={openManual} className="press flex min-h-[72px] items-center gap-2.5 rounded-lg bg-surface px-3 text-left shadow-card">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-muted"><PlusIcon /></span>
                <span className="text-[15px] font-semibold leading-[1.25] text-fg">Criar do zero</span>
              </button>
            </div>

            {favoriteError && <p role="alert" className="text-[15px] text-danger">{favoriteError}</p>}

            {isLoadingHistory && (logHistory ?? []).length === 0 && (
              <div className="space-y-2" aria-busy="true">
                {[0, 1, 2, 3].map((i) => <SkeletonBlock key={i} className="h-16 w-full" />)}
              </div>
            )}

            {isSearchingQuery ? (
              <>
                <Section title="Já registrei">
                  {matchingHistory.length === 0 ? (
                    <li className="px-[18px]"><EmptyNote text="Nada encontrado no que você já registrou." /></li>
                  ) : (
                    matchingHistory.map((entry) => (
                      <HistoryRow key={entry.group_key} entry={entry} onSelect={() => openFromHistory(entry)} onToggleFavorite={() => handleToggleFavorite(entry)} isTogglingFavorite={pendingFavoriteKey === entry.group_key} />
                    ))
                  )}
                </Section>

                <Section title="Catálogo">
                  {!isNetworkOnline() ? (
                    <li className="px-[18px]"><EmptyNote text="A busca de alimentos precisa de internet." /></li>
                  ) : trimmedQuery.length < 2 ? (
                    <li className="px-[18px]"><EmptyNote text="Digite ao menos 2 letras para buscar no catálogo." /></li>
                  ) : isSearching ? (
                    <li className="px-[18px]"><EmptyNote text="Buscando" /></li>
                  ) : (searchResults ?? []).length === 0 ? (
                    <li className="px-[18px]"><EmptyNote text="Nada encontrado no catálogo." /></li>
                  ) : (
                    searchResults.map((food) => <FoodItemRow key={food.id} food={food} onSelect={() => openFromFoodItem(food)} />)
                  )}
                </Section>
              </>
            ) : sortedHistory.length === 0 ? (
              !isLoadingHistory && (
                <div className="rounded-lg bg-surface px-4 py-8 text-center shadow-card">
                  <p className="text-[17px] font-bold text-fg">Nada registrado ainda</p>
                  <p className="mx-auto mt-1 max-w-[280px] text-[15px] leading-[1.45] text-muted">Busque um alimento acima ou crie do zero. O que você registrar volta aqui para repetir com um toque.</p>
                </div>
              )
            ) : (
              <>
                {favorites.length > 0 && (
                  <Section title="Favoritos">
                    {favorites.map((entry) => (
                      <HistoryRow key={entry.group_key} entry={entry} onSelect={() => openFromHistory(entry)} onToggleFavorite={() => handleToggleFavorite(entry)} isTogglingFavorite={pendingFavoriteKey === entry.group_key} />
                    ))}
                  </Section>
                )}
                <Section title="Já registrei">
                  {rest.length === 0 ? (
                    <li className="px-[18px]"><EmptyNote text="Tudo o que você já registrou está em Favoritos." /></li>
                  ) : (
                    rest.map((entry) => (
                      <HistoryRow key={entry.group_key} entry={entry} onSelect={() => openFromHistory(entry)} onToggleFavorite={() => handleToggleFavorite(entry)} isTogglingFavorite={pendingFavoriteKey === entry.group_key} />
                    ))
                  )}
                </Section>
              </>
            )}
          </>
        )}

        {selection && (
          <form onSubmit={handleSelectionSubmit} className="space-y-[14px]">
            {back}

            <Card tint="teal" className="enter !p-5">
              <h2 className="num break-anywhere text-[28px] leading-[1.05] text-fg">{selection.name}</h2>
              {computedMacros && (
                <>
                  <p className="num mt-3 text-[44px] leading-none text-teal"><CountUp value={Math.round(computedMacros.calories)} /><span className="font-sans text-[15px] font-medium text-muted"> kcal</span></p>
                  {macroCells(computedMacros)}
                </>
              )}
            </Card>

            <MealPicker value={mealType} onChange={setMealType} />

            <Card>
              {selection.servingGrams && (
                <div className="mb-4 grid grid-cols-2 gap-1 rounded-md bg-surface-2 p-1">
                  <button type="button" onClick={() => { setUseServing(true); setQuantity(String(selection.servingGrams)); }} className={`press min-h-[48px] rounded-sm text-[15px] font-semibold ${useServing ? 'bg-teal text-on-teal' : 'text-muted'}`}>
                    {selection.servingLabel || 'Porção'}
                  </button>
                  <button type="button" onClick={() => setUseServing(false)} className={`press min-h-[48px] rounded-sm text-[15px] font-semibold ${!useServing ? 'bg-teal text-on-teal' : 'text-muted'}`}>
                    Gramas
                  </button>
                </div>
              )}
              <label className={lbl} htmlFor="qtd">{useServing ? `Quantidade (${selection.servingLabel || 'porções'})` : 'Quantidade (gramas)'}</label>
              <input id="qtd" type="number" inputMode="decimal" value={quantity} min={1} step={1} onChange={(e) => setQuantity(e.target.value)} className={bigNum} />
              <label className={`${lbl} mt-4`} htmlFor="dia">Data</label>
              <input id="dia" type="date" value={date} max={todayLocalDate()} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            </Card>

            {submitError && <p role="alert" className="text-[15px] text-danger">{submitError}</p>}

            <Button type="submit" fullWidth size="lg" disabled={!(Number(quantity) > 0)}>Registrar alimento</Button>
          </form>
        )}

        {manualMode && (
          <form onSubmit={handleManualSubmit} className="space-y-[14px]">
            {back}

            <Card className="space-y-4">
              <div>
                <label className={lbl} htmlFor="nome">Nome</label>
                <input id="nome" type="text" value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Ex.: Marmita da vovó" autoFocus className={inputCls} />
              </div>
              <MealPicker value={manualMealType} onChange={setManualMealType} />
              <div>
                <label className={lbl} htmlFor="mdia">Data</label>
                <input id="mdia" type="date" value={manualDate} max={todayLocalDate()} onChange={(e) => setManualDate(e.target.value)} className={inputCls} />
              </div>
            </Card>

            <Card tint="teal" className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl} htmlFor="mq">Gramas</label>
                <input id="mq" type="number" inputMode="decimal" value={manualQuantity} min={1} step={1} onChange={(e) => setManualQuantity(e.target.value)} className={bigNum} />
              </div>
              <div>
                <label className={`${lbl} !text-teal`} htmlFor="mk">Calorias</label>
                <input id="mk" type="number" inputMode="decimal" value={manualCalories} min={1} step={1} onChange={(e) => setManualCalories(e.target.value)} className={bigNum} />
              </div>
            </Card>

            <Card>
              <p className={lbl}>Macros (opcional)</p>
              <div className="grid grid-cols-3 gap-3">
                {([
                  ['Proteína (g)', manualProtein, setManualProtein, 'text-violet'],
                  ['Carbo (g)', manualCarbs, setManualCarbs, 'text-sun'],
                  ['Gordura (g)', manualFat, setManualFat, 'text-brand-fg'],
                ] as const).map(([l, v, set, c]) => (
                  <label key={l} className={`block text-[13px] font-semibold ${c}`}>{l}
                    <input type="number" inputMode="decimal" value={v} min={0} step={1} onChange={(e) => set(e.target.value)} className="mt-2 h-12 w-full min-w-0 rounded-sm border-2 border-transparent bg-surface-2 px-1 text-center font-sans text-base font-semibold text-fg focus:border-brand-fg focus:outline-none" />
                  </label>
                ))}
              </div>
            </Card>

            {submitError && <p role="alert" className="text-[15px] text-danger">{submitError}</p>}

            <Button type="submit" fullWidth size="lg" disabled={!manualValid}>Registrar</Button>
          </form>
        )}
      </div>
    </>
  );
}
