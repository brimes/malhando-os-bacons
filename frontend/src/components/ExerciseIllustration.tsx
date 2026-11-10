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
      return <div className={`min-h-[160px] animate-pulse rounded-lg bg-surface-2 ${className}`} />;
    }
    return (
      <figure className={`flex flex-col items-center ${className}`}>
        <img src={imagem} alt={`Ilustração de ${nome}`} className="min-h-0 w-full rounded-lg bg-white object-contain" />
        <figcaption className="mt-1 text-[12px] text-dim">Ilustração</figcaption>
      </figure>
    );
  }

  const offline = !isNetworkOnline();
  // Sem `overflow-hidden` nem altura fixa: a proporção dá o respiro em telas
  // grandes e o `min-h` garante espaço para o botão em 320 px; se o texto pedir
  // mais, o cartão cresce em vez de cortar o botão.
  return (
    <div className={`relative flex min-h-[208px] aspect-[16/10] items-center justify-center rounded-lg p-3 ${className}`}>
      <div className="stripes absolute inset-0 rounded-lg" aria-hidden="true" />
      <div className="relative flex w-full flex-col items-center rounded-md bg-surface p-4 text-center shadow-card">
        {fase === 'gerando' ? (
          <>
            <div className="h-1.5 w-full overflow-hidden rounded-chip bg-surface-2" role="progressbar" aria-label="Gerando ilustração">
              <div className="h-full w-1/3 animate-pulse rounded-chip bg-brand-fg" />
            </div>
            <p className="mt-3 text-[15px] leading-[1.45] text-muted">Gerando a ilustração, isso leva alguns segundos...</p>
          </>
        ) : (
          <>
            <p className="text-[16px] font-semibold leading-snug text-fg">Não encontramos o vídeo deste exercício</p>
            <p className="mt-1 text-[15px] leading-[1.45] text-muted">Podemos criar uma ilustração do movimento para você.</p>
            {fase === 'falhou' && erro && <p role="alert" className="mt-2 text-[15px] leading-[1.45] text-danger">{erro}</p>}
            <Button size="md" variant="secondary" className="mt-3" onClick={gerar} disabled={offline}>
              <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
                <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
              </svg>
              {fase === 'falhou' ? 'Tentar novamente' : 'Gerar ilustração'}
            </Button>
            {offline && <p className="mt-2 text-[13px] text-dim">Precisa de internet.</p>}
          </>
        )}
      </div>
    </div>
  );
}
