import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import { formatoDaPlataforma, fonteLocal } from '../lib/videos/videoStore';
import { isNetworkOnline } from '../lib/offline';
import type { ExerciseVideo } from '../types';

const TENTATIVAS_MAX = 3;
const ESPERA_ENTRE_TENTATIVAS_MS = 5000;

/**
 * O vídeo em loop demonstrando o movimento.
 *
 * Toca do arquivo em disco. Nenhuma URL assinada é gerada aqui no caminho
 * normal — assinar é coisa do download, e um vídeo já baixado não volta à rede.
 * É o que faz isto funcionar em modo avião.
 *
 * Sem vídeo local e com rede, cai para streaming assinado. É o caso da pessoa
 * que abriu o app pela primeira vez e ainda não completou o acervo; some
 * sozinho quando o download termina.
 */
export function ExerciseVideoPlayer({ video, className = '' }: { video?: ExerciseVideo; className?: string }) {
  const [fonte, setFonte] = useState<string | null>(() => fonteLocal(video));
  const [falhou, setFalhou] = useState(false);
  // Acompanha a rede para o estado "indisponível offline" aparecer e sumir sozinho.
  const [online, setOnline] = useState(() => isNetworkOnline());
  // Falha de assinatura ou de reprodução com rede: tenta de novo algumas vezes
  // antes de desistir, porque a causa costuma ser passageira.
  const [tentativa, setTentativa] = useState(0);
  // Guarda se este componente ainda está montado quando a assinatura volta: a
  // pessoa passa de exercício rapidamente na sessão guiada, e escrever estado
  // depois de desmontar é aviso no console sem utilidade nenhuma.
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  useEffect(() => {
    const atualizar = () => setOnline(isNetworkOnline());
    window.addEventListener('online', atualizar);
    window.addEventListener('offline', atualizar);
    return () => {
      window.removeEventListener('online', atualizar);
      window.removeEventListener('offline', atualizar);
    };
  }, []);

  useEffect(() => {
    setFalhou(false);
    const local = fonteLocal(video);
    setFonte(local);
    if (local || !video || !isNetworkOnline()) return;

    // Ainda não baixado: pede uma URL assinada só para este. O download em
    // segundo plano segue no seu ritmo e, na próxima vez, o arquivo já está
    // aqui e este caminho não roda.
    const objeto = formatoDaPlataforma() === 'mp4' ? video.mp4 : video.webm;
    let cancelado = false;
    apiClient
      .post<{ urls: Record<string, string> }>('/exercise-videos/urls', { objetos: [objeto] })
      .then(({ data }) => {
        if (cancelado || !montado.current) return;
        const url = data.urls?.[objeto];
        if (url) setFonte(url);
        else setFalhou(true);
      })
      .catch(() => {
        if (!cancelado && montado.current) setFalhou(true);
      });
    return () => {
      cancelado = true;
    };
  }, [video, online, tentativa]);

  useEffect(() => setTentativa(0), [video]);

  useEffect(() => {
    if (!falhou || !online || tentativa >= TENTATIVAS_MAX) return;
    const id = window.setTimeout(() => setTentativa((n) => n + 1), ESPERA_ENTRE_TENTATIVAS_MS);
    return () => window.clearTimeout(id);
  }, [falhou, online, tentativa]);

  // Sem vídeo associado a este exercício: não ocupa espaço. A ausência de vídeo
  // nunca é erro — a maioria dos exercícios do catálogo casa, mas nem todos.
  if (!video) return null;

  // O exercício TEM vídeo, só não está disponível agora. Diferente de "não
  // encontramos o vídeo" (recusa gravada, `video_status`), que é decidido pelo
  // servidor e tratado em `ExerciseIllustration`: aqui a área nunca fica vazia.
  if (falhou || !fonte) {
    const semRede = !online && !fonte;
    return (
      <div
        role="status"
        className={`flex flex-col items-center justify-center gap-1 rounded-lg bg-surface px-3 text-center shadow-card ${semRede || (falhou && tentativa >= TENTATIVAS_MAX) ? '' : 'animate-pulse'} ${className}`}
      >
        <svg className="h-6 w-6 shrink-0 text-dim" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {semRede
            ? <><path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0" /><path d="M3 3l18 18" /></>
            : <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10 9.5v5l4.5-2.5z" /></>}
        </svg>
        <p className="text-[13px] font-semibold leading-tight text-muted">
          {semRede ? 'Vídeo indisponível offline' : falhou && tentativa >= TENTATIVAS_MAX ? 'Vídeo indisponível no momento' : 'Carregando vídeo…'}
        </p>
      </div>
    );
  }

  return (
    <video
      key={fonte}
      src={fonte}
      // `muted` e `playsInline` não são estética: sem eles o iOS bloqueia o
      // autoplay e/ou abre o vídeo em tela cheia por cima do treino.
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      onError={() => setFalhou(true)}
      // Sem tamanho nem `object-*` aqui de propósito: um lugar quer o vídeo
      // preenchendo a largura, outro quer ele cabendo na altura que sobrou.
      // Definir os dois aqui faria as classes brigarem pela ordem do CSS — não
      // pela ordem em que aparecem no `className`, que é o que se esperaria.
      className={`rounded-lg bg-surface-2 ${className}`}
    />
  );
}
