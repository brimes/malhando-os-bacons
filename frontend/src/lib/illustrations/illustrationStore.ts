// Armazenamento offline das ilustrações de movimento (N quadros) geradas por IA.
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

// Layout em disco, por exercício (chave normalizada):
//   <chave>.<i>.txt  um quadro (data URL)
//   <chave>.json     manifesto {"frames":N}, gravado DEPOIS de todos os quadros:
//                    sem ele a cópia é incompleta e não conta.
//   <chave>.txt      ilustração antiga (imagem única); ainda serve offline, mas
//                    conta como desatualizada.
function base(nome: string): string {
  return `${PASTA}/${encodeURIComponent(chaveDaIlustracao(nome))}`;
}

export interface IlustracaoCarregada {
  quadros: string[];
  /** Versão antiga (imagem única): online, o app pede a regeneração. */
  desatualizada: boolean;
}

// Memória da sessão: evita ler o disco de novo a cada render.
const memoria = new Map<string, string[]>();

function blobParaDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result));
    leitor.onerror = () => reject(leitor.error);
    leitor.readAsDataURL(blob);
  });
}

async function lerTexto(path: string): Promise<string | null> {
  try {
    const { data } = await Filesystem.readFile({ path, directory: Directory.Data, encoding: 'utf8' as never });
    return typeof data === 'string' ? data : null;
  } catch {
    return null;
  }
}

async function lerImagem(path: string): Promise<string | null> {
  const data = await lerTexto(path);
  return data && data.startsWith('data:image/') ? data : null;
}

async function gravar(path: string, data: string): Promise<boolean> {
  try {
    await Filesystem.writeFile({ path, directory: Directory.Data, data, encoding: 'utf8' as never, recursive: true });
    return true;
  } catch {
    // Sem espaço ou sem permissão: segue valendo online, só não offline.
    return false;
  }
}

async function apagar(path: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ path, directory: Directory.Data });
  } catch {
    // Não existia.
  }
}

async function lerDoDisco(nome: string): Promise<IlustracaoCarregada | null> {
  const manifesto = await lerTexto(`${base(nome)}.json`);
  if (manifesto) {
    try {
      const n = Number((JSON.parse(manifesto) as { frames?: number }).frames);
      if (Number.isInteger(n) && n >= 1 && n <= 4) {
        const quadros: string[] = [];
        for (let i = 0; i < n; i += 1) {
          const q = await lerImagem(`${base(nome)}.${i}.txt`);
          if (!q) return null;
          quadros.push(q);
        }
        return { quadros, desatualizada: false };
      }
    } catch {
      // Manifesto corrompido: cai para a cópia antiga, se houver.
    }
  }
  const antiga = await lerImagem(`${base(nome)}.txt`);
  return antiga ? { quadros: [antiga], desatualizada: true } : null;
}

/** Apaga a cópia local (memória e disco): chamado quando o servidor regenera. */
export async function invalidarIlustracao(nome: string): Promise<void> {
  memoria.delete(chaveDaIlustracao(nome));
  await apagar(`${base(nome)}.json`);
  await apagar(`${base(nome)}.txt`);
  for (let i = 0; i < 4; i += 1) await apagar(`${base(nome)}.${i}.txt`);
}

/**
 * Quadros da ilustração como data URLs: do disco se já vieram, senão da rede
 * (e guarda todos). Devolve null quando não há como obtê-los agora (offline
 * sem cópia, ou o servidor não a tem).
 *
 * Uma API antiga não manda `frames`: conta como 1 quadro.
 */
export async function carregarIlustracao(nome: string, online: boolean): Promise<IlustracaoCarregada | null> {
  const chave = chaveDaIlustracao(nome);
  const emMemoria = memoria.get(chave);
  if (emMemoria) return { quadros: emMemoria, desatualizada: false };
  const doDisco = await lerDoDisco(nome);
  if (doDisco) {
    if (!doDisco.desatualizada) memoria.set(chave, doDisco.quadros);
    return doDisco;
  }
  if (!online) return null;
  try {
    const estado = await exerciseIllustrationsApi.status(nome);
    if (estado.status === 'outdated') return { quadros: [], desatualizada: true };
    if (estado.status !== 'ready') return null;
    const n = Math.min(4, Math.max(1, Math.floor(estado.frames ?? 1)));
    const quadros: string[] = [];
    for (let i = 0; i < n; i += 1) {
      quadros.push(await blobParaDataUrl(await exerciseIllustrationsApi.imageBlob(nome, i)));
    }
    memoria.set(chave, quadros);
    let ok = true;
    for (let i = 0; i < n && ok; i += 1) ok = await gravar(`${base(nome)}.${i}.txt`, quadros[i]);
    if (ok) await gravar(`${base(nome)}.json`, JSON.stringify({ frames: n }));
    return { quadros, desatualizada: false };
  } catch {
    return null;
  }
}
