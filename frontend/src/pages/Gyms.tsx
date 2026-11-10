import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { gymsApi } from '../api/gyms';
import { getErrorMessage } from '../api/client';
import type { Gym } from '../types';

export function GymsPage() {
  const navigate = useNavigate();
  const [gyms, setGyms] = useState<Gym[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    gymsApi.list()
      .then(setGyms)
      .catch((requestError) => setError(getErrorMessage(requestError)))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <>
      <Header title="Minhas academias" showBack rightAction={<Button size="sm" onClick={() => navigate('/gyms/new')}>+ Academia</Button>} />
 <div className="space-y-3 px-4 py-5 pb-24">
 {error && <div className="rounded-md bg-danger-soft p-3 text-sm text-danger">{error}</div>}

        {isLoading ? (
 <div className="py-16 text-center text-dim">Carregando academias...</div>
        ) : gyms.length === 0 ? (
 <div className="space-y-4 py-14 text-center">
 <p className="mx-auto max-w-xs text-sm text-dim">
              Cadastre os lugares onde você treina e os aparelhos disponíveis em cada um, para o
              assistente montar planos que dá para seguir de verdade.
            </p>
            <Button onClick={() => navigate('/gyms/new')}>Cadastrar academia</Button>
          </div>
        ) : (
          gyms.map((gym) => (
            <Card key={gym.id} onClick={() => navigate(`/gyms/${gym.id}`)}>
 <div className="flex items-start justify-between gap-3">
 <div className="min-w-0">
 <h2 className="font-bold text-fg">{gym.name}</h2>
 {gym.notes && <p className="mt-1 line-clamp-2 text-xs text-dim">{gym.notes}</p>}
 <p className="mt-2 text-xs text-dim">
                    {gym.equipment.length} aparelho{gym.equipment.length === 1 ? '' : 's'} cadastrado{gym.equipment.length === 1 ? '' : 's'}
                  </p>
                </div>
 <span className="shrink-0 text-dim">›</span>
              </div>
            </Card>
          ))
        )}
      </div>
    </>
  );
}
