import { Capacitor } from '@capacitor/core';

// Valores públicos (não são segredos), versionados de propósito. Enquanto
// começarem com 'TODO_' o botão correspondente não aparece.

/** Client ID do tipo "Web application" no Google Cloud. Usado no Android (requestIdToken) e como audience do backend. */
export const GOOGLE_WEB_CLIENT_ID = 'TODO_GOOGLE_WEB_CLIENT_ID.apps.googleusercontent.com';

/** Client ID do tipo "iOS" no Google Cloud (bundle net.brimes.mob). */
export const GOOGLE_IOS_CLIENT_ID = 'TODO_GOOGLE_IOS_CLIENT_ID.apps.googleusercontent.com';

/**
 * Só documentação: o valor real é `com.googleusercontent.apps.<id>` e deve
 * substituir 'TODO_GOOGLE_IOS_REVERSED_CLIENT_ID' em ios/App/App/Info.plist
 * (CFBundleURLTypes). Sem isso o retorno do login Google no iOS não volta ao app.
 */
export const GOOGLE_IOS_REVERSED_CLIENT_ID = 'TODO_GOOGLE_IOS_REVERSED_CLIENT_ID';

export const APPLE_BUNDLE_ID = 'net.brimes.mob';

/** Client ID a passar ao plugin na plataforma atual, ou '' se ainda não configurado. */
export function googleClientIdForPlatform(): string {
  const platform = Capacitor.getPlatform();
  const id = platform === 'ios' ? GOOGLE_IOS_CLIENT_ID : platform === 'android' ? GOOGLE_WEB_CLIENT_ID : '';
  return id.startsWith('TODO_') ? '' : id;
}
