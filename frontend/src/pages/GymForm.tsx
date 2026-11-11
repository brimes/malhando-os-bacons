import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { CountUp } from '../components/CountUp';
import { Field, Skel, stagger } from '../components/treinos/states';
import { Check, Trash } from '../components/treinos/icons';
import { gymsApi } from '../api/gyms';
import { getErrorMessage } from '../api/client';

// Lista pronta para marcar com um toque — o texto livre abaixo dela cobre o
// que faltar. Marcado e digitado viram a mesma lista de strings no servidor,
// que não distingue as duas origens.
const EQUIPMENT_GROUPS: { title: string; items: string[] }[] = [
  { title: 'Pesos livres', items: ['Halteres', 'Barras e anilhas', 'Barra fixa', 'Banco regulável', 'Smith', 'Gaiola de agachamento', 'Kettlebell'] },
  { title: 'Máquinas de perna', items: ['Leg press', 'Hack squat', 'Cadeira extensora', 'Mesa flexora', 'Cadeira adutora', 'Cadeira abdutora', 'Panturrilha máquina'] },
  { title: 'Máquinas de tronco', items: ['Pulley alto', 'Puxador costas', 'Remada baixa', 'Remada máquina', 'Crossover', 'Supino máquina', 'Peck deck', 'Desenvolvimento máquina', 'Abdominal máquina'] },
  { title: 'Funcional', items: ['Elásticos', 'TRX', 'Corda naval', 'Caixa pliométrica', 'Medicine ball'] },
  { title: 'Cardio', items: ['Esteira', 'Bicicleta ergométrica', 'Elíptico', 'Remo ergômetro'] },
];
const EQUIPMENT_PRESETS = EQUIPMENT_GROUPS.flatMap((group) => group.items);

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

  if (isLoading) {
    return (
      <>
        <Header title={isEditing ? 'Editar academia' : 'Nova academia'} showBack />
        <div role="status" aria-label="Carregando" className="space-y-[14px] px-5 pt-2">
          <Skel className="h-[230px] rounded-lg" />
          <Skel className="h-[320px] rounded-lg" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header title={isEditing ? 'Editar academia' : 'Nova academia'} showBack />
      <form onSubmit={submit} className="space-y-[14px] px-5 pb-28 pt-2">
        {error && <div role="alert" className="rounded-lg bg-danger-soft p-[18px] text-[15px] font-semibold text-danger">{error}</div>}

        <div className="enter">
          <Card className="space-y-5">
            <Field label="Nome">
              <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex: Academia perto de casa" className="w-full" />
            </Field>
            <Field label="Observações" hint="opcional">
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} placeholder="Ex: horário de pico lotado, sem espaço para agachamento livre" className="w-full resize-none" />
            </Field>
          </Card>
        </div>

        <div className="enter pt-3" style={stagger(1)}>
          <div className="mb-[14px] flex items-end justify-between gap-3">
            <h2 className="text-[17px] font-bold text-fg">Aparelhos disponíveis</h2>
            <p className="num text-[34px] leading-none text-brand-fg"><CountUp key={equipment.length} value={equipment.length} /><span className="font-sans text-[15px] font-medium text-muted"> marcados</span></p>
          </div>
          <Card className="space-y-6">
            {EQUIPMENT_GROUPS.map((group) => (
              <div key={group.title}>
                <p className="mb-3 text-[13px] font-bold uppercase tracking-[0.06em] text-muted">{group.title}</p>
                <div className="flex flex-wrap gap-2">
                  {group.items.map((item) => {
                    const marked = equipment.includes(item);
                    return (
                      <button
                        key={item}
                        type="button"
                        aria-pressed={marked}
                        onClick={() => togglePreset(item)}
                        className={`press inline-flex min-h-[44px] items-center gap-1.5 rounded-chip px-4 text-[15px] font-semibold ${marked ? 'bg-brand text-white' : 'bg-surface-2 text-muted'}`}
                      >
                        {marked && <Check className="h-4 w-4" />}
                        {item}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {customItems.length > 0 && (
              <div>
                <p className="mb-3 text-[13px] font-bold uppercase tracking-[0.06em] text-muted">Adicionados por você</p>
                <div className="flex flex-wrap gap-2">
                  {customItems.map((item) => (
                    <span key={item} className="inline-flex min-h-[44px] items-center gap-1 rounded-chip bg-brand-soft pl-4 pr-1 text-[15px] font-semibold text-brand-fg">
                      {item}
                      <button type="button" onClick={() => removeItem(item)} aria-label={`Remover ${item}`} className="press flex h-11 w-11 items-center justify-center rounded-chip text-[20px] leading-none">×</button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <input
                value={customInput}
                onChange={(event) => setCustomInput(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustom(); } }}
                placeholder="Outro aparelho"
                aria-label="Outro aparelho"
                className="min-w-0 flex-1"
              />
              <Button type="button" variant="tonal" onClick={addCustom} className="shrink-0">Adicionar</Button>
            </div>
          </Card>
        </div>

        <div className="pt-3">
          <Button type="submit" fullWidth size="lg" isLoading={isSaving}>
            {isEditing ? 'Salvar alterações' : 'Cadastrar academia'}
          </Button>
        </div>

        {isEditing && (
          <Button type="button" variant="danger" fullWidth disabled={isDeleting} onClick={deleteGym}>
            <Trash className="h-5 w-5" /> {isDeleting ? 'Excluindo...' : 'Excluir academia'}
          </Button>
        )}
      </form>
    </>
  );
}
