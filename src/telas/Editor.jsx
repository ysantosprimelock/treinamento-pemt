import { useCallback, useEffect, useRef, useState } from 'react';
import * as db from '../lib/db';
import { MIN_FOTOS, MAX_FOTOS } from '../config';
import { UFS, uuid, nk, comUnico, palavras, fmtData } from '../lib/util';
import { mascaraCpf, cpfValido } from '../lib/cpf';
import { comprimir } from '../lib/imagem';
import PadAssinatura from '../componentes/PadAssinatura';
import Cabecalho from '../componentes/Cabecalho';

// Campos que sempre ficam em MAIÚSCULAS
const up = s => String(s || '').toLocaleUpperCase('pt-BR');
const CAMPOS_MAIUSC = ['cliente', 'local', 'cidade'];
export const emailValido = v => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

const PASSOS = ['Turma', 'Fotos', 'Operadores', 'Assinar'];
const FAB_PADRAO = ['Skyjack', 'Genie', 'JLG'];

export function validar(passo, t) {
  const e = [];
  if (passo === 0) {
    if (!t.cliente.trim()) e.push('Informe o cliente.');
    if (!t.local.trim()) e.push('Informe o local do treinamento.');
    if (!t.cidade.trim()) e.push('Informe a cidade.');
    if (!t.uf) e.push('Selecione a UF.');
    if (!t.data) e.push('Informe a data.');
    if (t.emailCliente && !emailValido(t.emailCliente)) e.push('E-mail do cliente inválido. Confira ou deixe em branco.');
    if (!t.fabricantes.length) e.push('Marque ao menos um fabricante.');
    if (!t.maquinas.length) e.push('Adicione ao menos uma máquina ou modelo.');
  }
  if (passo === 1) {
    if (t.fotos.length < MIN_FOTOS || t.fotos.length > MAX_FOTOS) e.push(`Adicione de ${MIN_FOTOS} a ${MAX_FOTOS} fotos (agora: ${t.fotos.length}).`);
  }
  if (passo === 2) {
    const vistos = {};
    if (!t.operadores.length) e.push('Adicione ao menos um operador.');
    t.operadores.forEach((o, i) => {
      const r = `Operador ${i + 1}: `;
      if (!o.nome.trim() && !o.cpf.trim() && t.operadores.length > 1) { e.push(r + 'está vazio. Preencha ou remova.'); return; }
      if (palavras(o.nome).length < 2) e.push(r + 'informe o nome completo.');
      if (!cpfValido(o.cpf)) e.push(r + 'CPF inválido.');
      else {
        const so = o.cpf.replace(/\D/g, '');
        if (vistos[so]) e.push(r + 'CPF repetido.');
        vistos[so] = true;
      }
    });
  }
  if (passo === 3) {
    const faltam = t.operadores.filter(o => !(t.assinaturas || {})[o.k]);
    if (faltam.length) e.push(`Faltam ${faltam.length} assinatura(s): ${faltam.map(o => o.nome).join(', ')}.`);
  }
  return e;
}

const novoOp = () => ({ k: uuid(), nome: '', cpf: '', funcao: '' });

export default function Editor({ id, listas, aoVoltar, aoFinalizar }) {
  const [t, setT] = useState(null);
  const [passo, setPasso] = useState(0);
  const [erros, setErros] = useState([]);
  const [urls, setUrls] = useState({});
  const [assinando, setAssinando] = useState(null);
  const [processando, setProcessando] = useState('');
  const [novoFab, setNovoFab] = useState('');
  const [novaMaq, setNovaMaq] = useState('');
  const tRef = useRef(null);
  const urlsRef = useRef({});
  const camRef = useRef(null);
  const galRef = useRef(null);

  // Carrega do aparelho
  useEffect(() => {
    let vivo = true;
    (async () => {
      const reg = await db.get('treinamentos', id);
      if (!vivo) return;
      if (!reg) { aoVoltar(); return; }
      const arqs = await db.arquivosDe(id);
      const u = {};
      for (const a of arqs) u[a.chave] = URL.createObjectURL(a.blob);
      urlsRef.current = u;
      setUrls(u);
      tRef.current = reg;
      setT(reg);
    })();
    return () => { vivo = false; Object.values(urlsRef.current).forEach(URL.revokeObjectURL); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Salva no aparelho logo após cada alteração
  useEffect(() => {
    if (!t) return;
    tRef.current = t;
    const h = setTimeout(() => { db.put('treinamentos', t).catch(err => console.error(err)); }, 300);
    return () => clearTimeout(h);
  }, [t]);

  const salvarAgora = useCallback(() => (tRef.current ? db.put('treinamentos', tRef.current).catch(err => console.error(err)) : Promise.resolve()), []);

  // Salva imediatamente se o app for para segundo plano ou fechado
  useEffect(() => {
    const vis = () => { if (document.visibilityState === 'hidden') salvarAgora(); };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('pagehide', salvarAgora);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('pagehide', salvarAgora);
      salvarAgora();
    };
  }, [salvarAgora]);

  const alterar = fn => setT(prev => ({ ...prev, ...fn(prev), atualizadoEm: Date.now() }));
  const setCampo = k => e => { const v = CAMPOS_MAIUSC.includes(k) ? up(e.target.value) : e.target.value; alterar(() => ({ [k]: v })); };
  const addUrl = (chave, blob) => setUrls(u => { const n = { ...u, [chave]: URL.createObjectURL(blob) }; urlsRef.current = n; return n; });
  const tirarUrl = chave => setUrls(u => { if (u[chave]) URL.revokeObjectURL(u[chave]); const n = { ...u }; delete n[chave]; urlsRef.current = n; return n; });

  if (!t) return <div className="centro">Carregando…</div>;

  const baseFab = listas.fabricantes && listas.fabricantes.length ? listas.fabricantes : FAB_PADRAO;
  let todosFab = [];
  [...baseFab, ...t.fabricantes].forEach(f => { todosFab = comUnico(todosFab, f); });

  // ---------- Fotos ----------
  async function adicionarFotos(lista) {
    const arquivos = [...lista];
    for (const f of arquivos) {
      if (tRef.current.fotos.length >= MAX_FOTOS) { setErros([`O limite é de ${MAX_FOTOS} fotos.`]); break; }
      setProcessando('Processando foto…');
      try {
        const blob = await comprimir(f);
        const chave = `${id}:foto:${uuid()}`;
        await db.put('arquivos', { chave, treinamentoId: id, tipo: 'foto', blob });
        addUrl(chave, blob);
        tRef.current = { ...tRef.current, fotos: [...tRef.current.fotos, chave] };
        alterar(prev => ({ fotos: prev.fotos.includes(chave) ? prev.fotos : [...prev.fotos, chave] }));
      } catch (err) {
        console.error(err);
        setErros(['Não foi possível salvar a foto. Tente de novo.']);
      }
    }
    setProcessando('');
  }
  async function removerFoto(chave) {
    alterar(prev => ({ fotos: prev.fotos.filter(c => c !== chave) }));
    tirarUrl(chave);
    await db.del('arquivos', chave);
  }

  // ---------- Assinaturas ----------
  async function salvarAssinatura(blob) {
    const k = assinando;
    const chave = `${id}:ass:${k}`;
    try {
      await db.put('arquivos', { chave, treinamentoId: id, tipo: 'assinatura', blob });
      tirarUrl(chave);
      addUrl(chave, blob);
      alterar(prev => ({ assinaturas: { ...(prev.assinaturas || {}), [k]: chave } }));
      setAssinando(null);
    } catch (err) {
      console.error(err);
      alert('Não foi possível salvar a assinatura no aparelho. Tente de novo.');
    }
  }

  // ---------- Operadores ----------
  function mudarOp(k, campo, valor) {
    const v = campo === 'cpf' ? mascaraCpf(valor) : campo === 'nome' ? up(valor) : valor;
    alterar(prev => ({ operadores: prev.operadores.map(o => (o.k === k ? { ...o, [campo]: v } : o)) }));
  }
  async function removerOp(o) {
    if ((o.nome || o.cpf) && !confirm('Remover este operador?')) return;
    const chave = (t.assinaturas || {})[o.k];
    alterar(prev => {
      const a = { ...(prev.assinaturas || {}) };
      delete a[o.k];
      return { operadores: prev.operadores.filter(x => x.k !== o.k), assinaturas: a };
    });
    if (chave) { tirarUrl(chave); await db.del('arquivos', chave); }
  }

  // ---------- Navegação ----------
  function avancar() {
    const e = validar(passo, t);
    setErros(e);
    if (e.length) { window.scrollTo({ top: 0 }); return; }
    if (passo < 3) { setPasso(passo + 1); window.scrollTo({ top: 0 }); return; }
    finalizar();
  }
  async function finalizar() {
    const todos = [0, 1, 2, 3].flatMap(p => validar(p, t));
    if (todos.length) { setErros(todos); window.scrollTo({ top: 0 }); return; }
    const base = { ...tRef.current, ...t };
    const final = { ...base, cliente: up(base.cliente), local: up(base.local), cidade: up(base.cidade),
      maquinas: base.maquinas.map(up), operadores: base.operadores.map(o => ({ ...o, nome: up(o.nome) })), status: 'pronto', finalizadoEm: Date.now(), atualizadoEm: Date.now(), erro: null, tipoErro: null, proximaTentativa: 0 };
    try {
      await db.put('treinamentos', final);
      tRef.current = final;
      aoFinalizar();
    } catch (err) {
      console.error(err);
      setErros(['Não foi possível salvar no aparelho. Verifique o espaço livre e tente de novo.']);
    }
  }
  async function descartar() {
    if (!confirm('Descartar este treinamento? As fotos e assinaturas dele serão apagadas do aparelho.')) return;
    tRef.current = null;
    await db.apagarTreinamento(id);
    aoVoltar();
  }

  const nAssin = t.operadores.filter(o => (t.assinaturas || {})[o.k]).length;

  return (
    <>
      <Cabecalho
        titulo={t.cliente.trim() || 'Novo treinamento'}
        sub={<span className="cab-sub">Salvo no aparelho</span>}
        direita={<button type="button" className="cab-acao" onClick={async () => { await salvarAgora(); aoVoltar(); }}>Início</button>}
      >
        <ol className="passos" aria-label="Etapas">
          {PASSOS.map((p, i) => <li key={p} className={i === passo ? 'on' : i < passo ? 'feito' : ''}>{i + 1} {p}</li>)}
        </ol>
      </Cabecalho>

      <main>
        {erros.length > 0 && (
          <div className="aviso" role="alert">
            <b>Corrija antes de continuar</b>
            <ul>{erros.map(e => <li key={e}>{e}</li>)}</ul>
          </div>
        )}

        {passo === 0 && (
          <>
            <section className="sec">
              <h2>Dados da turma</h2>
              <label>Cliente (empresa)<input className="maiusc" list="dl-clientes" autoComplete="off" autoCapitalize="characters" value={t.cliente} onChange={setCampo('cliente')} /></label>
              <datalist id="dl-clientes">{(listas.clientes || []).map(c => <option key={c} value={c} />)}</datalist>
              <label>Local do treinamento<input className="maiusc" autoComplete="off" autoCapitalize="characters" placeholder="Unidade, pátio, obra…" value={t.local} onChange={setCampo('local')} /></label>
              <div className="dois">
                <label>Cidade<input className="maiusc" autoComplete="off" autoCapitalize="characters" value={t.cidade} onChange={setCampo('cidade')} /></label>
                <label>UF
                  <select value={t.uf} onChange={setCampo('uf')}>
                    <option value="">—</option>
                    {UFS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </label>
              </div>
              <label>Data<input type="date" value={t.data} onChange={setCampo('data')} /></label>
              <label>E-mail do cliente (envio dos certificados)
                <input type="email" inputMode="email" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="compras@cliente.com.br"
                  value={t.emailCliente || ''} onChange={e => { const v = e.target.value.trim().toLowerCase(); alterar(() => ({ emailCliente: v })); }} />
              </label>
              {t.emailCliente && !emailValido(t.emailCliente) && <span className="erro-campo">E-mail incompleto ou inválido.</span>}
              <p className="dica" style={{ marginTop: 4 }}>Opcional. Sem e-mail, os certificados vão só para a Kimtech.</p>
            </section>

            <section className="sec">
              <h2>Fabricantes</h2>
              <p className="dica">Marque todos os fabricantes das máquinas deste treinamento.</p>
              <div className="chips">
                {todosFab.map(f => {
                  const on = t.fabricantes.some(x => nk(x) === nk(f));
                  return (
                    <button key={f} type="button" className="chip" aria-pressed={on}
                      onClick={() => alterar(prev => ({ fabricantes: on ? prev.fabricantes.filter(x => nk(x) !== nk(f)) : [...prev.fabricantes, f] }))}>
                      {f}
                    </button>
                  );
                })}
              </div>
              <div className="add">
                <input placeholder="Outro fabricante" autoComplete="off" value={novoFab} onChange={e => setNovoFab(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); alterar(prev => ({ fabricantes: comUnico(prev.fabricantes, novoFab, baseFab) })); setNovoFab(''); } }} />
                <button type="button" className="btn" onClick={() => { alterar(prev => ({ fabricantes: comUnico(prev.fabricantes, novoFab, baseFab) })); setNovoFab(''); }}>Adicionar</button>
              </div>
            </section>

            <section className="sec">
              <h2>Máquinas e modelos</h2>
              <p className="dica">Digite o modelo e toque em Adicionar. Os modelos usados ficam salvos para os próximos treinamentos.</p>
              <div className="add">
                <input className="maiusc" list="dl-maquinas" placeholder="Ex.: 3219, GS-1930…" autoComplete="off" autoCapitalize="characters" value={novaMaq} onChange={e => setNovaMaq(up(e.target.value))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); alterar(prev => ({ maquinas: comUnico(prev.maquinas, up(novaMaq), (listas.maquinas || []).map(up)) })); setNovaMaq(''); } }} />
                <button type="button" className="btn" onClick={() => { alterar(prev => ({ maquinas: comUnico(prev.maquinas, up(novaMaq), (listas.maquinas || []).map(up)) })); setNovaMaq(''); }}>Adicionar</button>
              </div>
              <datalist id="dl-maquinas">{(listas.maquinas || []).map(m => <option key={m} value={m} />)}</datalist>
              <ul className="tags">
                {t.maquinas.map(m => (
                  <li key={m}><span>{m}</span>
                    <button type="button" aria-label={`Remover ${m}`} onClick={() => alterar(prev => ({ maquinas: prev.maquinas.filter(x => x !== m) }))}>×</button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        {passo === 1 && (
          <section className="sec">
            <h2>Fotos do treinamento</h2>
            <p className="dica">De {MIN_FOTOS} a {MAX_FOTOS} fotos: turma, operadores e máquinas. Servem como registro documental.</p>
            <div className="dois">
              <button type="button" className="btn prim" disabled={t.fotos.length >= MAX_FOTOS || !!processando} onClick={() => camRef.current.click()}>Tirar foto</button>
              <button type="button" className="btn" disabled={t.fotos.length >= MAX_FOTOS || !!processando} onClick={() => galRef.current.click()}>Galeria</button>
            </div>
            <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={e => { const fs = e.target.files; adicionarFotos(fs).finally(() => { e.target.value = ''; }); }} />
            <input ref={galRef} type="file" accept="image/*" multiple hidden onChange={e => { const fs = e.target.files; adicionarFotos(fs).finally(() => { e.target.value = ''; }); }} />
            <div className="grade">
              {t.fotos.map((c, i) => (
                <figure key={c}>
                  {urls[c] && <img src={urls[c]} alt={`Foto ${i + 1}`} />}
                  <button type="button" className="x" aria-label={`Remover foto ${i + 1}`} onClick={() => removerFoto(c)}>×</button>
                </figure>
              ))}
            </div>
            <p className="dica" role="status" style={{ marginTop: 10 }}>{processando || `${t.fotos.length} de ${MAX_FOTOS} fotos (mínimo ${MIN_FOTOS}).`}</p>
          </section>
        )}

        {passo === 2 && (
          <section className="sec">
            <h2>Operadores</h2>
            <p className="dica">Um bloco por operador, sem limite de quantidade. CPF no formato 000.000.000-00.</p>
            {t.operadores.map((o, i) => {
              const cpfRuim = o.cpf.length === 14 && !cpfValido(o.cpf);
              return (
                <div className="op" key={o.k}>
                  <div className="op-cab">
                    <b>Operador {i + 1}</b>
                    {t.operadores.length > 1 && <button type="button" className="link" onClick={() => removerOp(o)}>Remover</button>}
                  </div>
                  <label>Nome completo<input className="maiusc" autoComplete="off" autoCapitalize="characters" value={o.nome} onChange={e => mudarOp(o.k, 'nome', e.target.value)} /></label>
                  <div className="dois empilha">
                    <label>CPF<input inputMode="numeric" maxLength={14} placeholder="000.000.000-00" autoComplete="off" value={o.cpf} onChange={e => mudarOp(o.k, 'cpf', e.target.value)} /></label>
                    <label>Função (opcional)<input autoComplete="off" value={o.funcao} onChange={e => mudarOp(o.k, 'funcao', e.target.value)} /></label>
                  </div>
                  {cpfRuim && <span className="erro-campo">CPF inválido. Confira os números.</span>}
                </div>
              );
            })}
            <button type="button" className="btn larg" onClick={() => alterar(prev => ({ operadores: [...prev.operadores, novoOp()] }))}>+ Adicionar operador</button>
          </section>
        )}

        {passo === 3 && (
          <>
            <section className="sec">
              <h2>Resumo</h2>
              <dl className="resumo">
                <dt>Cliente</dt><dd>{t.cliente}</dd>
                <dt>Local</dt><dd>{t.local} — {t.cidade}/{t.uf}</dd>
                <dt>Data</dt><dd>{fmtData(t.data)}</dd>
                <dt>E-mail</dt><dd>{t.emailCliente || 'não informado (só Kimtech)'}</dd>
                <dt>Fabricantes</dt><dd>{t.fabricantes.join(' / ')}</dd>
                <dt>Máquinas</dt><dd>{t.maquinas.join(' / ')}</dd>
                <dt>Fotos</dt><dd>{t.fotos.length}</dd>
              </dl>
            </section>
            <section className="sec">
              <h2>Assinaturas</h2>
              <p className="dica">{nAssin} de {t.operadores.length} assinaturas coletadas.</p>
              <ul className="assin">
                {t.operadores.map(o => {
                  const chave = (t.assinaturas || {})[o.k];
                  return (
                    <li key={o.k}>
                      <div><b>{o.nome}</b><small>{o.cpf}</small></div>
                      {chave && urls[chave] && <img src={urls[chave]} alt={`Assinatura de ${o.nome}`} />}
                      <button type="button" className={`btn peq${chave ? '' : ' prim'}`} onClick={() => setAssinando(o.k)}>{chave ? 'Refazer' : 'Assinar'}</button>
                    </li>
                  );
                })}
              </ul>
            </section>
            <button type="button" className="link" onClick={descartar}>Descartar este treinamento</button>
          </>
        )}
      </main>

      <nav className="barra">
        {passo > 0 && <button type="button" className="btn voltar" onClick={() => { setErros([]); setPasso(passo - 1); window.scrollTo({ top: 0 }); }}>Voltar</button>}
        <button type="button" className="btn prim" onClick={avancar} disabled={!!processando}>{passo === 3 ? 'Finalizar e enviar' : 'Avançar'}</button>
      </nav>

      {assinando && (
        <PadAssinatura
          nome={(t.operadores.find(o => o.k === assinando) || {}).nome || ''}
          aoConfirmar={salvarAssinatura}
          aoCancelar={() => setAssinando(null)}
        />
      )}
    </>
  );
}
