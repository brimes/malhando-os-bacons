-- Aceite do termo de isenção de responsabilidade.
-- A versão aceita é guardada junto do carimbo de tempo porque o texto do termo
-- muda com o tempo: quando a versão corrente do app não bate com a que está
-- gravada aqui, o aceite é pedido de novo em vez de ser considerado válido.
ALTER TABLE users
ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS terms_version TEXT;
