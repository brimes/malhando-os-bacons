-- Registro criado a partir da conversa com o assistente ("modo IA" da tela de
-- registrar): a pessoa descreve o que comeu em texto livre, o assistente
-- pergunta o que falta e estima os macros.
--
-- `origin` existe para dizer de onde o número veio, e essa procedência é
-- diferente das que já existem: não é `manual` (ninguém digitou os macros),
-- não é `photo_plate` (não houve foto). Sem um valor próprio, uma estimativa
-- de conversa ficaria indistinguível de um valor conferido a dedo — e é
-- justamente a que a pessoa mais deve poder reconhecer depois.
ALTER TABLE food_logs DROP CONSTRAINT IF EXISTS food_logs_origin_check;
ALTER TABLE food_logs ADD CONSTRAINT food_logs_origin_check
    CHECK (origin IN ('manual', 'plan', 'photo_plate', 'photo_label', 'cheat_day', 'assistant'));
