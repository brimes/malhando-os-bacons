import { useCallback, useEffect, useState } from 'react';
import { Card } from './Card';
import { Button } from './Button';
import { SectionTitle, Toggle } from './perfil/ui';
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
    <section>
      <SectionTitle>Vídeos dos exercícios</SectionTitle>
      <Card className="space-y-4">
        <div>
          <p className="num text-[32px] leading-[1.05] text-fg">
            {uso === null ? '...' : uso.arquivos}
            <span className="ml-2 font-sans text-[15px] font-semibold text-muted">
              {uso === null ? 'calculando' : `vídeo${uso.arquivos === 1 ? '' : 's'} no aparelho, ${formatarBytes(uso.bytes)}`}
            </span>
          </p>
          <p className="mt-2 text-[15px] leading-[1.45] text-muted">
            Ficam guardados no aparelho para tocar sem internet, inclusive em modo avião.
            {faltam ? ` Faltam ${faltam}.` : ''}
          </p>
        </div>
      </Card>

      <div className="mt-3 overflow-hidden rounded-lg bg-surface shadow-card">
        <Toggle
          checked={dadosMoveis}
          onChange={(novo) => {
            setDadosMoveis(novo);
            definirPermiteDadosMoveis(novo);
          }}
          label="Baixar usando dados móveis"
          hint="Desligado, os vídeos só baixam no Wi-Fi. São cerca de 95 MB no total."
        />
      </div>

      {progresso && progresso.total > 0 && (
        <p className="mt-3 px-1 text-[15px] font-semibold text-brand-fg">
          Baixando {progresso.baixados} de {progresso.total}
        </p>
      )}
      {erro && <p className="mt-3 px-1 text-[15px] text-danger" role="alert">{erro}</p>}

      <div className="mt-3 flex gap-2">
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
    </section>
  );
}
