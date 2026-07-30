# Onde o projeto parou

Estado em 30/07/2026. Complementa o `CLAUDE.md` (que tem as armadilhas técnicas)
com o que está em aberto e depende de decisão ou ação humana.

## Bloqueia a publicação na Play

1. **Validar o layout do release no aparelho.** Do SDK 35 em diante o Android
   força borda a borda; o `MainActivity` passou a aplicar os insets nativos, mas
   isso **não foi visto na tela** — o Fold estava `unauthorized` no adb. Instalar
   `~/Desktop/MOB-1.0.0-teste.apk` e conferir topo e rodapé.
2. **Formulário de segurança de dados**, no Play Console: declarar dados de saúde
   e que texto de treino é enviado à IA do Google. O inventário está na política.
3. **Classificação de conteúdo** e **imagens da listagem** (ícone 512×512, banner
   1024×500, capturas).

A política de privacidade está no ar em `https://mob-api.brimes.net/privacidade`,
pública e sem login, com `mob-contato@zel.care` como canal de privacidade.

## Acabamento antes de publicar

- A tela de login mostra **"Login com Google aguardando configuração OAuth"**.
  Funciona, mas passa impressão de inacabado numa loja. Esconder o bloco enquanto
  o OAuth não estiver configurado.
- **R8 desligado** (`minifyEnabled false`). Ligar depois exige testar o fluxo
  inteiro no aparelho: a ponte JS do Capacitor usa reflexão e regra faltando só
  falha em runtime.

## Limitações conhecidas, decididas de propósito

- **Iniciar treino offline funciona**, mas se o start conflitar no servidor (ex:
  sessão esquecida aberta em outro aparelho, que devolve 409), a sessão local
  fica presa: os dados são preservados e aparecem na lista de falhas em
  Configurações, porém não há fluxo de "descartar e recomeçar" no app.
- **A assinatura é mock.** `POST /subscription/mock` só muda o status; não
  provisiona LLM próprio. A tela diz isso, mas quem for implementar cobrança de
  verdade precisa alterar o `GeneratorResolver`, que hoje ignora
  `subscription_status` e decide só pela presença de chave.
- **Sem criptografia em repouso** para a chave de API do usuário. Ela nunca sai
  em JSON nem em log, mas está em texto no banco. Adicionar exige uma chave
  mestra no secret do k8s.

## Limpezas pendentes no banco de produção

```sql
-- usuário de teste criado durante a validação da API
DELETE FROM users WHERE email='claude-teste-descartavel@invalid.test';
```

No banco **local** sobrou o treino "Dia 1 - Peito, Tríceps e Abdômen" com 13
séries gravadas para 3 planejadas, resíduo de um bug de duplicação já corrigido.
Decidir se apaga só as excedentes, o treino todo, ou deixa.
