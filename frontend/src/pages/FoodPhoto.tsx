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
import { Chip } from '../components/Chip';
import { CountUp } from '../components/CountUp';
import { SkeletonBlock } from '../components/nutricao/States';
import { TrashIcon } from '../components/nutricao/icons';
import { MEAL_TYPE_LABELS } from '../types';
import type { LabelAnalysis, MealType, PlateAnalysisItem } from '../types';

const CONFIDENCE_LABEL: Record<string, string> = { high: 'Alta confiança', medium: 'Confiança média', low: 'Baixa confiança, confira com atenção' };

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

  const num = 'mt-1 h-12 w-full min-w-0 rounded-sm border-2 border-transparent bg-surface-2 px-1 text-center font-sans text-base font-semibold focus:border-brand-fg focus:outline-none';
  const text = 'mt-2 h-[52px] w-full rounded-md border-2 border-transparent bg-surface-2 px-4 text-base font-normal text-fg focus:border-brand-fg focus:outline-none';
  const mealPicker = (
    <div className="grid grid-cols-4 gap-1 rounded-md bg-surface-2 p-1" role="tablist" aria-label="Refeição">
      {(Object.entries(MEAL_TYPE_LABELS) as [MealType, string][]).map(([type, mealLabel]) => (
        <button key={type} type="button" role="tab" aria-selected={mealType === type} onClick={() => setMealType(type)}
          className={`press min-h-[48px] rounded-sm px-1 text-[13px] font-semibold ${mealType === type ? 'bg-teal text-on-teal' : 'text-muted'}`}>
          {mealLabel}
        </button>
      ))}
    </div>
  );
  const totalKcal = (plateItems ?? []).reduce((a, it) => a + (Number(it.calories) || 0), 0);
  const tips = isPlate
    ? ['Fotografe de frente, com boa luz', 'A IA estima alimentos e porções', 'Confira os números antes de registrar']
    : ['Chegue perto da tabela nutricional', 'Deixe o texto legível e sem reflexo', 'Confira os valores antes de salvar'];

  return (
    <>
      <Header title={title} showBack />
      <div className="space-y-[14px] px-5 pb-24 pt-2">
        {!hasAnalysis && !isUploading && (
          <>
            <div className="enter">
              <FoodPhotoCapture
                label={isPlate ? 'Fotografar prato' : 'Fotografar rótulo'}
                hint={isPlate ? 'Enquadre o prato inteiro' : 'Enquadre a tabela nutricional'}
                onCapture={handleCapture}
                disabled={isUploading}
              />
            </div>
            <ol className="enter space-y-2 pt-2" style={{ '--i': 1 } as React.CSSProperties}>
              {tips.map((t, i) => (
                <li key={t} className="flex min-h-[48px] items-center gap-3 text-[15px] text-muted">
                  <span className="num flex h-8 w-8 shrink-0 items-center justify-center rounded-chip bg-teal-soft text-[18px] text-teal">{i + 1}</span>
                  {t}
                </li>
              ))}
            </ol>
          </>
        )}

        {isUploading && (
          <Card tint="teal" className="space-y-4" >
            <p className="num text-[28px] leading-[1.05] text-teal animate-pulse">Analisando a foto</p>
            <SkeletonBlock className="h-14 w-full" />
            <SkeletonBlock className="h-14 w-full" />
            <SkeletonBlock className="h-14 w-2/3" />
          </Card>
        )}

        {error && <div role="alert" className="rounded-md bg-danger/15 p-3 text-[15px] text-danger">{error}</div>}

        {isPlate && plateItems && (
          <>
            <Card tint={confidence === 'low' ? 'sun' : 'teal'} className="enter">
              <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Total estimado</p>
              <p className="num text-[44px] leading-none text-teal"><CountUp value={Math.round(totalKcal)} /><span className="font-sans text-[15px] font-medium text-muted"> kcal</span></p>
              {confidence && <div className="mt-3"><Chip tone={confidence === 'low' ? 'sun' : 'teal'}>{CONFIDENCE_LABEL[confidence] ?? confidence}</Chip></div>}
              {caveat && <p className="mt-3 text-[15px] leading-[1.45] text-muted">{caveat}</p>}
            </Card>

            {mealPicker}

            {plateItems.length === 0 && (
              <p className="py-6 text-center text-[15px] text-muted">Todos os itens foram removidos. Tire outra foto para recomeçar.</p>
            )}

            <div className="space-y-[14px]">
              {plateItems.map((item, index) => (
                <Card key={index} className="enter space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={item.food_name}
                      aria-label="Nome do alimento"
                      onChange={(e) => updatePlateItem(index, 'food_name', e.target.value)}
                      className="h-12 min-w-0 flex-1 rounded-sm border-2 border-transparent bg-surface-2 px-3 text-base font-semibold text-fg focus:border-brand-fg focus:outline-none"
                    />
                    <button type="button" onClick={() => removePlateItem(index)} aria-label={`Remover ${item.food_name}`} className="press flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-danger"><TrashIcon /></button>
                  </div>
                  {([[['g', 'estimated_grams', 'text-muted'], ['kcal', 'calories', 'text-teal']], [['P', 'protein_g', 'text-violet'], ['C', 'carbs_g', 'text-sun'], ['G', 'fat_g', 'text-brand-fg']]] as const).map((row, ri) => (
                    <div key={ri} className={`grid gap-2 text-center ${ri === 0 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                      {row.map(([l, f, c]) => (
                        <label key={f} className={`block text-[13px] font-semibold ${c}`}>{l}
                          <input type="number" inputMode="decimal" value={item[f]} onChange={(e) => updatePlateItem(index, f, e.target.value)} className={`${num} ${c}`} />
                        </label>
                      ))}
                    </div>
                  ))}
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
            <Card tint="teal" className="enter space-y-4">
              <label className="block text-[15px] font-semibold text-fg">Nome
                <input value={label.name} onChange={(e) => setLabel({ ...label, name: e.target.value })} className={text} />
              </label>
              <label className="block text-[15px] font-semibold text-fg">Marca
                <input value={label.brand} onChange={(e) => setLabel({ ...label, brand: e.target.value })} className={text} />
              </label>
              <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Por 100 g</p>
              <div className="grid grid-cols-4 gap-2 text-center">
                {([
                  ['kcal', 'calories_per_100g', 'text-teal'], ['P', 'protein_g', 'text-violet'], ['C', 'carbs_g', 'text-sun'], ['G', 'fat_g', 'text-brand-fg'],
                ] as const).map(([l, f, c]) => (
                  <label key={f} className={`block text-[13px] font-semibold ${c}`}>{l}
                    <input type="number" inputMode="decimal" value={label[f]} onChange={(e) => setLabel({ ...label, [f]: Number(e.target.value) })} className={`${num} ${c}`} />
                  </label>
                ))}
              </div>
            </Card>

            <Card className="space-y-4">
              <label className="flex min-h-[48px] items-center gap-3 text-base text-fg">
                <input type="checkbox" checked={logAfterSaving} onChange={(e) => setLogAfterSaving(e.target.checked)} className="h-6 w-6 accent-[rgb(var(--teal))]" />
                Registrar no diário agora também
              </label>
              {logAfterSaving && (
                <>
                  {mealPicker}
                  <label className="block text-[15px] font-semibold text-fg">Quantidade (g)
                    <input type="number" inputMode="decimal" value={servingQuantity} onChange={(e) => setServingQuantity(e.target.value)} className={`${text} text-center font-semibold`} />
                  </label>
                </>
              )}
            </Card>

            <Button fullWidth size="lg" isLoading={isSaving} onClick={submitLabel}>Salvar alimento</Button>
          </>
        )}
      </div>
    </>
  );
}
