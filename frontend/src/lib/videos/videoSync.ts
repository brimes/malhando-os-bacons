// Quando o acervo de vídeos é baixado, e sob qual rede.
//
// Separado de `videoStore.ts` pelo mesmo motivo que `nutritionSync.ts` é
// separado dos repositórios: um sabe baixar, o outro decide quando. Aqui não
// há nada sobre arquivos, e lá não há nada sobre rede ou ciclo de vida do app.

import { Network } from '@capacitor/network';
import { carregarIndice, baixarAcervo, ErroDiscoCheio } from './videoStore';

/**
 * Preferência DESTE aparelho, não da conta: quem paga o plano de dados é quem
 * segura o telefone, e a mesma pessoa pode ter um aparelho com franquia larga
 * e outro sem. Por isso localStorage e não a API de configurações.
 */
const CHAVE_DADOS_MOVEIS = 'mob_videos_dados_moveis';

export function permiteDadosMoveis(): boolean {
  return localStorage.getItem(CHAVE_DADOS_MOVEIS) === '1';
}

export function definirPermiteDadosMoveis(permite: boolean): void {
  localStorage.setItem(CHAVE_DADOS_MOVEIS, permite ? '1' : '0');
}

/**
 * Se a rede atual serve para baixar 95 MB.
 *
 * `unknown` conta como permitida: o plugin devolve isso em alguns aparelhos
 * mesmo com Wi-Fi ligado, e tratar como recusa deixaria o acervo sem baixar
 * para sempre, sem nada na tela explicando por quê.
 */
async function redeServeParaBaixar(): Promise<boolean> {
  try {
    const status = await Network.getStatus();
    if (!status.connected) return false;
    if (status.connectionType === 'wifi' || status.connectionType === 'unknown') return true;
    return permiteDadosMoveis();
  } catch {
    return false;
  }
}

let iniciado = false;

/**
 * Carrega o índice do disco e, quando a rede permitir, completa o acervo.
 *
 * O índice é carregado SEMPRE, inclusive offline e em rede móvel: ele é o que
 * as telas consultam para saber se há vídeo local, e ele vem do disco, não da
 * rede. Só o download é que espera o Wi-Fi.
 */
export function iniciarSincronizacaoDeVideos(): void {
  if (iniciado) return;
  iniciado = true;

  const tentar = async () => {
    // Sem sessão o servidor responde 401 nos endpoints de vídeo, e no MOB um
    // 401 derruba a sessão e manda para o login — foi assim que a tela de
    // login entrou em ciclo no iOS. Mesma guarda que `nutritionSync` usa.
    if (!localStorage.getItem('mob_token')) return;
    if (!(await redeServeParaBaixar())) return;
    try {
      await baixarAcervo();
    } catch (erro) {
      if (erro instanceof ErroDiscoCheio) {
        // Não adianta insistir: sem espaço, toda tentativa falha igual. A tela
        // de Configurações mostra o ocupado e oferece limpar.
        return;
      }
    }
  };

  void carregarIndice().then(() => {
    void tentar();
    // Ao voltar para o Wi-Fi, completa o que faltou.
    void Network.addListener('networkStatusChange', () => {
      void tentar();
    });
  });
}
