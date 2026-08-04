#!/usr/bin/env node
/**
 * Sobe o número de build das duas plataformas juntas.
 *
 * Play e App Store recusam pacote com número já usado, e manter os dois em
 * contadores separados torna impossível olhar um aparelho e saber de que
 * commit ele veio. Aqui `versionCode` (Android) e `CURRENT_PROJECT_VERSION`
 * (iOS) andam sempre no mesmo número.
 *
 * Uso:
 *   node scripts/release/bump-version.js            # só incrementa o build
 *   node scripts/release/bump-version.js 1.1.0      # build + versão de marketing
 *   node scripts/release/bump-version.js --print    # mostra o estado atual
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const GRADLE = path.join(ROOT, 'frontend/android/app/build.gradle');
const PBXPROJ = path.join(ROOT, 'frontend/ios/App/App.xcodeproj/project.pbxproj');

function read(file) {
  if (!fs.existsSync(file)) throw new Error(`arquivo não encontrado: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

function current() {
  const gradle = read(GRADLE);
  const code = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
  const name = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
  if (!Number.isFinite(code) || !name) throw new Error('não consegui ler versionCode/versionName do build.gradle');

  const pbx = read(PBXPROJ);
  const iosBuilds = [...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map((m) => Number(m[1]));
  const iosNames = [...pbx.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1]);
  return { code, name, iosBuilds, iosNames };
}

function main() {
  const arg = process.argv[2];
  const state = current();

  if (arg === '--print') {
    console.log(`Android: versionCode ${state.code}, versionName ${state.name}`);
    console.log(`iOS:     CURRENT_PROJECT_VERSION ${[...new Set(state.iosBuilds)].join('/')}, MARKETING_VERSION ${[...new Set(state.iosNames)].join('/')}`);
    return;
  }

  // O maior dos dois é a referência: se uma plataforma subiu sozinha em algum
  // momento, voltar atrás faria a loja recusar o pacote por número repetido.
  const nextBuild = Math.max(state.code, ...state.iosBuilds) + 1;
  const nextName = arg && /^\d+\.\d+\.\d+$/.test(arg) ? arg : state.name;
  if (arg && arg !== nextName) throw new Error(`versão inválida: "${arg}" (esperado algo como 1.1.0)`);

  fs.writeFileSync(
    GRADLE,
    read(GRADLE)
      .replace(/versionCode\s+\d+/, `versionCode ${nextBuild}`)
      .replace(/versionName\s+"[^"]+"/, `versionName "${nextName}"`),
  );

  fs.writeFileSync(
    PBXPROJ,
    read(PBXPROJ)
      .replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${nextBuild};`)
      .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${nextName};`),
  );

  console.log(`build ${state.code} -> ${nextBuild}, versão ${state.name} -> ${nextName}`);
}

try {
  main();
} catch (error) {
  console.error(`ERRO: ${error.message}`);
  process.exit(1);
}
