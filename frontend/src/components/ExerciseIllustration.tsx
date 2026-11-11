import { App as CapacitorApp } from '@capacitor/app';
import { useCallback, useEffect, useRef, useState } from 'react';
import { exerciseIllustrationsApi } from '../api/exerciseIllustrations';
import { carregarIlustracao, invalidarIlustracao } from '../lib/illustrations/illustrationStore';
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

const TROCA_DE_QUADRO_MS = 700;

function usaMovimentoReduzido(): boolean {
  const [reduzido, setReduzido] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const aoMudar = () => setReduzido(mq.matches);
    mq.addEventListener('change', aoMudar);
    return () => mq.removeEventListener('change', aoMudar);
  }, []);
  return reduzido;
}

/** Ordem de ida e volta (0,1,2,1,...): o movimento repete sem pular do fim para o início. */
function sequencia(n: number): number[] {
  const ida = Array.from({ length: n }, (_, i) => i);
  return n > 2 ? [...ida, ...ida.slice(1, -1).reverse()] : ida;
}

/**
 * Os quadros do movimento em laço: troca a cada 700 ms com crossfade de
 * opacidade (nada de layout animado). Pausa fora da tela e com o app em
 * segundo plano. Com "reduzir movimento", quadros parados lado a lado, numerados.
 */
function QuadrosDoMovimento({ nome, quadros }: { nome: string; quadros: string[] }) {
  const reduzido = usaMovimentoReduzido();
  const [passo, setPasso] = useState(0);
  const [naTela, setNaTela] = useState(true);
  const [emPrimeiroPlano, setEmPrimeiroPlano] = useState(() => document.visibilityState !== 'hidden');
  const [proporcao, setProporcao] = useState('3 / 4');
  const palco = useRef<HTMLDivElement>(null);
  const ordem = sequencia(quadros.length);

  useEffect(() => {
    const el = palco.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(([e]) => setNaTela(e.isIntersecting), { threshold: 0.25 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [reduzido, quadros.length]);

  useEffect(() => {
    const aoMudar = () => setEmPrimeiroPlano(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', aoMudar);
    const handle = CapacitorApp.addListener('appStateChange', ({ isActive }) => setEmPrimeiroPlano(isActive));
    return () => {
      document.removeEventListener('visibilitychange', aoMudar);
      void handle.then((h) => h.remove()).catch(() => undefined);
    };
  }, []);

  const rodando = !reduzido && quadros.length > 1 && naTela && emPrimeiroPlano;
  useEffect(() => {
    if (!rodando) return;
    const id = window.setInterval(() => setPasso((p) => (p + 1) % ordem.length), TROCA_DE_QUADRO_MS);
    return () => window.clearInterval(id);
  }, [rodando, ordem.length]);

  const rotulo = `Ilustração do movimento: ${nome}`;

  if (reduzido && quadros.length > 1) {
    return (
      <ol className="flex w-full gap-2" aria-label={rotulo}>
        {quadros.map((q, i) => (
          <li key={i} className="min-w-0 flex-1 text-center">
            <img src={q} alt={`${nome}, quadro ${i + 1}`} className="w-full rounded-md bg-white object-contain" />
            <span className="num mt-1 block text-[13px] text-dim">{i + 1}</span>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div
      ref={palco}
      role="img"
      aria-label={rotulo}
      className="relative mx-auto max-h-[52vh] w-full overflow-hidden rounded-lg bg-white"
      style={{ aspectRatio: proporcao }}
    >
      {quadros.map((q, i) => (
        <img
          key={i}
          src={q}
          alt=""
          draggable={false}
          onLoad={i === 0 ? (e) => setProporcao(`${e.currentTarget.naturalWidth} / ${e.currentTarget.naturalHeight}`) : undefined}
          className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-[120ms] ease-linear ${
            i === ordem[passo] ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ))}
    </div>
  );
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
  const desatualizadaNoServidor = exercise.illustration?.status === 'outdated';
  const prontaNoServidor = exercise.illustration?.status === 'ready' || desatualizadaNoServidor;

  const [fase, setFase] = useState<Fase>(prontaNoServidor ? 'pronta' : 'ociosa');
  const [quadros, setQuadros] = useState<string[] | null>(null);
  const [erro, setErro] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [erroRegerar, setErroRegerar] = useState('');
  const regeneradaAuto = useRef('');
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
    setQuadros(null);
    setErro('');
    setConfirmando(false);
    setErroRegerar('');
    setFase(prontaNoServidor ? 'pronta' : 'ociosa');
  }, [nome, prontaNoServidor]);

  // Já gerada nesta sessão ou guardada no aparelho (o plano em cache pode ainda
  // não saber que ela existe): mostra direto em vez de oferecer gerar de novo.
  useEffect(() => {
    if (!naoLocalizado || prontaNoServidor) return;
    const id = geracao.current;
    void carregarIlustracao(nome, false).then((r) => {
      if (r && r.quadros.length && montado.current && id === geracao.current) {
        setQuadros(r.quadros);
        setFase('pronta');
      }
    });
  }, [nome, naoLocalizado, prontaNoServidor]);

  /** 'regerar': a cópia é de versão antiga e há rede, então o app pede uma nova sozinho. */
  const carregar = useCallback(async (): Promise<'pronta' | 'regerar' | 'nada'> => {
    const id = geracao.current;
    const online = isNetworkOnline();
    const r = await carregarIlustracao(nome, online);
    if (!montado.current || id !== geracao.current) return 'nada';
    if (r?.desatualizada && online && regeneradaAuto.current !== nome) return 'regerar';
    if (r && r.quadros.length) {
      setQuadros(r.quadros);
      setFase('pronta');
      return 'pronta';
    }
    return 'nada';
  }, [nome]);

  const gerarRef = useRef<(forcar?: boolean) => Promise<void>>(async () => undefined);

  // Estado `outdated` (sem botão): regenera ao abrir, mostrando "gerando".
  useEffect(() => {
    if (fase !== 'pronta' || quadros) return;
    const id = geracao.current;
    const regenerarSozinho = () => {
      regeneradaAuto.current = nome;
      void gerarRef.current(false);
    };
    if (desatualizadaNoServidor && isNetworkOnline() && regeneradaAuto.current !== nome) {
      regenerarSozinho();
      return;
    }
    void carregar().then((r) => {
      if (r === 'regerar' && montado.current && id === geracao.current) regenerarSozinho();
    });
  }, [fase, quadros, nome, desatualizadaNoServidor, carregar]);

  const acompanhar = useCallback(async () => {
    const id = geracao.current;
    const limite = Date.now() + MAX_POLLING_MS;
    while (montado.current && id === geracao.current && Date.now() < limite) {
      await new Promise((r) => setTimeout(r, INTERVALO_POLLING_MS));
      if (!montado.current || id !== geracao.current) return;
      try {
        const estado = await exerciseIllustrationsApi.status(nome);
        if (estado.status === 'ready') {
          // A cópia local (se houver) é da geração anterior.
          await invalidarIlustracao(nome);
          if ((await carregar()) !== 'pronta' && montado.current && id === geracao.current) {
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
      } catch {
        // Falha de rede passageira: tenta de novo até o limite.
      }
    }
    if (montado.current && id === geracao.current) {
      setErro('A geração demorou demais. Tente novamente.');
      setFase('falhou');
    }
  }, [nome, carregar]);

  // `forcar`: "Não ficou bom". Os quadros atuais continuam na tela até o
  // servidor aceitar o pedido (uma recusa, como o limite diário, não os apaga).
  const gerar = async (forcar = false) => {
    setErro('');
    setErroRegerar('');
    setConfirmando(false);
    if (!forcar) setFase('gerando');
    try {
      const estado = forcar ? await exerciseIllustrationsApi.regenerate(nome) : await exerciseIllustrationsApi.request(nome);
      if (!montado.current) return;
      if (forcar) {
        setQuadros(null);
        setFase('gerando');
      }
      if (estado.status === 'ready') {
        if ((await carregar()) !== 'pronta') {
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
      if (forcar) {
        setErroRegerar(mensagemDeErro(e));
        return;
      }
      setErro(mensagemDeErro(e));
      setFase('falhou');
    }
  };
  gerarRef.current = gerar;

  if (!naoLocalizado && !prontaNoServidor) return null;

  if (fase === 'pronta') {
    if (!quadros) {
      return <div className={`min-h-[160px] animate-pulse rounded-lg bg-surface-2 ${className}`} />;
    }
    return (
      <figure className={`flex flex-col items-center ${className}`}>
        <QuadrosDoMovimento nome={nome} quadros={quadros} />
        <figcaption className="mt-1 text-[12px] text-dim">Ilustração do movimento</figcaption>
        {isNetworkOnline() && (confirmando ? (
          <div className="mt-1 flex w-full flex-col items-center gap-1 text-center">
            <p className="text-[15px] leading-[1.45] text-muted">Gerar de novo? Conta como 1 das 10 gerações do dia.</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="md" variant="secondary" onClick={() => void gerar(true)}>Gerar de novo</Button>
              <Button size="md" variant="ghost" onClick={() => setConfirmando(false)}>Cancelar</Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="ghost" className="!min-h-[44px]" onClick={() => setConfirmando(true)}>Não ficou bom</Button>
        ))}
        {erroRegerar && <p role="alert" className="mt-1 text-center text-[15px] leading-[1.45] text-danger">{erroRegerar}</p>}
      </figure>
    );
  }

  const offline = !isNetworkOnline();
  // Sem `overflow-hidden` nem altura fixa: a proporção dá o respiro em telas
  // grandes e o `min-h` garante espaço para o botão em 320 px; se o texto pedir
  // mais, o cartão cresce em vez de cortar o botão.
  return (
    <div className={`relative flex min-h-[176px] aspect-[16/10] items-center justify-center rounded-lg p-3 ${className}`}>
      <div className="stripes absolute inset-0 rounded-lg" aria-hidden="true" />
      <div className="relative flex w-full flex-col items-center rounded-md bg-surface p-4 text-center shadow-card">
        {fase === 'gerando' ? (
          <>
            <div className="h-1.5 w-full overflow-hidden rounded-chip bg-surface-2" role="progressbar" aria-label="Gerando ilustração">
              <div className="h-full w-1/3 animate-pulse rounded-chip bg-brand-fg" />
            </div>
            <p className="mt-3 text-[15px] leading-[1.45] text-muted">Gerando a ilustração do movimento, isso leva alguns segundos...</p>
          </>
        ) : (
          <>
            <p className="text-[16px] font-semibold leading-snug text-fg">Não encontramos o vídeo deste exercício</p>
            <p className="mt-1 text-[15px] leading-[1.45] text-muted">Podemos criar uma ilustração do movimento para você.</p>
            {fase === 'falhou' && erro && <p role="alert" className="mt-2 text-[15px] leading-[1.45] text-danger">{erro}</p>}
            <Button size="md" variant="secondary" className="mt-3" onClick={() => void gerar()} disabled={offline}>
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
