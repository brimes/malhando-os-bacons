import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNutritionStore } from '../stores/useNutritionStore';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import type { FoodItem, MealType } from '../types';
import { MEAL_TYPE_LABELS } from '../types';

export function FoodLogPage() {
  const navigate = useNavigate();
  const { searchFoods, searchResults, isSearching, logFood, isLoading } = useNutritionStore();

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<FoodItem | null>(null);
  const [useServing, setUseServing] = useState(false);
  const [quantity, setQuantity] = useState('100');
  const [mealType, setMealType] = useState<MealType>('lunch');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(searchTimeout.current);
    // Re-searching after a selection needs to work too — clearing `selected`
    // whenever the query is edited by hand is what lets the dropdown come
    // back instead of staying hidden until the field is cleared outright.
    if (query.length >= 2) {
      searchTimeout.current = setTimeout(() => searchFoods(query), 400);
    }
  }, [query, searchFoods]);

  const handleSelect = (food: FoodItem) => {
    setSelected(food);
    setQuery(food.name);
    setUseServing(Boolean(food.serving_grams));
    setQuantity(food.serving_grams ? String(food.serving_grams) : '100');
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (selected) setSelected(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;

    await logFood({
      food_item_id: selected.id,
      meal_type: mealType,
      quantity_g: Number(quantity),
      date,
    });
    navigate('/nutrition');
  };

  const computedMacros = selected
    ? {
        calories: (selected.calories_per_100g * Number(quantity)) / 100,
        protein: (selected.protein_g * Number(quantity)) / 100,
        carbs: (selected.carbs_g * Number(quantity)) / 100,
        fat: (selected.fat_g * Number(quantity)) / 100,
      }
    : null;

  return (
    <>
      <Header title="Registrar Alimento" showBack />
      <form onSubmit={handleSubmit} className="px-4 py-4 pb-24 space-y-4">
        {/* Search */}
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Buscar alimento..."
            autoFocus
            className="w-full bg-zinc-900 border border-zinc-700 rounded-2xl px-4 py-3.5 text-white placeholder-zinc-500 focus:outline-none focus:border-primary-500 transition-colors"
          />
          {isSearching && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* Results dropdown */}
          {searchResults.length > 0 && !selected && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-2xl overflow-hidden z-50 shadow-xl">
              {searchResults.map((food) => (
                <button
                  key={food.id}
                  type="button"
                  onClick={() => handleSelect(food)}
                  className="w-full px-4 py-3 text-left hover:bg-zinc-800 transition-colors border-b border-zinc-800 last:border-0"
                >
                  <p className="text-sm font-medium text-white">
                    {food.name} {food.brand && <span className="text-zinc-500">· {food.brand}</span>}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {food.calories_per_100g} kcal/100g · P:{food.protein_g}g C:{food.carbs_g}g G:{food.fat_g}g
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        {selected && (
          <>
            {/* Meal type */}
            <div>
              <label className="block text-xs text-zinc-400 uppercase tracking-wide mb-2">Refeição</label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.entries(MEAL_TYPE_LABELS) as [MealType, string][]).map(([type, label]) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setMealType(type)}
                    className={`py-2.5 rounded-xl text-sm font-medium transition-colors ${
                      mealType === type
                        ? 'bg-primary-600 text-white'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
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
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary-500"
              />
            </div>

            {/* Quantity */}
            <Card>
              {selected.serving_grams && (
                <div className="mb-3 grid grid-cols-2 rounded-xl bg-zinc-950 p-1">
                  <button
                    type="button"
                    onClick={() => { setUseServing(true); setQuantity(String(selected.serving_grams)); }}
                    className={`rounded-lg py-2 text-xs font-semibold ${useServing ? 'bg-primary-600 text-white' : 'text-zinc-500'}`}
                  >
                    {selected.serving_label || 'Porção'}
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
                {useServing ? `Quantidade (${selected.serving_label || 'porções'})` : 'Quantidade (gramas)'}
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

            {/* Computed macros preview */}
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

            <Button type="submit" fullWidth size="lg" isLoading={isLoading}>
              Registrar Alimento
            </Button>
          </>
        )}
      </form>
    </>
  );
}
