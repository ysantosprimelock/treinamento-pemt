// Treinamentos realizados (enviados pelos instrutores), com filtros, totais e exportação
import { useCallback, useEffect, useState } from 'react';
import { hoje } from '../lib/util.js';
import { fmtData, fmtDataHoraIso, diasAtras, baixarCsv, Erro } from './comum.jsx';

const DRIVE = { ok: ['No Drive', 'ok'], pendente: ['Aguardando Drive', 'esp'], processando: ['Copiando…', 'esp'], erro: ['Erro no Drive', 'err'] };
export const fabricantesDe = t => (Array.isArray(t.fabricantes) ? t.fabricantes : []);
export const maquinasDe = t => (Array.isArray(t.maquinas) ? t.maquinas : []);

export function totais(lista) {
  const ops = lista.reduce((n, t) => n + (t.n_participantes || 0), 0);
  const aval = lista.reduce((n, t) => n + (t.n_avaliados || 0), 0);
  const apr = lista.reduce((n, t) => n + (t.n_aprovados || 0), 0);
  return { turmas: lista.length, ops, aval, apr, pct: aval ? Math.round((apr / aval) * 100) : null, drive: lista.filter(t => t.drive_status === 'erro').length };
}

export default function Treinamentos({ api, instrutores }) {
  const [filtros, setFiltros] = useState({ de: diasAtras(90), ate: hoje(), instrutor_id: '', busca: '' });
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  const buscar = useCallback(async (f = filtros) => {
    setCarregando(true);
    setErro('');
    try {
      setLista(await api.treinamentos({ ...f, limite: 1000 }));
    } catch (e) {
      setErro(e.message);
      setLista(x => x || []);
    } finally {
      setCarregando(false);
    }
  }, [api, filtros]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { buscar(); }, [api]);

  const set = k => e => setFiltros(x => ({ ...x, [k]: e.target.value }));
  const t = totais(lista || []);

  function exportar() {
    baixarCsv(`treinamentos-${filtros.de}-a-${filtros.ate}.csv`,
      ['Data', 'Cliente', 'Local', 'Cidade', 'UF', 'Instrutor', 'Operadores', 'Avaliados', 'Aprovados', 'Fotos', 'Fabricantes', 'Máquinas', 'E-mails do cliente', 'Drive', 'Enviado em', 'ID'],
      (lista || []).map(x => [fmtData(x.data_treinamento), x.cliente, x.local_treinamento, x.cidade, x.uf, x.instrutor_nome, x.n_participantes, x.n_avaliados, x.n_aprovados, x.n_fotos,
        fabricantesDe(x).join(' / '), maquinasDe(x).join(' / '), x.email_cliente || '', x.drive_status || '', fmtDataHoraIso(x.enviado_em), x.id]));
  }

  return (
    <section className="adm-pagina">
      <div className="adm-topo">
        <h1>Treinamentos realizados</h1>
        <button type="button" className="btn" onClick={exportar} disabled={!lista || !lista.length}>Exportar planilha (CSV)</button>
      </div>
      <form className="adm-busca" onSubmit={e => { e.preventDefault(); buscar(); }}>
        <label>De<input type="date" value={filtros.de} onChange={set('de')} /></label>
        <label>Até<input type="date" value={filtros.ate} onChange={set('ate')} /></label>
        <label>Instrutor
          <select value={filtros.instrutor_id} onChange={set('instrutor_id')}>
            <option value="">Todos</option>
            {instrutores.map(i => <option key={i.id} value={i.id}>{i.nome}</option>)}
          </select>
        </label>
        <label className="adm-busca-texto">Cliente, cidade, operador ou CPF<input type="search" value={filtros.busca} onChange={set('busca')} placeholder="Ex.: ACME, Maria, 529.982" /></label>
        <button type="submit" className="btn prim" disabled={carregando}>{carregando ? 'Buscando…' : 'Buscar'}</button>
      </form>
      <Erro msg={erro} />

      {lista && lista.length > 0 && (
        <dl className="adm-totais" aria-label="Totais do período">
          <div><dt>Turmas</dt><dd>{t.turmas}</dd></div>
          <div><dt>Operadores treinados</dt><dd>{t.ops}</dd></div>
          <div><dt>Aprovados</dt><dd>{t.apr}{t.pct !== null ? <small> de {t.aval} avaliados ({t.pct}%)</small> : null}</dd></div>
          {t.drive > 0 && <div className="alerta"><dt>Com erro no Drive</dt><dd>{t.drive}</dd></div>}
        </dl>
      )}

      {lista === null ? <p className="centro">Carregando…</p> : lista.length === 0 ? (
        <p className="adm-vazio">Nenhum treinamento encontrado com esses filtros.</p>
      ) : (
        <div className="adm-tabela-rolagem">
          <table className="adm-tabela clicavel cartoes">
            <thead><tr><th>Data</th><th>Cliente</th><th>Cidade</th><th>Instrutor</th><th className="num">Operadores</th><th className="num">Aprovados</th><th className="num">Fotos</th><th>Drive</th><th>Enviado em</th></tr></thead>
            <tbody>
              {lista.map(x => {
                const d = DRIVE[x.drive_status] || [x.drive_status || '—', ''];
                return (
                  <tr key={x.id} onClick={() => { window.location.hash = `#/treinamentos/${x.id}`; }}>
                    <td className="nowrap" data-rotulo="Data"><a href={`#/treinamentos/${x.id}`} onClick={e => e.stopPropagation()}><b>{fmtData(x.data_treinamento)}</b></a></td>
                    <td className="titulo" data-rotulo="Cliente"><b>{x.cliente}</b>{x.agendamento_id ? <small>pela agenda</small> : null}</td>
                    <td data-rotulo="Cidade">{x.cidade}/{x.uf}</td>
                    <td data-rotulo="Instrutor">{x.instrutor_nome}</td>
                    <td className="num" data-rotulo="Operadores">{x.n_participantes}</td>
                    <td className="num" data-rotulo="Aprovados">{x.n_avaliados ? `${x.n_aprovados} de ${x.n_avaliados}` : '—'}</td>
                    <td className="num" data-rotulo="Fotos">{x.n_fotos}</td>
                    <td data-rotulo="Drive"><span className={`situ ${d[1]}`}>{d[0]}</span></td>
                    <td className="nowrap" data-rotulo="Enviado em"><small>{fmtDataHoraIso(x.enviado_em)}</small></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {lista && lista.length >= 1000 && <p className="dica">Mostrando os 1.000 mais recentes. Use os filtros para achar os mais antigos.</p>}
    </section>
  );
}
