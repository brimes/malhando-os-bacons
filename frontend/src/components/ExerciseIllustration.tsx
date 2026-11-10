import { useCallback, useEffect, useRef, useState } from 'react';
import { exerciseIllustrationsApi } from '../api/exerciseIllustrations';
import { carregarIlustracao } from '../lib/illustrations/illustrationStore';
import { isNetworkOnline } from '../lib/offline';
import type { TrainingPlanExercise } from '../types';
import { Button } from './Button';

type Fase = 'ociosa' | 'gerando' | 'pronta' | 'falhou';

const INTERVALO_POLLING_MS = 3000;
/** A geração leva dezenas de segundos; o servidor já dá a pendência por morta em 5 min. */
const MAX_POLLING_MS = 4 * 60 * 1000;

function mensagemDeErro(erro: unknown): string {
  const resposta = (erro as { response?: { status?: number; data?: { error?: string } } })?.response;
  if (resposta?.data?.error) return resposta.data.error;
  return erro instanceof Error && erro.message ? erro.message : 'Não foi possível gerar a ilustração.';
}

/**
 * Substituto do vídeo quando o catálogo não tem o exercício.
 *
 * Só aparece quando o servidor já DECIDIU que não há vídeo (`video_status ===
 * 'not_found'`, a recusa gravada) ou quando já existe uma ilustração pronta.
 * "Ainda não associado" (sem `video_status`), "offline sem a imagem" e "vídeo
 * ainda baixando" não passam por aqui: esses estados não são "não localizamos".
 */
export function ExerciseIllustration({ exercise, className = '' }: { exercise: TrainingPlanExercise; className?: string }) {
  const nome = exercise.exercise_name;
  const naoLocalizado = exercise.video_status === 'not_found';
  const prontaNoServidor = exercise.illustration?.status === 'ready';

  const [fase, setFase] = useState<Fase>(prontaNoServidor ? 'pronta' : 'ociosa');
  const [imagem, setImagem] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const montado = useRef(true);
  const geracao = useRef(0);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  // Troca de exercício na sessão guiada: zera tudo e cancela polling antigo.
  useEffect(() => {
    geracao.current += 1;
    setImagem(null);
    setErro('');
    setFase(prontaNoServidor ? 'pronta' : 'ociosa');
  }, [nome, prontaNoServidor]);

  // Já gerada nesta sessão ou guardada no aparelho (o plano em cache pode ainda
  // não saber que ela existe): mostra direto em vez de oferecer gerar de novo.
  useEffect(() => {
    if (!naoLocalizado || prontaNoServidor) return;
    const id = geracao.current;
    void carregarIlustracao(nome, false).then((dataUrl) => {
      if (dataUrl && montado.current && id === geracao.current) {
        setImagem(dataUrl);
        setFase('pronta');
      }
    });
  }, [nome, naoLocalizado, prontaNoServidor]);

  const buscarImagem = useCallback(async (): Promise<boolean> => {
    const id = geracao.current;
    const dataUrl = await carregarIlustracao(nome, isNetworkOnline());
    if (!montado.current || id !== geracao.current) return false;
    if (dataUrl) {
      setImagem(dataUrl);
      setFase('pronta');
      return true;
    }
    return false;
  }, [nome]);

  useEffect(() => {
    if (fase === 'pronta' && !imagem) void buscarImagem();
  }, [fase, imagem, buscarImagem]);

  const acompanhar = useCallback(async () => {
    const id = geracao.current;
    const limite = Date.now() + MAX_POLLING_MS;
    while (montado.current && id === geracao.current && Date.now() < limite) {
      await new Promise((r) => setTimeout(r, INTERVALO_POLLING_MS));
      if (!montado.current || id !== geracao.current) return;
      try {
        const estado = await exerciseIllustrationsApi.status(nome);
        if (estado.status === 'ready') {
          await buscarImagem();
          return;
        }
        if (estado.status === 'failed') {
          setErro(estado.error || 'Não foi possível gerar a ilustração.');
          setFase('falhou');
          return;
        }
      } catch {
        // Falha de rede passageira: tenta de novo até o limite.
      }
    }
    if (montado.current && id === geracao.current) {
      setErro('A geração demorou demais. Tente novamente.');
      setFase('falhou');
    }
  }, [nome, buscarImagem]);

  const gerar = async () => {
    setErro('');
    setFase('gerando');
    try {
      const estado = await exerciseIllustrationsApi.request(nome);
      if (estado.status === 'ready') {
        if (!(await buscarImagem())) {
          setErro('Não foi possível carregar a ilustração.');
          setFase('falhou');
        }
        return;
      }
      if (estado.status === 'failed') {
        setErro(estado.error || 'Não foi possível gerar a ilustração.');
        setFase('falhou');
        return;
      }
      await acompanhar();
    } catch (e) {
      if (!montado.current) return;
      setErro(mensagemDeErro(e));
      setFase('falhou');
    }
  };

  if (!naoLocalizado && !prontaNoServidor) return null;

  if (fase === 'pronta') {
    if (!imagem) {
      return <div className={`animate-pulse rounded-2xl bg-zinc-800 ${className}`} />;
    }
    return (
      <figure className={`flex flex-col items-center ${className}`}>
        <img src={imagem} alt={`Ilustração de ${nome}`} className="min-h-0 w-full rounded-2xl bg-white object-contain" />
        <figcaption className="mt-1 text-[11px] text-zinc-500">Ilustração</figcaption>
      </figure>
    );
  }

  const offline = !isNetworkOnline();
  return (
    <div className={`rounded-2xl border border-zinc-800 bg-zinc-900 p-3 text-center ${className}`}>
      {fase === 'gerando' ? (
        <>
          <div className="mx-auto h-1.5 w-full overflow-hidden rounded-full bg-zinc-800" role="progressbar" aria-label="Gerando ilustração">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary-500" />
          </div>
          <p className="mt-2 text-xs text-zinc-400">Gerando a ilustração, isso leva alguns segundos...</p>
        </>
      ) : (
        <>
          <p className="text-xs text-zinc-400">Não localizamos o vídeo deste exercício.</p>
          {fase === 'falhou' && erro && <p className="mt-1 text-xs text-red-400">{erro}</p>}
          <Button size="sm" variant="secondary" className="mt-2" onClick={gerar} disabled={offline}>
            {fase === 'falhou' ? 'Tentar novamente' : 'Gerar ilustração'}
          </Button>
          {offline && <p className="mt-1 text-[11px] text-zinc-500">Precisa de internet.</p>}
        </>
      )}
    </div>
  );
}
