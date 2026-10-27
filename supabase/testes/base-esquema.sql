-- Reconstrução REDUZIDA do banco atual, só para os testes automáticos (PGlite).
-- NÃO rode este arquivo no Supabase.
-- Inclui os stubs do ambiente Supabase (auth.users, auth.uid(), storage) e as tabelas do app
-- de que o 09_agenda_avisos_admin.sql depende.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema storage;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  last_sign_in_at timestamptz
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table public.perfis (
  id        uuid primary key references auth.users (id) on delete cascade,
  nome      text not null check (length(btrim(nome)) >= 2),
  papel     text not null default 'instrutor' check (papel in ('instrutor', 'admin')),
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfis where id = auth.uid() and papel = 'admin' and ativo);
$$;

create table public.clientes (
  id bigint generated always as identity primary key,
  nome text not null check (length(btrim(nome)) > 0),
  criado_em timestamptz not null default now()
);
create unique index clientes_nome_uq on public.clientes (lower(btrim(nome)));
create table public.fabricantes (id bigint generated always as identity primary key, nome text not null);
create unique index fabricantes_nome_uq on public.fabricantes (lower(btrim(nome)));
create table public.maquinas (id bigint generated always as identity primary key, modelo text not null);
create unique index maquinas_modelo_uq on public.maquinas (lower(btrim(modelo)));

create table public.treinamentos (
  id                uuid primary key,
  instrutor_id      uuid not null references public.perfis (id) on delete restrict,
  instrutor_nome    text not null,
  cliente           text not null,
  local_treinamento text not null,
  cidade            text not null,
  uf                char(2) not null,
  data_treinamento  date not null,
  email_cliente     text,
  enviado_em        timestamptz not null default now(),
  drive_status      text not null default 'pendente'
);

create table public.participantes (
  id              uuid primary key default gen_random_uuid(),
  treinamento_id  uuid not null references public.treinamentos (id) on delete cascade,
  ordem           int not null,
  nome            text not null,
  cpf             text not null,
  funcao          text,
  assinatura_path text not null,
  unique (treinamento_id, ordem)
);

create table public.fotos (
  id             uuid primary key default gen_random_uuid(),
  treinamento_id uuid not null references public.treinamentos (id) on delete cascade,
  ordem          int not null,
  storage_path   text not null
);

create table public.provas (
  id          text primary key,
  titulo      text not null,
  nota_minima numeric(4,3) not null,
  questoes    jsonb not null,
  criada_em   timestamptz not null default now()
);

create table public.avaliacoes (
  participante_id   uuid primary key references public.participantes (id) on delete cascade,
  treinamento_id    uuid not null references public.treinamentos (id) on delete cascade,
  modo              text not null check (modo in ('qr', 'papel', 'instrutor')),
  prova_id          text references public.provas (id),
  respostas         jsonb,
  acertos           int,
  total             int,
  nota_minima       numeric(4,3),
  decisao_instrutor boolean,
  aprovado          boolean not null,
  tentativa_id      uuid,
  respondida_em     timestamptz,
  comprovante_path  text,
  criada_em         timestamptz not null default now()
);

alter table public.perfis        enable row level security;
alter table public.clientes      enable row level security;
alter table public.treinamentos  enable row level security;
alter table public.participantes enable row level security;
alter table public.fotos         enable row level security;
alter table public.provas        enable row level security;
alter table public.avaliacoes    enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant select on public.perfis, public.clientes, public.treinamentos, public.participantes, public.fotos, public.provas to authenticated;
create policy perfis_leitura on public.perfis for select to authenticated using (id = auth.uid() or public.is_admin());
create policy clientes_leitura on public.clientes for select to authenticated using (true);
create policy treinamentos_leitura on public.treinamentos for select to authenticated using (instrutor_id = auth.uid() or public.is_admin());
create policy participantes_leitura on public.participantes for select to authenticated using (treinamento_id in (select id from public.treinamentos));
create policy fotos_leitura on public.fotos for select to authenticated using (treinamento_id in (select id from public.treinamentos));
create policy provas_leitura on public.provas for select to authenticated using (true);
-- avaliacoes: sem leitura direta (como no banco real, o painel usa as funções admin_*)
