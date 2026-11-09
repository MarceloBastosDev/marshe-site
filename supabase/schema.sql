-- =====================================================================
-- PONTOS MARSHÊ · banco de dados (Supabase / Postgres)
-- Rode este arquivo inteiro no Supabase: SQL Editor → New query → Run.
-- Pode rodar de novo sem problema (ele recria funções e regras).
--
-- Regras do programa (mude em "regras_pontos", no fim do arquivo):
--   • cashback de 5% do valor pago, em pontos (1 ponto = R$ 0,01)
--   • os pontos entram quando a loja marca o pedido como ENTREGUE
--   • valem por 3 meses e são usados como desconto no próximo pedido
--   • os pontos usados saem do saldo quando a loja CONFIRMA o pedido
--     (os que vencem primeiro são usados primeiro)
-- =====================================================================

-- ---------- Tabelas ----------
create table if not exists public.regras_pontos (
  id int primary key default 1 check (id = 1),
  cashback_pct numeric(5,2) not null default 5,   -- % do valor pago que volta em pontos
  validade_meses int not null default 3
);
insert into public.regras_pontos (id) values (1) on conflict (id) do nothing;

create table if not exists public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text,
  whatsapp text,
  aceite_em timestamptz,
  criado_em timestamptz not null default now()
);

-- Indique e ganhe (colunas novas: rodar este arquivo de novo atualiza um banco já existente)
alter table public.regras_pontos add column if not exists bonus_indicacao int not null default 1000;
alter table public.perfis add column if not exists codigo_indicacao text unique;
alter table public.perfis add column if not exists indicado_por uuid references auth.users(id) on delete set null;
alter table public.perfis add column if not exists indicacao_premiada boolean not null default false;

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.pedidos (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  itens jsonb not null default '[]'::jsonb,
  subtotal numeric(10,2) not null check (subtotal >= 0),
  desconto numeric(10,2) not null default 0 check (desconto >= 0),
  pontos_usados integer not null default 0 check (pontos_usados >= 0),
  total numeric(10,2) not null check (total >= 0),
  nome text,
  cidade text,
  recebimento text,
  status text not null default 'aguardando'
    check (status in ('aguardando', 'confirmado', 'entregue', 'cancelado')),
  pontos_gerados integer not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists pedidos_user_idx on public.pedidos (user_id, criado_em desc);

create table if not exists public.pontos (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  quantidade integer not null,            -- positivo = crédito, negativo = uso
  restante integer not null default 0,    -- créditos: quanto ainda pode ser usado
  expira_em timestamptz,
  pedido_id bigint references public.pedidos(id) on delete set null,
  descricao text not null,
  criado_em timestamptz not null default now()
);
create index if not exists pontos_user_idx on public.pontos (user_id, criado_em desc);

-- ---------- Funções internas (não podem ser chamadas pelo site) ----------
create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public._saldo(p_user uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(restante), 0)::int
  from public.pontos
  where user_id = p_user and quantidade > 0 and restante > 0 and expira_em > now();
$$;

create or replace function public._creditar(p_user uuid, p_qtd int, p_pedido bigint, p_desc text) returns void
language plpgsql security definer set search_path = public as $$
declare v_meses int;
begin
  if p_qtd is null or p_qtd <= 0 then return; end if;
  select validade_meses into v_meses from public.regras_pontos where id = 1;
  insert into public.pontos (user_id, quantidade, restante, expira_em, pedido_id, descricao)
  values (p_user, p_qtd, p_qtd, now() + make_interval(months => coalesce(v_meses, 3)), p_pedido, p_desc);
end $$;

-- usa os pontos que vencem primeiro
create or replace function public._consumir(p_user uuid, p_qtd int, p_pedido bigint, p_desc text) returns void
language plpgsql security definer set search_path = public as $$
declare r record; falta int := p_qtd; usa int;
begin
  if p_qtd is null or p_qtd <= 0 then return; end if;
  if public._saldo(p_user) < p_qtd then
    raise exception 'Saldo de pontos insuficiente';
  end if;
  for r in
    select id, restante from public.pontos
    where user_id = p_user and quantidade > 0 and restante > 0 and expira_em > now()
    order by expira_em, id
    for update
  loop
    usa := least(r.restante, falta);
    update public.pontos set restante = restante - usa where id = r.id;
    falta := falta - usa;
    exit when falta = 0;
  end loop;
  insert into public.pontos (user_id, quantidade, restante, pedido_id, descricao)
  values (p_user, -p_qtd, 0, p_pedido, p_desc);
end $$;

revoke all on function public._saldo(uuid) from public, anon, authenticated;
revoke all on function public._creditar(uuid, int, bigint, text) from public, anon, authenticated;
revoke all on function public._consumir(uuid, int, bigint, text) from public, anon, authenticated;

-- Indique e ganhe: na 1ª compra ENTREGUE do indicado, os dois ganham o bônus
create or replace function public._premiar_indicacao(p_user uuid, p_pedido bigint) returns void
language plpgsql security definer set search_path = public as $$
declare f public.perfis; v_bonus int; v_nome text;
begin
  select * into f from public.perfis where id = p_user for update;
  if not found or f.indicado_por is null or f.indicacao_premiada then return; end if;
  if exists (select 1 from public.pedidos where user_id = p_user and status = 'entregue' and id <> p_pedido) then
    update public.perfis set indicacao_premiada = true where id = p_user; -- já era cliente antes
    return;
  end if;
  select bonus_indicacao into v_bonus from public.regras_pontos where id = 1;
  v_nome := coalesce(nullif(split_part(f.nome, ' ', 1), ''), 'um amigo');
  perform public._creditar(p_user, coalesce(v_bonus, 1000), p_pedido, 'Bônus de boas-vindas por indicação');
  perform public._creditar(f.indicado_por, coalesce(v_bonus, 1000), p_pedido, 'Bônus por indicar ' || v_nome);
  update public.perfis set indicacao_premiada = true where id = p_user;
end $$;
revoke all on function public._premiar_indicacao(uuid, bigint) from public, anon, authenticated;

-- ---------- Cliente ----------
-- código de indicação do cliente (criado na primeira vez) e quantos indicados ele tem
create or replace function public.minha_indicacao() returns table (codigo text, indicados int, premiados int)
language plpgsql security definer set search_path = public as $$
declare v_cod text;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta'; end if;
  select codigo_indicacao into v_cod from public.perfis where id = auth.uid();
  if not found then raise exception 'Complete seu cadastro primeiro'; end if;
  if v_cod is null then
    loop
      select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
        into v_cod from generate_series(1, 6);
      exit when not exists (select 1 from public.perfis where codigo_indicacao = v_cod);
    end loop;
    update public.perfis set codigo_indicacao = v_cod where id = auth.uid();
  end if;
  return query
    select v_cod,
           (select count(*)::int from public.perfis where indicado_por = auth.uid()),
           (select count(*)::int from public.perfis where indicado_por = auth.uid() and indicacao_premiada);
end $$;

-- vincula quem indicou (só uma vez, não vale indicar a si mesmo nem quem já comprou)
create or replace function public.registrar_indicacao(p_codigo text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_ref uuid;
begin
  if auth.uid() is null then return false; end if;
  select id into v_ref from public.perfis where codigo_indicacao = upper(trim(p_codigo));
  if v_ref is null or v_ref = auth.uid() then return false; end if;
  if exists (select 1 from public.pedidos where user_id = auth.uid() and status = 'entregue') then return false; end if;
  update public.perfis set indicado_por = v_ref
   where id = auth.uid() and indicado_por is null;
  return found;
end $$;

create or replace function public.meu_saldo() returns integer
language sql stable security definer set search_path = public as $$
  select public._saldo(auth.uid());
$$;

-- pontos que vencem nos próximos 30 dias
create or replace function public.meus_pontos_a_vencer() returns table (quantidade int, expira_em timestamptz)
language sql stable security definer set search_path = public as $$
  select sum(restante)::int, min(expira_em)
  from public.pontos
  where user_id = auth.uid() and quantidade > 0 and restante > 0
    and expira_em > now() and expira_em <= now() + interval '30 days';
$$;

-- Ao criar um pedido pelo site: garante dono, status inicial e saldo suficiente
create or replace function public._valida_pedido() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.eh_admin() and new.user_id is not null and new.user_id <> auth.uid() then
    return new; -- a loja pode lançar pedido para um cliente
  end if;
  new.user_id := auth.uid();
  new.status := 'aguardando';
  new.pontos_gerados := 0;
  new.criado_em := now();
  new.atualizado_em := now();
  if new.pontos_usados > public._saldo(new.user_id) then
    raise exception 'Saldo de pontos insuficiente';
  end if;
  if new.pontos_usados::numeric / 100 > new.subtotal then
    raise exception 'Os pontos não podem passar do valor do pedido';
  end if;
  return new;
end $$;
drop trigger if exists valida_pedido on public.pedidos;
create trigger valida_pedido before insert on public.pedidos
  for each row execute function public._valida_pedido();

-- ---------- Loja (só administradores) ----------
create or replace function public.confirmar_pedido(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare p public.pedidos;
begin
  if not public.eh_admin() then raise exception 'Apenas a loja pode fazer isso'; end if;
  select * into p from public.pedidos where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if p.status <> 'aguardando' then raise exception 'Este pedido não está aguardando confirmação'; end if;
  perform public._consumir(p.user_id, p.pontos_usados, p.id, 'Usados no pedido M' || p.id);
  update public.pedidos set status = 'confirmado', atualizado_em = now() where id = p_id;
end $$;

-- marca como entregue e credita o cashback; p_total permite corrigir o valor pago
create or replace function public.entregar_pedido(p_id bigint, p_total numeric default null) returns integer
language plpgsql security definer set search_path = public as $$
declare p public.pedidos; v_pct numeric; v_total numeric; v_pts int;
begin
  if not public.eh_admin() then raise exception 'Apenas a loja pode fazer isso'; end if;
  select * into p from public.pedidos where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if p.status = 'aguardando' then
    perform public.confirmar_pedido(p_id);
  elsif p.status <> 'confirmado' then
    raise exception 'Só pedidos confirmados podem ser entregues';
  end if;
  v_total := coalesce(p_total, p.total);
  if v_total < 0 then raise exception 'Valor inválido'; end if;
  select cashback_pct into v_pct from public.regras_pontos where id = 1;
  v_pts := floor(v_total * coalesce(v_pct, 5))::int;  -- R$ 1,00 com 5% = 5 pontos (R$ 0,05)
  perform public._creditar(p.user_id, v_pts, p.id, 'Cashback do pedido M' || p.id);
  perform public._premiar_indicacao(p.user_id, p.id);
  update public.pedidos
     set status = 'entregue', total = v_total, pontos_gerados = v_pts, atualizado_em = now()
   where id = p_id;
  return v_pts;
end $$;

create or replace function public.cancelar_pedido(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare p public.pedidos;
begin
  if not public.eh_admin() then raise exception 'Apenas a loja pode fazer isso'; end if;
  select * into p from public.pedidos where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if p.status = 'entregue' then raise exception 'Pedido já entregue: ajuste os pontos manualmente, se precisar'; end if;
  if p.status = 'cancelado' then return; end if;
  if p.status = 'confirmado' and p.pontos_usados > 0 then
    perform public._creditar(p.user_id, p.pontos_usados, p.id, 'Devolução do pedido cancelado M' || p.id);
  end if;
  update public.pedidos set status = 'cancelado', atualizado_em = now() where id = p_id;
end $$;

-- crédito (positivo) ou retirada (negativo) manual, com motivo
create or replace function public.ajustar_pontos(p_user uuid, p_qtd int, p_motivo text) returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Apenas a loja pode fazer isso'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do ajuste'; end if;
  if p_qtd > 0 then
    perform public._creditar(p_user, p_qtd, null, 'Ajuste da loja: ' || p_motivo);
  elsif p_qtd < 0 then
    perform public._consumir(p_user, -p_qtd, null, 'Ajuste da loja: ' || p_motivo);
  end if;
  return public._saldo(p_user);
end $$;

create or replace function public.admin_pedidos(p_status text default null)
returns table (id bigint, criado_em timestamptz, status text, itens jsonb, subtotal numeric, desconto numeric,
               pontos_usados int, total numeric, pontos_gerados int, nome text, cidade text, recebimento text,
               user_id uuid, email text, whatsapp text, saldo int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Apenas a loja pode fazer isso'; end if;
  return query
    select p.id, p.criado_em, p.status, p.itens, p.subtotal, p.desconto, p.pontos_usados, p.total, p.pontos_gerados,
           coalesce(p.nome, f.nome), p.cidade, p.recebimento, p.user_id, u.email::text, f.whatsapp, public._saldo(p.user_id)
    from public.pedidos p
    join auth.users u on u.id = p.user_id
    left join public.perfis f on f.id = p.user_id
    where p_status is null or p.status = p_status
    order by p.criado_em desc
    limit 300;
end $$;

create or replace function public.admin_clientes(p_busca text default '')
returns table (user_id uuid, email text, nome text, whatsapp text, saldo int, criado_em timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Apenas a loja pode fazer isso'; end if;
  return query
    select u.id, u.email::text, f.nome, f.whatsapp, public._saldo(u.id), u.created_at
    from auth.users u
    left join public.perfis f on f.id = u.id
    where coalesce(p_busca, '') = ''
       or u.email ilike '%' || p_busca || '%'
       or f.nome ilike '%' || p_busca || '%'
       or regexp_replace(coalesce(f.whatsapp, ''), '\D', '', 'g') like '%' || regexp_replace(p_busca, '\D', '', 'g') || '%'
          and regexp_replace(p_busca, '\D', '', 'g') <> ''
    order by u.created_at desc
    limit 200;
end $$;

create or replace function public.admin_extrato(p_user uuid) returns setof public.pontos
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Apenas a loja pode fazer isso'; end if;
  return query select * from public.pontos where user_id = p_user order by criado_em desc limit 200;
end $$;

-- ---------- Segurança por linha (cada cliente só vê o que é dele) ----------
alter table public.regras_pontos enable row level security;
alter table public.perfis enable row level security;
alter table public.admins enable row level security;
alter table public.pedidos enable row level security;
alter table public.pontos enable row level security;

drop policy if exists "regras: leitura pública" on public.regras_pontos;
create policy "regras: leitura pública" on public.regras_pontos for select using (true);

drop policy if exists "perfil: ver o próprio" on public.perfis;
drop policy if exists "perfil: criar o próprio" on public.perfis;
drop policy if exists "perfil: editar o próprio" on public.perfis;
create policy "perfil: ver o próprio" on public.perfis for select to authenticated using (id = auth.uid());
create policy "perfil: criar o próprio" on public.perfis for insert to authenticated with check (id = auth.uid());
create policy "perfil: editar o próprio" on public.perfis for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "pedidos: ver os próprios" on public.pedidos;
drop policy if exists "pedidos: criar os próprios" on public.pedidos;
create policy "pedidos: ver os próprios" on public.pedidos for select to authenticated using (user_id = auth.uid());
create policy "pedidos: criar os próprios" on public.pedidos for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "pontos: ver os próprios" on public.pontos;
create policy "pontos: ver os próprios" on public.pontos for select to authenticated using (user_id = auth.uid());
-- (sem regras de alteração: pontos e status só mudam pelas funções da loja)

-- ---------- Permissões (funciona com "Automatically expose new tables" desligado) ----------
grant usage on schema public to anon, authenticated;
grant select on public.regras_pontos to anon, authenticated;
-- perfil: o cliente só mexe em nome, WhatsApp e aceite (indicação e código ficam com o banco)
revoke insert, update on public.perfis from anon, authenticated;
grant select on public.perfis to authenticated;
grant insert (id, nome, whatsapp, aceite_em), update (id, nome, whatsapp, aceite_em) on public.perfis to authenticated;
grant select, insert on public.pedidos to authenticated;
grant select on public.pontos to authenticated;
revoke all on public.admins from anon, authenticated;
revoke update, delete on public.pedidos from anon, authenticated;
revoke insert, update, delete on public.pontos from anon, authenticated;

grant execute on function public.eh_admin() to authenticated;
grant execute on function public.meu_saldo() to authenticated;
grant execute on function public.meus_pontos_a_vencer() to authenticated;
grant execute on function public.minha_indicacao() to authenticated;
grant execute on function public.registrar_indicacao(text) to authenticated;
grant execute on function public.confirmar_pedido(bigint) to authenticated;
grant execute on function public.entregar_pedido(bigint, numeric) to authenticated;
grant execute on function public.cancelar_pedido(bigint) to authenticated;
grant execute on function public.ajustar_pontos(uuid, int, text) to authenticated;
grant execute on function public.admin_pedidos(text) to authenticated;
grant execute on function public.admin_clientes(text) to authenticated;
grant execute on function public.admin_extrato(uuid) to authenticated;
revoke execute on function public.confirmar_pedido(bigint), public.entregar_pedido(bigint, numeric), public.cancelar_pedido(bigint),
  public.ajustar_pontos(uuid, int, text), public.admin_pedidos(text), public.admin_clientes(text), public.admin_extrato(uuid),
  public.meu_saldo(), public.meus_pontos_a_vencer() from anon;

-- ---------- Preços dos produtos (editados no painel da loja) ----------
-- O catálogo (fotos, descrições) continua no produtos.json; aqui ficam só os valores
-- que a loja altera pelo painel. Uma linha por produto, sobrescreve o produtos.json.
create table if not exists public.precos (
  produto_id text primary key,
  preco numeric(10,2) check (preco is null or preco >= 0),
  preco_de numeric(10,2) check (preco_de is null or preco_de >= 0),   -- preço antigo (riscado) = oferta
  sob_consulta boolean not null default false,
  opcoes jsonb,                                                        -- {"4 cm": 20, "7 cm": 30}
  oculto boolean not null default false,                               -- esconde o produto da loja
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
alter table public.precos enable row level security;
drop policy if exists "precos: leitura pública" on public.precos;
drop policy if exists "precos: loja cria" on public.precos;
drop policy if exists "precos: loja edita" on public.precos;
drop policy if exists "precos: loja apaga" on public.precos;
create policy "precos: leitura pública" on public.precos for select using (true);
create policy "precos: loja cria" on public.precos for insert to authenticated with check (public.eh_admin());
create policy "precos: loja edita" on public.precos for update to authenticated using (public.eh_admin()) with check (public.eh_admin());
create policy "precos: loja apaga" on public.precos for delete to authenticated using (public.eh_admin());
grant select on public.precos to anon, authenticated;
grant insert, update, delete on public.precos to authenticated;

create or replace function public._precos_carimbo() returns trigger
language plpgsql security definer set search_path = public as $$
begin new.atualizado_em := now(); new.atualizado_por := auth.uid(); return new; end $$;
drop trigger if exists precos_carimbo on public.precos;
create trigger precos_carimbo before insert or update on public.precos
  for each row execute function public._precos_carimbo();

-- ---------- Ajuste fino das regras (opcional) ----------
-- update public.regras_pontos set cashback_pct = 5, validade_meses = 3 where id = 1;

-- ---------- Tornar alguém administrador da loja ----------
-- 1) a pessoa entra uma vez no site com o e-mail dela;
-- 2) rode (trocando o e-mail):
-- insert into public.admins (user_id) select id from auth.users where email = 'marshe3d@gmail.com' on conflict do nothing;

-- ---------- Detalhes dos produtos editáveis no painel (mesmo conteúdo de produtos-detalhes.sql) ----------
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
