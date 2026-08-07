import { useCallback, useEffect, useState } from 'react';
import { Card } from './Card';
import { Button } from './Button';
import {
  baixarAcervo,
  espacoOcupado,
  limparVideos,
  obterCatalogo,
  ErroDiscoCheio,
  type ProgressoDownload,
} from '../lib/videos/videoStore';
import { definirPermiteDadosMoveis, permiteDadosMoveis } from '../lib/videos/videoSync';

function formatarBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Espaço ocupado pelos vídeos de exercício, e o que fazer a respeito.
 *
 * Existe porque o app baixa o acervo inteiro (~95 MB) e ninguém deve descobrir
 * isso pela tela de armazenamento do sistema, sem saber o que foi que cresceu
 * nem como desfazer.
 */
export function ExerciseVideoSettings() {
  const [uso, setUso] = useState<{ arquivos: number; bytes: number } | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [dadosMoveis, setDadosMoveis] = useState(permiteDadosMoveis);
  const [progresso, setProgresso] = useState<ProgressoDownload | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const atualizar = useCallback(async () => {
    setUso(await espacoOcupado());
    const catalogo = await obterCatalogo();
    if (catalogo.length) setTotal(catalogo.length);
  }, []);

  useEffect(() => {
    void atualizar();
  }, [atualizar]);

  const baixar = async () => {
    setOcupado(true);
    setErro(null);
    try {
      await baixarAcervo(setProgresso);
    } catch (falha) {
      setErro(
        falha instanceof ErroDiscoCheio
          ? 'Não há espaço no aparelho. Libere espaço e tente de novo.'
          : 'Não foi possível baixar agora. Tente mais tarde.',
      );
    } finally {
      setProgresso(null);
      setOcupado(false);
      void atualizar();
    }
  };

  const limpar = async () => {
    if (!window.confirm('Apagar os vídeos baixados? Eles podem ser baixados de novo depois.')) return;
    setOcupado(true);
    await limparVideos();
    setOcupado(false);
    void atualizar();
  };

  const faltam = total !== null && uso !== null ? Math.max(0, total - uso.arquivos) : null;

  return (
    <div>
      <h3 className="mb-3 px-1 text-xs uppercase tracking-wide text-zinc-500">Vídeos dos exercícios</h3>
      <Card className="space-y-4">
        <div>
          <p className="text-sm text-zinc-300">
            {uso === null
              ? 'Calculando…'
              : `${uso.arquivos} vídeo${uso.arquivos === 1 ? '' : 's'} no aparelho · ${formatarBytes(uso.bytes)}`}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            Ficam guardados no aparelho para tocar sem internet, inclusive em modo avião.
            {faltam ? ` Faltam ${faltam}.` : ''}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            const novo = !dadosMoveis;
            setDadosMoveis(novo);
            definirPermiteDadosMoveis(novo);
          }}
          className="flex w-full items-center justify-between gap-4 text-left"
        >
          <span>
            <span className="block text-sm font-medium text-white">Baixar usando dados móveis</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-zinc-500">
              Desligado, os vídeos só baixam no Wi-Fi. São cerca de 95 MB no total.
            </span>
          </span>
          <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${dadosMoveis ? 'bg-primary-600' : 'bg-zinc-700'}`}>
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${dadosMoveis ? 'left-6' : 'left-1'}`} />
          </span>
        </button>

        {progresso && progresso.total > 0 && (
          <p className="text-xs text-primary-400">
            Baixando… {progresso.baixados} de {progresso.total}
          </p>
        )}
        {erro && <p className="text-xs text-red-400">{erro}</p>}

        <div className="flex gap-2">
          {faltam !== 0 && (
            <Button variant="secondary" fullWidth onClick={baixar} isLoading={ocupado}>
              Baixar agora
            </Button>
          )}
          {uso !== null && uso.arquivos > 0 && (
            <Button variant="ghost" fullWidth onClick={limpar} disabled={ocupado}>
              Apagar vídeos
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
