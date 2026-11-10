-- Invalidação de sessões. O JWT carrega `tv`; se não bater com esta coluna, o
-- middleware responde 401. Incrementar derruba todas as sessões da conta:
-- acontece ao redefinir a senha e quando um login Google/Apple vincula uma
-- conta que tinha senha (o /register não verifica e-mail, então essa senha
-- pode ser de quem pré-registrou o e-mail da vítima).
-- Todos começam em 0 e tokens antigos sem `tv` valem 0: ninguém é deslogado
-- no deploy.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;
