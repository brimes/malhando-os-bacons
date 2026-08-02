import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNutritionStore } from '../stores/useNutritionStore';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { getErrorMessage } from '../api/client';
import { isNetworkOnline } from '../lib/offline';
import { todayLocalDate } from '../lib/date';
import type { FoodItem, FoodLogHistoryEntry, MealType } from '../types';
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

/**
 * Favorites first, most recently used first; then the rest of the history by
 * how often it was logged in the last 90 days, breaking ties by last use.
 * Mirrors the backend's own ordering (GetLogHistory) so a local favorite
 * toggle — which never triggers a refetch — still lands the row in the right
 * place instead of wherever it happened to sit in the array before.
 */
function sortHistory(entries: FoodLogHistoryEntry[]): FoodLogHistoryEntry[] {
  const lastUsedEpoch = (entry: FoodLogHistoryEntry) => {
    if (entry.last_logged_at) return new Date(entry.last_logged_at).getTime();
    // No log left for this group_key: a favorite with nothing to sort by
    // yet goes to the top of the favorites block (it was just touched), a
    // non-favorite with nothing to sort by falls to the very back.
    return entry.favorite_id ? Infinity : -Infinity;
  };
  return [...entries].sort((a, b) => {
    const aFav = Boolean(a.favorite_id);
    const bFav = Boolean(b.favorite_id);
    if (aFav !== bFav) return aFav ? -1 : 1;
    if (!aFav && a.times_logged !== b.times_logged) return b.times_logged - a.times_logged;
    return lastUsedEpoch(b) - lastUsedEpoch(a);
  });
}

function EmptyNote({ text }: { text: string }) {
  return <p className="px-1 py-2 text-sm text-zinc-600">{text}</p>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
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
        <p className="truncate text-sm font-medium text-white">{entry.food_name}</p>
        <p className="text-xs text-zinc-500">
          {entry.quantity_g}g · {MEAL_TYPE_LABELS[entry.meal_type]} · {Math.round(entry.calories)} kcal
        </p>
      </button>
      <button
        type="button"
        onClick={onToggleFavorite}
        disabled={isTogglingFavorite}
        aria-label={favorited ? `Desfavoritar ${entry.food_name}` : `Favoritar ${entry.food_name}`}
        className={`shrink-0 p-1.5 text-xl leading-none disabled:opacity-50 ${
          favorited ? 'text-amber-400' : 'text-zinc-600'
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
        <p className="text-sm font-medium text-white">
          {food.name} {food.brand && <span className="text-zinc-500">· {food.brand}</span>}
        </p>
        <p className="text-xs text-zinc-500">
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
    clearSearch,
    logFood,
    isLoading,
    logHistory,
    isLoadingHistory,
    fetchLogHistory,
    toggleFavorite,
  } = useNutritionStore();

  const [query, setQuery] = useState('');
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  const [selection, setSelection] = useState<Selection | null>(null);
  const [manualMode, setManualMode] = useState(false);
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
      searchTimeout.current = setTimeout(() => searchFoods(query.trim()), 400);
    } else {
      clearSearch();
    }
  }, [query, searchFoods, clearSearch]);

  const sortedHistory = useMemo(() => sortHistory(logHistory), [logHistory]);
  const favorites = useMemo(() => sortedHistory.filter((e) => e.favorite_id), [sortedHistory]);
  const rest = useMemo(() => sortedHistory.filter((e) => !e.favorite_id), [sortedHistory]);

  const trimmedQuery = query.trim();
  const isSearchingQuery = trimmedQuery.length > 0;
  const normalizedQuery = trimmedQuery.toLowerCase();
  const matchingHistory = useMemo(
    () => sortedHistory.filter((e) => e.food_name.toLowerCase().includes(normalizedQuery)),
    [sortedHistory, normalizedQuery]
  );

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
      if (selection.foodItemId) {
        await logFood({
          food_item_id: selection.foodItemId,
          meal_type: mealType,
          quantity_g: Number(quantity),
          date,
        });
      } else {
        await logFood({
          food_name: selection.name,
          meal_type: mealType,
          quantity_g: Number(quantity),
          date,
          origin: 'manual',
          calories: computedMacros.calories,
          protein_g: computedMacros.protein,
          carbs_g: computedMacros.carbs,
          fat_g: computedMacros.fat,
        });
      }
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
      await logFood({
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

  const showList = !selection && !manualMode;

  return (
    <>
      <Header title="Registrar Alimento" showBack />
      <div className="px-4 py-4 pb-24 space-y-4">
        {showList && (
          <>
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar alimento..."
                autoFocus
                className="w-full bg-zinc-900 border border-zinc-700 rounded-2xl px-4 py-3.5 text-white placeholder-zinc-500 focus:outline-none focus:border-primary-500 transition-colors"
              />
              {isSearching && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={openManual}
              className="w-full rounded-2xl border border-dashed border-zinc-700 px-4 py-3 text-center text-sm font-semibold text-primary-400"
            >
              + Criar do zero
            </button>

            {favoriteError && <p className="text-xs text-red-400">{favoriteError}</p>}

            {isLoadingHistory && logHistory.length === 0 && (
              <div className="flex justify-center py-4">
                <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
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
            <button type="button" onClick={backToList} className="text-xs text-zinc-500">
              ‹ Voltar à lista
            </button>

            <Card>
              <p className="text-sm font-semibold text-white">{selection.name}</p>
            </Card>

            <div>
              <label className="block text-xs text-zinc-400 uppercase tracking-wide mb-2">Refeição</label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.entries(MEAL_TYPE_LABELS) as [MealType, string][]).map(([type, label]) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setMealType(type)}
                    className={`py-2.5 rounded-xl text-sm font-medium transition-colors ${
                      mealType === type ? 'bg-primary-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-zinc-400 uppercase tracking-wide mb-2">Data</label>
              <input
                type="date"
                value={date}
                max={todayLocalDate()}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary-500"
              />
            </div>

            <Card>
              {selection.servingGrams && (
                <div className="mb-3 grid grid-cols-2 rounded-xl bg-zinc-950 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setUseServing(true);
                      setQuantity(String(selection.servingGrams));
                    }}
                    className={`rounded-lg py-2 text-xs font-semibold ${useServing ? 'bg-primary-600 text-white' : 'text-zinc-500'}`}
                  >
                    {selection.servingLabel || 'Porção'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setUseServing(false)}
                    className={`rounded-lg py-2 text-xs font-semibold ${!useServing ? 'bg-primary-600 text-white' : 'text-zinc-500'}`}
                  >
                    Gramas
                  </button>
                </div>
              )}
              <label className="block text-xs text-zinc-400 uppercase tracking-wide mb-2">
                {useServing ? `Quantidade (${selection.servingLabel || 'porções'})` : 'Quantidade (gramas)'}
              </label>
              <input
                type="number"
                value={quantity}
                min={1}
                step={1}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-center text-2xl font-bold focus:outline-none focus:border-primary-500 transition-colors"
              />
            </Card>

            {computedMacros && (
              <Card>
                <p className="text-xs text-zinc-500 uppercase tracking-wide mb-3">Valores nutricionais</p>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div>
                    <p className="text-lg font-bold text-primary-400">{Math.round(computedMacros.calories)}</p>
                    <p className="text-xs text-zinc-500">kcal</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-blue-400">{Math.round(computedMacros.protein)}g</p>
                    <p className="text-xs text-zinc-500">proteína</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-amber-400">{Math.round(computedMacros.carbs)}g</p>
                    <p className="text-xs text-zinc-500">carbs</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-red-400">{Math.round(computedMacros.fat)}g</p>
                    <p className="text-xs text-zinc-500">gordura</p>
                  </div>
                </div>
              </Card>
            )}

            {submitError && <p className="text-xs text-red-400">{submitError}</p>}

            <Button type="submit" fullWidth size="lg" isLoading={isLoading} disabled={!(Number(quantity) > 0)}>
              Registrar Alimento
            </Button>
          </form>
        )}

        {manualMode && (
          <form onSubmit={handleManualSubmit} className="space-y-4">
            <button type="button" onClick={backToList} className="text-xs text-zinc-500">
              ‹ Voltar à lista
            </button>

            <Card>
              <label className="block text-xs text-zinc-400 uppercase tracking-wide mb-2">Nome</label>
              <input
                type="text"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="Ex.: Marmita da vovó"
                autoFocus
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary-500"
              />
            </Card>

            <div>
              <label className="block text-xs text-zinc-400 uppercase tracking-wide mb-2">Refeição</label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.entries(MEAL_TYPE_LABELS) as [MealType, string][]).map(([type, label]) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setManualMealType(type)}
                    className={`py-2.5 rounded-xl text-sm font-medium transition-colors ${
                      manualMealType === type ? 'bg-primary-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-zinc-400 uppercase tracking-wide mb-2">Data</label>
              <input
                type="date"
                value={manualDate}
                max={todayLocalDate()}
                onChange={(e) => setManualDate(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary-500"
              />
            </div>

            <Card>
              <label className="block text-xs text-zinc-400 uppercase tracking-wide mb-2">Quantidade (gramas)</label>
              <input
                type="number"
                value={manualQuantity}
                min={1}
                step={1}
                onChange={(e) => setManualQuantity(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-center text-2xl font-bold focus:outline-none focus:border-primary-500 transition-colors"
              />
            </Card>

            <Card>
              <label className="block text-xs text-zinc-400 uppercase tracking-wide mb-2">Calorias (kcal)</label>
              <input
                type="number"
                value={manualCalories}
                min={1}
                step={1}
                onChange={(e) => setManualCalories(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-center text-2xl font-bold focus:outline-none focus:border-primary-500 transition-colors"
              />
            </Card>

            <Card>
              <p className="text-xs text-zinc-500 uppercase tracking-wide mb-3">Macros (opcional)</p>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-1">Proteína (g)</label>
                  <input
                    type="number"
                    value={manualProtein}
                    min={0}
                    step={1}
                    onChange={(e) => setManualProtein(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-2 text-white text-center text-sm focus:outline-none focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-1">Carbs (g)</label>
                  <input
                    type="number"
                    value={manualCarbs}
                    min={0}
                    step={1}
                    onChange={(e) => setManualCarbs(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-2 text-white text-center text-sm focus:outline-none focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-500 mb-1">Gordura (g)</label>
                  <input
                    type="number"
                    value={manualFat}
                    min={0}
                    step={1}
                    onChange={(e) => setManualFat(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-2 text-white text-center text-sm focus:outline-none focus:border-primary-500"
                  />
                </div>
              </div>
            </Card>

            {submitError && <p className="text-xs text-red-400">{submitError}</p>}

            <Button type="submit" fullWidth size="lg" isLoading={isLoading} disabled={!manualValid}>
              Registrar
            </Button>
          </form>
        )}
      </div>
    </>
  );
}
