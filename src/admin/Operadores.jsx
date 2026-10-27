// Histórico de um operador em todos os treinamentos (por nome ou CPF)
import { useState } from 'react';
import { fmtData, fmtCpf, resultado, somarAnos, MODO, Erro } from './comum.jsx';
import { hoje } from '../lib/util.js';

export default function Operadores({ api }) {
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  async function buscar(e) {
    e.preventDefault();
    setErro('');
    if (busca.trim().length < 3) { setErro('Digite pelo menos 3 letras do nome ou 3 números do CPF.'); return; }
    setCarregando(true);
    try { setLista(await api.operadores(busca.trim())); } catch (x) { setErro(x.message); } finally { setCarregando(false); }
  }

  return (
    <section className="adm-pagina">
      <div className="adm-topo"><h1>Operadores</h1></div>
      <p className="dica">Confira se uma pessoa já fez treinamento, com qual resultado e até quando vale o certificado (2 anos a partir da data).</p>
      <form className="adm-busca" onSubmit={buscar}>
        <label className="adm-busca-texto">Nome ou CPF<input type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Ex.: Maria da Silva ou 529.982.247-25" /></label>
        <button type="submit" className="btn prim" disabled={carregando}>{carregando ? 'Buscando…' : 'Buscar'}</button>
      </form>
      <Erro msg={erro} />
      {lista && (lista.length === 0 ? <p className="adm-vazio">Ninguém encontrado com "{busca}".</p> : (
        <div className="adm-tabela-rolagem">
          <table className="adm-tabela cartoes">
            <thead><tr><th>Nome</th><th>CPF</th><th>Data</th><th>Cliente</th><th>Instrutor</th><th>Prova</th><th>Resultado</th><th>Certificado vale até</th><th><span className="sr">Abrir</span></th></tr></thead>
            <tbody>
              {lista.map(o => {
                const r = resultado(o.aprovado === null || o.aprovado === undefined ? null : o);
                const vence = o.aprovado ? somarAnos(o.data_treinamento, 2) : '';
                return (
                  <tr key={o.participante_id}>
                    <td className="titulo" data-rotulo="Nome"><b>{o.nome}</b>{o.funcao ? <small>{o.funcao}</small> : null}</td>
                    <td className="nowrap" data-rotulo="CPF">{fmtCpf(o.cpf)}</td>
                    <td className="nowrap" data-rotulo="Data">{fmtData(o.data_treinamento)}</td>
                    <td data-rotulo="Cliente">{o.cliente}<small>{o.cidade}/{o.uf}</small></td>
                    <td data-rotulo="Instrutor">{o.instrutor_nome}</td>
                    <td data-rotulo="Prova">{o.modo ? MODO[o.modo] || o.modo : '—'}</td>
                    <td data-rotulo="Resultado"><span className={`situ ${r.cls}`}>{r.txt}</span>{r.det ? <small>{r.det}</small> : null}</td>
                    <td className="nowrap" data-rotulo="Vale até">{vence ? <span className={vence < hoje() ? 'situ err' : ''}>{fmtData(vence)}{vence < hoje() ? ' (vencido)' : ''}</span> : '—'}</td>
                    <td><a className="btn peq" href={`#/treinamentos/${o.treinamento_id}`}>Abrir treinamento</a></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
