import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { KcalHero } from '../components/nutricao/KcalHero';
import { MealCard } from '../components/nutricao/MealCard';
import { EmptyState, SectionTitle } from '../components/nutricao/States';
import { CalendarIcon, ChevronIcon, FlameIcon, LeafIcon, PlateIcon, PlusIcon, TagIcon } from '../components/nutricao/icons';
import { EditFoodLogModal } from '../components/EditFoodLogModal';
import { FoodLogAssistant } from '../components/FoodLogAssistant';
import { RoutinePreviewModal } from '../components/RoutinePreviewModal';
import { todayLocalDate } from '../lib/date';
import { dateKey, createFoodLog, deleteFoodLog, foodLogsCache, updateFoodLog } from '../lib/local/repo/foodLogs';
import { nutritionPlansCache } from '../lib/local/repo/nutritionPlans';
import { useLocalAll } from '../lib/local/useLocal';
import { dismissRoutineDay, useOfflineStore } from '../lib/offline';
import { useNutritionStore } from '../stores/useNutritionStore';
import {
  MEAL_TYPE_LABELS,
  type FoodLog,
  type MealType,
  type NutritionLogDraftEntry,
  type NutritionRoutineMeal,
  type UpdateFoodLogInput,
} from '../types';

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/** "18/09" — o mesmo formato usado pelo resto da tela de nutrição para uma data solta. */
function formatDayLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function NutritionPage() {
  const navigate = useNavigate();
  const [editingLog, setEditingLog] = useState<FoodLog | null>(null);
  // Which meal's planned-menu modal is open, if any. The menu itself comes
  // straight from `activePlan.meals` — already loaded with the plan — so
  // opening this never touches the backend.
  const [menuMeal, setMenuMeal] = useState<MealType | null>(null);

  // "Dia normal" (rotina destilada) e "dias esquecidos": contas
  // determinísticas do servidor, cacheáveis como qualquer GET — ver
  // useNutritionStore.fetchRoutine/fetchMissingDays.
  const { routine, missingDays, fetchRoutine, fetchMissingDays, removeMissingDay } = useNutritionStore();
  useEffect(() => {
    fetchRoutine();
    fetchMissingDays();
  }, [fetchRoutine, fetchMissingDays]);

  // Dispensas de "dia esquecido" ("não foi um dia normal") vivem só neste
  // aparelho — sem tabela nova, ver offlineStore.ts.
  const dismissedDays = useOfflineStore((state) => state.dismissedRoutineDays ?? []);
  const visibleMissingDays = useMemo(
    () => (Array.isArray(missingDays) ? missingDays : []).filter((date) => !dismissedDays.includes(date)),
    [missingDays, dismissedDays]
  );

  // Pré-visualização do dia normal (hoje ou um dia esquecido) antes de virar
  // registro — mesmo modal para os dois, só a data/rótulo mudam.
  const [preview, setPreview] = useState<{ date: string; label: string } | null>(null);

  // "Extrapolei hoje": abre o assistente de conversa já existente para
  // descrever só o excesso; ao terminar, oferece (nunca cria sozinha) o
  // treino de compensação do dia do lixo.
  const [excessMode, setExcessMode] = useState(false);
  const [compensationOffer, setCompensationOffer] = useState<string | null>(null);

  // Local-first: both come straight from IndexedDB (loaded during boot — see
  // `offlineBoot.ts`) and re-render on their own the moment a write, a pull
  // or the outbox change them. No `isLoading`, no network call on mount —
  // the screen never waits for one to have something to draw.
  const today = todayLocalDate();
  const allLogs = useLocalAll(foodLogsCache);
  const todayLogs = useMemo(() => (allLogs ?? []).filter((log) => dateKey(log.date) === today), [allLogs, today]);
  const plans = useLocalAll(nutritionPlansCache);
  const activePlan = useMemo(() => (plans ?? []).find((plan) => plan.active) ?? null, [plans]);

  const totals = todayLogs.reduce(
    (acc, log) => ({
      calories: acc.calories + log.calories,
      protein: acc.protein + log.protein_g,
      carbs: acc.carbs + log.carbs_g,
      fat: acc.fat + log.fat_g,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const byMeal = todayLogs.reduce<Record<string, FoodLog[]>>((acc, log) => {
    (acc[log.meal_type] ??= []).push(log);
    return acc;
  }, {});

  const logPlannedItem = async (mealType: MealType, item: { food_name: string; quantity_g: number; calories: number; protein_g: number; carbs_g: number; fat_g: number }) => {
    await createFoodLog({
      food_name: item.food_name,
      quantity_g: item.quantity_g,
      meal_type: mealType,
      origin: 'plan',
      calories: item.calories,
      protein_g: item.protein_g,
      carbs_g: item.carbs_g,
      fat_g: item.fat_g,
      // Without this the server falls back to its own time.Now() — offline,
      // that means whatever date the queue drains on, not the day the person
      // actually tapped "Já comi".
      date: today,
    });
  };

  const handleSaveEdit = async (id: number, input: UpdateFoodLogInput) => {
    await updateFoodLog(id, input);
  };

  // Grava um food_log por item, pelo caminho normal (createFoodLog): funciona
  // offline e entra na fila igual a qualquer registro. `origin: 'routine'`
  // marca que o número é a estimativa da rotina, não uma medição do dia.
  const logRoutineDay = async (date: string, meals: NutritionRoutineMeal[]) => {
    for (const meal of meals ?? []) {
      for (const item of meal.items ?? []) {
        await createFoodLog({
          food_item_id: item.food_item_id,
          food_name: item.food_name,
          quantity_g: item.quantity_g,
          meal_type: meal.meal_type,
          date,
          origin: 'routine',
          calories: item.calories,
          protein_g: item.protein_g,
          carbs_g: item.carbs_g,
          fat_g: item.fat_g,
        });
      }
    }
  };

  const confirmPreview = async (meals: NutritionRoutineMeal[]) => {
    if (!preview) return;
    await logRoutineDay(preview.date, meals);
    if (preview.date !== today) removeMissingDay(preview.date);
  };

  const openTodayPreview = () => setPreview({ date: today, label: 'hoje' });
  const openMissingDayPreview = (date: string) => setPreview({ date, label: formatDayLabel(date) });

  const dismissMissingDay = (date: string) => {
    dismissRoutineDay(date);
    removeMissingDay(date);
  };

  // "Extrapolei hoje": se o dia ainda estiver vazio, registra a rotina antes
  // de abrir a conversa — decisão do dono: oferecer a compensação, nunca
  // montá-la sozinha, então isso só acontece depois que a pessoa registrar o
  // excesso e escolher.
  const startExcessFlow = async () => {
    if (todayLogs.length === 0 && routine?.enough) {
      await logRoutineDay(today, routine.meals ?? []);
    }
    setExcessMode(true);
  };

  const registrarExcesso = async (entries: NutritionLogDraftEntry[], descricao: string) => {
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
    setExcessMode(false);
    setCompensationOffer(descricao.trim() || 'Exagerei hoje.');
  };

  const quickTile = 'press flex min-h-[72px] items-center gap-3 rounded-lg bg-surface px-4 text-left shadow-card';
  const missingList = routine && (routine.enough ? visibleMissingDays : missingDays);
  const showMissing = !!routine && Array.isArray(missingList) && missingList.length > 0;
  const sheetTitle = 'num text-[28px] leading-[1.05] text-fg';

  return (
    <>
      <Header
        title="Nutrição"
        rightAction={
          <Button size="md" onClick={() => navigate('/nutrition/log')}>
            <PlusIcon className="h-5 w-5" /> Registrar
          </Button>
        }
      />
      <div className="space-y-[14px] px-5 pb-24 pt-2">
        {/* Protagonista: anel de kcal e macros. */}
        <div className="enter" style={{ '--i': 0 } as React.CSSProperties}>
          {activePlan ? (
            <KcalHero
              calories={totals.calories}
              caloriesTarget={activePlan.calories_target}
              protein={totals.protein}
              proteinTarget={activePlan.protein_target}
              carbs={totals.carbs}
              carbsTarget={activePlan.carbs_target}
              fat={totals.fat}
              fatTarget={activePlan.fat_target}
              eyebrow={activePlan.name}
              actionLabel="Plano"
              onAction={() => navigate('/nutrition/plan')}
            />
          ) : (
            <>
              <KcalHero calories={totals.calories} protein={totals.protein} carbs={totals.carbs} fat={totals.fat} />
              <Card className="mt-[14px]">
                <EmptyState
                  icon={<LeafIcon />}
                  title="Você ainda não tem um plano"
                  text="Com um plano, o anel mostra quanto falta para a meta do dia."
                  actionLabel="Criar plano"
                  onAction={() => navigate('/nutrition/plan')}
                />
              </Card>
            </>
          )}
        </div>

        <div className="enter grid grid-cols-2 gap-3" style={{ '--i': 1 } as React.CSSProperties}>
          <button type="button" onClick={() => navigate('/nutrition/photo/plate')} className={quickTile}>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-teal-soft text-teal"><PlateIcon /></span>
            <span className="text-[15px] font-semibold leading-[1.25] text-fg">Foto do prato</span>
          </button>
          <button type="button" onClick={() => navigate('/nutrition/photo/label')} className={quickTile}>
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-teal-soft text-teal"><TagIcon /></span>
            <span className="text-[15px] font-semibold leading-[1.25] text-fg">Foto do rótulo</span>
          </button>
        </div>

        {routine?.enough && todayLogs.length === 0 && (
          <Card tint="teal" className="enter" >
            <p className="text-[17px] font-bold text-fg">Foi um dia normal?</p>
            <p className="mt-1 text-[15px] leading-[1.45] text-muted">
              Pelos últimos {routine.based_on_days} dias, dá para registrar hoje com um toque.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Button tone="teal" variant="tonal" onClick={openTodayPreview}>Foi normal</Button>
              <Button variant="secondary" onClick={() => void startExcessFlow()}>Extrapolei</Button>
            </div>
          </Card>
        )}

        {compensationOffer && (
          <Card tint="sun" className="enter">
            <p className="text-[17px] font-bold text-fg">Quer montar a compensação?</p>
            <p className="mt-1 text-[15px] leading-[1.45] text-muted">
              O excesso já está registrado. Posso montar um ajuste no treino para compensar, só se você quiser.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Button
                tone="sun"
                variant="tonal"
                onClick={() => {
                  const mensagem = compensationOffer;
                  setCompensationOffer(null);
                  navigate('/nutrition/cheat-day', { state: { initialMessage: mensagem } });
                }}
              >
                Montar
              </Button>
              <Button variant="secondary" onClick={() => setCompensationOffer(null)}>Agora não</Button>
            </div>
          </Card>
        )}

        {showMissing && (
          <Card className="enter">
            <h2 className="text-[17px] font-bold text-fg">Dias esquecidos</h2>
            {routine!.enough ? (
              <>
                <p className="mt-1 text-[15px] text-muted">Foi parecido com o normal? Confirme em um toque.</p>
                <ul className="mt-3 space-y-2">
                  {visibleMissingDays.map((date) => (
                    <li key={date} className="flex min-h-[56px] items-center justify-between gap-2 rounded-md bg-surface-2 pl-4 pr-2">
                      <span className="num text-[22px] text-fg">{formatDayLabel(date)}</span>
                      <div className="flex shrink-0 gap-1">
                        <Button size="sm" tone="teal" variant="tonal" onClick={() => openMissingDayPreview(date)}>Confirmar</Button>
                        <Button size="sm" variant="ghost" onClick={() => dismissMissingDay(date)}>Não foi</Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-1 text-[15px] leading-[1.45] text-muted">
                Registre uns dias normais para o MOB aprender sua rotina. Sem ela, não dá para propor o que você costuma comer.
              </p>
            )}
          </Card>
        )}

        <SectionTitle right={<span className="num text-[22px] text-muted">{todayLogs.length} {todayLogs.length === 1 ? 'item' : 'itens'}</span>}>
          Refeições de hoje
        </SectionTitle>

        {todayLogs.length === 0 && (
          <Card className="enter">
            <EmptyState
              icon={<PlateIcon />}
              title="Nada registrado hoje"
              text="Comece pela primeira refeição ou tire uma foto do prato."
              actionLabel="Registrar alimento"
              onAction={() => navigate('/nutrition/log')}
            />
          </Card>
        )}

        {MEAL_ORDER.map((meal, i) => {
          const logs = byMeal[meal] ?? [];
          const plannedMeal = activePlan?.meals?.find((m) => m.meal_type === meal);
          // Sem refeição planejada e sem registro, não ocupa espaço quando o dia está vazio.
          if (todayLogs.length === 0) return null;
          return (
            <MealCard
              key={meal}
              index={i + 2}
              title={MEAL_TYPE_LABELS[meal]}
              time={plannedMeal?.suggested_at}
              logs={logs}
              onOpenMenu={plannedMeal && (plannedMeal.items ?? []).length > 0 ? () => setMenuMeal(meal) : undefined}
              onAdd={() => navigate('/nutrition/log')}
              onEdit={setEditingLog}
              onDelete={deleteFoodLog}
            />
          );
        })}

        <div className="space-y-3 pt-2">
          <button type="button" onClick={() => navigate('/nutrition/cheat-day')} className="press tint-sun flex min-h-[72px] w-full items-center gap-4 rounded-lg bg-surface px-[18px] text-left shadow-card">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-sun-soft text-sun"><FlameIcon /></span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold text-fg">Dia do lixo</p>
              <p className="text-[15px] text-muted">Vai exagerar? Fale comigo antes.</p>
            </div>
            <ChevronIcon />
          </button>
          <button type="button" onClick={() => navigate('/nutrition/history')} className="press flex min-h-[72px] w-full items-center gap-4 rounded-lg bg-surface px-[18px] text-left shadow-card">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-teal-soft text-teal"><CalendarIcon /></span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold text-fg">Calendário de calorias</p>
              <p className="text-[15px] text-muted">O consumo de cada dia</p>
            </div>
            <ChevronIcon />
          </button>
        </div>
      </div>

      {editingLog && (
        <EditFoodLogModal log={editingLog} onClose={() => setEditingLog(null)} onSave={handleSaveEdit} onDelete={deleteFoodLog} />
      )}

      {menuMeal && (() => {
        const meal = menuMeal;
        const plannedMeal = activePlan?.meals?.find((m) => m.meal_type === meal);
        return (
          <div className="fixed inset-0 z-[100] flex items-end bg-bg/80 backdrop-blur-sm" onClick={() => setMenuMeal(null)}>
            <div
              className="flex max-h-[85vh] w-full flex-col overflow-y-auto rounded-t-xl bg-surface p-5 pb-safe shadow-sheet sheet-in"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-teal">Sugestão do plano</p>
              <h3 className={sheetTitle}>{MEAL_TYPE_LABELS[meal]}</h3>
              {plannedMeal?.suggested_at && <p className="mt-1 text-[15px] text-muted">{plannedMeal.suggested_at}</p>}
              <ul className="mt-4 space-y-2">
                {(plannedMeal?.items ?? []).map((item, index) => (
                  <li key={index} className="flex min-h-[64px] items-center justify-between gap-3 rounded-md bg-surface-2 pl-4 pr-2">
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-fg">{item.food_name}</p>
                      <p className="text-[13px] text-muted">{item.quantity_g} g, {Math.round(item.calories)} kcal</p>
                    </div>
                    <Button size="md" tone="teal" variant="tonal" onClick={() => logPlannedItem(meal, item)}>Já comi</Button>
                  </li>
                ))}
              </ul>
              <Button className="mt-3" variant="ghost" onClick={() => setMenuMeal(null)}>Fechar</Button>
            </div>
          </div>
        );
      })()}

      {preview && routine && (
        <RoutinePreviewModal
          dateLabel={preview.label}
          meals={routine.meals ?? []}
          onClose={() => setPreview(null)}
          onConfirm={confirmPreview}
        />
      )}

      {excessMode && (
        <div className="fixed inset-0 z-[100] flex items-end bg-bg/80 backdrop-blur-sm" onClick={() => setExcessMode(false)}>
          <div
            className="flex max-h-[88vh] w-full flex-col overflow-y-auto rounded-t-xl bg-surface p-5 pb-safe shadow-sheet sheet-in"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className={sheetTitle}>O que passou do normal?</h3>
            <p className="mt-1 text-[15px] leading-[1.45] text-muted">
              Conte só o excesso. O resto do dia já foi registrado com base na sua rotina.
            </p>
            <div className="mt-3">
              <FoodLogAssistant onRegistrar={registrarExcesso} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
