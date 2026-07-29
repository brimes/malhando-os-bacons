# MOB — notas para agentes

Stack e estrutura estão no `README.md`. Aqui fica só o que não é óbvio no código.

## Ambiente (o que quebra se ignorado)

- **Não há Go nem `gofmt` no host.** Buildar: `docker compose build backend`. Para `vet`/`gofmt`, usar um container `golang:1.22-alpine` com o código copiado via build context — bind mount (`-v $PWD:/src`) monta incompleto e falha com "does not contain main module".
- **O container do frontend não tem bind mount.** Editar `frontend/src` não afeta o container. Antes de typechecar: `docker compose build frontend && docker compose up -d frontend`, só então `docker compose exec -T frontend npx tsc --noEmit`. Sem rebuildar, o `tsc` valida código antigo e passa verde à toa.
- **O sandbox não alcança `localhost:8080`.** Chamar a API de dentro de um container: `docker compose exec -T frontend node -e 'fetch("http://backend:8080/api/...")'`. Token de teste: forjar JWT HS256 com o `JWT_SECRET` do container (claims `user_id`, `email`, `exp`, `iat`, `iss: "mob-api"`), ver `backend/internal/middleware/auth.go`.
- **O Postgres local tem dados reais do dono do projeto** (`user_id=2`), não é seed. Endpoints de onboarding e metas fazem UPSERT sem versionar: testar neles sobrescreve dados que não voltam. Criar usuário descartável e apagar no fim.
- **Estado do app no celular** pode ser lido ao vivo: `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` + protocolo do Chrome. Foi assim que apareceram bugs que nenhum teste sintético pegou.

## Migrations

Rodam no boot (`backend/internal/db/migrate.go`), em ordem de nome, registradas em `schema_migrations`, sob advisory lock. Basta criar `backend/migrations/NNN_*.sql`. Um banco com tabelas mas sem `schema_migrations` é **adotado** sem re-executar — a 001 tem seed de alimentos sem `ON CONFLICT` e duplicaria.

## Decisões que não devem ser desfeitas

- **Geração de plano é assíncrona** (`training_plan_jobs` + polling). O assistente leva minutos; segurar a conexão estourava o `WriteTimeout` e o proxy virava 500.
- **Ajustar plano reconcilia no lugar**, nunca recria. `workouts` e `workout_sets` referenciam dias e exercícios com `ON DELETE SET NULL`: apagar desvincularia todo histórico e os pesos memorizados, sem erro.
- **`set_number` é derivado no servidor** e séries têm `client_set_id`; o start tem `client_session_id`. Sem essas chaves, uma requisição reenviada não é recusada como repetida — é renomeada para a próxima série e inserida, corrompendo o histórico em silêncio.
- **A sessão de treino em andamento vive em slot próprio** do store offline, fora do cache despejável. No cache, ela era a primeira descartada pela poda LRU e pela limpeza de cota.
- **Sair da conta não descarta a fila offline**, só o cache de leitura. Token expirado ou 5xx passageiro em `/auth/me` caem no logout e apagariam trabalho que só existe no aparelho.
- **Insets vêm do nativo** (`MainActivity`). Do SDK 35 em diante a plataforma força borda a borda, e o WebView do Android devolve `env(safe-area-inset-*)` zerado mesmo com `viewport-fit=cover` — medido no aparelho. Correção em CSS não resolve.
- **Provider de LLM resolvido por usuário** (`services.GeneratorResolver`): chave própria quando existe, crédito compartilhado quando não. A chave nunca volta em JSON nem entra em log, e nunca é enfileirada offline (a fila é localStorage em texto puro).
- **Aviso de IA só no termo de aceite.** Repetir em cada tela vira ruído que se para de ler.

## Deploy

Push em `main` dispara o workflow (`.github/workflows/deploy.yml`) num runner self-hosted, filtrado por `backend/**`, `k8s/**` e o próprio workflow — mudança só de frontend não deploya. `k8s/secret.yml` é template e **não** é aplicado pelo workflow; precisa de `kubectl apply` manual. API em `https://mob-api.brimes.net`.

## Release Android

- App: `net.brimes.mob`, `targetSdk`/`compileSdk` 36 (a Play exige 35 desde 08/2025 e 36 a partir de 08/2026).
- Assinatura: chave de **upload** (Play App Signing) em `~/mob-release-keys/`, lida de `frontend/android/keystore.properties` (não versionado). Sem o arquivo, o release sai sem assinatura em vez de quebrar o build.
- `frontend/android/` **é versionado** (só build e segredos ficam de fora): carrega id, SDK, assinatura e os insets, que um `cap add android` apagaria sem aviso.
- Gerar: `npm run build && npx cap sync android && (cd android && ./gradlew bundleRelease)`. Precisa de `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools` e `JAVA_HOME=$(brew --prefix openjdk@17)`.
- Copiar o artefato para `~/Desktop` como `MOB-<versionName>-play.aab` / `-teste.apk` ao fim do build.
- Ícones e splash: fontes em `frontend/assets/`, gerar com `npx @capacitor/assets generate --android`. A arte original tem margem demais; recortar antes. O `adaptive-icon.xml` já aplica o inset da zona segura — reduzir a arte de novo a encolhe duas vezes.
- R8 desligado de propósito: a ponte JS do Capacitor usa reflexão e regra faltando só falha em runtime.
