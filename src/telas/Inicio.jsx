import { useEffect, useState } from 'react';
import * as db from '../lib/db';
import { fmtData, fmtDataHora } from '../lib/util';
import Cabecalho from '../componentes/Cabecalho';

function situacao(t) {
  if (t.status === 'enviado') return { txt: 'Enviado', cls: 'ok' };
  if (t.status === 'enviando') return { txt: 'Enviando…', cls: 'esp' };
  if (t.status === 'pronto') return { txt: 'Na fila', cls: 'esp' };
  if (t.status === 'erro' && t.tipoErro === 'correcao') return { txt: 'Precisa de correção', cls: 'err' };
  if (t.status === 'erro' && t.tipoErro === 'sessao') return { txt: 'Entre de novo', cls: 'err' };
  if (t.status === 'erro') return { txt: 'Aguardando conexão', cls: 'esp' };
  return { txt: 'Em andamento', cls: '' };
}

export default function Inicio({ usuario, nome, online, envio, versao, aoNovo, aoAbrir, aoEnviar, aoCorrigir, aoSair }) {
  const [lista, setLista] = useState(null);

  useEffect(() => {
    let vivo = true;
    db.todos('treinamentos').then(l => { if (vivo) setLista(l); }).catch(() => { if (vivo) setLista([]); });
    return () => { vivo = false; };
  }, [versao]);

  if (!lista) return <div className="centro">Carregando…</div>;

  const meus = lista.filter(t => t.userId === usuario.id);
  const rascunhos = meus.filter(t => t.status === 'rascunho').sort((a, b) => b.atualizadoEm - a.atualizadoEm);
  const fila = meus.filter(t => ['pronto', 'enviando', 'erro'].includes(t.status)).sort((a, b) => a.finalizadoEm - b.finalizadoEm);
  const enviados = meus.filter(t => t.status === 'enviado').sort((a, b) => b.enviadoEm - a.enviadoEm);
  const deOutros = lista.filter(t => t.userId !== usuario.id && t.status !== 'enviado').length;

  function sair() {
    const n = rascunhos.length + fila.length;
    const msg = n
      ? `Há ${n} treinamento(s) neste aparelho ainda não enviados. Eles continuam salvos e serão enviados quando você entrar de novo. Sair mesmo assim?`
      : 'Sair da conta?';
    if (confirm(msg)) aoSair();
  }

  return (
    <>
      <Cabecalho
        titulo={nome || 'Treinamento PEMT'}
        sub={<span className={`conex${online ? '' : ' off'}`}>{online ? 'Conectado' : 'Sem internet'}</span>}
        direita={<button type="button" className="cab-acao" onClick={sair}>Sair</button>}
      />

      <main>
        {usuario.offline && (
          <div className="aviso atencao"><b>Modo sem internet</b><p>Você pode registrar treinamentos. Para enviar, entre de novo quando houver conexão.</p></div>
        )}
        {deOutros > 0 && (
          <div className="aviso atencao"><b>{deOutros} treinamento(s) de outro instrutor neste aparelho</b><p>Eles serão enviados quando esse instrutor entrar.</p></div>
        )}

        <section className="sec">
          <div className="envio">
            <div className="contador">{fila.length}<small>{fila.length === 1 ? 'treinamento aguardando envio' : 'treinamentos aguardando envio'}</small></div>
            <button type="button" className="btn peq" disabled={!fila.length || envio.rodando || !online || usuario.offline} onClick={aoEnviar}>
              {envio.rodando ? 'Enviando…' : 'Enviar agora'}
            </button>
          </div>
          {envio.msg && <p className="dica" role="status" style={{ margin: '10px 0 0' }}>{envio.msg}</p>}
        </section>

        <button type="button" className="btn prim larg" onClick={aoNovo}>Novo treinamento</button>

        {rascunhos.length > 0 && <h3>Em andamento</h3>}
        <ul className="lista">
          {rascunhos.map(t => (
            <li key={t.id} className="item">
              <div className="item-topo"><b>{t.cliente || 'Sem cliente'}</b><span className="situ">Em andamento</span></div>
              <small>{fmtData(t.data)} · {t.operadores.length} operador(es) · {t.fotos.length} foto(s)</small>
              <div className="acoes"><button type="button" className="btn peq prim" onClick={() => aoAbrir(t.id)}>Continuar</button></div>
            </li>
          ))}
        </ul>

        {fila.length > 0 && <h3>Aguardando envio</h3>}
        <ul className="lista">
          {fila.map(t => {
            const s = situacao(t);
            return (
              <li key={t.id} className="item">
                <div className="item-topo"><b>{t.cliente}</b><span className={`situ ${s.cls}`}>{s.txt}</span></div>
                <small>{fmtData(t.data)} · {t.cidade}/{t.uf} · {t.operadores.length} operador(es)</small>
                {t.erro && <small>{t.erro}</small>}
                {t.status === 'erro' && t.tipoErro === 'correcao' && (
                  <div className="acoes"><button type="button" className="btn peq" onClick={() => aoCorrigir(t)}>Corrigir</button></div>
                )}
              </li>
            );
          })}
        </ul>

        {enviados.length > 0 && <h3>Enviados (cópia no aparelho)</h3>}
        <ul className="lista">
          {enviados.map(t => (
            <li key={t.id} className="item">
              <div className="item-topo"><b>{t.cliente}</b><span className="situ ok">Enviado</span></div>
              <small>{fmtData(t.data)} · {t.operadores.length} operador(es) · enviado em {fmtDataHora(t.enviadoEm)}</small>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
