import { useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState, ErrorState, SkelRows, stagger } from '../components/treinos/states';
import { Pin, Plus } from '../components/treinos/icons';
import { gymsApi } from '../api/gyms';
import { useCachedResource } from '../lib/useCachedResource';
import type { Gym } from '../types';

export function GymsPage() {
  const navigate = useNavigate();
  const resource = useCachedResource<Gym[]>('/gyms', { fetcher: gymsApi.list });
  const gyms = resource.data ?? [];
  const isLoading = resource.isLoading;
  const error = resource.error;
  const load = () => { void resource.reload(); };

  return (
    <>
      <Header
        title="Academias"
        showBack
        rightAction={<Button size="md" onClick={() => navigate('/gyms/new')} aria-label="Cadastrar academia" className="!min-w-[48px] !px-0 w-12"><Plus className="h-6 w-6" /></Button>}
      />
      <div className="space-y-[14px] px-5 pb-28 pt-2">
        {error && <ErrorState message={error} onRetry={load} />}

        {isLoading ? (
          <SkelRows count={3} />
        ) : gyms.length === 0 && !error ? (
          <EmptyState
            icon={<Pin />}
            title="Onde você treina?"
            text="Cadastre os lugares e os aparelhos de cada um. O assistente monta planos que dá para seguir de verdade."
            action={{ label: 'Cadastrar academia', onClick: () => navigate('/gyms/new') }}
          />
        ) : (
          gyms.map((gym, index) => (
            <div key={gym.id} className="enter" style={stagger(index)}>
              <Card onClick={() => navigate(`/gyms/${gym.id}`)} className="flex min-h-[72px] items-center gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-fg"><Pin className="h-6 w-6" /></span>
                <div className="min-w-0 flex-1">
                  <h2 className="break-anywhere text-[17px] font-bold leading-[1.3] text-fg">{gym.name}</h2>
                  {gym.notes && <p className="mt-0.5 line-clamp-2 text-[15px] leading-[1.4] text-muted">{gym.notes}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="num text-[34px] leading-none text-fg">{gym.equipment.length}</p>
                  <p className="mt-1 text-[13px] text-muted">{gym.equipment.length === 1 ? 'aparelho' : 'aparelhos'}</p>
                </div>
              </Card>
            </div>
          ))
        )}
      </div>
    </>
  );
}
