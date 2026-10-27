// Tudo de um treinamento, para auditoria: turma, fotos, lista de presença com assinaturas,
// provas (com as respostas), comprovantes, PDFs, Drive e ligação com a agenda.
import { Fragment, useCallback, useEffect, useState } from 'react';
import { fmtData, fmtDataHoraIso, fmtCpf, hora, lugar, resultado, somarAnos, MODO, baixarCsv, Janela, Erro } from './comum.jsx';
import { fabricantesDe, maquinasDe } from './Treinamentos.jsx';

const LETRAS = ['A', 'B', 'C', 'D', 'E', 'F'];
// Campos mostrados na seção de auditoria com nome claro (os demais aparecem com o nome da coluna)
const ROTULOS = {
  id: 'Identificador', instrutor_id: 'Identificador do instrutor', instrutor_nome: 'Instrutor', cliente: 'Cliente', local_treinamento: 'Local',
  cidade: 'Cidade', uf: 'UF', data_treinamento: 'Data do treinamento', email_cliente: 'E-mails do cliente', criado_no_aparelho_em: 'Criado no aparelho em',
  enviado_em: 'Recebido pelo servidor em', drive_status: 'Situação no Drive', drive_tentativas: 'Tentativas de cópia no Drive', drive_erro: 'Erro do Drive',
  drive_pasta_url: 'Pasta no Drive', drive_pdf_url: 'PDF no Drive', drive_processado_em: 'Copiado para o Drive em', agendamento_id: 'Agendamento'
};

// Respostas da prova, questão por questão
export function Respostas({ av, prova }) {
  if (!av || !Array.isArray(av.respostas)) return <p className="dica">Sem respostas gravadas (aprovação ou reprovação direta do instrutor).</p>;
  if (!prova || !Array.isArray(prova.questoes)) return <pre className="adm-cru">{JSON.stringify(av.respostas)}</pre>;
  return (
    <ol className="adm-respostas">
      {prova.questoes.map((q, i) => {
        const m = av.respostas[i];
        const marcou = Number.isInteger(m) ? m : null;
        const certo = marcou !== null && marcou === q.c;
        return (
          <li key={i} className={certo ? 'certa' : 'errada'}>
            <span className="adm-q">{q.p}</span>
            <span>Marcou: <b>{marcou === null ? 'em branco' : `${LETRAS[marcou]}) ${q.a[marcou] ?? ''}`}</b>{certo ? ' ✓' : ' ✗'}</span>
            {!certo && <span>Correta: {LETRAS[q.c]}) {q.a[q.c]}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function VincularAgenda({ api, t, aoFechar, aoFeito }) {
  const [opcoes, setOpcoes] = useState(null);
  const [esc, setEsc] = useState('');
  const [erro, setErro] = useState('');
  useEffect(() => {
    api.agendamentos().then(l => {
      const mesmoCliente = a => a.cliente.trim().toLowerCase() === String(t.cliente).trim().toLowerCase();
      setOpcoes(l.filter(a => a.status !== 'cancelado').sort((a, b) => (mesmoCliente(b) - mesmoCliente(a)) || (b.data_treinamento.localeCompare(a.data_treinamento))));
    }).catch(e => setErro(e.message));
  }, [api, t.cliente]);
  async function ligar(e) {
    e.preventDefault();
    try {
      const r = await api.vincular(t.id, esc);
      if (r && r.ok === false) { setErro('Não foi possível ligar: ' + r.motivo); return; }
      aoFeito();
    } catch (x) { setErro(x.message); }
  }
  return (
    <Janela titulo="Ligar a um agendamento" aoFechar={aoFechar}>
      <form className="adm-form" onSubmit={ligar}>
        <p>Use quando o instrutor fez o treinamento sem abrir pelo agendamento. O agendamento passa a "Realizado".</p>
        <Erro msg={erro} />
        {opcoes === null ? <p className="centro">Carregando…</p> : (
          <label>Agendamento
            <select value={esc} onChange={e => setEsc(e.target.value)}>
              <option value="">Escolha…</option>
              {opcoes.map(a => <option key={a.id} value={a.id}>{fmtData(a.data_treinamento)} – {a.cliente}{a.status === 'realizado' ? ' (já realizado)' : ''}</option>)}
            </select>
          </label>
        )}
        <div className="adm-acoes-form">
          <button type="button" className="btn" onClick={aoFechar}>Fechar</button>
          <button type="submit" className="btn prim" disabled={!esc}>Ligar</button>
        </div>
      </form>
    </Janela>
  );
}

export default function Treinamento({ api, id, avisar }) {
  const [d, setD] = useState(null);
  const [urls, setUrls] = useState({});
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState({});
  const [foto, setFoto] = useState(null);
  const [ligando, setLigando] = useState(false);

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const x = await api.treinamento(id);
      setD(x);
      const t = x.treinamento;
      const caminhos = [
        `${t.instrutor_id}/${t.id}/lista-presenca.pdf`,
        ...x.fotos.map(f => f.storage_path),
        ...x.participantes.flatMap(p => [p.assinatura_path, p.avaliacao && p.avaliacao.comprovante_path])
      ];
      api.urls(caminhos).then(setUrls).catch(e => setErro('Não foi possível abrir os arquivos: ' + e.message));
    } catch (e) {
      setErro(e.message);
    }
  }, [api, id]);
  useEffect(() => { carregar(); }, [carregar]);

  if (!d) return <section className="adm-pagina"><a href="#/treinamentos" className="adm-voltar">Treinamentos</a><Erro msg={erro} />{!erro && <p className="centro">Carregando…</p>}</section>;

  const t = d.treinamento;
  const fabs = d.fabricantes_vinculados || fabricantesDe(t);
  const maqs = d.maquinas_vinculadas || maquinasDe(t);
  const lista = urls[`${t.instrutor_id}/${t.id}/lista-presenca.pdf`];
  const parts = d.participantes;
  const aprovados = parts.filter(p => p.avaliacao && p.avaliacao.aprovado).length;
  const ag = d.agendamento;

  function exportar() {
    baixarCsv(`operadores-${t.cliente}-${t.data_treinamento}.csv`,
      ['Nº', 'Nome', 'CPF', 'Função', 'Prova', 'Acertos', 'Total', 'Resultado', 'Decisão do instrutor', 'Validade do certificado', 'Cliente', 'Data', 'Instrutor'],
      parts.map(p => {
        const av = p.avaliacao, r = resultado(av);
        return [p.ordem, p.nome, fmtCpf(p.cpf), p.funcao || '', av ? MODO[av.modo] || av.modo : '', av && av.total ? av.acertos : '', av && av.total ? av.total : '',
          r.txt, av && av.decisao_instrutor !== null && av.decisao_instrutor !== undefined ? (av.decisao_instrutor ? 'aprovou' : 'reprovou') : '',
          av && av.aprovado ? fmtData(somarAnos(t.data_treinamento, 2)) : '', t.cliente, fmtData(t.data_treinamento), t.instrutor_nome];
      }));
  }

  async function desligar() {
    if (!confirm('Desfazer a ligação deste treinamento com o agendamento?')) return;
    try { await api.desvincular(t.id); avisar('Ligação desfeita.'); carregar(); } catch (e) { avisar(e.message, 'err'); }
  }

  return (
    <section className="adm-pagina">
      <a href="#/treinamentos" className="adm-voltar">Treinamentos</a>
      <div className="adm-topo">
        <div>
          <h1>{t.cliente}</h1>
          <p className="adm-sub">{fmtData(t.data_treinamento)} · {lugar(t.local_treinamento, t.cidade, t.uf)} · instrutor {t.instrutor_nome}</p>
        </div>
        <div className="adm-botoes">
          {lista && <a className="btn prim" href={lista} target="_blank" rel="noopener">Lista de presença (PDF)</a>}
          {t.drive_pasta_url && <a className="btn" href={t.drive_pasta_url} target="_blank" rel="noopener">Pasta no Drive</a>}
          <button type="button" className="btn" onClick={exportar}>Exportar operadores (CSV)</button>
        </div>
      </div>
      <Erro msg={erro} />

      <dl className="adm-fatos">
        <div><dt>Operadores</dt><dd>{parts.length} ({aprovados} aprovado{aprovados === 1 ? '' : 's'})</dd></div>
        <div><dt>Fabricantes</dt><dd>{fabs.join(' / ') || '—'}</dd></div>
        <div><dt>Máquinas</dt><dd>{maqs.join(' / ') || '—'}</dd></div>
        <div><dt>E-mails do cliente</dt><dd>{t.email_cliente || 'não informado'}</dd></div>
        <div><dt>Recebido pelo servidor</dt><dd>{fmtDataHoraIso(t.enviado_em)}</dd></div>
        <div><dt>Drive</dt><dd>{t.drive_status === 'ok' ? `copiado em ${fmtDataHoraIso(t.drive_processado_em)}` : t.drive_status === 'erro' ? `erro: ${t.drive_erro || ''}` : t.drive_status || '—'}</dd></div>
        <div className="largo"><dt>Agendamento</dt><dd>
          {ag ? <>{fmtData(ag.data_treinamento)}{ag.horario ? ' às ' + hora(ag.horario) : ''} – {ag.cliente}{ag.observacoes ? ` (${ag.observacoes})` : ''} <button type="button" className="link" onClick={desligar}>Desfazer ligação</button></>
            : <>sem agendamento <button type="button" className="link escuro" onClick={() => setLigando(true)}>Ligar a um agendamento</button></>}
        </dd></div>
      </dl>

      <h2>Fotos da prática</h2>
      {d.fotos.length === 0 ? <p className="dica">Sem fotos.</p> : (
        <div className="adm-fotos">
          {d.fotos.map(f => (
            <button type="button" key={f.storage_path} className="adm-foto" onClick={() => urls[f.storage_path] && setFoto(f)} aria-label={`Abrir foto ${f.ordem}`}>
              {urls[f.storage_path] ? <img src={urls[f.storage_path]} alt={`Foto ${f.ordem}`} loading="lazy" /> : <span>Foto {f.ordem}</span>}
            </button>
          ))}
        </div>
      )}

      <h2>Lista de presença e provas</h2>
      <div className="adm-tabela-rolagem">
        <table className="adm-tabela adm-presenca cartoes">
          <thead><tr><th className="num">Nº</th><th>Nome</th><th>CPF</th><th>Função</th><th>Prova</th><th>Resultado</th><th>Validade</th><th>Assinatura</th><th><span className="sr">Documentos</span></th></tr></thead>
          <tbody>
            {parts.map(p => {
              const av = p.avaliacao, r = resultado(av);
              const comp = av && av.comprovante_path ? urls[av.comprovante_path] : null;
              const temRespostas = av && Array.isArray(av.respostas);
              return (
                <Fragment key={p.id}>
                  <tr>
                    <td className="num" data-rotulo="Nº">{p.ordem}</td>
                    <td className="adm-nome titulo" data-rotulo="Nome"><b>{p.nome}</b></td>
                    <td className="nowrap" data-rotulo="CPF">{fmtCpf(p.cpf)}</td>
                    <td data-rotulo="Função">{p.funcao || '—'}</td>
                    <td className="nowrap" data-rotulo="Prova">{av ? MODO[av.modo] || av.modo : '—'}</td>
                    <td data-rotulo="Resultado"><span className={`situ ${r.cls}`}>{r.txt}</span>{r.det ? <small>{r.det}</small> : null}</td>
                    <td className="nowrap" data-rotulo="Validade">{av && av.aprovado ? fmtData(somarAnos(t.data_treinamento, 2)) : '—'}</td>
                    <td className="adm-assin" data-rotulo="Assinatura">{urls[p.assinatura_path] ? <img src={urls[p.assinatura_path]} alt={`Assinatura de ${p.nome}`} /> : <small>—</small>}</td>
                    <td className="adm-acoes">
                      {comp && <a className="btn peq" href={comp} target="_blank" rel="noopener">Comprovante</a>}
                      {temRespostas && <button type="button" className="btn peq" aria-expanded={!!aberto[p.id]} onClick={() => setAberto(x => ({ ...x, [p.id]: !x[p.id] }))}>{aberto[p.id] ? 'Fechar respostas' : 'Ver respostas'}</button>}
                    </td>
                  </tr>
                  {aberto[p.id] && (
                    <tr className="adm-detalhe"><td colSpan={9}><Respostas av={av} prova={d.provas[av.prova_id]} /></td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="dica">"Aprovado pelo instrutor" indica decisão do instrutor sobre a nota. Essa informação é interna: não aparece nos documentos do cliente.</p>

      <details className="adm-auditoria">
        <summary>Todos os dados gravados (auditoria)</summary>
        <dl>
          {Object.entries(t).map(([k, v]) => (
            <div key={k}><dt>{ROTULOS[k] || k}</dt><dd>{v === null || v === '' ? '—' : Array.isArray(v) ? v.join(' / ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd></div>
          ))}
        </dl>
      </details>

      {foto && (
        <Janela titulo={`Foto ${foto.ordem}`} aoFechar={() => setFoto(null)} largo>
          <img className="adm-foto-grande" src={urls[foto.storage_path]} alt={`Foto ${foto.ordem}`} />
          <p><a href={urls[foto.storage_path]} target="_blank" rel="noopener">Abrir em tamanho original</a></p>
        </Janela>
      )}
      {ligando && <VincularAgenda api={api} t={t} aoFechar={() => setLigando(false)} aoFeito={() => { setLigando(false); avisar('Treinamento ligado ao agendamento.'); carregar(); }} />}
    </section>
  );
}
