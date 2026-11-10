import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNutritionStore } from '../stores/useNutritionStore';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
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
 return <p className="px-1 py-2 text-sm text-dim">{text}</p>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
 <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-dim">{title}</h3>
 <div className="space-y-2">{children}</div>
    </div>
  );
}

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
 <Card className="flex items-center gap-2 py-3">
 <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
 <p className="truncate text-sm font-medium text-fg">{entry.food_name}</p>
 <p className="text-xs text-dim">
          {entry.quantity_g}g · {MEAL_TYPE_LABELS[entry.meal_type]} · {Math.round(entry.calories)} kcal
        </p>
      </button>
      <button
        type="button"
        onClick={onToggleFavorite}
        disabled={isTogglingFavorite}
        aria-label={favorited ? `Desfavoritar ${entry.food_name}` : `Favoritar ${entry.food_name}`}
 className={`shrink-0 p-1.5 text-xl leading-none disabled:opacity-50 ${
          favorited ? 'text-sun' : 'text-dim'
        }`}
      >
        {favorited ? '★' : '☆'}
      </button>
    </Card>
  );
}

function FoodItemRow({ food, onSelect }: { food: FoodItem; onSelect: () => void }) {
  return (
 <button type="button" onClick={onSelect} className="w-full text-left">
 <Card className="py-3">
 <p className="text-sm font-medium text-fg">
 {food.name} {food.brand && <span className="text-dim">· {food.brand}</span>}
        </p>
 <p className="text-xs text-dim">
          {food.calories_per_100g} kcal/100g · P:{food.protein_g}g C:{food.carbs_g}g G:{food.fat_g}g
        </p>
      </Card>
    </button>
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

  const sortedHistory = useMemo(() => sortHistory(logHistory), [logHistory]);
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
  const matchingHistory = historyResults.length > 0 ? historyResults : localMatches;

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

  return (
    <>
      <Header title="Registrar Alimento" showBack />
 <div className="px-4 py-4 pb-24 space-y-4">
        {aiMode && (
          <>
 <button type="button" onClick={() => setAiMode(false)} className="text-sm text-dim">
              ← Voltar para a busca
            </button>
            <FoodLogAssistant onRegistrar={registrarDoAssistente} />
          </>
        )}

        {showList && (
          <>
 <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar alimento..."
                autoFocus
 className="w-full bg-surface border border-line rounded-lg px-4 py-3.5 text-fg placeholder-dim focus:outline-none transition-colors"
              />
              {isSearching && (
 <div className="absolute right-3 top-1/2 -translate-y-1/2">
 <div className="w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>

 <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { setSubmitError(null); setAiMode(true); }}
 className="rounded-lg bg-brand-soft px-4 py-3 text-center text-sm font-semibold text-brand-fg"
              >
                Descrever conversando
              </button>
              <button
                type="button"
                onClick={openManual}
 className="rounded-lg border border-dashed border-line px-4 py-3 text-center text-sm font-semibold text-brand-fg"
              >
                + Criar do zero
              </button>
            </div>

 {favoriteError && <p className="text-xs text-danger">{favoriteError}</p>}

            {isLoadingHistory && logHistory.length === 0 && (
 <div className="flex justify-center py-4">
 <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {isSearchingQuery ? (
              <>
                <Section title="Já registrei">
                  {matchingHistory.length === 0 ? (
                    <EmptyNote text="Nada encontrado no que você já registrou." />
                  ) : (
                    matchingHistory.map((entry) => (
                      <HistoryRow
                        key={entry.group_key}
                        entry={entry}
                        onSelect={() => openFromHistory(entry)}
                        onToggleFavorite={() => handleToggleFavorite(entry)}
                        isTogglingFavorite={pendingFavoriteKey === entry.group_key}
                      />
                    ))
                  )}
                </Section>

                <Section title="Catálogo">
                  {!isNetworkOnline() ? (
                    <EmptyNote text="A busca de alimentos precisa de internet." />
                  ) : trimmedQuery.length < 2 ? (
                    <EmptyNote text="Digite ao menos 2 letras para buscar no catálogo." />
                  ) : isSearching ? (
                    <EmptyNote text="Buscando..." />
                  ) : searchResults.length === 0 ? (
                    <EmptyNote text="Nada encontrado no catálogo." />
                  ) : (
                    searchResults.map((food) => (
                      <FoodItemRow key={food.id} food={food} onSelect={() => openFromFoodItem(food)} />
                    ))
                  )}
                </Section>
              </>
            ) : sortedHistory.length === 0 ? (
              !isLoadingHistory && (
                <EmptyNote text="Você ainda não registrou nada. Busque um alimento ou crie do zero." />
              )
            ) : (
              <>
                {favorites.length > 0 && (
                  <Section title="Favoritos">
                    {favorites.map((entry) => (
                      <HistoryRow
                        key={entry.group_key}
                        entry={entry}
                        onSelect={() => openFromHistory(entry)}
                        onToggleFavorite={() => handleToggleFavorite(entry)}
                        isTogglingFavorite={pendingFavoriteKey === entry.group_key}
                      />
                    ))}
                  </Section>
                )}
                <Section title="Já registrei">
                  {rest.length === 0 ? (
                    <EmptyNote text="Tudo o que você já registrou está em Favoritos." />
                  ) : (
                    rest.map((entry) => (
                      <HistoryRow
                        key={entry.group_key}
                        entry={entry}
                        onSelect={() => openFromHistory(entry)}
                        onToggleFavorite={() => handleToggleFavorite(entry)}
                        isTogglingFavorite={pendingFavoriteKey === entry.group_key}
                      />
                    ))
                  )}
                </Section>
              </>
            )}
          </>
        )}

        {selection && (
 <form onSubmit={handleSelectionSubmit} className="space-y-4">
 <button type="button" onClick={backToList} className="text-xs text-dim">
              ‹ Voltar à lista
            </button>

            <Card>
 <p className="text-sm font-semibold text-fg">{selection.name}</p>
            </Card>

            <div>
 <label className="block text-xs text-muted uppercase tracking-wide mb-2">Refeição</label>
 <div className="grid grid-cols-2 gap-2">
                {(Object.entries(MEAL_TYPE_LABELS) as [MealType, string][]).map(([type, label]) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setMealType(type)}
 className={`py-2.5 rounded-md text-sm font-medium transition-colors ${
                      mealType === type ? 'bg-brand text-white' : 'bg-surface-2 text-muted hover:bg-surface-2'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
 <label className="block text-xs text-muted uppercase tracking-wide mb-2">Data</label>
              <input
                type="date"
                value={date}
                max={todayLocalDate()}
                onChange={(e) => setDate(e.target.value)}
 className="w-full bg-surface-2 border border-line rounded-md px-4 py-3 text-fg focus:outline-none"
              />
            </div>

            <Card>
              {selection.servingGrams && (
 <div className="mb-3 grid grid-cols-2 rounded-md bg-bg p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setUseServing(true);
                      setQuantity(String(selection.servingGrams));
                    }}
 className={`rounded-lg py-2 text-xs font-semibold ${useServing ? 'bg-brand text-white' : 'text-dim'}`}
                  >
                    {selection.servingLabel || 'Porção'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setUseServing(false)}
 className={`rounded-lg py-2 text-xs font-semibold ${!useServing ? 'bg-brand text-white' : 'text-dim'}`}
                  >
                    Gramas
                  </button>
                </div>
              )}
 <label className="block text-xs text-muted uppercase tracking-wide mb-2">
                {useServing ? `Quantidade (${selection.servingLabel || 'porções'})` : 'Quantidade (gramas)'}
              </label>
              <input
                type="number"
                value={quantity}
                min={1}
                step={1}
                onChange={(e) => setQuantity(e.target.value)}
 className="w-full bg-surface-2 border border-line rounded-md px-4 py-3 text-fg text-center text-2xl font-bold focus:outline-none transition-colors"
              />
            </Card>

            {computedMacros && (
              <Card>
 <p className="text-xs text-dim uppercase tracking-wide mb-3">Valores nutricionais</p>
 <div className="grid grid-cols-4 gap-2 text-center">
                  <div>
 <p className="text-lg font-bold text-brand-fg">{Math.round(computedMacros.calories)}</p>
 <p className="text-xs text-dim">kcal</p>
                  </div>
                  <div>
 <p className="text-lg font-bold text-teal">{Math.round(computedMacros.protein)}g</p>
 <p className="text-xs text-dim">proteína</p>
                  </div>
                  <div>
 <p className="text-lg font-bold text-sun">{Math.round(computedMacros.carbs)}g</p>
 <p className="text-xs text-dim">carbs</p>
                  </div>
                  <div>
 <p className="text-lg font-bold text-danger">{Math.round(computedMacros.fat)}g</p>
 <p className="text-xs text-dim">gordura</p>
                  </div>
                </div>
              </Card>
            )}

 {submitError && <p className="text-xs text-danger">{submitError}</p>}

            <Button type="submit" fullWidth size="lg" disabled={!(Number(quantity) > 0)}>
              Registrar Alimento
            </Button>
          </form>
        )}

        {manualMode && (
 <form onSubmit={handleManualSubmit} className="space-y-4">
 <button type="button" onClick={backToList} className="text-xs text-dim">
              ‹ Voltar à lista
            </button>

            <Card>
 <label className="block text-xs text-muted uppercase tracking-wide mb-2">Nome</label>
              <input
                type="text"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="Ex.: Marmita da vovó"
                autoFocus
 className="w-full bg-surface-2 border border-line rounded-md px-4 py-3 text-fg focus:outline-none"
              />
            </Card>

            <div>
 <label className="block text-xs text-muted uppercase tracking-wide mb-2">Refeição</label>
 <div className="grid grid-cols-2 gap-2">
                {(Object.entries(MEAL_TYPE_LABELS) as [MealType, string][]).map(([type, label]) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setManualMealType(type)}
 className={`py-2.5 rounded-md text-sm font-medium transition-colors ${
                      manualMealType === type ? 'bg-brand text-white' : 'bg-surface-2 text-muted hover:bg-surface-2'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
 <label className="block text-xs text-muted uppercase tracking-wide mb-2">Data</label>
              <input
                type="date"
                value={manualDate}
                max={todayLocalDate()}
                onChange={(e) => setManualDate(e.target.value)}
 className="w-full bg-surface-2 border border-line rounded-md px-4 py-3 text-fg focus:outline-none"
              />
            </div>

            <Card>
 <label className="block text-xs text-muted uppercase tracking-wide mb-2">Quantidade (gramas)</label>
              <input
                type="number"
                value={manualQuantity}
                min={1}
                step={1}
                onChange={(e) => setManualQuantity(e.target.value)}
 className="w-full bg-surface-2 border border-line rounded-md px-4 py-3 text-fg text-center text-2xl font-bold focus:outline-none transition-colors"
              />
            </Card>

            <Card>
 <label className="block text-xs text-muted uppercase tracking-wide mb-2">Calorias (kcal)</label>
              <input
                type="number"
                value={manualCalories}
                min={1}
                step={1}
                onChange={(e) => setManualCalories(e.target.value)}
 className="w-full bg-surface-2 border border-line rounded-md px-4 py-3 text-fg text-center text-2xl font-bold focus:outline-none transition-colors"
              />
            </Card>

            <Card>
 <p className="text-xs text-dim uppercase tracking-wide mb-3">Macros (opcional)</p>
 <div className="grid grid-cols-3 gap-2">
                <div>
 <label className="block text-xs text-dim mb-1">Proteína (g)</label>
                  <input
                    type="number"
                    value={manualProtein}
                    min={0}
                    step={1}
                    onChange={(e) => setManualProtein(e.target.value)}
 className="w-full bg-surface-2 border border-line rounded-lg px-2 py-2 text-fg text-center text-sm focus:outline-none"
                  />
                </div>
                <div>
 <label className="block text-xs text-dim mb-1">Carbs (g)</label>
                  <input
                    type="number"
                    value={manualCarbs}
                    min={0}
                    step={1}
                    onChange={(e) => setManualCarbs(e.target.value)}
 className="w-full bg-surface-2 border border-line rounded-lg px-2 py-2 text-fg text-center text-sm focus:outline-none"
                  />
                </div>
                <div>
 <label className="block text-xs text-dim mb-1">Gordura (g)</label>
                  <input
                    type="number"
                    value={manualFat}
                    min={0}
                    step={1}
                    onChange={(e) => setManualFat(e.target.value)}
 className="w-full bg-surface-2 border border-line rounded-lg px-2 py-2 text-fg text-center text-sm focus:outline-none"
                  />
                </div>
              </div>
            </Card>

 {submitError && <p className="text-xs text-danger">{submitError}</p>}

            <Button type="submit" fullWidth size="lg" disabled={!manualValid}>
              Registrar
            </Button>
          </form>
        )}
      </div>
    </>
  );
}
