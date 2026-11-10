import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { FoodPhotoCapture } from '../components/FoodPhotoCapture';
import { nutritionApi } from '../api/nutrition';
import { useNutritionStore } from '../stores/useNutritionStore';
import { createFoodLog } from '../lib/local/repo/foodLogs';
import { todayLocalDate } from '../lib/date';
import { getErrorMessage } from '../api/client';
import { MEAL_TYPE_LABELS } from '../types';
import type { LabelAnalysis, MealType, PlateAnalysisItem } from '../types';

const CONFIDENCE_LABEL: Record<string, string> = { high: 'Alta confiança', medium: 'Confiança média', low: 'Baixa confiança — confira com atenção' };

export function FoodPhotoPage() {
  const { kind } = useParams<{ kind: 'plate' | 'label' }>();
  const navigate = useNavigate();
  const { createFood } = useNutritionStore();

  const [photoId, setPhotoId] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mealType, setMealType] = useState<MealType>('lunch');

  // Plate: a photo can hold several foods, each reviewed and logged separately.
  const [plateItems, setPlateItems] = useState<PlateAnalysisItem[] | null>(null);
  const [confidence, setConfidence] = useState<string | null>(null);
  const [caveat, setCaveat] = useState<string | null>(null);

  // Label: a single food, saved as personal and optionally logged right away.
  const [label, setLabel] = useState<LabelAnalysis | null>(null);
  const [logAfterSaving, setLogAfterSaving] = useState(true);
  const [servingQuantity, setServingQuantity] = useState('100');

  const isPlate = kind === 'plate';
  const title = isPlate ? 'Foto do prato' : 'Foto do rótulo';

  const handleCapture = async (file: Blob) => {
    setIsUploading(true);
    setError(null);
    try {
      if (isPlate) {
        const result = await nutritionApi.uploadPlatePhoto(file);
        setPhotoId(result.photo_id);
        setPlateItems(result.analysis.items);
        setConfidence(result.analysis.confidence);
        setCaveat(result.analysis.caveat);
      } else {
        const result = await nutritionApi.uploadLabelPhoto(file);
        setPhotoId(result.photo_id);
        setLabel(result.analysis);
        setServingQuantity(String(result.analysis.serving_grams || 100));
      }
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsUploading(false);
    }
  };

  const updatePlateItem = (index: number, field: keyof PlateAnalysisItem, value: string) => {
    setPlateItems((current) => current?.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      if (field === 'food_name') return { ...item, food_name: value };
      return { ...item, [field]: Number(value) };
    }) ?? null);
  };

  const removePlateItem = (index: number) => {
    setPlateItems((current) => current?.filter((_, itemIndex) => itemIndex !== index) ?? null);
  };

  const submitPlate = async () => {
    if (!plateItems || plateItems.length === 0) return;
    setIsSaving(true);
    setError(null);
    try {
      for (const item of plateItems) {
        // Grava local antes de subir, como o resto da nutrição: sem isso o
        // registro só existiria no servidor e o diário — que lê do aparelho —
        // não o mostraria até um pull, obrigando a fechar e reabrir o app.
        await createFoodLog({
          food_name: item.food_name,
          quantity_g: item.estimated_grams,
          meal_type: mealType,
          origin: 'photo_plate',
          photo_id: photoId ?? undefined,
          calories: item.calories,
          protein_g: item.protein_g,
          carbs_g: item.carbs_g,
          fat_g: item.fat_g,
          date: todayLocalDate(),
        });
      }
      navigate('/nutrition');
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  };

  const submitLabel = async () => {
    if (!label) return;
    setIsSaving(true);
    setError(null);
    try {
      const food = await createFood({
        name: label.name,
        brand: label.brand,
        calories_per_100g: label.calories_per_100g,
        protein_g: label.protein_g,
        carbs_g: label.carbs_g,
        fat_g: label.fat_g,
        fiber_g: label.fiber_g,
        sodium_mg: label.sodium_mg,
        serving_label: label.serving_label,
        serving_grams: label.serving_grams,
        photo_id: photoId ?? undefined,
      });
      if (logAfterSaving) {
        const quantity = Number(servingQuantity) || label.serving_grams || 100;
        // O servidor recalcula os macros a partir do food_item_id e ignora o
        // que vai aqui; estes valores só seguram a tela até a criação
        // sincronizar e a linha do servidor sobrescrever a otimista.
        const ratio = quantity / 100;
        await createFoodLog({
          food_item_id: food.id,
          food_name: label.name,
          quantity_g: quantity,
          meal_type: mealType,
          origin: 'photo_label',
          photo_id: photoId ?? undefined,
          calories: (label.calories_per_100g ?? 0) * ratio,
          protein_g: (label.protein_g ?? 0) * ratio,
          carbs_g: (label.carbs_g ?? 0) * ratio,
          fat_g: (label.fat_g ?? 0) * ratio,
          date: todayLocalDate(),
        });
      }
      navigate('/nutrition');
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  };

  const hasAnalysis = isPlate ? Boolean(plateItems) : Boolean(label);

  return (
    <>
      <Header title={title} showBack />
 <div className="space-y-4 px-4 py-4 pb-24">
        {!hasAnalysis && (
          <>
 <Card className="border-brand bg-brand-soft">
 <p className="text-sm text-brand-fg">
                {isPlate
                  ? 'Fotografe o prato de frente, com boa luz. A IA estima os alimentos e as porções — confira antes de registrar.'
                  : 'Fotografe a tabela de informação nutricional do rótulo, bem próxima e legível.'}
              </p>
            </Card>
            <FoodPhotoCapture
              label={isPlate ? 'Fotografar prato' : 'Fotografar rótulo'}
              onCapture={handleCapture}
              disabled={isUploading}
            />
            {isUploading && (
 <p className="text-center text-sm text-dim">
 <span className="animate-pulse">Analisando a foto...</span>
              </p>
            )}
          </>
        )}

 {error && <div className="rounded-md bg-danger-soft p-3 text-sm text-danger">{error}</div>}

        {isPlate && plateItems && (
          <>
            {confidence && (
 <Card className={confidence === 'low' ? ' bg-sun-soft' : ''}>
 <p className="text-sm font-semibold text-fg">{CONFIDENCE_LABEL[confidence] ?? confidence}</p>
 {caveat && <p className="mt-1 text-xs leading-relaxed text-muted">{caveat}</p>}
              </Card>
            )}

            <div>
 <label className="block text-xs uppercase tracking-wide text-muted mb-2">Refeição</label>
 <div className="grid grid-cols-2 gap-2">
                {(Object.entries(MEAL_TYPE_LABELS) as [MealType, string][]).map(([type, mealLabel]) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setMealType(type)}
 className={`py-2.5 rounded-md text-sm font-medium transition-colors ${mealType === type ? 'bg-brand text-white' : 'bg-surface-2 text-muted'}`}
                  >
                    {mealLabel}
                  </button>
                ))}
              </div>
            </div>

 <div className="space-y-3">
              {plateItems.map((item, index) => (
 <Card key={index} className="space-y-2">
 <div className="flex items-center gap-2">
                    <input
                      value={item.food_name}
                      onChange={(e) => updatePlateItem(index, 'food_name', e.target.value)}
 className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg"
                    />
 <button type="button" onClick={() => removePlateItem(index)} className="text-xs text-danger">Remover</button>
                  </div>
 <div className="grid grid-cols-5 gap-2 text-center">
 <label className="text-xs text-dim">g
 <input type="number" value={item.estimated_grams} onChange={(e) => updatePlateItem(index, 'estimated_grams', e.target.value)} className="mt-1 w-full rounded-lg bg-surface px-1 py-1.5 text-sm text-fg" />
                    </label>
 <label className="text-xs text-dim">kcal
 <input type="number" value={item.calories} onChange={(e) => updatePlateItem(index, 'calories', e.target.value)} className="mt-1 w-full rounded-lg bg-surface px-1 py-1.5 text-sm text-brand-fg" />
                    </label>
 <label className="text-xs text-dim">P
 <input type="number" value={item.protein_g} onChange={(e) => updatePlateItem(index, 'protein_g', e.target.value)} className="mt-1 w-full rounded-lg bg-surface px-1 py-1.5 text-sm text-teal" />
                    </label>
 <label className="text-xs text-dim">C
 <input type="number" value={item.carbs_g} onChange={(e) => updatePlateItem(index, 'carbs_g', e.target.value)} className="mt-1 w-full rounded-lg bg-surface px-1 py-1.5 text-sm text-sun" />
                    </label>
 <label className="text-xs text-dim">G
 <input type="number" value={item.fat_g} onChange={(e) => updatePlateItem(index, 'fat_g', e.target.value)} className="mt-1 w-full rounded-lg bg-surface px-1 py-1.5 text-sm text-danger" />
                    </label>
                  </div>
                </Card>
              ))}
            </div>

            <Button fullWidth size="lg" isLoading={isSaving} onClick={submitPlate} disabled={plateItems.length === 0}>
              Registrar {plateItems.length} {plateItems.length === 1 ? 'item' : 'itens'}
            </Button>
          </>
        )}

        {!isPlate && label && (
          <>
 <Card className="space-y-3">
 <label className="block text-sm text-fg">Nome
 <input value={label.name} onChange={(e) => setLabel({ ...label, name: e.target.value })} className="mt-1.5 w-full rounded-md border border-line bg-surface-2 px-3 py-2.5 text-fg" />
              </label>
 <label className="block text-sm text-fg">Marca
 <input value={label.brand} onChange={(e) => setLabel({ ...label, brand: e.target.value })} className="mt-1.5 w-full rounded-md border border-line bg-surface-2 px-3 py-2.5 text-fg" />
              </label>
 <p className="text-xs uppercase tracking-wide text-dim">Por 100g</p>
 <div className="grid grid-cols-4 gap-2 text-center">
 <label className="text-xs text-dim">kcal
 <input type="number" value={label.calories_per_100g} onChange={(e) => setLabel({ ...label, calories_per_100g: Number(e.target.value) })} className="mt-1 w-full rounded-lg bg-surface px-1 py-1.5 text-sm text-brand-fg" />
                </label>
 <label className="text-xs text-dim">P
 <input type="number" value={label.protein_g} onChange={(e) => setLabel({ ...label, protein_g: Number(e.target.value) })} className="mt-1 w-full rounded-lg bg-surface px-1 py-1.5 text-sm text-teal" />
                </label>
 <label className="text-xs text-dim">C
 <input type="number" value={label.carbs_g} onChange={(e) => setLabel({ ...label, carbs_g: Number(e.target.value) })} className="mt-1 w-full rounded-lg bg-surface px-1 py-1.5 text-sm text-sun" />
                </label>
 <label className="text-xs text-dim">G
 <input type="number" value={label.fat_g} onChange={(e) => setLabel({ ...label, fat_g: Number(e.target.value) })} className="mt-1 w-full rounded-lg bg-surface px-1 py-1.5 text-sm text-danger" />
                </label>
              </div>
            </Card>

 <Card className="space-y-3">
 <label className="flex items-center gap-2 text-sm text-fg">
                <input type="checkbox" checked={logAfterSaving} onChange={(e) => setLogAfterSaving(e.target.checked)} />
                Registrar no diário agora também
              </label>
              {logAfterSaving && (
                <>
 <div className="grid grid-cols-2 gap-2">
                    {(Object.entries(MEAL_TYPE_LABELS) as [MealType, string][]).map(([type, mealLabel]) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setMealType(type)}
 className={`py-2.5 rounded-md text-sm font-medium transition-colors ${mealType === type ? 'bg-brand text-white' : 'bg-surface-2 text-muted'}`}
                      >
                        {mealLabel}
                      </button>
                    ))}
                  </div>
 <label className="block text-xs text-muted">Quantidade (g)
 <input type="number" value={servingQuantity} onChange={(e) => setServingQuantity(e.target.value)} className="mt-1.5 w-full rounded-md border border-line bg-surface-2 px-3 py-2.5 text-center text-fg" />
                  </label>
                </>
              )}
            </Card>

            <Button fullWidth size="lg" isLoading={isSaving} onClick={submitLabel}>
              Salvar alimento
            </Button>
          </>
        )}
      </div>
    </>
  );
}
