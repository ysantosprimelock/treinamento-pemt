// Testes do 09_agenda_avisos_admin.sql num PostgreSQL de verdade (PGlite, em memória).
// Roda em duas versões do banco: com tabelas de ligação de fabricantes/máquinas (A) e com colunas de lista (B).
//   node supabase/testes/banco.test.mjs
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const BASE = fs.readFileSync(path.join(aqui, 'base-esquema.sql'), 'utf8');
const MIGRACAO = fs.readFileSync(path.join(aqui, '..', '09_agenda_avisos_admin.sql'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FALHA ' + m); } };
const erroDe = async fn => { try { await fn(); return null; } catch (e) { return e; } };

const U = {
  admin: '00000000-0000-4000-8000-0000000000ad',
  a: '00000000-0000-4000-8000-00000000000a',
  b: '00000000-0000-4000-8000-00000000000b',
  inativo: '00000000-0000-4000-8000-00000000000c'
};
const T1 = '10000000-0000-4000-8000-000000000001';
const T2 = '10000000-0000-4000-8000-000000000002';
const T3 = '10000000-0000-4000-8000-000000000003';

async function variante(nome, extra) {
  console.log(`\n===== Banco ${nome} =====`);
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(extra);
  const q = (s, p) => db.query(s, p);
  const um = async (s, p) => (await q(s, p)).rows[0];

  async function como(uid, fn, papel = 'authenticated') {
    await db.exec('begin');
    try {
      await q(`select set_config('request.jwt.claim.sub', $1, true)`, [uid || '']);
      await db.exec(`set local role ${papel}`);
      const r = await fn();
      await db.exec('commit');
      return r;
    } catch (e) {
      await db.exec('rollback');
      throw e;
    }
  }
  const rpc = (uid, sql, p, papel) => como(uid, async () => (await q(sql, p)).rows[0], papel);

  // Usuários e dados existentes
  await db.exec(`
    insert into auth.users (id, email, last_sign_in_at) values
      ('${U.admin}', 'adm@kimtechmanutencao.com.br', now()), ('${U.a}', 'joaquim@kimtechmanutencao.com.br', null),
      ('${U.b}', 'rafael@kimtechmanutencao.com.br', null), ('${U.inativo}', 'saiu@kimtechmanutencao.com.br', null);
    insert into public.perfis (id, nome, papel, ativo) values
      ('${U.admin}', 'YURI', 'instrutor', true), ('${U.a}', 'JOAQUIM LUIZ', 'instrutor', true),
      ('${U.b}', 'RAFAEL VERAS', 'instrutor', true), ('${U.inativo}', 'EX INSTRUTOR', 'instrutor', false);
    insert into public.provas (id, titulo, nota_minima, questoes) values
      ('PEMT-1', 'Prova', 0.7, '[{"p":"Q1?","a":["a","b","c","d"],"c":1},{"p":"Q2?","a":["a","b","c","d"],"c":2}]');
    insert into public.treinamentos (id, instrutor_id, instrutor_nome, cliente, local_treinamento, cidade, uf, data_treinamento, email_cliente, enviado_em) values
      ('${T1}', '${U.a}', 'JOAQUIM LUIZ', 'ACME LTDA', 'PATIO 2', 'FORTALEZA', 'CE', '2026-10-20', 'sst@acme.com.br', now() - interval '3 days'),
      ('${T2}', '${U.b}', 'RAFAEL VERAS', 'BETA SA', 'OBRA', 'MARACANAU', 'CE', '2026-10-22', null, now() - interval '1 day'),
      ('${T3}', '${U.a}', 'JOAQUIM LUIZ', 'ACME LTDA', 'PATIO 9', 'CAUCAIA', 'CE', '2026-10-25', 'novo@acme.com.br', now());
    insert into public.participantes (id, treinamento_id, ordem, nome, cpf, funcao, assinatura_path) values
      ('20000000-0000-4000-8000-000000000001', '${T1}', 1, 'MARIA DA SILVA', '52998224725', 'OPERADORA', '${U.a}/${T1}/assinaturas/01.png'),
      ('20000000-0000-4000-8000-000000000002', '${T1}', 2, 'JOSE SOUZA', '11144477735', null, '${U.a}/${T1}/assinaturas/02.png'),
      ('20000000-0000-4000-8000-000000000003', '${T2}', 1, 'ANA PEREIRA', '39053344705', null, '${U.b}/${T2}/assinaturas/01.png');
    insert into public.fotos (treinamento_id, ordem, storage_path) values
      ('${T1}', 1, '${U.a}/${T1}/fotos/01.jpg'), ('${T1}', 2, '${U.a}/${T1}/fotos/02.jpg'), ('${T2}', 1, '${U.b}/${T2}/fotos/01.jpg');
    insert into public.avaliacoes (participante_id, treinamento_id, modo, prova_id, respostas, acertos, total, nota_minima, aprovado, comprovante_path) values
      ('20000000-0000-4000-8000-000000000001', '${T1}', 'qr', 'PEMT-1', '[1,2]', 2, 2, 0.7, true, '${U.a}/${T1}/provas/01.pdf');
    insert into public.avaliacoes (participante_id, treinamento_id, modo, decisao_instrutor, aprovado) values
      ('20000000-0000-4000-8000-000000000002', '${T1}', 'instrutor', false, false);
  `);

  console.log('1) Instalação');
  let e = await erroDe(() => db.exec(MIGRACAO));
  ok(!e, '09 roda sem erro' + (e ? ': ' + e.message : ''));
  e = await erroDe(() => db.exec(MIGRACAO));
  ok(!e, '09 roda de novo sem erro (pode ser repetido)' + (e ? ': ' + e.message : ''));
  ok((await um(`select papel from public.perfis where id = $1`, [U.admin])).papel === 'admin', 'login adm@ virou admin');
  ok((await um(`select count(*)::int n from public.treinamentos`)).n === 3 && (await um(`select count(*)::int n from public.avaliacoes`)).n === 2, 'nenhum dado existente foi alterado');
  ok((await um(`select relrowsecurity r from pg_class where oid = 'public.agendamentos'::regclass`)).r === true, 'agendamentos com RLS ligado');
  ok((await um(`select relrowsecurity r from pg_class where oid = 'public.push_inscricoes'::regclass`)).r === true, 'push_inscricoes com RLS ligado');

  console.log('2) Agendamentos: só o admin cria e altera; instrutor vê só os dele');
  const novo = (instr, extra = '') => `insert into public.agendamentos (cliente, data_treinamento, horario, local_treinamento, cidade, uf, email_cliente, fabricantes, maquinas, observacoes, instrutor_id)
     values (' acme ltda ', '2026-10-30', '08:00', 'pátio 3', 'fortaleza', 'ce', ' SST@ACME.com.br ', array['Genie','Genie',' JLG '], array['gs-1930',' 3219 '], ' levar EPI ', '${instr}') ${extra} returning *`;
  e = await erroDe(() => rpc(U.a, novo(U.a)));
  ok(e && /row-level security|permission/i.test(e.message), 'instrutor NÃO cria agendamento');
  const ag1 = await rpc(U.admin, novo(U.a));
  ok(ag1 && ag1.cliente === 'ACME LTDA' && ag1.cidade === 'FORTALEZA' && ag1.uf === 'CE' && ag1.local_treinamento === 'PÁTIO 3', 'admin cria; cliente/local/cidade/UF ficam em maiúsculas');
  ok(ag1.email_cliente === 'sst@acme.com.br' && ag1.observacoes === 'levar EPI', 'e-mail em minúsculas e observação sem espaços sobrando');
  ok(ag1.fabricantes.length === 2 && ag1.maquinas.includes('GS-1930') && ag1.maquinas.includes('3219'), 'fabricantes sem repetição e máquinas em maiúsculas');
  ok(ag1.status === 'agendado' && ag1.criado_por === U.admin, 'status inicial "agendado" e criado_por = admin');
  ok((await um(`select count(*)::int n from public.clientes where nome = 'ACME LTDA'`)).n === 1, 'cliente entra na lista de sugestões do app');
  const ag2 = await rpc(U.admin, novo(U.b));
  e = await erroDe(() => rpc(U.admin, novo(U.inativo)));
  ok(e && /inativo/i.test(e.message), 'não agenda para instrutor inativo');
  const vistosA = await como(U.a, async () => (await q(`select id from public.agendamentos`)).rows);
  ok(vistosA.length === 1 && vistosA[0].id === ag1.id, 'instrutor A vê só o agendamento dele');
  const vistosB = await como(U.b, async () => (await q(`select id from public.agendamentos`)).rows);
  ok(vistosB.length === 1 && vistosB[0].id === ag2.id, 'instrutor B vê só o dele');
  const alt = await como(U.a, async () => (await q(`update public.agendamentos set cliente = 'HACK' where id = $1 returning id`, [ag1.id])).rows);
  ok(alt.length === 0 && (await um(`select cliente from public.agendamentos where id = $1`, [ag1.id])).cliente === 'ACME LTDA', 'instrutor NÃO altera agendamento');
  const del = await como(U.a, async () => (await q(`delete from public.agendamentos where id = $1 returning id`, [ag1.id])).rows);
  ok(del.length === 0, 'instrutor NÃO apaga agendamento');
  const upd = await rpc(U.admin, `update public.agendamentos set status = 'cancelado', motivo_cancelamento = 'cliente pediu', criado_por = $2 where id = $1 returning *`, [ag2.id, U.b]);
  ok(upd.status === 'cancelado' && upd.motivo_cancelamento === 'cliente pediu' && upd.criado_por === U.admin && new Date(upd.atualizado_em) >= new Date(ag2.atualizado_em), 'admin cancela; criado_por não muda; atualizado_em avança');
  const reab = await rpc(U.admin, `update public.agendamentos set status = 'agendado' where id = $1 returning *`, [ag2.id]);
  ok(reab.motivo_cancelamento === null, 'ao reabrir, o motivo do cancelamento é limpo');
  e = await erroDe(() => rpc(null, `select * from public.agendamentos`, [], 'anon'));
  ok(e && /permission/i.test(e.message), 'sem login (anon) NÃO lê agendamentos');

  console.log('3) Ligação treinamento ↔ agendamento');
  let r = await rpc(U.b, `select public.agenda_vincular($1) r`, [{ treinamento_id: T1, agendamento_id: ag1.id }]);
  ok(r.r.ok === false && /outro instrutor/.test(r.r.motivo), 'instrutor B NÃO liga treinamento de A');
  r = await rpc(U.a, `select public.agenda_vincular($1) r`, [{ treinamento_id: 'xx', agendamento_id: ag1.id }]);
  ok(r.r.ok === false, 'identificador inválido: ok=false, sem erro (não trava o envio)');
  r = await rpc(U.a, `select public.agenda_vincular($1) r`, [{ treinamento_id: T1, agendamento_id: '30000000-0000-4000-8000-000000000999' }]);
  ok(r.r.ok === false && /não encontrado/.test(r.r.motivo), 'agendamento apagado: ok=false, sem erro');
  r = await rpc(U.a, `select public.agenda_vincular($1) r`, [{ treinamento_id: T1, agendamento_id: ag1.id }]);
  ok(r.r.ok === true, 'instrutor A liga o próprio treinamento');
  let ag = await um(`select status, realizado_em from public.agendamentos where id = $1`, [ag1.id]);
  ok(ag.status === 'realizado' && ag.realizado_em, 'agendamento vira "realizado"');
  ok((await um(`select agendamento_id from public.treinamentos where id = $1`, [T1])).agendamento_id === ag1.id, 'treinamento guarda o agendamento');
  r = await rpc(U.a, `select public.agenda_vincular($1) r`, [{ treinamento_id: T1, agendamento_id: ag1.id }]);
  ok(r.r.ok === true, 'repetir a ligação não dá erro (reenvio)');
  r = await rpc(U.a, `select public.agenda_vincular($1) r`, [{ treinamento_id: T3, agendamento_id: ag1.id }]);
  ok(r.r.ok === true && (await um(`select count(*)::int n from public.treinamentos where agendamento_id = $1`, [ag1.id])).n === 2, 'um agendamento pode ter duas turmas');
  e = await erroDe(() => rpc(U.a, `select public.agenda_desvincular($1) r`, [T1]));
  ok(e && /administrador/.test(e.message), 'instrutor NÃO desfaz ligação');
  await rpc(U.admin, `select public.agenda_desvincular($1) r`, [T1]);
  ok((await um(`select status from public.agendamentos where id = $1`, [ag1.id])).status === 'realizado', 'desligar uma turma: continua realizado (sobrou outra)');
  await rpc(U.admin, `select public.agenda_desvincular($1) r`, [T3]);
  ok((await um(`select status from public.agendamentos where id = $1`, [ag1.id])).status === 'agendado', 'desligar a última: volta a "agendado"');
  r = await rpc(U.admin, `select public.agenda_vincular($1) r`, [{ treinamento_id: T1, agendamento_id: ag1.id }]);
  ok(r.r.ok === true, 'admin liga manualmente');
  e = await erroDe(() => rpc(null, `select public.agenda_vincular($1) r`, [{ treinamento_id: T1, agendamento_id: ag1.id }], 'anon'));
  ok(e && /permission/i.test(e.message), 'sem login NÃO chama a ligação');

  console.log('4) Inscrições de aviso (push)');
  const insc = (end, extra = {}) => ({ endpoint: end, p256dh: 'B' + 'x'.repeat(86), auth: 'abcdefghijklmnopqrstuv', user_agent: 'Android', ...extra });
  r = await rpc(U.a, `select public.push_salvar($1) r`, [insc('https://fcm.googleapis.com/fcm/send/aaa')]);
  ok(r.r.ok === true, 'instrutor inscreve o aparelho');
  e = await erroDe(() => rpc(U.a, `select public.push_salvar($1) r`, [insc('http://inseguro/x')]));
  ok(e && /inválida/.test(e.message), 'endereço sem https é recusado');
  e = await erroDe(() => rpc(U.a, `select public.push_salvar($1) r`, [insc('https://fcm.googleapis.com/x', { auth: "'; drop table x;--" })]));
  ok(e && /inválidas/.test(e.message), 'chave com caracteres inválidos é recusada');
  e = await erroDe(() => rpc(U.a, `select * from public.push_inscricoes`));
  ok(e && /permission/i.test(e.message), 'instrutor NÃO lê a tabela de inscrições');
  await rpc(U.b, `select public.push_salvar($1) r`, [insc('https://fcm.googleapis.com/fcm/send/aaa')]);
  ok((await um(`select usuario_id from public.push_inscricoes where endpoint like '%/aaa'`)).usuario_id === U.b, 'mesmo aparelho com outro login passa a ser do novo usuário');
  await rpc(U.a, `select public.push_remover($1) r`, ['https://fcm.googleapis.com/fcm/send/aaa']);
  ok((await um(`select count(*)::int n from public.push_inscricoes`)).n === 1, 'A NÃO remove inscrição que agora é de B');
  for (let i = 0; i < 12; i++) await rpc(U.a, `select public.push_salvar($1) r`, [insc('https://fcm.googleapis.com/fcm/send/a' + i)]);
  ok((await um(`select count(*)::int n from public.push_inscricoes where usuario_id = $1`, [U.a])).n === 10, 'no máximo 10 aparelhos por usuário');
  e = await erroDe(() => rpc(U.a, `select public.push_destinos($1) r`, [[U.a]]));
  ok(e && /administrador/.test(e.message), 'instrutor NÃO lê destinos de aviso');
  r = await rpc(U.admin, `select public.push_destinos($1) r`, [[U.b]]);
  ok(Array.isArray(r.r) && r.r.length === 1 && r.r[0].endpoint.endsWith('/aaa') && r.r[0].p256dh && r.r[0].auth, 'admin obtém os aparelhos do instrutor B');
  r = await rpc(U.admin, `select public.push_destinos($1) r`, [[U.inativo]]);
  ok(r.r.length === 0, 'instrutor inativo não recebe aviso');
  r = await rpc(U.admin, `select public.push_descartar($1) n`, [['https://fcm.googleapis.com/fcm/send/aaa']]);
  ok(r.n === 1, 'admin descarta inscrição vencida');
  await rpc(U.a, `select public.push_remover($1) r`, ['https://fcm.googleapis.com/fcm/send/a11']);
  ok((await um(`select count(*)::int n from public.push_inscricoes where usuario_id = $1`, [U.a])).n === 9, 'instrutor remove a própria inscrição ao sair');
  e = await erroDe(() => rpc(null, `select public.push_salvar($1) r`, [insc('https://x.y/z')], 'anon'));
  ok(e && /permission/i.test(e.message), 'sem login NÃO inscreve');

  console.log('5) Consultas do painel admin');
  for (const [fn, arg] of [['admin_treinamentos', '{}'], ['admin_treinamento', T1], ['admin_operadores', 'maria'], ['admin_instrutores', null], ['admin_cliente_padrao', 'acme']]) {
    const sql = arg === null ? `select public.${fn}() r` : `select public.${fn}($1) r`;
    e = await erroDe(() => rpc(U.a, sql, arg === null ? [] : [arg]));
    ok(e && /administrador/.test(e.message), `instrutor NÃO acessa ${fn}`);
    e = await erroDe(() => rpc(null, sql, arg === null ? [] : [arg], 'anon'));
    ok(e && /permission/i.test(e.message), `sem login NÃO acessa ${fn}`);
  }
  r = await rpc(U.admin, `select public.admin_treinamentos($1) r`, [{}]);
  ok(r.r.length === 3 && r.r[0].id === T3, 'lista todos os treinamentos, mais recente primeiro');
  const l1 = r.r.find(x => x.id === T1);
  ok(l1.n_participantes === 2 && l1.n_avaliados === 2 && l1.n_aprovados === 1 && l1.n_fotos === 2, 'contagens de operadores, avaliados, aprovados e fotos');
  ok(l1.email_cliente === 'sst@acme.com.br' && l1.instrutor_nome === 'JOAQUIM LUIZ' && l1.agendamento_id === ag1.id, 'traz todas as colunas do treinamento (inclusive agendamento)');
  r = await rpc(U.admin, `select public.admin_treinamentos($1) r`, [{ busca: '224725' }]);
  ok(r.r.length === 1 && r.r[0].id === T1, 'busca por parte do CPF');
  r = await rpc(U.admin, `select public.admin_treinamentos($1) r`, [{ busca: 'pereira' }]);
  ok(r.r.length === 1 && r.r[0].id === T2, 'busca por nome do operador');
  r = await rpc(U.admin, `select public.admin_treinamentos($1) r`, [{ busca: 'acme' }]);
  ok(r.r.length === 2, 'busca por cliente');
  r = await rpc(U.admin, `select public.admin_treinamentos($1) r`, [{ busca: '%' }]);
  ok(r.r.length === 0, 'curinga "%" digitado é tratado como texto');
  r = await rpc(U.admin, `select public.admin_treinamentos($1) r`, [{ de: '2026-10-21', ate: '2026-10-24' }]);
  ok(r.r.length === 1 && r.r[0].id === T2, 'filtro por período');
  r = await rpc(U.admin, `select public.admin_treinamentos($1) r`, [{ instrutor_id: U.a, limite: 1 }]);
  ok(r.r.length === 1 && r.r[0].id === T3, 'filtro por instrutor e limite');

  r = await rpc(U.admin, `select public.admin_treinamento($1) r`, [T1]);
  const d = r.r;
  ok(d.treinamento.cliente === 'ACME LTDA' && d.participantes.length === 2 && d.fotos.length === 2, 'detalhe: dados, operadores e fotos');
  ok(d.participantes[0].cpf === '52998224725' && d.participantes[0].avaliacao.acertos === 2 && d.participantes[0].avaliacao.comprovante_path.endsWith('provas/01.pdf'), 'detalhe: avaliação e comprovante do operador');
  ok(d.participantes[1].avaliacao.modo === 'instrutor' && d.participantes[1].avaliacao.decisao_instrutor === false, 'detalhe: decisão do instrutor aparece para o admin');
  ok(d.provas['PEMT-1'] && d.provas['PEMT-1'].questoes.length === 2, 'detalhe: questões e gabarito da prova usada');
  ok(d.agendamento && d.agendamento.id === ag1.id, 'detalhe: agendamento ligado');
  e = await erroDe(() => rpc(U.admin, `select public.admin_treinamento($1) r`, ['10000000-0000-4000-8000-000000000999']));
  ok(e && /não encontrado/.test(e.message), 'treinamento inexistente: mensagem clara');

  r = await rpc(U.admin, `select public.admin_operadores($1) r`, ['maria']);
  ok(r.r.length === 1 && r.r[0].aprovado === true && r.r[0].cliente === 'ACME LTDA', 'histórico do operador por nome');
  r = await rpc(U.admin, `select public.admin_operadores($1) r`, ['390.533']);
  ok(r.r.length === 1 && r.r[0].nome === 'ANA PEREIRA' && r.r[0].aprovado === null, 'por CPF; sem avaliação = null');
  r = await rpc(U.admin, `select public.admin_operadores($1) r`, ['ma']);
  ok(r.r.length === 0, 'busca com menos de 3 letras não lista tudo');

  r = await rpc(U.admin, `select public.admin_instrutores() r`);
  const ja = r.r.find(x => x.id === U.a);
  ok(r.r.length === 4 && ja.email === 'joaquim@kimtechmanutencao.com.br' && ja.treinamentos === 2 && ja.aparelhos_aviso === 9 && ja.agendados === 0, 'instrutores com e-mail, treinamentos e aparelhos');
  ok(r.r.find(x => x.id === U.admin).papel === 'admin', 'mostra quem é admin');

  r = await rpc(U.admin, `select public.admin_cliente_padrao($1) r`, ['Acme Ltda']);
  ok(r.r && r.r.cidade === 'FORTALEZA' && r.r.email_cliente === 'sst@acme.com.br', 'padrão do cliente vem do registro mais recente (o agendamento)');
  r = await rpc(U.admin, `select public.admin_cliente_padrao($1) r`, ['beta sa']);
  ok(r.r && r.r.cidade === 'MARACANAU', 'cliente sem agendamento usa o último treinamento');
  r = await rpc(U.admin, `select public.admin_cliente_padrao($1) r`, ['inexistente']);
  ok(r.r === null, 'cliente novo: nada a preencher');

  console.log('6) Regras antigas continuam valendo');
  const tA = await como(U.a, async () => (await q(`select id from public.treinamentos`)).rows);
  ok(tA.length === 2 && tA.every(x => x.id !== T2), 'instrutor A continua vendo só os treinamentos dele');
  e = await erroDe(() => rpc(U.a, `select * from public.avaliacoes`));
  ok(e && /permission/i.test(e.message), 'avaliações continuam sem leitura direta');

  return db;
}

const dbA = await variante('A (tabelas de ligação de fabricantes/máquinas)', `
  create table public.treinamento_fabricantes (treinamento_id uuid references public.treinamentos (id) on delete cascade, fabricante_id bigint references public.fabricantes (id), primary key (treinamento_id, fabricante_id));
  create table public.treinamento_maquinas (treinamento_id uuid references public.treinamentos (id) on delete cascade, maquina_id bigint references public.maquinas (id), primary key (treinamento_id, maquina_id));
  insert into public.fabricantes (nome) values ('Genie'), ('JLG'), ('Skyjack');
  insert into public.maquinas (modelo) values ('GS-1930'), ('3219');
`);
await dbA.exec(`
  insert into public.treinamento_fabricantes select '${T1}', id from public.fabricantes where nome in ('JLG', 'Genie');
  insert into public.treinamento_maquinas select '${T1}', id from public.maquinas;
  select set_config('request.jwt.claim.sub', '${U.admin}', false);
`);
{
  const r = (await dbA.query(`select public.admin_treinamento($1) r`, [T1])).rows[0].r;
  ok(JSON.stringify(r.fabricantes_vinculados) === '["Genie","JLG"]' && r.maquinas_vinculadas.length === 2, 'A: detalhe traz fabricantes e máquinas das tabelas de ligação');
}

const dbB = await variante('B (fabricantes e máquinas em colunas do treinamento)', `
  alter table public.treinamentos add column fabricantes text[] not null default '{}';
  alter table public.treinamentos add column maquinas text[] not null default '{}';
`);
await dbB.exec(`
  update public.treinamentos set fabricantes = array['Genie','JLG'], maquinas = array['3219'] where id = '${T1}';
  select set_config('request.jwt.claim.sub', '${U.admin}', false);
`);
{
  const r = (await dbB.query(`select public.admin_treinamento($1) r`, [T1])).rows[0].r;
  ok(r.fabricantes_vinculados === null && JSON.stringify(r.treinamento.fabricantes) === '["Genie","JLG"]', 'B: fabricantes vêm da coluna do treinamento');
}

console.log(`\nResultado: ${pass} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
