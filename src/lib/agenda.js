// Treinamentos agendados pela Kimtech para o instrutor (tabela agendamentos).
// A lista fica guardada no aparelho para aparecer mesmo sem internet.
import { uuid, hoje, fmtData, lsGet, lsSet } from './util.js';

const LS_AGENDA = 'pemt.agenda';
const CAMPOS = 'id, cliente, data_treinamento, horario, local_treinamento, cidade, uf, email_cliente, fabricantes, maquinas, observacoes, status, atualizado_em';

// Tabela ainda não criada no banco (SQL 09 não rodado): o app segue funcionando sem agenda
export const semTabela = e => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /could not find the table|does not exist/i.test(e.message || ''));

export function agendaGuardada(uid) {
  const g = lsGet(LS_AGENDA, null);
  return g && g.uid === uid && Array.isArray(g.itens) ? g : { uid, itens: [], em: 0 };
}

// Busca no servidor só os agendamentos do próprio instrutor que ainda estão "agendado"
export async function baixarAgenda(supabase, uid, agora = Date.now()) {
  const { data, error } = await supabase.from('agendamentos').select(CAMPOS)
    .eq('instrutor_id', uid).eq('status', 'agendado')
    .order('data_treinamento', { ascending: true }).order('horario', { ascending: true, nullsFirst: false });
  if (error) {
    if (semTabela(error)) return { uid, itens: [], em: agora, indisponivel: true };
    throw error;
  }
  const g = { uid, itens: data || [], em: agora };
  lsSet(LS_AGENDA, g);
  return g;
}

export const horaCurta = h => (h ? String(h).slice(0, 5) : '');

// "Hoje", "Amanhã", "Data passou" ou a data
export function quando(dataIso, referencia = hoje()) {
  if (!dataIso) return '';
  const dia = d => Math.round(Date.parse(d + 'T12:00:00Z') / 86400000);
  const dif = dia(dataIso) - dia(referencia);
  if (dif === 0) return 'Hoje';
  if (dif === 1) return 'Amanhã';
  if (dif < 0) return 'Data passou';
  return fmtData(dataIso);
}

// Treinamento local (rascunho) já preenchido com os dados do agendamento.
// Os operadores não vêm do agendamento: o instrutor cadastra em campo.
export function rascunhoDeAgenda(ag, userId, agora = Date.now()) {
  return {
    id: uuid(), userId, status: 'rascunho', criadoEm: agora, atualizadoEm: agora,
    cliente: ag.cliente || '', local: ag.local_treinamento || '', cidade: ag.cidade || '', uf: ag.uf || '',
    data: ag.data_treinamento || hoje(), emailCliente: ag.email_cliente || '',
    fabricantes: Array.isArray(ag.fabricantes) ? [...ag.fabricantes] : [],
    maquinas: Array.isArray(ag.maquinas) ? [...ag.maquinas] : [],
    fotos: [], operadores: [{ k: uuid(), nome: '', cpf: '', funcao: '' }], assinaturas: {}, provas: {}, decisoes: {}, provaSessao: null,
    agendamentoId: ag.id,
    agendamento: { data: ag.data_treinamento, horario: horaCurta(ag.horario), observacoes: ag.observacoes || '' }
  };
}

// Situação de cada agendamento neste aparelho: { local: treinamento ligado (o mais recente) | null }
export function juntarComLocais(itens, locais, userId) {
  const meus = locais.filter(t => t.userId === userId && t.agendamentoId);
  return itens.map(ag => {
    const ligados = meus.filter(t => t.agendamentoId === ag.id).sort((a, b) => (b.atualizadoEm || 0) - (a.atualizadoEm || 0));
    return { ag, local: ligados[0] || null };
  });
}
