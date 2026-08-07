// Acervo local dos vídeos demonstrativos de exercício.
//
// A regra que organiza tudo aqui: **assina uma vez, no download; nunca na
// reprodução.** Um vídeo já baixado toca do disco, sem rede e sem URL assinada.
// É o que faz o treino funcionar em modo avião, que é o cenário para o qual
// isto existe — academia com sinal ruim.
//
// O disco é o índice. Não existe registro paralelo do que foi baixado: um
// `readdir` na pasta devolve nome, tamanho e URI de cada arquivo, e é dele que
// o índice em memória é montado no boot. Manter uma lista à parte criaria a
// possibilidade de ela discordar do disco — o app acharia que tem um vídeo que
// não está lá, ou baixaria de novo o que já tem —, e nada aqui precisa disso.

import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { apiClient } from '../../api/client';
import { isNetworkOnline } from '../offline';
import { getRecord, putRecord } from '../localDb';
import type { ExerciseVideo } from '../../types';

/** Uma entrada do catálogo, como o servidor devolve. */
export interface ExercicioCatalogo {
  nome: string;
  webm: string;
  mp4: string;
}

/** Pasta dentro de Directory.Data. */
const PASTA = 'videos';

/**
 * `Directory.Data` e não `Directory.Cache`: o sistema operacional pode limpar
 * `Cache` quando quiser, e o vídeo sumiria exatamente no cenário que isto
 * existe para resolver — a pessoa offline, na academia.
 */
const DIRETORIO = Directory.Data;

const CHAVE_CATALOGO = 'exercise_video_catalog';
/** O catálogo muda junto com o conteúdo do bucket, que é raro. */
const VALIDADE_CATALOGO_MS = 24 * 60 * 60 * 1000;

/** O servidor assina no máximo 200 objetos por requisição. */
const OBJETOS_POR_LOTE = 200;

/**
 * Downloads simultâneos. Os arquivos são pequenos (96 KB em média), então o
 * gargalo é latência, não banda — mas subir demais em rede de celular só gera
 * timeout e retentativa.
 */
const SIMULTANEOS = 4;

/** Um arquivo menor que isto não é vídeo, é um erro que virou arquivo. */
const TAMANHO_MINIMO_BYTES = 1024;

interface ArquivoLocal {
  uri: string;
  tamanho: number;
}

/** nome do catálogo -> arquivo em disco. Montado do disco, no boot. */
let indice = new Map<string, ArquivoLocal>();
let indiceCarregado = false;

/**
 * iOS leva mp4, Android leva webm.
 *
 * O WKWebView só toca WebM em versões recentes do sistema; o H.264 toca em
 * qualquer iOS. No Android o WebM é seguro e ~5% menor. Baixar os dois
 * formatos dobraria o espaço sem servir para nada.
 */
export function formatoDaPlataforma(): 'webm' | 'mp4' {
  return Capacitor.getPlatform() === 'ios' ? 'mp4' : 'webm';
}

/**
 * Nome do arquivo em disco a partir do nome do catálogo.
 *
 * Percent-encoding e não hash: é reversível, então o disco continua legível e
 * o nome original é recuperável sem consultar nada. Verificado sobre os 963
 * nomes — nenhuma colisão, nenhuma perda na ida e volta, 117 bytes no pior
 * caso (o limite comum é 255).
 *
 * O nome do catálogo em si nunca é alterado: só o nome do ARQUIVO é
 * codificado.
 */
export function nomeDeArquivo(nomeCatalogo: string, formato: 'webm' | 'mp4'): string {
  return `${encodeURIComponent(nomeCatalogo)}.${formato}`;
}

function nomeDoCatalogo(nomeArquivo: string): string | null {
  const ponto = nomeArquivo.lastIndexOf('.');
  if (ponto <= 0) return null;
  try {
    return decodeURIComponent(nomeArquivo.slice(0, ponto));
  } catch {
    // Arquivo que não veio daqui. Ignora em vez de derrubar a leitura inteira.
    return null;
  }
}

async function garantirPasta(): Promise<void> {
  try {
    await Filesystem.mkdir({ path: PASTA, directory: DIRETORIO, recursive: true });
  } catch {
    // Já existe — é o caso normal a partir do segundo boot.
  }
}

/**
 * Monta o índice a partir do que está em disco. Idempotente.
 *
 * Arquivos truncados (download interrompido, disco cheio) são apagados aqui em
 * vez de entrarem no índice: arquivo de 0 byte é pior que arquivo ausente,
 * porque o app acha que tem o vídeo e só descobre que não na hora de tocar.
 */
export async function carregarIndice(): Promise<void> {
  if (indiceCarregado) return;
  await garantirPasta();
  const novo = new Map<string, ArquivoLocal>();
  try {
    const { files } = await Filesystem.readdir({ path: PASTA, directory: DIRETORIO });
    for (const arquivo of files) {
      if (arquivo.type === 'directory') continue;
      const nome = nomeDoCatalogo(arquivo.name);
      if (!nome) continue;
      if (arquivo.size < TAMANHO_MINIMO_BYTES) {
        await removerArquivo(arquivo.name);
        continue;
      }
      novo.set(nome, { uri: arquivo.uri, tamanho: arquivo.size });
    }
  } catch {
    // Pasta inacessível: segue com índice vazio. Sem vídeo o app funciona.
  }
  indice = novo;
  indiceCarregado = true;
}

async function removerArquivo(nomeArquivo: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ path: `${PASTA}/${nomeArquivo}`, directory: DIRETORIO });
  } catch {
    // Já não existe.
  }
}

/**
 * Caminho tocável para o vídeo, ou null se ele não está no aparelho.
 *
 * Síncrono de propósito: é chamado no render, e nenhuma tela deve esperar por
 * disco para decidir se mostra um vídeo.
 */
export function fonteLocal(video: ExerciseVideo | undefined): string | null {
  if (!video) return null;
  const arquivo = indice.get(video.catalog_name);
  if (!arquivo) return null;
  // convertFileSrc traduz o caminho nativo para o esquema que o WebView
  // consegue carregar. Sem isso o <video> não abre o arquivo.
  return Capacitor.convertFileSrc(arquivo.uri);
}

export function temVideoLocal(nomeCatalogo: string): boolean {
  return indice.has(nomeCatalogo);
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

interface CatalogoGuardado {
  buscadoEm: number;
  exercicios: ExercicioCatalogo[];
}

/**
 * O catálogo, do cache local quando possível.
 *
 * Offline devolve o que estiver guardado, mesmo vencido: um catálogo velho
 * ainda descreve corretamente os vídeos que já estão no aparelho, e é o que
 * permite a tela de espaço funcionar sem rede.
 */
export async function obterCatalogo(): Promise<ExercicioCatalogo[]> {
  const guardado = await getRecord<{ key: string; value: CatalogoGuardado }>('meta', CHAVE_CATALOGO);
  const valor = guardado?.value;
  const fresco = valor && Date.now() - valor.buscadoEm < VALIDADE_CATALOGO_MS;
  if (fresco) return valor.exercicios;
  if (!isNetworkOnline()) return valor?.exercicios ?? [];

  try {
    const { data } = await apiClient.get<{ exercicios: ExercicioCatalogo[] }>(
      '/exercise-videos/catalog',
    );
    const exercicios = data.exercicios ?? [];
    await putRecord('meta', {
      key: CHAVE_CATALOGO,
      value: { buscadoEm: Date.now(), exercicios } satisfies CatalogoGuardado,
    });
    return exercicios;
  } catch {
    return valor?.exercicios ?? [];
  }
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

export interface ProgressoDownload {
  baixados: number;
  total: number;
}

let baixandoAgora = false;

/**
 * Baixa o que falta do acervo.
 *
 * Baixa o catálogo INTEIRO (963 vídeos, ~95 MB), não só os do treino salvo.
 * A troca é deliberada: espaço em disco por ausência de toda a lógica de ciclo
 * de vida — o que baixar, o que apagar, o que fazer quando a pessoa abre um
 * exercício que ainda não veio. E, principalmente, faz com que corrigir um
 * vínculo no servidor não custe download nenhum: o arquivo já está aqui, só o
 * apontamento muda.
 *
 * Idempotente e seguro para chamar de novo: o que já está em disco é pulado.
 */
export async function baixarAcervo(
  aoProgredir?: (progresso: ProgressoDownload) => void,
): Promise<ProgressoDownload> {
  if (baixandoAgora) return { baixados: 0, total: 0 };
  baixandoAgora = true;
  try {
    await carregarIndice();
    const catalogo = await obterCatalogo();
    const formato = formatoDaPlataforma();

    const faltando = catalogo.filter((e) => !indice.has(e.nome));
    const progresso: ProgressoDownload = { baixados: 0, total: faltando.length };
    if (faltando.length === 0) return progresso;

    for (let inicio = 0; inicio < faltando.length; inicio += OBJETOS_POR_LOTE) {
      if (!isNetworkOnline()) break;
      const lote = faltando.slice(inicio, inicio + OBJETOS_POR_LOTE);
      const objetos = lote.map((e) => (formato === 'mp4' ? e.mp4 : e.webm));

      let urls: Record<string, string>;
      try {
        // Um único pedido para os 200: uma requisição por vídeo seria 963
        // idas ao servidor para baixar 95 MB.
        const { data } = await apiClient.post<{ urls: Record<string, string> }>(
          '/exercise-videos/urls',
          { objetos },
        );
        urls = data.urls ?? {};
      } catch {
        // Sem assinatura não há o que baixar neste lote. Para por aqui e
        // tenta de novo na próxima chamada — o que já baixou continua valendo.
        break;
      }

      await emParalelo(lote, SIMULTANEOS, async (entrada) => {
        const objeto = formato === 'mp4' ? entrada.mp4 : entrada.webm;
        const url = urls[objeto];
        if (!url) return;
        if (await baixarUm(entrada.nome, url, formato)) {
          progresso.baixados += 1;
          aoProgredir?.({ ...progresso });
        }
      });
    }
    return progresso;
  } finally {
    baixandoAgora = false;
  }
}

/**
 * Baixa um vídeo e o registra no índice. Devolve se deu certo.
 *
 * `Filesystem.downloadFile` grava direto em disco por streaming. Baixar via
 * `fetch` + base64 + `writeFile` carregaria o arquivo inteiro na memória —
 * caminho conhecido para derrubar aparelho fraco.
 */
async function baixarUm(nomeCatalogo: string, url: string, formato: 'webm' | 'mp4'): Promise<boolean> {
  const arquivo = nomeDeArquivo(nomeCatalogo, formato);
  const caminho = `${PASTA}/${arquivo}`;
  try {
    await Filesystem.downloadFile({ url, path: caminho, directory: DIRETORIO });
  } catch (erro) {
    // Disco cheio precisa parar o acervo inteiro, não só este arquivo: seguir
    // tentando 900 downloads que vão todos falhar não ajuda ninguém.
    if (pareceDiscoCheio(erro)) throw new ErroDiscoCheio();
    return false;
  }

  // Valida o que chegou. Um 403 (URL vencida) ou uma resposta de portal
  // cativo viram um arquivo pequeno gravado com sucesso — sem esta conferência
  // ele entraria no índice e o app acharia que tem o vídeo.
  try {
    const info = await Filesystem.stat({ path: caminho, directory: DIRETORIO });
    if (info.size < TAMANHO_MINIMO_BYTES) {
      await removerArquivo(arquivo);
      return false;
    }
    indice.set(nomeCatalogo, { uri: info.uri, tamanho: info.size });
    return true;
  } catch {
    await removerArquivo(arquivo);
    return false;
  }
}

export class ErroDiscoCheio extends Error {
  constructor() {
    super('Não há espaço no aparelho para baixar os vídeos.');
    this.name = 'ErroDiscoCheio';
  }
}

function pareceDiscoCheio(erro: unknown): boolean {
  const texto = String((erro as { message?: string })?.message ?? erro).toLowerCase();
  return texto.includes('space') || texto.includes('espaço') || texto.includes('enospc') || texto.includes('quota');
}

/** Executa `tarefa` sobre `itens` com no máximo `limite` em voo. */
async function emParalelo<T>(
  itens: T[],
  limite: number,
  tarefa: (item: T) => Promise<void>,
): Promise<void> {
  let proximo = 0;
  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (proximo < itens.length) {
      const meu = itens[proximo++];
      try {
        await tarefa(meu);
      } catch (erro) {
        if (erro instanceof ErroDiscoCheio) throw erro;
        // Falha de um vídeo não interrompe os outros: ele fica faltando e a
        // próxima passada tenta de novo, porque o índice é montado do disco.
      }
    }
  });
  await Promise.all(trabalhadores);
}

// ---------------------------------------------------------------------------
// Espaço
// ---------------------------------------------------------------------------

export interface UsoDeEspaco {
  arquivos: number;
  bytes: number;
}

export async function espacoOcupado(): Promise<UsoDeEspaco> {
  await carregarIndice();
  let bytes = 0;
  for (const arquivo of indice.values()) bytes += arquivo.tamanho;
  return { arquivos: indice.size, bytes };
}

/** Apaga todos os vídeos. O acervo pode ser baixado de novo a qualquer momento. */
export async function limparVideos(): Promise<void> {
  await carregarIndice();
  const formato = formatoDaPlataforma();
  for (const nome of [...indice.keys()]) {
    await removerArquivo(nomeDeArquivo(nome, formato));
  }
  indice = new Map();
}
