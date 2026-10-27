// Agenda: o admin cadastra cliente, data, local e instrutor; o instrutor vê no app e recebe aviso no celular.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { UFS, hoje, nk, comUnico, listaEmails } from '../lib/util.js';
import { fmtData, fmtDataHoraIso, hora, lugar, Janela, Erro } from './comum.jsx';

const emailValido = v => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
const up = s => String(s || '').toLocaleUpperCase('pt-BR');
const FAB_PADRAO = ['Genie', 'JLG', 'Skyjack'];

export const FILTROS = [
  ['proximos', 'Próximos'],
  ['atrasados', 'Data passou'],
  ['realizados', 'Realizados'],
  ['cancelados', 'Cancelados'],
  ['todos', 'Todos']
];

const chave = a => `${a.data_treinamento} ${a.horario || '99'}`;
export function filtrarAgenda(itens, filtro, ref = hoje()) {
  const f = {
    proximos: a => a.status === 'agendado' && a.data_treinamento >= ref,
    atrasados: a => a.status === 'agendado' && a.data_treinamento < ref,
    realizados: a => a.status === 'realizado',
    cancelados: a => a.status === 'cancelado',
    todos: () => true
  }[filtro] || (() => true);
  const l = itens.filter(f);
  return filtro === 'proximos' ? l.sort((a, b) => chave(a).localeCompare(chave(b))) : l.sort((a, b) => chave(b).localeCompare(chave(a)));
}

// Texto do aviso para o celular
export function textoAviso(ag, tipo) {
  const quando = `${fmtData(ag.data_treinamento)}${ag.horario ? ' às ' + hora(ag.horario) : ''}`;
  const onde = lugar(ag.local_treinamento, ag.cidade, ag.uf);
  if (tipo === 'cancelado') {
    return { titulo: 'Treinamento cancelado', corpo: `${ag.cliente} – ${quando}${ag.motivo_cancelamento ? '. Motivo: ' + ag.motivo_cancelamento : ''}` };
  }
  return {
    titulo: tipo === 'novo' ? 'Novo treinamento agendado' : 'Treinamento agendado foi alterado',
    corpo: `${ag.cliente} – ${quando}${onde ? ' – ' + onde : ''}`
  };
}

export function resumoAviso(r) {
  if (!r) return '';
  if (!r.aparelhos) return 'nenhum celular com avisos ativos';
  return `${r.enviados} de ${r.aparelhos} celular(es)${r.falhas ? `, ${r.falhas} falha(s)` : ''}`;
}

// URL do app do instrutor (o painel fica em <app>/admin/)
export const urlApp = (loc = window.location) => new URL('../', loc.href).href;

function situacao(a, ref = hoje()) {
  if (a.status === 'cancelado') return { txt: 'Cancelado', cls: 'err' };
  if (a.status === 'realizado') return { txt: 'Realizado', cls: 'ok' };
  if (a.data_treinamento < ref) return { txt: 'Data passou', cls: 'err' };
  return { txt: 'Agendado', cls: 'esp' };
}

const VAZIO = { cliente: '', data_treinamento: '', horario: '', local_treinamento: '', cidade: '', uf: '', email_cliente: '', instrutor_id: '', fabricantes: [], maquinas: [], observacoes: '' };

export function FormAgenda({ api, inicial, instrutores, listas, aoFechar, aoSalvo }) {
  const novo = !inicial || !inicial.id;
  const [f, setF] = useState(() => ({ ...VAZIO, ...(inicial || {}), horario: hora(inicial && inicial.horario), uf: (inicial && inicial.uf) || '' }));
  const [avisar, setAvisar] = useState(true);
  const [erros, setErros] = useState([]);
  const [salvando, setSalvando] = useState(false);
  const [novoFab, setNovoFab] = useState('');
  const [novaMaq, setNovaMaq] = useState('');
  const ativos = instrutores.filter(i => i.ativo || i.id === f.instrutor_id);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const baseFab = listas.fabricantes && listas.fabricantes.length ? listas.fabricantes : FAB_PADRAO;
  let todosFab = [];
  [...baseFab, ...f.fabricantes].forEach(x => { todosFab = comUnico(todosFab, x); });

  // Cliente já atendido: completa local, cidade, UF e e-mails com o último usado (só os campos vazios)
  async function completarCliente() {
    if (!novo || !f.cliente.trim()) return;
    try {
      const p = await api.clientePadrao(f.cliente);
      if (!p) return;
      setF(x => ({
        ...x,
        local_treinamento: x.local_treinamento || p.local_treinamento || '',
        cidade: x.cidade || p.cidade || '',
        uf: x.uf || p.uf || '',
        email_cliente: x.email_cliente || p.email_cliente || ''
      }));
    } catch { /* sem sugestão: o admin digita */ }
  }

  function validar() {
    const e = [];
    if (!f.cliente.trim()) e.push('Informe o cliente.');
    if (!f.data_treinamento) e.push('Informe a data do treinamento.');
    if (!f.instrutor_id) e.push('Escolha o instrutor.');
    const ruins = listaEmails(f.email_cliente).filter(x => !emailValido(x));
    if (ruins.length) e.push(`E-mail inválido: ${ruins.join(', ')}.`);
    return e;
  }

  async function salvar(ev) {
    ev.preventDefault();
    const e = validar();
    setErros(e);
    if (e.length) return;
    if (novo && f.data_treinamento < hoje() && !confirm('A data escolhida já passou. Salvar mesmo assim?')) return;
    setSalvando(true);
    try {
      const dados = {
        cliente: up(f.cliente.trim()), data_treinamento: f.data_treinamento, horario: f.horario || null,
        local_treinamento: up(f.local_treinamento.trim()) || null, cidade: up(f.cidade.trim()) || null, uf: f.uf || null,
        email_cliente: listaEmails(f.email_cliente).join(', ') || null, instrutor_id: f.instrutor_id,
        fabricantes: f.fabricantes, maquinas: f.maquinas.map(up), observacoes: f.observacoes.trim() || null
      };
      if (!novo) dados.id = inicial.id;
      const salvo = await api.salvarAgendamento(dados);
      let aviso = null;
      if (avisar) {
        const trocouInstrutor = !novo && inicial.instrutor_id !== salvo.instrutor_id;
        const t = textoAviso(salvo, novo || trocouInstrutor ? 'novo' : 'alterado');
        try {
          const r = await api.avisar({ usuarios: [salvo.instrutor_id], ...t, url: urlApp() + '?agenda=' + salvo.id, tag: 'agenda-' + salvo.id });
          aviso = { ok: true, r };
          await api.marcarAviso(salvo.id, resumoAviso(r)).catch(() => {});
        } catch (err) {
          aviso = { ok: false, msg: err.message };
          await api.marcarAviso(salvo.id, 'não enviado: ' + err.message).catch(() => {});
        }
      }
      aoSalvo(salvo, aviso, novo);
    } catch (err) {
      setErros([err.message]);
      setSalvando(false);
    }
  }

  const addFab = () => { setF(x => ({ ...x, fabricantes: comUnico(x.fabricantes, novoFab, baseFab) })); setNovoFab(''); };
  const addMaq = () => { setF(x => ({ ...x, maquinas: comUnico(x.maquinas, up(novaMaq), (listas.maquinas || []).map(up)) })); setNovaMaq(''); };

  return (
    <Janela titulo={novo ? 'Novo agendamento' : 'Editar agendamento'} aoFechar={aoFechar} largo>
      <form onSubmit={salvar} className="adm-form" noValidate>
        {erros.length > 0 && <div className="aviso" role="alert"><b>Confira antes de salvar</b><ul>{erros.map(x => <li key={x}>{x}</li>)}</ul></div>}
        <label>Cliente (empresa)
          <input className="maiusc" list="adm-clientes" autoComplete="off" value={f.cliente} onChange={set('cliente')} onBlur={completarCliente} />
        </label>
        <datalist id="adm-clientes">{(listas.clientes || []).map(c => <option key={c} value={c} />)}</datalist>
        <div className="adm-linha3">
          <label>Data<input type="date" value={f.data_treinamento} onChange={set('data_treinamento')} /></label>
          <label>Horário (opcional)<input type="time" value={f.horario} onChange={set('horario')} /></label>
          <label>Instrutor
            <select value={f.instrutor_id} onChange={set('instrutor_id')}>
              <option value="">Escolha…</option>
              {ativos.map(i => <option key={i.id} value={i.id}>{i.nome}{i.aparelhos_aviso ? '' : ' (sem avisos no celular)'}</option>)}
            </select>
          </label>
        </div>
        <label>Local do treinamento<input className="maiusc" autoComplete="off" placeholder="Unidade, pátio, obra…" value={f.local_treinamento} onChange={set('local_treinamento')} /></label>
        <div className="adm-linha2">
          <label>Cidade<input className="maiusc" autoComplete="off" value={f.cidade} onChange={set('cidade')} /></label>
          <label>UF
            <select value={f.uf} onChange={set('uf')}>
              <option value="">—</option>
              {UFS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
        </div>
        <label>E-mails do cliente (certificados)
          <input type="text" inputMode="email" autoComplete="off" spellCheck={false} placeholder="sst@cliente.com.br, compras@cliente.com.br" value={f.email_cliente} onChange={e => setF(x => ({ ...x, email_cliente: e.target.value.toLowerCase() }))} />
        </label>

        <fieldset className="adm-grupo">
          <legend>Fabricantes (opcional)</legend>
          <div className="chips">
            {todosFab.map(x => {
              const on = f.fabricantes.some(y => nk(y) === nk(x));
              return <button key={x} type="button" className="chip" aria-pressed={on} onClick={() => setF(v => ({ ...v, fabricantes: on ? v.fabricantes.filter(y => nk(y) !== nk(x)) : [...v.fabricantes, x] }))}>{x}</button>;
            })}
          </div>
          <div className="add">
            <input placeholder="Outro fabricante" autoComplete="off" value={novoFab} onChange={e => setNovoFab(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addFab(); } }} />
            <button type="button" className="btn" onClick={addFab}>Adicionar</button>
          </div>
        </fieldset>

        <fieldset className="adm-grupo">
          <legend>Máquinas e modelos (opcional)</legend>
          <div className="add">
            <input className="maiusc" list="adm-maquinas" placeholder="Ex.: 3219, GS-1930…" autoComplete="off" value={novaMaq} onChange={e => setNovaMaq(up(e.target.value))} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addMaq(); } }} />
            <button type="button" className="btn" onClick={addMaq}>Adicionar</button>
          </div>
          <datalist id="adm-maquinas">{(listas.maquinas || []).map(m => <option key={m} value={m} />)}</datalist>
          {f.maquinas.length > 0 && (
            <ul className="tags">
              {f.maquinas.map(m => <li key={m}><span>{m}</span><button type="button" aria-label={`Remover ${m}`} onClick={() => setF(v => ({ ...v, maquinas: v.maquinas.filter(y => y !== m) }))}>×</button></li>)}
            </ul>
          )}
        </fieldset>

        <label>Observações para o instrutor
          <textarea rows={3} value={f.observacoes} onChange={set('observacoes')} placeholder="Contato no local, EPIs, portaria, quantidade de alunos…" />
        </label>
        <label className="adm-check"><input type="checkbox" checked={avisar} onChange={e => setAvisar(e.target.checked)} /> Avisar o instrutor no celular</label>
        <div className="adm-acoes-form">
          <button type="button" className="btn" onClick={aoFechar}>Fechar sem salvar</button>
          <button type="submit" className="btn prim" disabled={salvando}>{salvando ? 'Salvando…' : novo ? 'Salvar agendamento' : 'Salvar alterações'}</button>
        </div>
      </form>
    </Janela>
  );
}

function CancelarAgenda({ api, ag, aoFechar, aoFeito }) {
  const [motivo, setMotivo] = useState('');
  const [avisar, setAvisar] = useState(true);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  async function confirmar(e) {
    e.preventDefault();
    setOcupado(true);
    try {
      const salvo = await api.salvarAgendamento({ id: ag.id, status: 'cancelado', motivo_cancelamento: motivo.trim() || null });
      let aviso = null;
      if (avisar) {
        try {
          const r = await api.avisar({ usuarios: [salvo.instrutor_id], ...textoAviso(salvo, 'cancelado'), url: urlApp(), tag: 'agenda-' + salvo.id });
          aviso = { ok: true, r };
          await api.marcarAviso(salvo.id, 'cancelamento: ' + resumoAviso(r)).catch(() => {});
        } catch (err) { aviso = { ok: false, msg: err.message }; }
      }
      aoFeito(salvo, aviso);
    } catch (err) {
      setErro(err.message);
      setOcupado(false);
    }
  }
  return (
    <Janela titulo="Cancelar agendamento" aoFechar={aoFechar}>
      <form onSubmit={confirmar} className="adm-form">
        <p>{ag.cliente} – {fmtData(ag.data_treinamento)}{ag.horario ? ' às ' + hora(ag.horario) : ''}. O agendamento sai da lista do instrutor.</p>
        <Erro msg={erro} />
        <label>Motivo (opcional)<textarea rows={2} value={motivo} onChange={e => setMotivo(e.target.value)} /></label>
        <label className="adm-check"><input type="checkbox" checked={avisar} onChange={e => setAvisar(e.target.checked)} /> Avisar o instrutor no celular</label>
        <div className="adm-acoes-form">
          <button type="button" className="btn" onClick={aoFechar}>Manter agendamento</button>
          <button type="submit" className="btn perigo" disabled={ocupado}>{ocupado ? 'Cancelando…' : 'Cancelar agendamento'}</button>
        </div>
      </form>
    </Janela>
  );
}

export default function Agenda({ api, instrutores, listas, avisar }) {
  const [itens, setItens] = useState(null);
  const [ligados, setLigados] = useState({});
  const [filtro, setFiltro] = useState('proximos');
  const [editando, setEditando] = useState(null);
  const [cancelando, setCancelando] = useState(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState('');
  const nomeInstr = useMemo(() => Object.fromEntries(instrutores.map(i => [i.id, i.nome])), [instrutores]);

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const [ags, tr] = await Promise.all([api.agendamentos(), api.treinamentosLigados().catch(() => [])]);
      const porAg = {};
      for (const t of tr) (porAg[t.agendamento_id] = porAg[t.agendamento_id] || []).push(t);
      setLigados(porAg);
      setItens(ags);
    } catch (e) {
      setErro(e.message);
      setItens(x => x || []);
    }
  }, [api]);
  useEffect(() => { carregar(); }, [carregar]);

  function depoisDoAviso(texto, aviso) {
    if (!aviso) return avisar(texto);
    if (!aviso.ok) return avisar(`${texto} O aviso no celular não foi enviado: ${aviso.msg}`, 'err');
    if (!aviso.r.aparelhos) return avisar(`${texto} O instrutor ainda não ativou os avisos no celular; ele verá ao abrir o app.`, 'atencao');
    return avisar(`${texto} Aviso enviado para ${resumoAviso(aviso.r)}.`, aviso.r.enviados ? 'ok' : 'atencao');
  }

  async function reenviar(ag) {
    setOcupado(ag.id);
    try {
      const r = await api.avisar({ usuarios: [ag.instrutor_id], ...textoAviso(ag, 'novo'), url: urlApp() + '?agenda=' + ag.id, tag: 'agenda-' + ag.id });
      await api.marcarAviso(ag.id, resumoAviso(r)).catch(() => {});
      depoisDoAviso('Aviso reenviado.', { ok: true, r });
      carregar();
    } catch (e) {
      avisar('O aviso não foi enviado: ' + e.message, 'err');
    } finally {
      setOcupado('');
    }
  }

  async function reabrir(ag) {
    setOcupado(ag.id);
    try {
      await api.salvarAgendamento({ id: ag.id, status: 'agendado' });
      avisar('Agendamento reaberto. Ele volta a aparecer para o instrutor.');
      carregar();
    } catch (e) {
      avisar(e.message, 'err');
    } finally {
      setOcupado('');
    }
  }

  const contagem = useMemo(() => Object.fromEntries(FILTROS.map(([k]) => [k, itens ? filtrarAgenda(itens, k).length : 0])), [itens]);
  const lista = itens ? filtrarAgenda(itens, filtro) : [];

  return (
    <section className="adm-pagina">
      <div className="adm-topo">
        <h1>Agenda</h1>
        <button type="button" className="btn prim" onClick={() => setEditando({})} disabled={!instrutores.length}>Novo agendamento</button>
      </div>
      <p className="dica">O instrutor vê os agendamentos dele na tela inicial do app e começa o treinamento já com cliente, data e local preenchidos.</p>
      <Erro msg={erro} />
      <div className="adm-filtros" role="tablist" aria-label="Situação">
        {FILTROS.map(([k, rot]) => (
          <button key={k} type="button" role="tab" aria-selected={filtro === k} className="adm-seg" onClick={() => setFiltro(k)}>
            {rot}<span className="adm-cont">{contagem[k]}</span>
          </button>
        ))}
      </div>

      {itens === null ? <p className="centro">Carregando…</p> : lista.length === 0 ? (
        <p className="adm-vazio">{filtro === 'proximos' ? 'Nenhum treinamento agendado. Use "Novo agendamento" para colocar um na agenda de um instrutor.' : 'Nada nesta situação.'}</p>
      ) : (
        <div className="adm-tabela-rolagem">
          <table className="adm-tabela cartoes">
            <thead><tr><th>Data</th><th>Cliente</th><th>Local</th><th>Instrutor</th><th>Situação</th><th>Aviso no celular</th><th><span className="sr">Ações</span></th></tr></thead>
            <tbody>
              {lista.map(a => {
                const s = situacao(a);
                const trs = ligados[a.id] || [];
                return (
                  <tr key={a.id} data-id={a.id}>
                    <td className="nowrap" data-rotulo="Data"><b>{fmtData(a.data_treinamento)}</b>{a.horario ? <small>{hora(a.horario)}</small> : null}</td>
                    <td className="titulo" data-rotulo="Cliente"><b>{a.cliente}</b>{a.observacoes ? <small className="adm-obs">{a.observacoes}</small> : null}</td>
                    <td data-rotulo="Local">{lugar(a.local_treinamento, a.cidade, a.uf) || '—'}</td>
                    <td data-rotulo="Instrutor">{nomeInstr[a.instrutor_id] || '—'}</td>
                    <td data-rotulo="Situação"><span className={`situ ${s.cls}`}>{s.txt}</span>{a.status === 'cancelado' && a.motivo_cancelamento ? <small>{a.motivo_cancelamento}</small> : null}</td>
                    <td data-rotulo="Aviso no celular">{a.avisado_em ? <><small>{fmtDataHoraIso(a.avisado_em)}</small><small>{a.aviso_resultado}</small></> : <small>não enviado</small>}</td>
                    <td className="adm-acoes">
                      {a.status === 'agendado' && <button type="button" className="btn peq" onClick={() => setEditando(a)}>Editar</button>}
                      {a.status === 'agendado' && <button type="button" className="btn peq" disabled={ocupado === a.id} onClick={() => reenviar(a)}>{a.avisado_em ? 'Avisar de novo' : 'Avisar instrutor'}</button>}
                      {a.status === 'agendado' && <button type="button" className="link" onClick={() => setCancelando(a)}>Cancelar</button>}
                      {a.status === 'cancelado' && <button type="button" className="btn peq" disabled={ocupado === a.id} onClick={() => reabrir(a)}>Reabrir</button>}
                      {trs.map((t, i) => <a key={t.id} className="btn peq" href={`#/treinamentos/${t.id}`}>{trs.length > 1 ? `Ver turma ${i + 1}` : 'Ver treinamento'}</a>)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <FormAgenda api={api} inicial={editando.id ? editando : null} instrutores={instrutores} listas={listas}
          aoFechar={() => setEditando(null)}
          aoSalvo={(salvo, aviso, novo) => { setEditando(null); depoisDoAviso(novo ? 'Agendamento salvo.' : 'Alterações salvas.', aviso); carregar(); }} />
      )}
      {cancelando && (
        <CancelarAgenda api={api} ag={cancelando} aoFechar={() => setCancelando(null)}
          aoFeito={(s, aviso) => { setCancelando(null); depoisDoAviso('Agendamento cancelado.', aviso); carregar(); }} />
      )}
    </section>
  );
}
