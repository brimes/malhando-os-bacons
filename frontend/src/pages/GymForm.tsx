import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { gymsApi } from '../api/gyms';
import { getErrorMessage } from '../api/client';

// Lista pronta para marcar com um toque — o texto livre abaixo dela cobre o
// que faltar. Marcado e digitado viram a mesma lista de strings no servidor,
// que não distingue as duas origens.
const EQUIPMENT_PRESETS = [
  'Halteres', 'Barras e anilhas', 'Barra fixa', 'Banco regulável', 'Smith',
  'Leg press', 'Hack squat', 'Gaiola de agachamento', 'Cadeira extensora',
  'Mesa flexora', 'Cadeira adutora', 'Cadeira abdutora', 'Panturrilha máquina',
  'Pulley alto', 'Puxador costas', 'Remada baixa', 'Remada máquina', 'Crossover',
  'Supino máquina', 'Peck deck', 'Desenvolvimento máquina', 'Abdominal máquina',
  'Kettlebell', 'Elásticos', 'TRX', 'Corda naval', 'Caixa pliométrica',
  'Medicine ball', 'Esteira', 'Bicicleta ergométrica', 'Elíptico', 'Remo ergômetro',
];

export function GymFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEditing = Boolean(id);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [equipment, setEquipment] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState('');
  const [isLoading, setIsLoading] = useState(isEditing);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    gymsApi.get(Number(id)).then((gym) => {
      if (!alive) return;
      setName(gym.name);
      setNotes(gym.notes);
      setEquipment(gym.equipment);
    }).catch((requestError) => setError(getErrorMessage(requestError)))
      .finally(() => { if (alive) setIsLoading(false); });
    return () => { alive = false; };
  }, [id]);

  const togglePreset = (item: string) => setEquipment((current) => (
    current.includes(item) ? current.filter((entry) => entry !== item) : [...current, item]
  ));

  const removeItem = (item: string) => setEquipment((current) => current.filter((entry) => entry !== item));

  const addCustom = () => {
    const value = customInput.trim();
    setCustomInput('');
    if (!value || equipment.includes(value)) return;
    setEquipment((current) => [...current, value]);
  };

  // Qualquer coisa fora da lista pronta é o que a pessoa digitou — mostrado à
  // parte, cada um removível, por isso continua na lista mesmo sem estar entre
  // os chips marcáveis.
  const customItems = equipment.filter((item) => !EQUIPMENT_PRESETS.includes(item));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const input = { name: name.trim(), notes: notes.trim(), equipment };
      if (isEditing) await gymsApi.update(Number(id), input);
      else await gymsApi.create(input);
      navigate('/gyms');
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  };

  const deleteGym = async () => {
    if (!id) return;
    if (!window.confirm(`Excluir a academia "${name}"? Planos que já a usam continuam como estão.`)) return;
    setIsDeleting(true);
    try {
      await gymsApi.delete(Number(id));
      navigate('/gyms', { replace: true });
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      setIsDeleting(false);
    }
  };

 if (isLoading) return <div className="py-20 text-center text-dim">Carregando academia...</div>;

  return (
    <>
      <Header title={isEditing ? 'Editar academia' : 'Nova academia'} showBack />
 <form onSubmit={submit} className="space-y-5 px-4 py-5 pb-24">
 {error && <div className="rounded-md bg-danger-soft p-3 text-sm text-danger">{error}</div>}

 <Card className="space-y-4">
 <label className="block text-sm text-fg">
            Nome
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex: Academia perto de casa"
 className="mt-2 w-full rounded-md border border-line bg-surface-2 px-4 py-3 text-fg focus:outline-none"
            />
          </label>
 <label className="block text-sm text-fg">
 Observações <span className="text-dim">(opcional)</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={2}
              placeholder="Ex: horário de pico lotado, sem espaço para agachamento livre..."
 className="mt-2 w-full resize-none rounded-md border border-line bg-surface-2 px-4 py-3 text-fg focus:outline-none"
            />
          </label>
        </Card>

 <Card className="space-y-3">
 <p className="text-sm font-semibold text-fg">Aparelhos disponíveis</p>
 <div className="flex flex-wrap gap-2">
            {EQUIPMENT_PRESETS.map((item) => {
              const marked = equipment.includes(item);
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => togglePreset(item)}
 className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    marked ? 'bg-brand text-white' : 'bg-surface-2 text-muted'
                  }`}
                >
                  {item}
                </button>
              );
            })}
          </div>

          {customItems.length > 0 && (
 <div className="border-t border-line pt-3">
 <p className="text-xs uppercase tracking-wide text-dim">Adicionados por você</p>
 <div className="mt-2 flex flex-wrap gap-2">
                {customItems.map((item) => (
 <span key={item} className="flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1.5 text-xs font-medium text-brand-fg">
                    {item}
 <button type="button" onClick={() => removeItem(item)} aria-label={`Remover ${item}`} className="text-brand-fg hover:text-fg">×</button>
                  </span>
                ))}
              </div>
            </div>
          )}

 <div className="flex gap-2 border-t border-line pt-3">
            <input
              value={customInput}
              onChange={(event) => setCustomInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustom(); } }}
              placeholder="Outro aparelho..."
 className="min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-3 py-2.5 text-sm text-fg focus:outline-none"
            />
 <button type="button" onClick={addCustom} className="shrink-0 rounded-md bg-surface-2 px-4 text-sm font-semibold text-brand-fg">
              Adicionar
            </button>
          </div>
        </Card>

        <Button type="submit" fullWidth size="lg" isLoading={isSaving}>
          {isEditing ? 'Salvar alterações' : 'Cadastrar academia'}
        </Button>

        {isEditing && (
          <button
            type="button"
            disabled={isDeleting}
            onClick={deleteGym}
 className="w-full py-2 text-center text-sm text-danger disabled:opacity-50"
          >
            {isDeleting ? 'Excluindo...' : 'Excluir academia'}
          </button>
        )}
      </form>
    </>
  );
}
