import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, configurado } from './supabase';
import * as db from './lib/db';
import { criarSync } from './lib/sync';
import { criarProvaApi } from './lib/provaApi';
import { baixarProvas } from './prova/index.js';
import { uuid, hoje, lsGet, lsSet } from './lib/util';
import { agendaGuardada, baixarAgenda, rascunhoDeAgenda } from './lib/agenda';
import { ativarAvisos, desligarAvisos, permissaoAvisos } from './lib/avisos';
import Login from './telas/Login';
import Inicio from './telas/Inicio';
import Editor from './telas/Editor';
import { LOGO_URL } from './componentes/Cabecalho';

async function carregarLogo() {
  const r = await fetch(LOGO_URL, { cache: 'no-cache' });
  if (!r.ok) throw new Error('Falha de rede ao carregar a logo (HTTP ' + r.status + ')');
  return new Uint8Array(await r.arrayBuffer());
}

const LS_USUARIO = 'pemt.usuario';
// Notificação aberta: <app>?agenda=<id> leva ao agendamento na tela inicial
const AGENDA_URL = new URLSearchParams(window.location.search).get('agenda');
const LS_LISTAS = 'pemt.listas';

export default function App() {
  if (!configurado) {
    return (
      <div className="login">
        <div className="aviso"><b>App não configurado</b><p>Cole a chave pública do Supabase em <code>src/config.js</code> e publique de novo.</p></div>
      </div>
    );
  }
  return <Principal />;
}

function Principal() {
  const [sessao, setSessao] = useState(undefined); // undefined = carregando
  const [ultimo, setUltimo] = useState(() => lsGet(LS_USUARIO, null));
  const [listas, setListas] = useState(() => lsGet(LS_LISTAS, { fabricantes: [], maquinas: [], clientes: [] }));
  const [online, setOnline] = useState(navigator.onLine);
  const [tela, setTela] = useState({ nome: 'inicio' });
  const [versao, setVersao] = useState(0);
  const [envio, setEnvio] = useState({ rodando: false, msg: '' });
  const sync = useMemo(() => criarSync({ supabase, db, carregarLogo }), []);
  const provaApi = useMemo(() => criarProvaApi(supabase), []);
  const atualizar = useCallback(() => setVersao(v => v + 1), []);
  const [agenda, setAgenda] = useState(null); // null = recurso indisponível (banco sem o SQL 09)
  const [agendaAtualizando, setAgendaAtualizando] = useState(false);
  const [destaque, setDestaque] = useState(AGENDA_URL);
  const [avisos, setAvisos] = useState(() => ({ estado: permissaoAvisos() === 'granted' ? 'ativo' : permissaoAvisos() === 'denied' ? 'bloqueado' : permissaoAvisos() === 'sem-suporte' ? 'sem-suporte' : 'pedir' }));

  // Sessão
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessao(data.session ?? null)).catch(() => setSessao(null));
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => setSessao(s ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  // Conexão
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // Pede ao navegador para não apagar os dados do app; limpa enviados antigos
  useEffect(() => {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    sync.limparEnviadosAntigos().then(n => { if (n) atualizar(); }).catch(() => {});
  }, [sync, atualizar]);

  const uid = sessao && sessao.user ? sessao.user.id : null;

  // Perfil e listas de apoio (quando conectado)
  useEffect(() => {
    if (!uid || !online) return;
    (async () => {
      const { data: perfil } = await supabase.from('perfis').select('nome, papel, ativo').eq('id', uid).maybeSingle();
      const u = { id: uid, email: sessao.user.email, nome: perfil ? perfil.nome : sessao.user.email };
      lsSet(LS_USUARIO, u);
      setUltimo(u);
      const [f, m, c] = await Promise.all([
        supabase.from('fabricantes').select('nome').order('nome'),
        supabase.from('maquinas').select('modelo').order('modelo'),
        supabase.from('clientes').select('nome').order('nome')
      ]);
      if (!f.error && !m.error && !c.error) {
        const l = { fabricantes: f.data.map(x => x.nome), maquinas: m.data.map(x => x.modelo), clientes: c.data.map(x => x.nome) };
        lsSet(LS_LISTAS, l);
        setListas(l);
      }
      // Prova (questões e gabarito): fica guardada no aparelho para aplicar e corrigir sem internet
      await baixarProvas(supabase);
    })().catch(err => console.error(err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, online]);

  // Agenda guardada no aparelho (aparece mesmo sem internet)
  const idUsuario = uid || (ultimo && ultimo.id) || null;
  useEffect(() => {
    if (!idUsuario) return;
    const g = agendaGuardada(idUsuario);
    setAgenda(g.em ? g.itens : null); // outro usuário neste aparelho: não mostra a agenda do anterior
  }, [idUsuario]);

  const carregarAgenda = useCallback(async () => {
    if (!uid || !navigator.onLine) return;
    setAgendaAtualizando(true);
    try {
      const g = await baixarAgenda(supabase, uid);
      setAgenda(g.indisponivel ? null : g.itens);
      if (g.indisponivel) setAvisos(a => (a.estado === 'pedir' ? { estado: 'indisponivel' } : a));
    } catch (err) {
      console.error('Agenda:', err);
    } finally {
      setAgendaAtualizando(false);
    }
  }, [uid]);

  // Atualiza ao entrar, quando a internet volta, ao voltar para o app e quando chega um aviso
  useEffect(() => {
    if (!uid || !online) return;
    carregarAgenda();
    // Permissão já dada: renova a inscrição deste aparelho para o usuário logado
    if (permissaoAvisos() === 'granted') {
      ativarAvisos(supabase).then(r => setAvisos({ estado: r.estado })).catch(err => console.error('Avisos:', err));
    }
  }, [uid, online, carregarAgenda]);

  useEffect(() => {
    if (!uid) return;
    let ultimaVez = 0;
    const aoVer = () => {
      if (document.visibilityState !== 'visible' || Date.now() - ultimaVez < 30000) return;
      ultimaVez = Date.now();
      carregarAgenda();
    };
    const aoMensagem = e => {
      const m = e.data || {};
      if (m.tipo === 'aviso') carregarAgenda();
      if (m.tipo === 'abrir') {
        try { const id = new URL(m.url).searchParams.get('agenda'); if (id) setDestaque(id); } catch { /* endereço inválido */ }
        setTela({ nome: 'inicio' });
        carregarAgenda();
      }
    };
    document.addEventListener('visibilitychange', aoVer);
    const sw = navigator.serviceWorker;
    if (sw) sw.addEventListener('message', aoMensagem);
    return () => { document.removeEventListener('visibilitychange', aoVer); if (sw) sw.removeEventListener('message', aoMensagem); };
  }, [uid, carregarAgenda]);

  // Tira o ?agenda= do endereço depois de usar (não reabre o destaque ao recarregar)
  useEffect(() => {
    if (AGENDA_URL && window.history && window.history.replaceState) {
      const u = new URL(window.location.href);
      u.searchParams.delete('agenda');
      window.history.replaceState(null, '', u.pathname + u.search + u.hash);
    }
  }, []);

  async function ligarAvisos() {
    setAvisos(a => ({ ...a, ocupado: true, msg: '' }));
    try {
      const r = await ativarAvisos(supabase, { pedir: true });
      setAvisos({ estado: r.estado });
    } catch (err) {
      console.error(err);
      setAvisos({ estado: 'pedir', msg: 'Não foi possível ativar agora. Confira a internet e tente de novo.' });
    }
  }

  const enviar = useCallback(async (opcoes = {}) => {
    if (!uid) return;
    setEnvio(e => ({ ...e, rodando: true }));
    try {
      const r = await sync.sincronizar(opcoes);
      setEnvio({ rodando: false, msg: r.msg && r.msg !== 'Envio já em andamento.' ? r.msg : '' });
    } catch (err) {
      setEnvio({ rodando: false, msg: String(err && err.message ? err.message : err) });
    } finally {
      atualizar();
    }
  }, [uid, sync, atualizar]);

  // Envio automático: ao abrir, quando a internet volta, ao voltar para o app e a cada minuto
  useEffect(() => {
    if (!uid) return;
    enviar({ ignorarEspera: true });
    const aoVoltarInternet = () => enviar({ ignorarEspera: true });
    const aoVerTela = () => { if (document.visibilityState === 'visible') enviar(); };
    window.addEventListener('online', aoVoltarInternet);
    document.addEventListener('visibilitychange', aoVerTela);
    const iv = setInterval(() => { if (navigator.onLine) enviar(); }, 60000);
    return () => {
      window.removeEventListener('online', aoVoltarInternet);
      document.removeEventListener('visibilitychange', aoVerTela);
      clearInterval(iv);
    };
  }, [uid, enviar]);

  if (sessao === undefined) return <div className="centro">Carregando…</div>;

  // Sem sessão e sem internet: permite trabalhar com o último usuário que entrou neste aparelho
  const usuario = uid
    ? { id: uid, email: sessao.user.email }
    : (!online && ultimo ? { id: ultimo.id, email: ultimo.email, offline: true } : null);

  if (!usuario) return <Login online={online} />;

  async function novo() {
    const t = {
      id: uuid(), userId: usuario.id, status: 'rascunho', criadoEm: Date.now(), atualizadoEm: Date.now(),
      cliente: '', local: '', cidade: '', uf: '', data: hoje(), emailCliente: '', fabricantes: [], maquinas: [],
      fotos: [], operadores: [{ k: uuid(), nome: '', cpf: '', funcao: '' }], assinaturas: {}, provas: {}, decisoes: {}, provaSessao: null
    };
    await db.put('treinamentos', t);
    setTela({ nome: 'editar', id: t.id });
  }

  // Treinamento a partir do agendamento: abre o que já existe neste aparelho ou cria um novo preenchido
  async function novoDeAgenda(ag) {
    const existente = (await db.todos('treinamentos')).find(t => t.userId === usuario.id && t.agendamentoId === ag.id && t.status === 'rascunho');
    if (existente) { setTela({ nome: 'editar', id: existente.id }); return; }
    const t = rascunhoDeAgenda(ag, usuario.id);
    await db.put('treinamentos', t);
    setDestaque(null);
    setTela({ nome: 'editar', id: t.id });
  }

  async function sair() {
    await desligarAvisos(supabase);
    await supabase.auth.signOut({ scope: 'local' });
  }

  async function corrigir(t) {
    await db.del('arquivos', `${t.id}:pdf`); // a lista em PDF será gerada de novo com os dados corrigidos
    for (const a of await db.arquivosDe(t.id)) if (a.tipo === 'comprovante') await db.del('arquivos', a.chave); // idem comprovantes
    await db.put('treinamentos', { ...t, status: 'rascunho', erro: null, tipoErro: null, atualizadoEm: Date.now() });
    setTela({ nome: 'editar', id: t.id });
  }

  if (tela.nome === 'editar') {
    return (
      <Editor
        key={tela.id}
        id={tela.id}
        listas={listas}
        api={usuario.offline ? null : provaApi}
        online={online && !usuario.offline}
        carregarLogo={carregarLogo}
        aoVoltar={() => { setTela({ nome: 'inicio' }); atualizar(); }}
        aoFinalizar={() => { setTela({ nome: 'inicio' }); atualizar(); enviar({ ignorarEspera: true }); }}
      />
    );
  }

  return (
    <Inicio
      usuario={usuario}
      nome={ultimo && ultimo.id === usuario.id ? ultimo.nome : ''}
      online={online}
      envio={envio}
      versao={versao}
      aoNovo={novo}
      aoAbrir={id => setTela({ nome: 'editar', id })}
      aoEnviar={() => enviar({ ignorarEspera: true, incluirCorrecao: true })}
      aoCorrigir={corrigir}
      aoSair={sair}
      agenda={agenda}
      agendaAtualizando={agendaAtualizando}
      destaque={destaque}
      avisos={usuario.offline ? null : avisos}
      aoIniciarAgenda={novoDeAgenda}
      aoAtualizarAgenda={usuario.offline ? null : carregarAgenda}
      aoAtivarAvisos={ligarAvisos}
    />
  );
}
