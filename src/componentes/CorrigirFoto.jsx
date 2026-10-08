import { useEffect, useRef, useState } from 'react';
import { LETRAS, corrigir, minimoAcertos } from '../prova/correcao.js';
import { juntarLeituras } from '../lib/leitorFolha.js';

// Correção pela foto: o instrutor fotografa cada página da prova em papel; o app lê as caixinhas
// pintadas, mostra o resultado e as questões em dúvida, e o instrutor confirma.
// lerFoto e obterMapa podem ser trocados nos testes (no navegador usam a câmera e o PDF da folha).
export default function CorrigirFoto({ prova, nome, aoSalvar, aoCancelar, aoManual, lerFoto, obterMapa }) {
  const dlg = useRef(null);
  const camRef = useRef(null);
  const [mapa, setMapa] = useState(null);
  const [paginas, setPaginas] = useState({}); // índice da página -> { leitura, previa, blob }
  const [resp, setResp] = useState(null);     // respostas em revisão (depois de ler todas as páginas)
  const [duvidas, setDuvidas] = useState([]);
  const [msg, setMsg] = useState(null); // { t: texto, erro: bool }
  const [ocupado, setOcupado] = useState('');

  useEffect(() => {
    const d = dlg.current;
    if (!d.open) d.showModal();
    const aoEsc = e => { e.preventDefault(); aoCancelar(); };
    d.addEventListener('cancel', aoEsc);
    return () => d.removeEventListener('cancel', aoEsc);
  }, [aoCancelar]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const fn = obterMapa || (async p => (await import('../lib/provaPdf.js')).mapaFolha(p));
        const m = await fn(prova);
        if (vivo) setMapa(m);
      } catch (e) {
        if (vivo) setMsg({ t: 'Não foi possível preparar a leitura: ' + (e.message || e), erro: true });
      }
    })();
    return () => { vivo = false; };
  }, [prova, obterMapa]);

  const nPag = mapa ? mapa.paginas : 0;
  const faltando = mapa ? [...Array(nPag).keys()].filter(i => !paginas[i]) : [];

  async function aoFoto(arquivo) {
    if (!arquivo || !mapa) return;
    setOcupado('Lendo a foto…'); setMsg(null);
    try {
      const fn = lerFoto || (async (a, m) => (await import('../lib/fotoProva.js')).lerFotoDaProva(a, m));
      const r = await fn(arquivo, mapa);
      if (!r.leitura.ok) { setMsg({ t: r.leitura.erro, erro: true }); return; }
      const novas = { ...paginas, [r.leitura.pagina]: r };
      setPaginas(novas);
      if ([...Array(nPag).keys()].every(i => novas[i])) {
        const j = juntarLeituras([...Array(nPag).keys()].map(i => novas[i].leitura), prova.questoes.length);
        setResp(j.respostas);
        setDuvidas(j.duvidas);
      } else {
        const falta = [...Array(nPag).keys()].filter(i => !novas[i]).map(i => i + 1);
        setMsg({ t: `Página ${r.leitura.pagina + 1} lida. Agora fotografe a página ${falta.join(' e ')}.`, erro: false });
      }
    } catch (e) {
      setMsg({ t: 'Não foi possível ler a foto: ' + (e.message || e), erro: true });
    } finally {
      setOcupado('');
    }
  }

  const completas = resp && resp.every(r => r !== null);
  const nota = completas ? corrigir(prova, resp) : null;
  const emDuvida = new Set(duvidas.map(d => d.q));

  function confirmar() {
    if (!completas) return;
    const fotos = [...Array(nPag).keys()].map(i => paginas[i].blob).filter(Boolean);
    aoSalvar(resp, fotos);
  }

  return (
    <dialog ref={dlg} className="dlg-papel" aria-labelledby="foto-tit">
      <div className="dlg">
        <h3 id="foto-tit">Corrigir pela foto</h3>
        <p className="dica" style={{ marginBottom: 8 }}>{nome}</p>

        {!resp && (
          <>
            <p className="dica">Fotografe <b>cada página inteira</b>, de cima, com os <b>4 quadrados pretos</b> dos cantos aparecendo e boa luz. A ordem das páginas não importa.</p>
            <ul className="foto-pags">
              {[...Array(nPag).keys()].map(i => (
                <li key={i} className={paginas[i] ? 'ok' : ''}>
                  {paginas[i] ? <img src={paginas[i].previa} alt={`Página ${i + 1} lida`} /> : <span className="foto-vazia">Página {i + 1}</span>}
                  <small>{paginas[i] ? `Página ${i + 1} lida` : 'Falta fotografar'}</small>
                </li>
              ))}
            </ul>
            <button type="button" className="btn prim larg" disabled={!mapa || !!ocupado} onClick={() => camRef.current.click()}>
              {ocupado || (faltando.length === nPag ? 'Tirar foto da prova' : `Tirar foto da página ${faltando.map(i => i + 1).join(' e ')}`)}
            </button>
            <input ref={camRef} type="file" accept="image/*" capture="environment" hidden
              onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; aoFoto(f); }} />
          </>
        )}

        {msg && !resp && <p className={msg.erro ? 'erro-campo' : 'foto-info'} role={msg.erro ? 'alert' : 'status'} style={{ marginTop: 8 }}>{msg.t}</p>}

        {resp && (
          <>
            <div className={`foto-res ${completas ? (nota.aprovado ? 'ok' : 'err') : 'pend'}`}>
              {completas
                ? <><b>{nota.aprovado ? 'APROVADO' : 'REPROVADO'}</b><span>{nota.acertos} de {nota.total} acertos (mínimo {minimoAcertos(prova)})</span></>
                : <><b>Falta decidir {resp.filter(r => r === null).length} questão(ões)</b><span>Toque na letra marcada na folha</span></>}
            </div>
            {duvidas.length > 0 && (
              <p className="aviso-duvida">Confira as questões destacadas: {duvidas.map(d => `${d.q + 1} (${d.motivo})`).join(', ')}.</p>
            )}
            <div className="foto-previas">
              {[...Array(nPag).keys()].map(i => <img key={i} src={paginas[i].previa} alt={`Página ${i + 1} com as respostas lidas`} />)}
            </div>
            <ol className="papel">
              {prova.questoes.map((q, i) => (
                <li key={i} className={emDuvida.has(i) ? 'duvida' : ''}>
                  <span className="papel-q">{i + 1}. {q.p}</span>
                  <div className="papel-bts" role="group" aria-label={`Questão ${i + 1}`}>
                    {q.a.map((a, k) => (
                      <button key={k} type="button" className="papel-bt" aria-pressed={resp[i] === k} title={a}
                        onClick={() => setResp(r => r.map((x, j) => (j === i ? k : x)))}>
                        {LETRAS[k]}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
            <button type="button" className="link" style={{ marginTop: 8 }} onClick={() => { setResp(null); setDuvidas([]); setPaginas({}); setMsg(null); }}>Fotografar de novo</button>
          </>
        )}

        <div className="dlg-bts">
          <button type="button" className="btn" onClick={aoCancelar}>Cancelar</button>
          {resp
            ? <button type="button" className="btn prim" disabled={!completas} onClick={confirmar}>Confirmar</button>
            : <button type="button" className="btn" onClick={aoManual}>Lançar à mão</button>}
        </div>
      </div>
    </dialog>
  );
}
