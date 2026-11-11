-- Ilustração do movimento: N quadros em vez de uma imagem só.
--
-- Linhas antigas (imagem única, gerada só a partir do nome) ficam com
-- version = 1 e frames = 1: contam como desatualizadas e são regeneradas sem
-- gastar a cota de ninguém. Linhas novas gravam version = 2.
-- Em linhas novas, storage_path é a PASTA (<id>) e os quadros são <i>.jpg.
ALTER TABLE exercise_illustrations
    ADD COLUMN IF NOT EXISTS frames      INT  NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS version     INT  NOT NULL DEFAULT 1;
