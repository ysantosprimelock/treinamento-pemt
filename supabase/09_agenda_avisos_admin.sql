-- =====================================================================
-- 09 – Agenda de treinamentos, avisos no celular (push) e consultas do painel admin
--
-- O que este script faz:
--   * Tabela AGENDAMENTOS: o admin cadastra cliente, data, local e instrutor; o instrutor vê no app.
--   * Coluna treinamentos.agendamento_id: liga o treinamento feito ao agendamento.
--   * Tabela PUSH_INSCRICOES: aparelhos dos instrutores que aceitaram receber avisos.
--   * Funções do painel admin (só funcionam para perfis com papel = 'admin').
--
-- Não altera nem apaga nenhum dado existente. Pode ser executado mais de uma vez.
-- Pré-requisito: scripts anteriores instalados (inclusive o 06_provas.sql).
-- Rodar no SQL Editor do Supabase ou no pgAdmin (usuário postgres). Execute o arquivo inteiro.
-- =====================================================================

do $$
begin
  if to_regclass('public.treinamentos') is null or to_regclass('public.perfis') is null then
    raise exception 'Banco sem as tabelas do app (treinamentos/perfis). Confira se está no projeto certo.';
  end if;
  if to_regclass('public.avaliacoes') is null or to_regclass('public.provas') is null then
    raise exception 'Rode antes o 06_provas.sql (tabelas avaliacoes e provas não encontradas).';
  end if;
end $$;

begin;

-- ---------------------------------------------------------------------
-- 1. Agendamentos
-- ---------------------------------------------------------------------
create table if not exists public.agendamentos (
  id                  uuid primary key default gen_random_uuid(),
  cliente             text not null check (length(btrim(cliente)) > 0),
  data_treinamento    date not null,
  horario             time,
  local_treinamento   text,
  cidade              text,
  uf                  char(2) check (uf is null or uf in
    ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  email_cliente       text,
  fabricantes         text[] not null default '{}',
  maquinas            text[] not null default '{}',
  observacoes         text,
  instrutor_id        uuid not null references public.perfis (id) on delete restrict,
  status              text not null default 'agendado' check (status in ('agendado', 'realizado', 'cancelado')),
  motivo_cancelamento text,
  criado_por          uuid references public.perfis (id) on delete set null default auth.uid(),
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  realizado_em        timestamptz,
  avisado_em          timestamptz,
  aviso_resultado     text
);
create index if not exists agendamentos_instrutor_idx on public.agendamentos (instrutor_id, status, data_treinamento);
create index if not exists agendamentos_data_idx on public.agendamentos (data_treinamento desc);

-- Treinamento feito a partir de um agendamento (um agendamento pode ter mais de uma turma)
alter table public.treinamentos add column if not exists agendamento_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'treinamentos_agendamento_fk') then
    alter table public.treinamentos
      add constraint treinamentos_agendamento_fk foreign key (agendamento_id)
      references public.agendamentos (id) on delete set null;
  end if;
end $$;
create index if not exists treinamentos_agendamento_idx on public.treinamentos (agendamento_id);

-- Padroniza como o app (maiúsculas), valida o instrutor e cadastra o cliente na lista de sugestões
create or replace function public.agendamentos_antes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.cliente           := upper(btrim(new.cliente));
  new.local_treinamento := nullif(upper(btrim(coalesce(new.local_treinamento, ''))), '');
  new.cidade            := nullif(upper(btrim(coalesce(new.cidade, ''))), '');
  new.uf                := nullif(upper(btrim(coalesce(new.uf, ''))), '');
  new.email_cliente     := nullif(lower(btrim(coalesce(new.email_cliente, ''))), '');
  new.observacoes       := nullif(btrim(coalesce(new.observacoes, '')), '');
  new.fabricantes       := coalesce((select array_agg(distinct btrim(x)) from unnest(new.fabricantes) x where btrim(x) <> ''), '{}');
  new.maquinas          := coalesce((select array_agg(distinct upper(btrim(x))) from unnest(new.maquinas) x where btrim(x) <> ''), '{}');
  if tg_op = 'INSERT' or new.instrutor_id is distinct from old.instrutor_id then
    if not exists (select 1 from public.perfis where id = new.instrutor_id and ativo) then
      raise exception 'Instrutor inativo ou inexistente.' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.atualizado_em := now();
    new.criado_por := old.criado_por;
    new.criado_em := old.criado_em;
  end if;
  if new.status = 'realizado' and new.realizado_em is null then new.realizado_em := now(); end if;
  if new.status <> 'cancelado' then new.motivo_cancelamento := null; end if;
  insert into public.clientes (nome) values (new.cliente) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists agendamentos_antes_trg on public.agendamentos;
create trigger agendamentos_antes_trg
  before insert or update on public.agendamentos
  for each row execute function public.agendamentos_antes();

-- ---------------------------------------------------------------------
-- 2. Aparelhos inscritos para receber avisos (push)
--    Acesso só pelas funções abaixo (sem leitura direta pelo app).
-- ---------------------------------------------------------------------
create table if not exists public.push_inscricoes (
  endpoint      text primary key check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  usuario_id    uuid not null references public.perfis (id) on delete cascade,
  p256dh        text not null check (length(p256dh) between 20 and 200),
  auth          text not null check (length(auth) between 8 and 100),
  user_agent    text,
  criada_em     timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);
create index if not exists push_inscricoes_usuario_idx on public.push_inscricoes (usuario_id);

-- ---------------------------------------------------------------------
-- 3. Funções
-- ---------------------------------------------------------------------

-- Interrompe se quem chama não for administrador ativo
create or replace function public.exigir_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada. Entre novamente.' using errcode = '28000';
  end if;
  if not public.is_admin() then
    raise exception 'Acesso restrito ao administrador.' using errcode = '42501';
  end if;
end;
$$;

-- Instrutor (ou admin): liga um treinamento enviado ao agendamento de onde ele saiu.
-- Nunca bloqueia o envio: se algo não bater, devolve ok=false com o motivo.
create or replace function public.agenda_vincular(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_tid   uuid;
  v_aid   uuid;
  v_dono  uuid;
begin
  if v_uid is null then
    raise exception 'Sessão expirada. Entre novamente.' using errcode = '28000';
  end if;
  begin
    v_tid := nullif(p ->> 'treinamento_id', '')::uuid;
    v_aid := nullif(p ->> 'agendamento_id', '')::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', 'identificador inválido');
  end;
  if v_tid is null or v_aid is null then
    return jsonb_build_object('ok', false, 'motivo', 'dados incompletos');
  end if;

  select instrutor_id into v_dono from public.treinamentos where id = v_tid;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'treinamento não encontrado');
  end if;
  if v_dono <> v_uid and not public.is_admin() then
    return jsonb_build_object('ok', false, 'motivo', 'treinamento de outro instrutor');
  end if;
  if not exists (select 1 from public.agendamentos where id = v_aid) then
    return jsonb_build_object('ok', false, 'motivo', 'agendamento não encontrado');
  end if;

  update public.treinamentos set agendamento_id = v_aid
   where id = v_tid and agendamento_id is distinct from v_aid;
  update public.agendamentos set status = 'realizado', realizado_em = coalesce(realizado_em, now())
   where id = v_aid and status <> 'realizado';
  return jsonb_build_object('ok', true);
end;
$$;

-- Admin: desfaz a ligação (ex.: ligado ao agendamento errado). O agendamento volta a "agendado"
-- se não sobrar nenhum treinamento ligado a ele.
create or replace function public.agenda_desvincular(p_treinamento uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aid uuid;
begin
  perform public.exigir_admin();
  select agendamento_id into v_aid from public.treinamentos where id = p_treinamento;
  if v_aid is null then
    return jsonb_build_object('ok', true);
  end if;
  update public.treinamentos set agendamento_id = null where id = p_treinamento;
  if not exists (select 1 from public.treinamentos where agendamento_id = v_aid) then
    update public.agendamentos set status = 'agendado', realizado_em = null where id = v_aid and status = 'realizado';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Aparelho do instrutor: guarda (ou atualiza) a inscrição para receber avisos.
-- Se o aparelho já era de outro usuário, passa a ser de quem está logado agora.
create or replace function public.push_salvar(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_endpoint text := btrim(coalesce(p ->> 'endpoint', ''));
  v_p256 text := btrim(coalesce(p ->> 'p256dh', ''));
  v_auth text := btrim(coalesce(p ->> 'auth', ''));
begin
  if v_uid is null then
    raise exception 'Sessão expirada. Entre novamente.' using errcode = '28000';
  end if;
  if not exists (select 1 from public.perfis where id = v_uid and ativo) then
    raise exception 'Usuário sem permissão.' using errcode = '42501';
  end if;
  if v_endpoint !~ '^https://' or length(v_endpoint) > 1000 then
    raise exception 'Inscrição de aviso inválida.' using errcode = '22023';
  end if;
  if v_p256 !~ '^[A-Za-z0-9_=-]{20,200}$' or v_auth !~ '^[A-Za-z0-9_=-]{8,100}$' then
    raise exception 'Chaves da inscrição de aviso inválidas.' using errcode = '22023';
  end if;

  insert into public.push_inscricoes (endpoint, usuario_id, p256dh, auth, user_agent)
  values (v_endpoint, v_uid, v_p256, v_auth, left(p ->> 'user_agent', 300))
  on conflict (endpoint) do update
    set usuario_id = excluded.usuario_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, atualizada_em = now();

  -- no máximo 10 aparelhos por usuário (apaga os mais antigos)
  delete from public.push_inscricoes
   where usuario_id = v_uid
     and endpoint in (select endpoint from public.push_inscricoes where usuario_id = v_uid
                      order by atualizada_em desc offset 10);
  return jsonb_build_object('ok', true);
end;
$$;

-- Aparelho do instrutor: para de receber avisos (ao sair da conta)
create or replace function public.push_remover(p_endpoint text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sessão expirada. Entre novamente.' using errcode = '28000';
  end if;
  delete from public.push_inscricoes where endpoint = p_endpoint and usuario_id = auth.uid();
  return jsonb_build_object('ok', true);
end;
$$;

-- Usada pela função de envio de avisos (com a sessão do admin): aparelhos dos instrutores escolhidos
create or replace function public.push_destinos(p_usuarios uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('endpoint', i.endpoint, 'p256dh', i.p256dh, 'auth', i.auth, 'usuario_id', i.usuario_id))
    from public.push_inscricoes i
    join public.perfis pe on pe.id = i.usuario_id and pe.ativo
    where i.usuario_id = any (coalesce(p_usuarios, '{}'))
  ), '[]'::jsonb);
end;
$$;

-- Usada pela função de envio de avisos: apaga inscrições que o serviço de push disse que não existem mais
create or replace function public.push_descartar(p_endpoints text[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  perform public.exigir_admin();
  delete from public.push_inscricoes where endpoint = any (coalesce(p_endpoints, '{}'));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------- Consultas do painel admin ----------

-- Lista de treinamentos com contagens. p: { de, ate, instrutor_id, busca, limite }
-- busca: cliente, cidade, local, nome do operador ou parte do CPF
create or replace function public.admin_treinamentos(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_de    date;
  v_ate   date;
  v_instr uuid;
  v_busca text := nullif(btrim(coalesce(p ->> 'busca', '')), '');
  v_like  text;
  v_dig   text;
  v_lim   int;
begin
  perform public.exigir_admin();
  v_de    := nullif(p ->> 'de', '')::date;
  v_ate   := nullif(p ->> 'ate', '')::date;
  v_instr := nullif(p ->> 'instrutor_id', '')::uuid;
  v_lim   := least(greatest(coalesce(nullif(p ->> 'limite', '')::int, 300), 1), 2000);
  v_like  := '%' || replace(replace(replace(coalesce(v_busca, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_dig   := regexp_replace(coalesce(v_busca, ''), '\D', '', 'g');

  return coalesce((
    select jsonb_agg(x.j order by x.d desc, x.e desc)
    from (
      select to_jsonb(t) || jsonb_build_object(
               'n_participantes', (select count(*) from public.participantes pa where pa.treinamento_id = t.id),
               'n_avaliados',     (select count(*) from public.avaliacoes a where a.treinamento_id = t.id),
               'n_aprovados',     (select count(*) from public.avaliacoes a where a.treinamento_id = t.id and a.aprovado),
               'n_fotos',         (select count(*) from public.fotos f where f.treinamento_id = t.id)
             ) as j,
             t.data_treinamento as d, t.enviado_em as e
      from public.treinamentos t
      where (v_de is null or t.data_treinamento >= v_de)
        and (v_ate is null or t.data_treinamento <= v_ate)
        and (v_instr is null or t.instrutor_id = v_instr)
        and (v_busca is null
             or t.cliente ilike v_like or t.cidade ilike v_like or t.local_treinamento ilike v_like
             or exists (select 1 from public.participantes pa
                         where pa.treinamento_id = t.id
                           and (pa.nome ilike v_like or (length(v_dig) >= 3 and pa.cpf like '%' || v_dig || '%'))))
      order by t.data_treinamento desc, t.enviado_em desc
      limit v_lim
    ) x
  ), '[]'::jsonb);
end;
$$;

-- Tudo de um treinamento: dados, operadores com avaliação, fotos, provas usadas e agendamento
create or replace function public.admin_treinamento(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_t   jsonb;
  v_fab jsonb;
  v_maq jsonb;
begin
  perform public.exigir_admin();
  select to_jsonb(t) into v_t from public.treinamentos t where t.id = p_id;
  if v_t is null then
    raise exception 'Treinamento não encontrado.' using errcode = 'P0002';
  end if;

  -- Bancos com tabelas de ligação de fabricantes/máquinas (versões antigas do esquema)
  if to_regclass('public.treinamento_fabricantes') is not null then
    execute 'select coalesce(jsonb_agg(f.nome order by f.nome), ''[]''::jsonb)
               from public.treinamento_fabricantes tf join public.fabricantes f on f.id = tf.fabricante_id
              where tf.treinamento_id = $1' into v_fab using p_id;
  end if;
  if to_regclass('public.treinamento_maquinas') is not null then
    execute 'select coalesce(jsonb_agg(m.modelo order by m.modelo), ''[]''::jsonb)
               from public.treinamento_maquinas tm join public.maquinas m on m.id = tm.maquina_id
              where tm.treinamento_id = $1' into v_maq using p_id;
  end if;

  return jsonb_build_object(
    'treinamento', v_t,
    'fabricantes_vinculados', v_fab,
    'maquinas_vinculadas', v_maq,
    'participantes', coalesce((
      select jsonb_agg(to_jsonb(pa) || jsonb_build_object(
               'avaliacao', (select to_jsonb(a) from public.avaliacoes a where a.participante_id = pa.id))
             order by pa.ordem)
      from public.participantes pa where pa.treinamento_id = p_id), '[]'::jsonb),
    'fotos', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.ordem) from public.fotos f where f.treinamento_id = p_id), '[]'::jsonb),
    'provas', coalesce((
      select jsonb_object_agg(pr.id, to_jsonb(pr))
      from public.provas pr
      where pr.id in (select a.prova_id from public.avaliacoes a where a.treinamento_id = p_id and a.prova_id is not null)), '{}'::jsonb),
    'agendamento', (select to_jsonb(ag) from public.agendamentos ag where ag.id = nullif(v_t ->> 'agendamento_id', '')::uuid)
  );
end;
$$;

-- Histórico de um operador (nome ou CPF) em todos os treinamentos
create or replace function public.admin_operadores(p_busca text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_busca text := nullif(btrim(coalesce(p_busca, '')), '');
  v_like  text;
  v_dig   text;
begin
  perform public.exigir_admin();
  if v_busca is null or length(v_busca) < 3 then
    return '[]'::jsonb;
  end if;
  v_like := '%' || replace(replace(replace(v_busca, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_dig  := regexp_replace(v_busca, '\D', '', 'g');
  return coalesce((
    select jsonb_agg(x.j order by x.d desc, x.n)
    from (
      select jsonb_build_object(
               'participante_id', pa.id, 'nome', pa.nome, 'cpf', pa.cpf, 'funcao', pa.funcao,
               'treinamento_id', t.id, 'cliente', t.cliente, 'data_treinamento', t.data_treinamento,
               'cidade', t.cidade, 'uf', t.uf, 'instrutor_nome', t.instrutor_nome,
               'aprovado', a.aprovado, 'modo', a.modo, 'acertos', a.acertos, 'total', a.total,
               'decisao_instrutor', a.decisao_instrutor) as j,
             t.data_treinamento as d, pa.nome as n
      from public.participantes pa
      join public.treinamentos t on t.id = pa.treinamento_id
      left join public.avaliacoes a on a.participante_id = pa.id
      where pa.nome ilike v_like or (length(v_dig) >= 3 and pa.cpf like '%' || v_dig || '%')
      order by t.data_treinamento desc, pa.nome
      limit 500
    ) x
  ), '[]'::jsonb);
end;
$$;

-- Instrutores e administradores, com e-mail, atividade e aparelhos com aviso ligado
create or replace function public.admin_instrutores()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.exigir_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', pe.id, 'nome', pe.nome, 'papel', pe.papel, 'ativo', pe.ativo, 'email', u.email,
             'treinamentos', (select count(*) from public.treinamentos t where t.instrutor_id = pe.id),
             'ultimo_treinamento', (select max(t.data_treinamento) from public.treinamentos t where t.instrutor_id = pe.id),
             'agendados', (select count(*) from public.agendamentos ag where ag.instrutor_id = pe.id and ag.status = 'agendado'),
             'aparelhos_aviso', (select count(*) from public.push_inscricoes i where i.usuario_id = pe.id),
             'ultimo_acesso', u.last_sign_in_at
           ) order by pe.ativo desc, pe.nome)
    from public.perfis pe
    left join auth.users u on u.id = pe.id
  ), '[]'::jsonb);
end;
$$;

-- Último local, cidade, UF e e-mails usados para um cliente (preenche o agendamento)
create or replace function public.admin_cliente_padrao(p_cliente text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_nome text := lower(btrim(coalesce(p_cliente, '')));
  v jsonb;
begin
  perform public.exigir_admin();
  if v_nome = '' then return null; end if;
  select x.j into v from (
    select jsonb_build_object('local_treinamento', ag.local_treinamento, 'cidade', ag.cidade, 'uf', ag.uf,
                              'email_cliente', ag.email_cliente) as j, ag.criado_em as quando
    from public.agendamentos ag where lower(btrim(ag.cliente)) = v_nome
    union all
    select jsonb_build_object('local_treinamento', t.local_treinamento, 'cidade', t.cidade, 'uf', t.uf,
                              'email_cliente', to_jsonb(t) ->> 'email_cliente') as j, t.enviado_em as quando
    from public.treinamentos t where lower(btrim(t.cliente)) = v_nome
    order by 2 desc
    limit 1
  ) x;
  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Segurança
-- ---------------------------------------------------------------------
alter table public.agendamentos    enable row level security;
alter table public.push_inscricoes enable row level security;

revoke all on public.agendamentos, public.push_inscricoes from anon, authenticated;
grant select, insert, update, delete on public.agendamentos to authenticated;
-- push_inscricoes: sem acesso direto (só pelas funções)

-- Instrutor vê só os próprios agendamentos; admin vê e altera todos
drop policy if exists agendamentos_leitura on public.agendamentos;
create policy agendamentos_leitura on public.agendamentos for select to authenticated
  using (instrutor_id = auth.uid() or public.is_admin());

drop policy if exists agendamentos_admin_insere on public.agendamentos;
create policy agendamentos_admin_insere on public.agendamentos for insert to authenticated
  with check (public.is_admin());

drop policy if exists agendamentos_admin_altera on public.agendamentos;
create policy agendamentos_admin_altera on public.agendamentos for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists agendamentos_admin_apaga on public.agendamentos;
create policy agendamentos_admin_apaga on public.agendamentos for delete to authenticated
  using (public.is_admin());

-- Funções: fechadas por padrão, liberadas só para usuários logados (cada uma confere o papel)
revoke all on function public.agendamentos_antes() from public, anon, authenticated;
revoke all on function public.exigir_admin() from public, anon;
revoke all on function public.agenda_vincular(jsonb) from public, anon;
revoke all on function public.agenda_desvincular(uuid) from public, anon;
revoke all on function public.push_salvar(jsonb) from public, anon;
revoke all on function public.push_remover(text) from public, anon;
revoke all on function public.push_destinos(uuid[]) from public, anon;
revoke all on function public.push_descartar(text[]) from public, anon;
revoke all on function public.admin_treinamentos(jsonb) from public, anon;
revoke all on function public.admin_treinamento(uuid) from public, anon;
revoke all on function public.admin_operadores(text) from public, anon;
revoke all on function public.admin_instrutores() from public, anon;
revoke all on function public.admin_cliente_padrao(text) from public, anon;

grant execute on function public.exigir_admin() to authenticated;
grant execute on function public.agenda_vincular(jsonb) to authenticated;
grant execute on function public.agenda_desvincular(uuid) to authenticated;
grant execute on function public.push_salvar(jsonb) to authenticated;
grant execute on function public.push_remover(text) to authenticated;
grant execute on function public.push_destinos(uuid[]) to authenticated;
grant execute on function public.push_descartar(text[]) to authenticated;
grant execute on function public.admin_treinamentos(jsonb) to authenticated;
grant execute on function public.admin_treinamento(uuid) to authenticated;
grant execute on function public.admin_operadores(text) to authenticated;
grant execute on function public.admin_instrutores() to authenticated;
grant execute on function public.admin_cliente_padrao(text) to authenticated;
grant execute on function public.is_admin() to authenticated;

commit;

-- ---------------------------------------------------------------------
-- 5. Administrador do painel
--    Troque o e-mail abaixo se o seu login de administrador for outro.
-- ---------------------------------------------------------------------
update public.perfis set papel = 'admin'
 where id in (select id from auth.users where lower(email) = 'adm@kimtechmanutencao.com.br');

-- Conferência: o seu login deve aparecer com papel = admin
select u.email, p.nome, p.papel, p.ativo
from public.perfis p join auth.users u on u.id = p.id
order by p.papel, p.nome;
