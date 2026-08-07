import { describe, expect, it } from 'vitest';
import { nomeDeArquivo } from '../videoStore';

// Estes testes existem por causa de uma restrição que não é negociável: o nome
// do exercício é a chave de identificação em todo o sistema — no catálogo, nos
// caminhos dos objetos do bucket e na tabela de vínculo do servidor. Ele nunca
// pode ser normalizado, virar slug, perder acento ou mudar de caixa. Só o nome
// do ARQUIVO em disco é codificado, e a codificação tem de ser reversível.
describe('nome do arquivo em disco', () => {
  it('é reversível para nomes com acento, espaço e parênteses', () => {
    const nomes = [
      'Rosca martelo',
      'Abdução Lateral do Quadril com Alavanca',
      'Tríceps testa com barra',
      'Peso muerto piernas rígidas con barra',
      'Hiperextensão',
      'Remada Alta (1)',
      'Leg Press 45°',
      'Barra fixa com L-sit',
      'Cópia de Abdominal de Rã com Bola de Exercícios',
    ];
    for (const nome of nomes) {
      const arquivo = nomeDeArquivo(nome, 'webm');
      const recuperado = decodeURIComponent(arquivo.slice(0, arquivo.lastIndexOf('.')));
      expect(recuperado).toBe(nome);
    }
  });

  it('preserva os bytes originais em NFC, sem decompor o acento', () => {
    const nome = 'Abdução';
    const arquivo = nomeDeArquivo(nome, 'webm');
    const recuperado = decodeURIComponent(arquivo.slice(0, arquivo.lastIndexOf('.')));
    // Se algo no caminho normalizasse para NFD, o texto pareceria igual na
    // tela mas teria outro comprimento — e o vínculo com o bucket quebraria.
    expect(recuperado.normalize('NFC')).toBe(recuperado);
    expect(recuperado.length).toBe(nome.length);
  });

  it('não produz separador de diretório a partir do nome', () => {
    // Um nome com barra viraria subpasta e o arquivo sumiria do readdir.
    const arquivo = nomeDeArquivo('a/b', 'webm');
    expect(arquivo).not.toContain('/');
    expect(decodeURIComponent(arquivo.slice(0, arquivo.lastIndexOf('.')))).toBe('a/b');
  });

  it('usa a extensão do formato pedido', () => {
    expect(nomeDeArquivo('Rosca martelo', 'mp4')).toBe('Rosca%20martelo.mp4');
    expect(nomeDeArquivo('Rosca martelo', 'webm')).toBe('Rosca%20martelo.webm');
  });

  it('gera nomes distintos para exercícios distintos', () => {
    const a = nomeDeArquivo('Supino Reto', 'webm');
    const b = nomeDeArquivo('Supino reto', 'webm');
    // Caixa diferente é exercício diferente no catálogo: colidir sobrescreveria
    // um vídeo com o outro.
    expect(a).not.toBe(b);
  });
});
