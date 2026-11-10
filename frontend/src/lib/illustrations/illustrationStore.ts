// Armazenamento offline das ilustrações de exercício geradas por IA.
//
// Diferente dos vídeos (~95 MB, catálogo inteiro), aqui só se guarda o que a
// pessoa realmente viu: o servidor recomprime para JPEG (~100-200 KB), então
// guardar sob demanda custa pouco. Directory.Data pelo mesmo motivo dos vídeos:
// Cache é o que o sistema limpa justamente quando a pessoa está offline.

import { Directory, Filesystem } from '@capacitor/filesystem';
import { exerciseIllustrationsApi } from '../../api/exerciseIllustrations';

const PASTA = 'ilustracoes';

/** Mesma normalização do servidor (chaveIlustracao): caixa e espaços. */
export function chaveDaIlustracao(nome: string): string {
  return nome.trim().split(/\s+/).join(' ').toLowerCase();
}

function caminho(nome: string): string {
  return `${PASTA}/${encodeURIComponent(chaveDaIlustracao(nome))}.txt`;
}

// Memória da sessão: evita ler o disco de novo a cada render.
const memoria = new Map<string, string>();

function blobParaDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result));
    leitor.onerror = () => reject(leitor.error);
    leitor.readAsDataURL(blob);
  });
}

async function lerDoDisco(nome: string): Promise<string | null> {
  try {
    const { data } = await Filesystem.readFile({
      path: caminho(nome),
      directory: Directory.Data,
      encoding: 'utf8' as never,
    });
    return typeof data === 'string' && data.startsWith('data:image/') ? data : null;
  } catch {
    return null;
  }
}

async function gravarNoDisco(nome: string, dataUrl: string): Promise<void> {
  try {
    await Filesystem.writeFile({
      path: caminho(nome),
      directory: Directory.Data,
      data: dataUrl,
      encoding: 'utf8' as never,
      recursive: true,
    });
  } catch {
    // Sem espaço ou sem permissão: a imagem segue valendo online, só não offline.
  }
}

/**
 * Imagem da ilustração como data URL: do disco se já veio, senão da rede (e
 * guarda). Devolve null quando não há como obtê-la agora (offline sem cópia,
 * ou o servidor não a tem).
 */
export async function carregarIlustracao(nome: string, online: boolean): Promise<string | null> {
  const chave = chaveDaIlustracao(nome);
  const emMemoria = memoria.get(chave);
  if (emMemoria) return emMemoria;
  const doDisco = await lerDoDisco(nome);
  if (doDisco) {
    memoria.set(chave, doDisco);
    return doDisco;
  }
  if (!online) return null;
  try {
    const dataUrl = await blobParaDataUrl(await exerciseIllustrationsApi.imageBlob(nome));
    memoria.set(chave, dataUrl);
    await gravarNoDisco(nome, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}
