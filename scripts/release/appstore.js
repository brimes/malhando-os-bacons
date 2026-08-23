#!/usr/bin/env node
/**
 * Consulta e vincula builds na App Store Connect.
 *
 * Contraparte do `upload-play.js`, e escrito em Node puro pelo mesmo motivo:
 * a alternativa (fastlane) traria Ruby e um Gemfile para um repositório que não
 * tem nenhum dos dois, e aqui são duas chamadas.
 *
 * O envio do binário continua sendo `xcrun altool --upload-app`, que já vem com
 * o Xcode. O que falta depois dele é justamente isto: saber se a build
 * processou e apontá-la na versão que vai para revisão.
 *
 * Uso:
 *   node scripts/release/appstore.js state
 *   node scripts/release/appstore.js attach 13
 *
 * A chave da API fica em ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8.
 */
const fs = require('fs');
const crypto = require('crypto');

const KEY_ID = process.env.ASC_KEY_ID || '3QC2759Z7L';
const ISSUER = process.env.ASC_ISSUER || '5e7d90eb-3bd8-4505-8625-1ab723d2676f';
const APP_ID = process.env.ASC_APP_ID || '6797657395';
const API = 'https://api.appstoreconnect.apple.com';

/** JWT ES256 assinado com a chave da conta; vale 15 minutos, o teto da Apple. */
function token() {
  const keyPath = `${process.env.HOME}/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8`;
  if (!fs.existsSync(keyPath)) throw new Error(`chave da App Store Connect não encontrada: ${keyPath}`);
  const key = fs.readFileSync(keyPath, 'utf8');
  const now = Math.floor(Date.now() / 1000);
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = b64({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' });
  const payload = b64({ iss: ISSUER, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' });
  const signer = crypto.createSign('SHA256');
  signer.update(`${header}.${payload}`);
  // ieee-p1363, não DER: é o formato de assinatura que JWT ES256 exige.
  return `${header}.${payload}.${signer.sign({ key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

async function api(jwt, method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const detail = data?.errors?.[0]?.detail ?? String(text).slice(0, 300);
    throw new Error(`HTTP ${res.status} — ${detail}`);
  }
  return data;
}

async function main() {
  const [command, arg] = process.argv.slice(2);
  const jwt = token();

  const builds = (await api(jwt, 'GET', `/v1/builds?filter[app]=${APP_ID}&limit=5&sort=-version`)).data;
  const version = (await api(jwt, 'GET', `/v1/apps/${APP_ID}/appStoreVersions?limit=1`)).data[0];
  const atual = await api(jwt, 'GET', `/v1/appStoreVersions/${version.id}/build`).catch(() => ({ data: null }));

  console.log(`versão ${version.attributes.versionString} — ${version.attributes.appStoreState}`);
  console.log(`build vinculada: ${atual.data ? atual.data.attributes.version : '(nenhuma)'}\n`);
  console.log('builds enviadas:');
  for (const b of builds) console.log(`  ${b.attributes.version} — ${b.attributes.processingState}`);

  if (command === 'attach') {
    const alvo = builds.find((b) => b.attributes.version === String(arg));
    if (!alvo) throw new Error(`build ${arg} não encontrada entre as 5 mais recentes`);
    // Vincular uma build ainda em processamento falha com um erro obscuro;
    // recusar aqui deixa claro que é só esperar.
    if (alvo.attributes.processingState !== 'VALID') {
      throw new Error(`build ${arg} ainda está em ${alvo.attributes.processingState} — espere e tente de novo`);
    }
    await api(jwt, 'PATCH', `/v1/appStoreVersions/${version.id}/relationships/build`, {
      data: { type: 'builds', id: alvo.id },
    });
    const conferido = await api(jwt, 'GET', `/v1/appStoreVersions/${version.id}/build`);
    console.log(`\nvinculada: build ${conferido.data.attributes.version}`);
  }
}

main().catch((error) => {
  console.error(`ERRO: ${error.message}`);
  process.exit(1);
});
