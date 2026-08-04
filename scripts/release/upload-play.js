#!/usr/bin/env node
/**
 * Envia um AAB para uma trilha da Google Play, via Play Developer API.
 *
 * Escrito em Node puro de propósito: o fastlane resolveria isso, mas traria
 * Ruby e um Gemfile para um repositório que não tem nenhum dos dois. A API é
 * quatro chamadas.
 *
 * Uso:
 *   GOOGLE_PLAY_SERVICE_ACCOUNT=~/mob-release-keys/play-service-account.json \
 *   node scripts/release/upload-play.js <caminho-do-aab> [trilha]
 *
 * A trilha padrão é `internal`. Nada é publicado para usuário final aqui:
 * `internal` chega só a quem está na lista de testadores internos do console.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PACKAGE_NAME = 'net.brimes.mob';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const UPLOAD_API = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3';

function credentialsPath() {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error(
      'GOOGLE_PLAY_SERVICE_ACCOUNT não definido. Aponte para o JSON da conta de serviço do Google Play.',
    );
  }
  return raw.startsWith('~') ? path.join(process.env.HOME, raw.slice(1)) : raw;
}

/** Troca o JWT assinado pela conta de serviço por um access token OAuth2. */
async function accessToken() {
  const creds = JSON.parse(fs.readFileSync(credentialsPath(), 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = b64({ alg: 'RS256', typ: 'JWT' });
  const claims = b64({
    iss: creds.client_email,
    scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });
  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), creds.private_key)
    .toString('base64url');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`OAuth falhou: ${JSON.stringify(body).slice(0, 300)}`);
  return body.access_token;
}

async function api(token, url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const detail = body?.error?.message ?? String(text).slice(0, 400);
    throw new Error(`HTTP ${res.status} — ${detail}`);
  }
  return body;
}

async function main() {
  const [aabPath, track = 'internal'] = process.argv.slice(2);
  if (!aabPath || !fs.existsSync(aabPath)) {
    throw new Error(`AAB não encontrado: ${aabPath ?? '(caminho não informado)'}`);
  }

  const token = await accessToken();

  // Uma "edit" é a transação: nada do que vai abaixo tem efeito até o commit.
  const edit = await api(token, `${API}/applications/${PACKAGE_NAME}/edits`, { method: 'POST' });
  console.log(`edit aberta: ${edit.id}`);

  const aab = fs.readFileSync(aabPath);
  const uploaded = await api(
    token,
    `${UPLOAD_API}/applications/${PACKAGE_NAME}/edits/${edit.id}/bundles?uploadType=media`,
    { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: aab },
  );
  console.log(`AAB enviado: versionCode ${uploaded.versionCode} (${(aab.length / 1024 / 1024).toFixed(1)} MB)`);

  await api(token, `${API}/applications/${PACKAGE_NAME}/edits/${edit.id}/tracks/${track}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      track,
      releases: [{ versionCodes: [String(uploaded.versionCode)], status: 'completed' }],
    }),
  });
  console.log(`atribuído à trilha: ${track}`);

  await api(token, `${API}/applications/${PACKAGE_NAME}/edits/${edit.id}:commit`, { method: 'POST' });
  console.log(`commit feito — versionCode ${uploaded.versionCode} está em ${track}`);
}

main().catch((error) => {
  console.error(`ERRO: ${error.message}`);
  process.exit(1);
});
