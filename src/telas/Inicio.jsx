import { useEffect, useState } from 'react';
import * as db from '../lib/db';
import { fmtData, fmtDataHora } from '../lib/util';
import { quando, horaCurta, juntarComLocais } from '../lib/agenda';
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

// Situação do treinamento local ligado a um agendamento
function situacaoAgenda(local) {
  if (!local) return null;
  if (local.status === 'rascunho') return { txt: 'Em andamento', acao: 'Continuar' };
  if (local.status === 'enviado') return { txt: 'Enviado', cls: 'ok' };
  return { txt: 'Aguardando envio', cls: 'esp' };
}

function Agendados({ agenda, destaque, online, atualizando, avisosBloqueados, aoIniciar, aoAbrir, aoAtualizar }) {
  const ordem = x => `${x.ag.data_treinamento || ''} ${x.ag.horario || '99'}`;
  const itens = agenda.filter(x => !(x.local && x.local.status === 'enviado')).sort((a, b) => ordem(a).localeCompare(ordem(b)));
  return (
    <section className="agenda-bloco" aria-label="Agendados para você">
      <div className="agenda-tit">
        <h3>Agendados para você</h3>
        {aoAtualizar && <button type="button" className="link escuro" disabled={!online || atualizando} onClick={aoAtualizar}>{atualizando ? 'Atualizando…' : 'Atualizar'}</button>}
      </div>
      {avisosBloqueados && <p className="dica">Avisos desligados neste celular. Para ligar: Chrome → ⋮ → Configurações → Configurações do site → Notificações.</p>}
      {itens.length === 0 && <p className="dica">Nenhum treinamento agendado para você no momento.</p>}
      <ul className="lista">
        {itens.map(({ ag, local }) => {
          const s = situacaoAgenda(local);
          const q = quando(ag.data_treinamento);
          const lugar = [ag.local_treinamento, [ag.cidade, ag.uf].filter(Boolean).join('/')].filter(Boolean).join(' — ');
          return (
            <li key={ag.id} id={`agenda-${ag.id}`} className={`item agenda${destaque === ag.id ? ' destaque' : ''}`}>
              <div className="item-topo"><b>{ag.cliente}</b><span className={`situ ${s ? s.cls || '' : q === 'Data passou' ? 'err' : 'esp'}`}>{s ? s.txt : q}</span></div>
              <small>{fmtData(ag.data_treinamento)}{ag.horario ? ` às ${horaCurta(ag.horario)}` : ''}{lugar ? ` · ${lugar}` : ''}</small>
              {ag.maquinas && ag.maquinas.length > 0 && <small>Máquinas: {ag.maquinas.join(' / ')}</small>}
              {ag.observacoes && <p className="obs">{ag.observacoes}</p>}
              {(!s || s.acao) && (
                <div className="acoes">
                  <button type="button" className="btn peq prim" onClick={() => (local ? aoAbrir(local.id) : aoIniciar(ag))}>{s ? s.acao : 'Iniciar treinamento'}</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CartaoAvisos({ avisos, aoAtivar }) {
  if (!avisos || avisos.estado !== 'pedir') return null;
  return (
    <div className="aviso atencao avisos">
      <b>Receba aviso quando houver treinamento agendado</b>
      <p>O celular mostra uma notificação assim que a Kimtech agendar um treinamento para você.</p>
      {avisos.msg && <p className="erro-campo" style={{ marginTop: 6 }}>{avisos.msg}</p>}
      <button type="button" className="btn peq" style={{ marginTop: 10 }} disabled={avisos.ocupado} onClick={aoAtivar}>{avisos.ocupado ? 'Ativando…' : 'Ativar avisos'}</button>
    </div>
  );
}

export default function Inicio({ usuario, nome, online, envio, versao, aoNovo, aoAbrir, aoEnviar, aoCorrigir, aoSair,
  agenda = null, agendaAtualizando = false, destaque = null, avisos = null, aoIniciarAgenda = () => {}, aoAtualizarAgenda = null, aoAtivarAvisos = () => {} }) {
  const [lista, setLista] = useState(null);

  useEffect(() => {
    let vivo = true;
    db.todos('treinamentos').then(l => { if (vivo) setLista(l); }).catch(() => { if (vivo) setLista([]); });
    return () => { vivo = false; };
  }, [versao]);

  // Leva até o agendamento aberto pela notificação
  useEffect(() => {
    if (!destaque || !lista) return;
    const el = document.getElementById(`agenda-${destaque}`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
  }, [destaque, lista, agenda]);

  if (!lista) return <div className="centro">Carregando…</div>;

  const meus = lista.filter(t => t.userId === usuario.id);
  const naAgenda = new Set((agenda || []).map(ag => ag.id));
  const todosRascunhos = meus.filter(t => t.status === 'rascunho');
  // Rascunho de um agendamento que está na lista acima aparece só lá (botão Continuar)
  const rascunhos = todosRascunhos.filter(t => !t.agendamentoId || !naAgenda.has(t.agendamentoId)).sort((a, b) => b.atualizadoEm - a.atualizadoEm);
  const fila = meus.filter(t => ['pronto', 'enviando', 'erro'].includes(t.status)).sort((a, b) => a.finalizadoEm - b.finalizadoEm);
  const enviados = meus.filter(t => t.status === 'enviado').sort((a, b) => b.enviadoEm - a.enviadoEm);
  const deOutros = lista.filter(t => t.userId !== usuario.id && t.status !== 'enviado').length;

  function sair() {
    const n = todosRascunhos.length + fila.length;
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

        <CartaoAvisos avisos={avisos} aoAtivar={aoAtivarAvisos} />

        {agenda && (
          <Agendados agenda={juntarComLocais(agenda, lista, usuario.id)} destaque={destaque} online={online && !usuario.offline}
            atualizando={agendaAtualizando} avisosBloqueados={!!avisos && avisos.estado === 'bloqueado'} aoIniciar={aoIniciarAgenda} aoAbrir={aoAbrir} aoAtualizar={aoAtualizarAgenda} />
        )}

        <button type="button" className="btn prim larg" onClick={aoNovo}>{agenda && agenda.length ? 'Novo treinamento (sem agendamento)' : 'Novo treinamento'}</button>

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
