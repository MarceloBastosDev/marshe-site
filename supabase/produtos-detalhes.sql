-- Marshê Studio 3D · Detalhes dos produtos editáveis no painel da loja
-- Rode UMA vez no Supabase: SQL Editor > New query > cole tudo > Run.
-- Pode rodar de novo sem problema (não apaga nada).
--
-- Acrescenta à tabela "precos" (uma linha por produto) os campos que a loja
-- passa a editar pelo painel. Campo vazio (null) = usa o que está no produtos.json.

alter table public.precos add column if not exists nome text;
alter table public.precos add column if not exists descricao text;
alter table public.precos add column if not exists categorias text[];
alter table public.precos add column if not exists selos text[];
alter table public.precos add column if not exists personalizavel text;   -- '' = sem personalização
alter table public.precos add column if not exists ordem integer;         -- posição na vitrine (1 = primeiro)

-- Limites de tamanho (evitam textos gigantes por engano)
alter table public.precos drop constraint if exists precos_nome_tam;
alter table public.precos add constraint precos_nome_tam check (nome is null or char_length(nome) between 2 and 80);
alter table public.precos drop constraint if exists precos_descricao_tam;
alter table public.precos add constraint precos_descricao_tam check (descricao is null or char_length(descricao) <= 700);
alter table public.precos drop constraint if exists precos_personalizavel_tam;
alter table public.precos add constraint precos_personalizavel_tam check (personalizavel is null or char_length(personalizavel) <= 120);
alter table public.precos drop constraint if exists precos_categorias_tam;
alter table public.precos add constraint precos_categorias_tam check (categorias is null or cardinality(categorias) between 1 and 8);
alter table public.precos drop constraint if exists precos_selos_validos;
alter table public.precos add constraint precos_selos_validos check (selos is null or selos <@ array['Novo', 'Mais pedido']::text[]);
alter table public.precos drop constraint if exists precos_ordem_faixa;
alter table public.precos add constraint precos_ordem_faixa check (ordem is null or ordem between 1 and 999);

-- As permissões continuam as mesmas: qualquer um lê, só a loja (admins) grava.
