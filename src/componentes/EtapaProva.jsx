import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import * as db from '../lib/db';
import { provaAtual, provaPorId, corrigir, minimoAcertos, resultadoFinal } from '../prova/index.js';
import { linkProva } from '../lib/provaApi';
import { comprimir } from '../lib/imagem';
import LancarPapel from './LancarPapel';
import CorrigirFoto from './CorrigirFoto';

const INTERVALO_ATUALIZACAO = 10000;

// Fotos da folha guardadas no aparelho (versão antiga guardava uma só, em "folha")
export const chavesFolha = r => (r ? (Array.isArray(r.folhas) ? r.folhas : r.folha ? [r.folha] : []) : []);

// Texto do resultado na tela do INSTRUTOR (os documentos do cliente não mostram a decisão do instrutor)
// prova: tentativa (qr/papel) ou undefined; decisao: { aprovado } ou undefined
export function textoResultado(prova, decisao) {
  const nota = prova ? `${prova.acertos} de ${prova.total} · ${prova.modo === 'qr' ? 'celular' : 'papel'}` : '';
  if (decisao && typeof decisao.aprovado === 'boolean') {
    return {
      txt: `${decisao.aprovado ? 'Aprovado' : 'Reprovado'} por você${nota ? ' · prova: ' + nota : ' · sem prova'}`,
      cls: decisao.aprovado ? 'ok' : 'err'
    };
  }
  if (!prova) return { txt: 'Aguardando prova', cls: 'pend' };
  return { txt: `${prova.aprovado ? 'Aprovado' : 'Reprovado'} · ${nota}`, cls: prova.aprovado ? 'ok' : 'err' };
}

// sincronizar: busca no servidor os resultados e as assinaturas feitas pelo QR code (vem do Editor)
export default function EtapaProva({ id, t, alterar, api, online, carregarLogo, sincronizar, lerFoto = null, obterMapa = null }) {
  const [qr, setQr] = useState('');
  const [msg, setMsg] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [papelDe, setPapelDe] = useState(null);
  const [fotoDe, setFotoDe] = useState(null);
  const [verQr, setVerQr] = useState(true);
  const [prova, setProva] = useState(() => provaAtual());
  const tRef = useRef(t);
  tRef.current = t;
  // "alterar" do editor muda a cada render; o ref evita reiniciar a busca de resultados a cada tecla
  const alterarRef = useRef(alterar);
  alterarRef.current = alterar;

  const sessao = t.provaSessao;
  const link = sessao ? linkProva(sessao.token) : '';
  const provas = t.provas || {};
  const decisoes = t.decisoes || {};
  const finais = t.operadores.map(o => resultadoFinal(provas[o.k], decisoes[o.k]));
  const nCom = finais.filter(r => r !== null).length;
  const nAprov = finais.filter(r => r === true).length;

  useEffect(() => {
    if (!link) { setQr(''); return; }
    let vivo = true;
    QRCode.toDataURL(link, { width: 360, margin: 1, errorCorrectionLevel: 'M' }).then(u => { if (vivo) setQr(u); }).catch(() => { if (vivo) setQr(''); });
    return () => { vivo = false; };
  }, [link]);

  // Prova ainda não guardada neste aparelho (ex.: primeiro uso depois da atualização): baixa
  const baixar = useCallback(async () => {
    if (!api || !api.baixarProvas) return;
    setOcupado('Baixando a prova…');
    try {
      setProva(await api.baixarProvas());
      setMsg('');
    } catch (e) {
      setMsg('Não foi possível baixar a prova: ' + (e.message || 'sem conexão.'));
    } finally {
      setOcupado('');
    }
  }, [api]);

  useEffect(() => {
    if (!prova && online) baixar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const sincRef = useRef(sincronizar);
  sincRef.current = sincronizar;
  const atualizar = useCallback(async () => {
    if (!api || !sincRef.current) return;
    try {
      await sincRef.current();
      setMsg('');
    } catch (e) {
      setMsg('Não foi possível buscar os resultados agora. ' + (e.message || ''));
    }
  }, [api]);

  const abrir = useCallback(async (silencioso = false) => {
    if (!api) return;
    if (!silencioso) setOcupado('Abrindo a prova…');
    try {
      const r = await api.abrirSessao(tRef.current);
      alterarRef.current(() => ({ provaSessao: { token: r.token, expiraEm: r.expira_em } }));
      setVerQr(true);
      setMsg('');
    } catch (e) {
      if (!silencioso) setMsg('Não foi possível abrir a prova pelo QR code: ' + (e.message || 'sem conexão.'));
    } finally {
      setOcupado('');
    }
  }, [api]);

  // Ao entrar na etapa com a prova já aberta: atualiza a lista de operadores no servidor
  useEffect(() => {
    if (sessao && online && api) abrir(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Busca os resultados do QR code de tempos em tempos
  useEffect(() => {
    if (!sessao || !online || !api) return;
    atualizar();
    const iv = setInterval(atualizar, INTERVALO_ATUALIZACAO);
    return () => clearInterval(iv);
  }, [sessao && sessao.token, online, api, atualizar]); // eslint-disable-line react-hooks/exhaustive-deps

  async function compartilhar() {
    try {
      if (navigator.share) await navigator.share({ title: 'Prova PEMT', text: 'Prova do treinamento de PEMT:', url: link });
      else { await navigator.clipboard.writeText(link); setMsg('Link copiado.'); }
    } catch { /* cancelado */ }
  }

  async function baixarFolha() {
    if (!prova) return;
    setOcupado('Gerando a prova para imprimir…');
    try {
      let logo = null;
      try { logo = carregarLogo ? await carregarLogo() : null; } catch { logo = null; }
      const { gerarFolhaProva } = await import('../lib/provaPdf.js');
      const bytes = await gerarFolhaProva(prova, logo);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = `Prova PEMT para imprimir (${prova.id}).pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setMsg('Não foi possível gerar a prova: ' + (e.message || e));
    } finally {
      setOcupado('');
    }
  }

  // Aprovar / Reprovar: a decisão do instrutor vale sobre a nota. Tocar de novo desfaz.
  function decidir(o, aprovado) {
    const atual = decisoes[o.k];
    alterar(prev => {
      const d = { ...(prev.decisoes || {}) };
      if (atual && atual.aprovado === aprovado) delete d[o.k];
      else d[o.k] = { aprovado, em: Date.now() };
      return { decisoes: d };
    });
  }

  async function limpar(o) {
    const atual = provas[o.k];
    if (!confirm(`Apagar o resultado de ${o.nome}?`)) return;
    alterar(prev => {
      const p = { ...(prev.provas || {}) }; delete p[o.k];
      const d = { ...(prev.decisoes || {}) }; delete d[o.k];
      return { provas: p, decisoes: d };
    });
    for (const c of chavesFolha(atual)) await db.del('arquivos', c).catch(() => {});
  }

  // Respostas da prova em papel (lançadas à mão ou lidas pela foto).
  // fotos: lista de imagens da folha (null = manter as que já estavam)
  async function salvarPapel(k, respostas, fotos, lidoPorFoto) {
    const o = t.operadores.find(x => x.k === k);
    if (!o) return;
    const anterior = provas[o.k];
    const daProva = (anterior && anterior.modo === 'papel' && provaPorId(anterior.provaId)) || prova;
    let folhas = anterior && anterior.modo === 'papel' ? chavesFolha(anterior) : [];
    try {
      if (fotos && fotos.length) {
        setOcupado('Guardando as fotos da folha…');
        for (const c of folhas) await db.del('arquivos', c).catch(() => {});
        folhas = [];
        const lote = Date.now().toString(36);
        for (let i = 0; i < fotos.length; i++) {
          const blob = await comprimir(fotos[i], 1600, 0.75);
          const chave = `${id}:folha:${o.k}:${lote}-${i}`;
          await db.put('arquivos', { chave, treinamentoId: id, tipo: 'folha', blob });
          folhas.push(chave);
        }
      }
      const r = corrigir(daProva, respostas);
      alterar(prev => ({ provas: { ...(prev.provas || {}), [o.k]: { modo: 'papel', provaId: daProva.id, respostas, ...r, em: Date.now(), folhas, lidoPorFoto: !!lidoPorFoto } } }));
      setPapelDe(null);
      setFotoDe(null);
    } catch (e) {
      alert('Não foi possível salvar: ' + (e.message || e));
    } finally {
      setOcupado('');
    }
  }

  const papelOp = papelDe && t.operadores.find(o => o.k === papelDe);
  const fotoOp = fotoDe && t.operadores.find(o => o.k === fotoDe);
  const papelAtual = papelOp && provas[papelOp.k] && provas[papelOp.k].modo === 'papel' ? provas[papelOp.k] : null;

  return (
    <>
      <section className="sec">
        <h2>Prova</h2>
        {prova
          ? <p className="dica">{prova.questoes.length} questões. Para passar: {minimoAcertos(prova)} acertos. Cada operador faz pelo celular (QR code) ou no papel e pode refazer quantas vezes precisar.</p>
          : (
            <div className="aviso" role="alert">
              <b>A prova ainda não está neste aparelho</b>
              <p>Conecte à internet para baixar (só na primeira vez). Depois funciona sem internet.</p>
              <button type="button" className="btn peq" disabled={!online || !api || !!ocupado} onClick={baixar}>Baixar a prova</button>
            </div>
          )}
        <p className="prova-resumo"><b>{nCom} de {t.operadores.length}</b> com resultado · <span className="ok">{nAprov} aprovado(s)</span> · <span className="err">{nCom - nAprov} reprovado(s)</span></p>
        {ocupado && <p className="dica" role="status">{ocupado}</p>}
        {msg && <p className="erro-campo" role="alert" style={{ marginTop: 4 }}>{msg}</p>}
      </section>

      <section className="sec">
        <h3 className="sub">Pelo celular (QR code)</h3>
        {!sessao && (
          <>
            <p className="dica">Precisa de internet neste celular e no celular dos operadores.</p>
            <button type="button" className="btn prim larg" disabled={!online || !api || !!ocupado} onClick={() => abrir(false)}>Mostrar QR code da prova</button>
            {!online && <p className="dica" style={{ marginTop: 8 }}>Sem internet agora. Use a prova em papel.</p>}
          </>
        )}
        {sessao && (
          <>
            {verQr && qr && <div className="qr"><img src={qr} alt="QR code da prova" /></div>}
            <p className="dica" style={{ marginTop: 8 }}>O operador aponta a câmera do celular para o QR code, digita o CPF, responde e, no fim, <b>assina a lista de presença no próprio celular</b>. O resultado e a assinatura aparecem aqui sozinhos.</p>
            <div className="dois">
              <button type="button" className="btn peq" onClick={() => setVerQr(v => !v)}>{verQr ? 'Esconder QR' : 'Mostrar QR'}</button>
              <button type="button" className="btn peq" onClick={compartilhar}>Enviar link</button>
            </div>
            <button type="button" className="btn peq larg" style={{ marginTop: 10 }} disabled={!online} onClick={() => { abrir(true); atualizar(); }}>Atualizar resultados</button>
          </>
        )}
      </section>

      <section className="sec">
        <h3 className="sub">No papel</h3>
        <p className="dica">Use a prova impressa pelo app (com os quadrados pretos nos cantos). O operador <b>pinta o quadradinho</b>. Depois toque em <b>Corrigir pela foto</b> no nome dele e fotografe as páginas: o app lê as respostas e dá o resultado. Se preferir, <b>Lançar à mão</b> (serve também para ler as perguntas em voz alta).</p>
        <button type="button" className="btn larg" disabled={!!ocupado || !prova} onClick={baixarFolha}>Baixar prova para imprimir</button>
      </section>

      <section className="sec">
        <h3 className="sub">Resultado por operador</h3>
        <p className="dica">Aprovar / Reprovar: a sua decisão vale sobre a nota da prova. Toque de novo para desfazer.</p>
        <ul className="res-lista">
          {t.operadores.map(o => {
            const r = provas[o.k];
            const d = decisoes[o.k];
            const s = textoResultado(r, d);
            return (
              <li key={o.k}>
                <div className="res-topo">
                  <div><b>{o.nome}</b><small>{o.cpf}</small></div>
                  <span className={`res ${s.cls}`}>{s.txt}</span>
                  {(t.assinaturasQr || {})[o.k] && (t.assinaturas || {})[o.k] && <small className="assinou">Assinou no celular</small>}
                </div>
                <div className="res-acoes">
                  <button type="button" className="btn peq" disabled={!prova} onClick={() => setFotoDe(o.k)}>Corrigir pela foto</button>
                  <button type="button" className="btn peq" aria-pressed={!!d && d.aprovado === true} onClick={() => decidir(o, true)}>Aprovar</button>
                  <button type="button" className="btn peq" aria-pressed={!!d && d.aprovado === false} onClick={() => decidir(o, false)}>Reprovar</button>
                  <div className="res-links">
                    <button type="button" className="link" disabled={!prova} onClick={() => setPapelDe(o.k)}>Lançar à mão</button>
                    {(r || d) && <button type="button" className="link" onClick={() => limpar(o)}>Limpar</button>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {papelOp && prova && (
        <LancarPapel
          prova={(papelAtual && provaPorId(papelAtual.provaId)) || prova}
          nome={papelOp.nome}
          inicial={papelAtual ? papelAtual.respostas : null}
          temFoto={chavesFolha(papelAtual).length > 0}
          aoSalvar={(respostas, foto) => salvarPapel(papelOp.k, respostas, foto ? [foto] : null, false)}
          aoCancelar={() => setPapelDe(null)}
        />
      )}

      {fotoOp && prova && (
        <CorrigirFoto
          prova={prova}
          nome={fotoOp.nome}
          lerFoto={lerFoto}
          obterMapa={obterMapa}
          aoSalvar={(respostas, fotos) => salvarPapel(fotoOp.k, respostas, fotos, true)}
          aoCancelar={() => setFotoDe(null)}
          aoManual={() => { const k = fotoOp.k; setFotoDe(null); setPapelDe(k); }}
        />
      )}
    </>
  );
}
