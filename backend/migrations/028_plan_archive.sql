-- Arquivamento de plano vencido: não apaga (dias e séries continuam referenciados
-- pelo histórico), só some da listagem padrão depois que a data-alvo passou.
ALTER TABLE training_plans ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_training_plans_archived ON training_plans (user_id, archived_at);
