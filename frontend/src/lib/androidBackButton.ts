// O botão voltar do Android saía do app de qualquer tela, porque nada escutava
// o evento: sem listener, o Capacitor deixa o comportamento padrão da
// Activity, que é encerrar. Numa navegação de cinco níveis isso significa
// perder tudo e voltar para a área de trabalho.
//
// Fica aqui, fora do React, porque o listener é do ciclo de vida do app e não
// de nenhuma tela — registrar por componente daria um listener por montagem.

import { App } from '@capacitor/app';

/** Telas em que voltar não faz sentido: são o começo do fluxo, não um passo. */
const RAIZES = new Set(['/', '/login', '/onboarding']);

let registrado = false;

export function registerAndroidBackButton(): void {
  if (registrado) return;
  registrado = true;

  void App.addListener('backButton', () => {
    const naRaiz = RAIZES.has(window.location.pathname);

    // Fora da raiz: volta uma tela, como o gesto de voltar do iOS. `history.back()`
    // e não `navigate(-1)` porque isto vive fora do Router — e o histórico é o
    // mesmo que ele usa, então o resultado é idêntico.
    if (!naRaiz && window.history.length > 1) {
      window.history.back();
      return;
    }

    // Na raiz, sair é o comportamento correto e esperado do Android — mas
    // minimizar, não encerrar: encerrar mataria a fila offline em memória antes
    // de ela drenar, e o usuário perderia o que registrou sem sinal.
    void App.minimizeApp();
  });
}
