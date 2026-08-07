import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import { formatoDaPlataforma, fonteLocal } from '../lib/videos/videoStore';
import { isNetworkOnline } from '../lib/offline';
import type { ExerciseVideo } from '../types';

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
  }, [video]);

  // Sem vídeo para este exercício, ou nem local nem rede: não ocupa espaço na
  // tela. A ausência de vídeo nunca é erro — a maioria dos exercícios do
  // catálogo casa, mas nem todos, e o exercício vale sem a demonstração.
  if (!video || falhou || !fonte) return null;

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
      className={`w-full rounded-2xl bg-zinc-900 object-cover ${className}`}
    />
  );
}
