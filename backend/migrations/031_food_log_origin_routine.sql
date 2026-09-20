-- Registro gerado a partir do "dia normal" destilado do próprio histórico
-- (GET /api/nutrition/routine): a pessoa confirma um dia que o MOB já sabe
-- que ela costuma comer, em vez de digitar item por item de novo. Não é
-- `manual` (ninguém escolheu a comida agora), não é `assistant` (não houve
-- conversa) — é uma procedência própria, para o histórico e a IA saberem
-- depois que aquele número é uma estimativa da rotina, não uma medição do dia.
--
-- Derrubado por busca no catálogo, não pelo nome escrito à mão (mesmo motivo
-- da migration 029): se o nome desta constraint neste banco divergir de
-- `food_logs_origin_check`, o DROP por nome não acharia nada, o ADD passaria,
-- e a constraint velha recusaria 'routine' só em produção, na primeira
-- confirmação de um dia normal.
DO $$
DECLARE constraint_name TEXT;
BEGIN
    FOR constraint_name IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'food_logs'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%origin%'
    LOOP
        EXECUTE format('ALTER TABLE food_logs DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END $$;
ALTER TABLE food_logs ADD CONSTRAINT food_logs_origin_check
    CHECK (origin IN ('manual', 'plan', 'photo_plate', 'photo_label', 'cheat_day', 'assistant', 'routine'));
