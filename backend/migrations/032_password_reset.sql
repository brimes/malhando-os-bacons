-- Redefinição de senha por código e login social (Google/Apple).
--
-- password_reset_codes guarda só o HMAC do código de 6 dígitos, nunca o código.
-- Cada linha é uso único (used_at), expira (expires_at) e tem teto de
-- tentativas, porque 6 dígitos são só um milhão de combinações. Quem não está
-- mais ativo é apagado ao redefinir ou ao pedir um código novo.

ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_id TEXT;
-- Refresh token da Apple, obtido ao trocar o authorizationCode. Só serve para
-- revogar o vínculo quando a conta é excluída (exigência da Apple); nunca sai
-- em JSON nem em log. Fica nulo se as credenciais da Apple não estiverem
-- configuradas.
ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_refresh_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_apple_id ON users(apple_id);

CREATE TABLE IF NOT EXISTS password_reset_codes (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash   TEXT NOT NULL,
    attempts    INT NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_codes_user ON password_reset_codes(user_id, created_at DESC);
