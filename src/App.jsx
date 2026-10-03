import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, configurado } from './supabase';
import * as db from './lib/db';
import { criarSync } from './lib/sync';
import { uuid, hoje, lsGet, lsSet } from './lib/util';
import Login from './telas/Login';
import Inicio from './telas/Inicio';
import Editor from './telas/Editor';

const LS_USUARIO = 'pemt.usuario';
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
  const sync = useMemo(() => criarSync({ supabase, db }), []);
  const atualizar = useCallback(() => setVersao(v => v + 1), []);

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
    })().catch(err => console.error(err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, online]);

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
      cliente: '', local: '', cidade: '', uf: '', data: hoje(), fabricantes: [], maquinas: [],
      fotos: [], operadores: [{ k: uuid(), nome: '', cpf: '', funcao: '' }], assinaturas: {}
    };
    await db.put('treinamentos', t);
    setTela({ nome: 'editar', id: t.id });
  }

  async function corrigir(t) {
    await db.put('treinamentos', { ...t, status: 'rascunho', erro: null, tipoErro: null, atualizadoEm: Date.now() });
    setTela({ nome: 'editar', id: t.id });
  }

  if (tela.nome === 'editar') {
    return (
      <Editor
        key={tela.id}
        id={tela.id}
        listas={listas}
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
      aoSair={() => supabase.auth.signOut({ scope: 'local' })}
    />
  );
}
