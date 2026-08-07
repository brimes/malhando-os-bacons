#!/usr/bin/env node
// Gera `backend/internal/services/exercise_catalog.json` a partir do
// `catalog-bucket.json`, que é a fonte da verdade e vive no bucket.
//
// O que ele faz é só descartar os campos que o backend não usa (`thumbnail` e
// `description`), o que leva o arquivo de 361 KB para 167 KB. Os nomes são
// copiados byte a byte: eles são a chave de identificação do exercício no
// bucket, na tabela de vínculo e nos caminhos dos objetos, e qualquer
// normalização — NFD, slug, minúscula — quebraria o vínculo em silêncio.
//
// Uso:
//   gsutil cp gs://malhando-os-bacons-exercicios/catalog-bucket.json /tmp/
//   node scripts/gerar-catalogo-exercicios.js /tmp/catalog-bucket.json

const fs = require('fs');
const path = require('path');

const entrada = process.argv[2];
if (!entrada) {
  console.error('uso: node scripts/gerar-catalogo-exercicios.js <catalog-bucket.json>');
  process.exit(1);
}

const bruto = JSON.parse(fs.readFileSync(entrada, 'utf8'));
const exercicios = bruto.exercicios ?? [];

const problemas = [];
const enxuto = exercicios.map((e) => {
  // O caminho do objeto termina com o nome exato. Se isso deixar de valer, o
  // vínculo aponta para um arquivo que não é o daquele exercício — e nada
  // depois disso perceberia.
  if (!e.objeto_webm?.endsWith(`/${e.name}.webm`)) problemas.push(`webm não bate com o nome: ${e.name}`);
  if (!e.objeto_mp4?.endsWith(`/${e.name}.mp4`)) problemas.push(`mp4 não bate com o nome: ${e.name}`);
  if (e.name !== e.name.normalize('NFC')) problemas.push(`nome fora de NFC: ${e.name}`);
  return { nome: e.name, webm: e.objeto_webm, mp4: e.objeto_mp4 };
});

const repetidos = enxuto.length - new Set(enxuto.map((e) => e.nome)).size;
if (repetidos > 0) problemas.push(`${repetidos} nome(s) repetido(s): a chave deixaria de ser única`);

if (problemas.length) {
  console.error('catálogo inconsistente, nada foi gravado:');
  for (const p of problemas.slice(0, 20)) console.error('  - ' + p);
  process.exit(1);
}

const saida = path.join(__dirname, '..', 'backend', 'internal', 'services', 'exercise_catalog.json');
fs.writeFileSync(saida, JSON.stringify(enxuto));
console.log(`${enxuto.length} exercícios gravados em ${path.relative(process.cwd(), saida)}`);
console.log('rode os testes do backend: eles conferem a contagem e os caminhos.');
