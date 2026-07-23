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
├── docker-compose.yml       # PostgreSQL + Backend
├── Makefile                 # Comandos principais
└── README.md
```

## Rotas da API

```
POST   /api/auth/google              — Login com Google OAuth
GET    /api/auth/me                  — Usuário atual

GET    /api/workouts                 — Listar treinos
POST   /api/workouts                 — Criar treino
GET    /api/workouts/stats           — Estatísticas (frequência, volume, streak)
GET    /api/workouts/:id             — Detalhe do treino
PUT    /api/workouts/:id             — Atualizar treino
DELETE /api/workouts/:id             — Deletar treino

GET    /api/nutrition/plans          — Planos alimentares
POST   /api/nutrition/plans          — Criar plano (ativa automaticamente)
GET    /api/nutrition/logs?date=     — Log de refeições do dia
POST   /api/nutrition/logs           — Registrar refeição
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
# Edite backend/.env com suas credenciais Google OAuth

# Instala dependências do frontend
cd frontend && npm install && cd ..

# Sobe PostgreSQL + Backend via Docker
make up
```

### Dev local (hot reload)
```bash
# Terminal 1: Backend Go (com hot reload manual)
cd backend && make dev

# Terminal 2: Frontend React
cd frontend && npm run dev
```

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

## Features

- **Treinos**: registro de exercícios com séries, repetições e carga. Estatísticas de frequência, volume total e sequência.
- **Nutrição**: catálogo de alimentos com dados TACO, log por refeição (café, almoço, jantar, lanche), plano com metas de macros.
- **Dashboard**: visão cruzada de treino + nutrição + passos do dia e semana.
- **Galaxy Watch 7**: métricas em tempo real (passos, BPM), registro rápido de treino, sincronização automática a cada 30 min.
