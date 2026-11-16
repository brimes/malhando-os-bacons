# Mapa offline — Nutrição, Resultados, Perfil, Academias, planos

Legenda: **A** escrita enfileirável · **B** leitura que precisa de cache · **C** IA (precisa de rede).
"Await?" = a UI só atualiza depois que a chamada de rede volta. Todos os `apiClient` têm timeout de 8 s:
com API pendurada, a escrita fica 8 s parada e o timeout **não** é enfileirável (`isQueueableFailure`), então vira erro.
Rotas em `ONLINE_ONLY_PATHS` (`offlineSync.ts`) são rejeitadas offline com "Esta ação precisa de internet".

## Nutrição
| Ação | Arquivo:linha | Endpoint | Cls | Await? | Estado antes |
|---|---|---|---|---|---|
| Registrar (histórico/busca/zero/plano/rotina/cópia) | FoodLog.tsx:331,362; Nutrition.tsx:96,122,165; NutritionHistory.tsx:164 | POST /nutrition/logs | A | não (`createFoodLog` grava em IndexedDB e enfileira, `client_log_id` dedupe) | já local-first |
| Editar / apagar registro | Nutrition.tsx:113; EditFoodLogModal.tsx:127,263; NutritionHistory.tsx:157 | PUT/DELETE /nutrition/logs/:id | A | não (repo local) | já local-first |
| Favoritar / desfavoritar | useNutritionStore.ts:toggleFavorite; FoodLog.tsx:303 | POST/DELETE /nutrition/favorites | A | **sim** | offline desfavoritar item local = erro; pendurado = erro de rede |
| Criar/apagar alimento próprio | useNutritionStore.ts createFood/deleteFood; FoodPhoto.tsx:115 | POST/DELETE /nutrition/foods | A | **sim** | idem |
| Criar plano alimentar manual | NutritionPlan.tsx:78 (store.createPlan) | POST /nutrition/plans | A | **sim** | idem |
| Ativar plano alimentar | NutritionPlan.tsx:102 | PUT /nutrition/plans/:id/activate | A | **sim** | idem |
| Listar histórico/favoritos | useNutritionStore.fetchLogHistory | GET /nutrition/logs/history | B | readThrough (cache) | ok com cache |
| Planos, rotina, dias esquecidos, calendário | store.fetchPlans/fetchRoutine/fetchMissingDays; NutritionHistory.tsx:95 | GET | B | readThrough/cache | ok com cache; calendário sem cache dedicado |
| Busca no catálogo | store.searchFoods | GET /nutrition/foods/search | B* | — | não cacheável (catálogo no servidor); offline cai no histórico local |
| Foto de prato/rótulo | FoodPhoto.tsx:50,56 | POST /nutrition/photos | C | sim | "precisa de internet" |
| Descrever conversando / extrapolei / sugestão | FoodLogAssistant.tsx:59; Nutrition.tsx | POST /nutrition/logs/assistant, GET /nutrition/suggestion | C | sim | idem |
| Plano com IA / ajustar com IA | NutritionPlan.tsx:90,111 | POST /nutrition/plans/automatic, /adjust | C | sim | idem |
| Dia do lixo (conversa, aceitar, descartar) | CheatDay.tsx:58,73,85 | /nutrition/cheat-day* | C | sim | idem |

## Resultados / Avaliação
| Ação | Arquivo:linha | Endpoint | Cls | Await? |
|---|---|---|---|---|
| Registrar peso/medidas | Results.tsx:166 | POST /results | A | **sim** (depois relê `GET /results`) |
| Apagar registro | Results.tsx:179 | DELETE /results/:id | A | **sim** |
| Ler resultados | Results.tsx:128 | GET /results | B | apiClient (cache automático por GET) |
| Registrar avaliação física | FitnessAssessment.tsx:48 | POST /onboarding/fitness-assessments | A | **sim** |
| Pedir avaliação do progresso | ProgressReview.tsx | /progress-reviews* | C | sim |

## Perfil / Configurações / Onboarding
| Ação | Arquivo:linha | Endpoint | Cls | Await? |
|---|---|---|---|---|
| Salvar dados do perfil | ProfileData.tsx:67 → useOnboardingStore.saveProfile | PUT /onboarding/profile | A | **sim** |
| Salvar configurações de treino | Settings.tsx:50 | PUT /settings | A | **sim** |
| Onboarding: dados | Onboarding.tsx:21 | PUT /onboarding/profile | A | **sim** |
| Onboarding: conversa do objetivo | useOnboardingStore.sendMessage | POST /onboarding/objective/messages | C | sim |
| Reiniciar objetivo | Profile.tsx:49 | POST /onboarding/objective/reset | C | sim |
| Chave LLM | LlmSettingsSection.tsx | /llm-settings | C (nunca enfileirar) | sim; já desabilita offline |
| Aceitar termos | TermsGate.tsx:121 | POST /terms/accept | A* | sim (fora do escopo; relatado) |
| Leituras: /onboarding, /settings, /terms | stores/telas | GET | B | cache automático por GET |

## Academias
| Ação | Arquivo:linha | Endpoint | Cls | Await? |
|---|---|---|---|---|
| Criar | GymForm.tsx:75 | POST /gyms | A | **sim** |
| Editar | GymForm.tsx:74 | PUT /gyms/:id | A | **sim** (id negativo → `UnsyncedDependencyError`) |
| Excluir | GymForm.tsx:89 | DELETE /gyms/:id | A | **sim** |
| Listar / abrir | Gyms.tsx:21; GymForm.tsx:40 | GET /gyms, /gyms/:id | B | cache automático por GET; gym criada offline não aparece na lista |

## Planos de treino (somente edições sem IA)
| Ação | Arquivo:linha | Endpoint | Cls | Await? |
|---|---|---|---|---|
| Arquivar / reabrir | TrainingPlanDetail.tsx:174,187 | POST /training-plans/:id/(un)archive | A | **sim** (aplica no cache só depois) |
| Excluir | TrainingPlanDetail.tsx:126 | DELETE /training-plans/:id | A | sim |
| Listar arquivados | ArchivedTrainingPlans.tsx:24 | GET ?archived=true | B | cache automático |
| Ajustar / dia dinâmico | TrainingPlanDetail.tsx:140,204 | /adjust, /dynamic-day | C | sim |

## Falta de chave de idempotência no backend (relatar ao dono)
`POST /results` (mesma data corrige, então reenvio é inofensivo), `POST /nutrition/favorites` (upsert por `group_key`), `POST /nutrition/plans`, `POST /gyms`, `POST /nutrition/foods` e `POST /onboarding/fitness-assessments` **não** têm chave que o servidor deduplique:
um timeout seguido de reenvio duplicaria. `food_logs` já tem `client_log_id`.
