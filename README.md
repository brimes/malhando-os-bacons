# MOB — Malhando os Bacons

Plataforma de fitness pessoal com acompanhamento de treinos, nutrição e dados do Galaxy Watch 7.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Backend | Go 1.22, REST API, pgx/PostgreSQL |
| Frontend | React 18 + TypeScript, Vite, Capacitor, Tailwind CSS |
| Watch | Wear OS / Kotlin, Jetpack Compose for Wear |
| Banco | PostgreSQL 16 |
| Deploy | Docker + Docker Compose |

## Estrutura do Projeto

```
mob/
├── backend/                 # API REST em Go
│   ├── cmd/server/main.go
│   ├── internal/
│   │   ├── config/          # Configuração via env vars
│   │   ├── db/              # Conexão PostgreSQL (pgx pool)
│   │   ├── handlers/        # Handlers HTTP (auth, workouts, nutrition, steps, dashboard)
│   │   ├── middleware/       # JWT auth + CORS
│   │   ├── models/          # Structs Go
│   │   ├── routes/          # Definição de rotas
│   │   └── services/        # Lógica de negócio
│   ├── migrations/          # Schema SQL
│   ├── Dockerfile
│   └── Makefile
│
├── frontend/                # App Capacitor + React
│   ├── src/
│   │   ├── api/             # Clientes axios (workouts, nutrition, steps)
│   │   ├── components/      # BottomNav, Header, Card, Button, Chart
│   │   ├── pages/           # Dashboard, Workouts, Nutrition, Profile...
│   │   ├── stores/          # Zustand (auth, workout, nutrition)
│   │   └── types/           # TypeScript types
│   ├── capacitor.config.ts
│   └── vite.config.ts
│
├── watch/                   # Galaxy Watch 7 (Wear OS / Kotlin)
│   └── src/main/java/com/mob/watch/
│       ├── MainActivity.kt       # Tela principal com métricas
│       ├── WorkoutActivity.kt    # Registro rápido de treino
│       ├── SyncService.kt        # Sync em background
│       ├── ApiClient.kt          # Cliente HTTP para o backend
│       └── HealthDataCollector.kt # Leitura de sensores
│
├── docker-compose.yml       # PostgreSQL + Backend + Frontend web
├── Makefile                 # Comandos principais
└── README.md
```

## Rotas da API

```
POST   /api/auth/google              — Login com Google OAuth
POST   /api/auth/register            — Cadastro com nome, e-mail e senha
POST   /api/auth/login               — Login com e-mail e senha
GET    /api/auth/me                  — Usuário atual

GET    /api/onboarding               — Estado atual do onboarding
PUT    /api/onboarding/profile       — Salvar dados corporais iniciais
POST   /api/onboarding/objective/messages — Conversar com assistente de objetivo
POST   /api/onboarding/objective/reset — Apagar objetivo e reiniciar a conversa
GET    /api/onboarding/fitness-assessments — Histórico de testes de condicionamento
POST   /api/onboarding/fitness-assessments — Registrar caminhada de 6 minutos

GET    /api/workouts                 — Listar treinos
POST   /api/workouts                 — Criar treino
GET    /api/workouts/stats           — Estatísticas (frequência, volume, streak)
GET    /api/workouts/calendar?month= — Treinos agrupados por dia no mês
GET    /api/workouts/:id             — Detalhe do treino
PUT    /api/workouts/:id             — Atualizar treino
DELETE /api/workouts/:id             — Deletar treino

GET    /api/training-plans           — Listar planos de treino
POST   /api/training-plans/manual    — Criar plano manual
POST   /api/training-plans/automatic — Gerar plano personalizado com LLM
GET    /api/training-plans/:id       — Plano, dias, exercícios e últimas execuções
DELETE /api/training-plans/:id       — Excluir completamente um plano

GET    /api/nutrition/plans          — Planos alimentares
POST   /api/nutrition/plans          — Criar plano (ativa automaticamente)
GET    /api/nutrition/logs?date=     — Log de refeições do dia
POST   /api/nutrition/logs           — Registrar refeição
GET    /api/nutrition/calendar?month= — Calorias agrupadas por dia no mês
GET    /api/nutrition/foods/search?q — Buscar alimentos (TACO/USDA)

GET    /api/steps?date=              — Passos do dia
POST   /api/steps/sync               — Sincronizar do watch

GET    /api/dashboard                — Resumo cruzado treino + nutrição + passos
GET    /health                       — Health check
```

## Como Rodar

### Requisitos
- Docker e Docker Compose
- Node.js 20+
- Go 1.22+ (opcional, para rodar backend localmente)
- Android Studio + Wear OS SDK (para o watch)

### Setup inicial
```bash
cd /home/picoclaw/mob

# Copia o .env de exemplo
cp backend/.env.example backend/.env
# Variáveis usadas pelo Docker Compose
cp .env.example .env
# Edite backend/.env com suas credenciais Google OAuth

# Sobe PostgreSQL, Backend e Frontend web via Docker
make up
```

### Desenvolvimento web (hot reload no Docker)
```bash
docker compose up -d --build
docker compose watch frontend
```

O `watch` sincroniza o código de `frontend/` com o container e o Vite recarrega as alterações automaticamente. Em outro terminal, use `docker compose logs -f frontend backend` para acompanhar os logs.

### Acessar
- Frontend: http://localhost:5173
- Backend API: http://localhost:8080
- Health check: http://localhost:8080/health

### Watch App
Abra `/home/picoclaw/mob/watch/` no Android Studio e conecte um Galaxy Watch 7 (ou emulador Wear OS).

## Banco de Dados

### Schema
```sql
users            — usuários (Google OAuth)
workouts         — sessões de treino
workout_sets     — exercícios dentro do treino
food_items       — catálogo de alimentos (TACO seeds incluídas)
nutrition_plans  — planos alimentares
food_logs        — registros diários de refeições
steps            — passos diários (unique por user+date)
```

### Migrações
```bash
# Aplicar schema inicial
make migrate
```

## Variáveis de Ambiente (backend/.env)

| Variável | Descrição |
|----------|-----------|
| `PORT` | Porta do servidor (padrão: 8080) |
| `DATABASE_URL` | URL de conexão PostgreSQL |
| `JWT_SECRET` | Secret para assinar tokens JWT (mínimo 32 chars) |
| `GOOGLE_CLIENT_ID` | Client ID do Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Client Secret do Google OAuth |
| `ENVIRONMENT` | `development` ou `production` |
| `ALLOWED_ORIGINS` | Origins permitidas para CORS |
| `OPENCODE_URL` | URL do servidor iniciado por `opencode serve` |
| `OPENCODE_MODEL` | Modelo no formato `provider/model` |

## Assistente de objetivo

O onboarding usa o servidor HTTP oficial do CLI OpenCode. Inicie-o antes de conversar com o assistente:

```bash
opencode serve --hostname 192.168.252.1 --port 4096
```

Neste ambiente, `192.168.252.1` é a interface do Mac acessível pela VM Docker. O backend usa `OPENCODE_URL` e `OPENCODE_MODEL`, permitindo trocar o modelo sem alterar o código.

## Login com Google

1. Acesse [Google Cloud Console](https://console.cloud.google.com/) e crie ou selecione um projeto.
2. Abra **Google Auth Platform**, configure **Branding**, **Audience** e adicione seu e-mail como usuário de teste enquanto o app estiver em modo de testes.
3. Em **Clients**, crie um cliente OAuth do tipo **Web application**.
4. Em **Authorized JavaScript origins**, adicione `http://localhost:5173`.
5. Copie o **Client ID** para `GOOGLE_CLIENT_ID` no arquivo `.env` da raiz e reconstrua os serviços:

```bash
cp .env.example .env
# Edite GOOGLE_CLIENT_ID no arquivo .env
docker compose up -d --build backend frontend
```

O fluxo web atual usa Google Identity Services e precisa apenas do Client ID. Nunca coloque o Client Secret no frontend ou em uma variável `VITE_*`. Android e iOS precisarão de clientes OAuth próprios quando forem compilados.

## Features

- **Treinos**: registro de exercícios com séries, repetições e carga. Estatísticas de frequência, volume total e sequência.
- **Nutrição**: catálogo de alimentos com dados TACO, log por refeição (café, almoço, jantar, lanche), plano com metas de macros.
- **Dashboard**: visão cruzada de treino + nutrição + passos do dia e semana.
- **Galaxy Watch 7**: métricas em tempo real (passos, BPM), registro rápido de treino, sincronização automática a cada 30 min.
