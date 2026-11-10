# MOB: design system (MASTER)

Fonte única de verdade do visual do app. Toda cor, fonte, espaço, raio, sombra e
animação do `frontend/` sai daqui. Valor que não está aqui não entra no código.

Modo: **parcial**. Mantidos sem mudança: a paleta da marca (`primary-*`, `bacon.*`
do `tailwind.config.js`), o logo e os ícones do app. Mudam: tipografia, tamanhos,
componentes, movimento; entram as cores de apoio e o modo claro.

## Teses validadas (10/11/2026)

**Visual.** Base escura quente (marrom-carvão, não cinza) com espelho claro em
off-white levemente rosado, com o laranja e o vermelho bacon como cor da marca e do
treino (o degradê fica reservado a um cartão por tela), e três cores de apoio que
contrastam com ele e dizem de que área se trata: teal para nutrição e descanso,
violeta para progresso e resultados, amarelo para sequência e energia; verde só
para série concluída; números grandes em Archivo condensado pesado (o peso, as
repetições e as calorias são o que se lê de longe, com o celular no banco), texto
em Inter a partir de 15 px; respiro generoso com unidade de 4 px e alvos de toque
de no mínimo 52 px; cartões arredondados (22 px) preenchidos, separados por tom e
sombra suave em vez de borda.

**Interação.** Rápida e física: toque responde em 120 ms (escala 0,97), telas e
listas entram em 260 ms com deslize de 16 px e escalonamento de 40 ms, números
contam até o valor em 600 ms e anéis se desenham em 700 ms, tudo em
`cubic-bezier(0.25, 1, 0.5, 1)`; concluir uma série solta faíscas por 500 ms. No
treino guiado, cada fase tem sua cor, e ela tinge o selo do cronômetro, a série
atual e o botão principal: amarelo no preparo, laranja na execução, teal no
descanso. Proibido: bounce elástico, parallax, revelar listas ao rolar, e qualquer
animação que atrase o próximo toque. Com "reduzir movimento", só opacidade.

**Padrões permitidos.** Degradê da marca em um cartão por tela; leve tom da cor de
apoio no topo do cartão da área; números tabulares condensados; desfoque só atrás
de modal; faíscas ao concluir série; faixas diagonais no estado "sem vídeo";
contagem do preparo pulsando a cada segundo; pulso duplo quando o descanso termina.

### Emendas feitas nesta etapa

- **Archivo, não Barlow Condensed.** O dataset sugeriu Barlow Condensed, que é a
  escolha reflexa de todo app fitness. Archivo é uma família só com eixo de largura
  (62 a 125): condensada nos números e no título, normal onde precisar, sem segunda
  família para carregar.
- **Botão da marca em `#c34522` nos dois temas.** O `#d95c2b` do mockup dá 3,8:1
  com texto branco, abaixo do mínimo para texto de 17 px. `#d95c2b`/`#e8783c`
  seguem como cor de texto, ícone e anel no escuro.
- **Saída de elemento: 180 ms**, só opacidade e 8 px. A tese não fixava saída;
  saída mais curta que a entrada para não segurar o próximo toque.

## Cores

Tokens semânticos, como variáveis CSS em `frontend/src/index.css` (`:root` = claro,
`.dark` = escuro) e expostos no Tailwind como `bg-surface`, `text-muted`,
`text-teal` etc. O tema segue o sistema por padrão; a pessoa pode fixar claro ou
escuro no Perfil.

| Token | Escuro | Claro | Uso |
|---|---|---|---|
| `bg` | `#120d0b` | `#f7f4f2` | fundo da tela |
| `surface` | `#1d1613` | `#ffffff` | cartões, barra de navegação |
| `surface-2` | `#271e1a` | `#f1ebe8` | trilhos, botões secundários, campos |
| `line` | `#2e2420` | `#e6dcd8` | divisória rara (rodapé fixo, nav) |
| `fg` | `#f6efec` | `#1d1512` | texto principal |
| `muted` | `#ad9a93` | `#6e5d57` | texto secundário |
| `dim` | `#93807a` | `#857269` | rótulos menores, desabilitado |
| `brand` | `#c34522` | `#c34522` | fundo de botão principal |
| `brand-fg` | `#e8783c` | `#c34522` | texto, ícone, anel e barra da marca |
| `brand-soft` | `#d95c2b26` | `#d95c2b1f` | fundo tingido da marca |
| `teal` | `#34d1bd` | `#0c7d70` | nutrição, descanso |
| `violet` | `#9d8cff` | `#5a47d6` | progresso, resultados |
| `sun` | `#ffc94a` | `#946600` | sequência, fase "prepare-se" |
| `ok` | `#3fbf86` | `#187a51` | série concluída, sucesso |
| `danger` | `#f0645a` | `#c4302a` | erro, descartar, excluir |
| `on-sun` | `#2a1c00` | `#ffffff` | texto sobre `sun` |
| `on-teal` | `#04241f` | `#ffffff` | texto sobre `teal` |

Cada cor de apoio tem uma versão `-soft` (a cor com alfa `22` no escuro, `1a` no
claro) para fundos tingidos.

Degradê da marca (`hero`): `linear-gradient(135deg, #d8392e 0%, #d95c2b 55%, #e8783c 100%)`,
texto branco. **Um por tela, no cartão principal.**

### Mapa de cor por área

| Área | Cor |
|---|---|
| Treino, ação principal | `brand` / `brand-fg` |
| Nutrição | `teal` |
| Resultados, progresso, revisões | `violet` |
| Sequência de dias | `sun` |
| Concluído | `ok` |

### Fases do treino guiado

| Fase | Cor | Botão principal |
|---|---|---|
| `countdown` (Prepare-se) | `sun` + `on-sun` | Começar agora |
| `executing` | `brand` + branco | Concluí a série / Concluir agora |
| `resting` | `teal` + `on-teal` | Pular descanso |
| `rest_done` | `teal`, pulso duplo | Continuar |

### Contraste medido

| Par | Razão |
|---|---|
| `fg` sobre `bg`, escuro / claro | 17,0 / 16,4 |
| `muted` sobre `surface`, escuro / claro | 6,7 / 6,2 |
| `dim` sobre `surface`, escuro / claro | 4,8 / 4,6 |
| branco sobre `brand` | 5,0 |
| `brand-fg` sobre `bg` escuro / claro | 6,6 / 4,6 |
| `teal` sobre `surface`, escuro / claro | 9,4 / 5,0 |
| `violet` sobre `surface`, escuro / claro | 6,5 / 6,4 |
| `sun` sobre `surface` escuro; `#946600` sobre branco | 11,7 / 5,1 |
| `ok` sobre `surface`, escuro / claro | 7,7 / 5,3 |
| `on-sun` sobre `sun`; `on-teal` sobre `teal` (escuro) | 10,8 / 8,6 |

## Tipografia

- **Display:** Archivo variável, `font-stretch` 72 a 80 %, peso 800 a 850,
  `font-variant-numeric: tabular-nums`. Números e títulos de tela. Fallback:
  `"Arial Narrow", "Roboto Condensed", system-ui, sans-serif`.
- **Texto:** Inter variável, 400 a 750. Fallback: `system-ui, -apple-system, "Segoe UI", sans-serif`.
- **Carregamento:** empacotado no app (`@fontsource-variable/archivo` e
  `@fontsource-variable/inter`), não pelo Google Fonts. O app funciona offline na
  academia e o link do Google falha sem rede. Recurso a conferir no aparelho:
  algarismos tabulares do Archivo (não verificado nesta sessão).

| Token | Tamanho / altura | Peso | Uso |
|---|---|---|---|
| `num-xl` | 44 / 1 | display 850 | cronômetro de descanso |
| `num-lg` | 38 / 1.05 | display 850 | peso no stepper, stat principal |
| `num-md` | 28 / 1.05 | display 850 | stats do hero, título de exercício |
| `num-sm` | 18 a 24 / 1.1 | display 800 | faixa de séries, valores em linha |
| `title` | 34 / 1.02 | display 850 | título de tela |
| `heading` | 17 / 1.3 | Inter 750 | título de cartão |
| `body-lg` | 17 / 1.4 | Inter 750 | botão principal |
| `body` | 16 / 1.5 | Inter 400 a 600 | texto corrido, campos |
| `body-sm` | 15 / 1.45 | Inter 400 a 600 | texto secundário |
| `label` | 13 / 1.3 | Inter 600 | rótulos, chips |
| `eyebrow` | 12 a 13 / 1.2 | Inter 700 a 750, caixa alta, 0,06 em | sobre-título |
| `nav` | 12 / 1 | Inter 600 | barra de navegação |

Mínimo absoluto: 12 px. Campos de formulário: 16 px sempre (o iOS dá zoom abaixo disso).

## Espaço, raio, sombra, toque

- **Unidade:** 4 px. Escala: 4, 8, 12, 16, 20, 24, 32, 40, 48.
- **Margem lateral da tela:** 20 px. **Espaço entre cartões:** 14 px (lista) / 12 px (grade).
- **Respiro interno de cartão:** 18 px; hero 20 px.
- **Raios:** `chip` 999 px; `sm` 12 px (botão pequeno, ícone em fundo); `md` 16 px
  (botões, campos, linhas de série); `lg` 22 px (cartões); `xl` 26 px (hero).
- **Sombras:** `card` escuro `0 1px 0 #ffffff0a inset, 0 8px 24px #00000055`; claro
  `0 1px 2px #3a120e0f, 0 8px 24px #3a120e14`. `sheet` (modal de baixo)
  `0 -8px 40px #00000066`. Nada além disso.
- **Toque:** botão principal 56 a 58 px de altura; secundário e ícone, 48 px no
  mínimo; ação discreta em linha, 44 px.
- **Borda:** cartões não têm borda. Borda só em campo focado (`brand-fg`, 2 px) e
  em divisória fixa (`line`).

## Componentes base

Cada um com os cinco estados: padrão, pressionado (`scale(.97)`, 120 ms), foco
(`outline 3px brand-fg`, deslocado 2 px), ativo/selecionado, desabilitado
(opacidade .45, sem escala).

- **Button** `primary` (fundo `brand`, texto branco), `secondary` (`surface-2`,
  texto `fg`), `tonal` (fundo `*-soft`, texto da cor da área), `danger` (`danger`
  texto sobre `surface-2`; preenchido só na confirmação), `ghost` (texto `muted`).
  Tamanhos: `lg` 58 px / 17 px, `md` 48 px / 16 px, `sm` 40 px / 15 px (só em linha
  dentro de cartão).
- **Card** `surface`, raio `lg`, sombra `card`, respiro 18 px. Variante `tint-*`:
  `linear-gradient(160deg, var(--x-soft), transparent 60%)` sobre `surface`.
- **Hero** degradê da marca, raio `xl`, um por tela.
- **Chip** é informação, não botão: altura 32 px, raio `chip`, `label`, sem
  sombra, ícone de 15 px da área quando ajuda a ler. Neutro em `surface-2` com
  texto `muted`; de área no `*-soft` com texto da cor dela.
- **Referência visual:** `docs/design-system.html` (abrir no navegador).
- **Input / Select / Textarea** `surface-2`, raio `md`, altura 52 px, texto 16 px,
  foco com borda `brand-fg`.
- **Stepper** −/+ 56 px, valor em `num-lg`, passo 2,5 kg.
- **Ring / Bar** trilho `surface-2`, preenchimento na cor da área, ponta arredondada.
- **Bottom nav** `surface`, ícone 26 px, rótulo `nav`, ativo em `brand-fg` com
  traço de 3 px no topo.
- **Sheet (modal)** sobe de baixo, raio `xl` no topo, fundo `bg/80` com
  `backdrop-blur` (único lugar do desfoque).

## Movimento

| Token | Valor |
|---|---|
| `ease` | `cubic-bezier(0.25, 1, 0.5, 1)` |
| `t-press` | 120 ms, `scale(.97)` |
| `t-enter` | 260 ms, `translateY(16px)` + opacidade |
| `t-exit` | 180 ms, `translateY(8px)` + opacidade |
| `stagger` | 40 ms por item, no máximo 6 itens escalonados |
| `t-count` | 600 ms, contagem de número (ease-out quártico) |
| `t-ring` | 700 ms, anel e barra desenhando (`transform`/`stroke-dashoffset`) |
| `t-celebrate` | 500 ms, faíscas ao concluir série |

Regras:
- Animar só `transform`, `opacity`, `stroke-dashoffset` e cor. Nunca largura,
  altura, `top`/`left`, margem ou padding.
- Lista entra uma vez, ao abrir a tela. Rolar não revela nada.
- Nenhuma animação bloqueia toque: botões ficam ativos durante a entrada.
- `prefers-reduced-motion: reduce` → só opacidade, durações a 1 ms, sem faíscas,
  sem contagem (o número aparece direto), sem pulsos.
- Laços permitidos: só a contagem do preparo e o pulso duplo do fim do descanso,
  porque refletem estado real.
- Sem biblioteca de animação: CSS + Tailwind + `requestAnimationFrame` para contagem.

## Arquivos derivados

- `frontend/src/index.css`: variáveis dos dois temas, keyframes, utilidades de movimento.
- `frontend/tailwind.config.js`: cores semânticas apontando para as variáveis,
  `fontFamily.display`, raios, sombras, durações e easing.
- `frontend/src/lib/theme.ts`: preferência sistema/claro/escuro, aplica `.dark` no `<html>`.
