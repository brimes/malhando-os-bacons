import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNutritionStore } from '../stores/useNutritionStore';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';

export function NutritionPlanPage() {
  const navigate = useNavigate();
  const { plans, isLoading, fetchPlans, createPlan } = useNutritionStore();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [calories, setCalories] = useState('2000');
  const [protein, setProtein] = useState('150');
  const [carbs, setCarbs] = useState('250');
  const [fat, setFat] = useState('65');

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await createPlan({
      name,
      calories_target: Number(calories),
      protein_target: Number(protein),
      carbs_target: Number(carbs),
      fat_target: Number(fat),
    });
    setShowForm(false);
    navigate('/nutrition');
  };

  return (
    <>
      <Header
        title="Planos Alimentares"
        showBack
        rightAction={
          <Button size="sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancelar' : '+ Novo'}
          </Button>
        }
      />
      <div className="px-4 py-4 pb-24 space-y-4">
        {showForm && (
          <Card>
            <h3 className="font-semibold text-white mb-4">Novo Plano</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-400 uppercase tracking-wide mb-1.5">Nome</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Ganho de massa"
                  required
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:border-primary-500 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Calorias (kcal)', value: calories, setter: setCalories, color: 'text-primary-400' },
                  { label: 'Proteína (g)', value: protein, setter: setProtein, color: 'text-blue-400' },
                  { label: 'Carboidratos (g)', value: carbs, setter: setCarbs, color: 'text-amber-400' },
                  { label: 'Gordura (g)', value: fat, setter: setFat, color: 'text-red-400' },
                ].map((field) => (
                  <div key={field.label}>
                    <label className={`block text-xs ${field.color} mb-1.5`}>{field.label}</label>
                    <input
                      type="number"
                      value={field.value}
                      min={0}
                      onChange={(e) => field.setter(e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-white text-center focus:outline-none focus:border-primary-500 text-sm"
                    />
                  </div>
                ))}
              </div>

              <Button type="submit" fullWidth isLoading={isLoading}>
                Criar Plano
              </Button>
            </form>
          </Card>
        )}

        {plans.length === 0 ? (
          <Card className="text-center py-8">
            <p className="text-zinc-400 text-sm">Nenhum plano criado ainda</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {plans.map((plan) => (
              <Card key={plan.id} className={plan.active ? 'border-primary-600' : ''}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-white">{plan.name}</p>
                      {plan.active && (
                        <span className="text-xs bg-primary-900 text-primary-300 px-2 py-0.5 rounded-full">Ativo</span>
                      )}
                    </div>
                    <p className="text-sm text-zinc-400">{plan.calories_target} kcal/dia</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-zinc-800">
                  <div className="text-center">
                    <p className="text-sm font-semibold text-blue-400">{plan.protein_target}g</p>
                    <p className="text-xs text-zinc-600">proteína</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-amber-400">{plan.carbs_target}g</p>
                    <p className="text-xs text-zinc-600">carbs</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-red-400">{plan.fat_target}g</p>
                    <p className="text-xs text-zinc-600">gordura</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
