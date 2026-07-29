-- Configurações de LLM por usuário. Quem informa a própria chave passa a gastar
-- a cota dela; sem chave, as gerações caem no crédito compartilhado do servidor.
-- subscription_status é um mock declarado: não existe cobrança por trás dele.
CREATE TABLE IF NOT EXISTS user_llm_settings (
    user_id                 BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    provider                TEXT NOT NULL DEFAULT 'gemini',
    api_key                 TEXT,
    model                   TEXT,
    subscription_status     TEXT NOT NULL DEFAULT 'free'
                            CHECK (subscription_status IN ('free', 'active', 'cancelled')),
    subscription_updated_at TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
