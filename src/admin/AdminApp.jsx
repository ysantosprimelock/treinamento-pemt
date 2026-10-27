// Painel admin (só para perfis com papel = 'admin'): agenda, treinamentos, operadores e instrutores.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { criarApi, criarClienteAdmin } from './api.js';
// O painel fica em <app>/admin/: a logo está uma pasta acima
const LOGO_URL = '../logo-kimtech.png';
import Agenda from './Agenda.jsx';
import Treinamentos from './Treinamentos.jsx';
import Treinamento from './Treinamento.jsx';
import Operadores from './Operadores.jsx';
import Instrutores from './Instrutores.jsx';

const ABAS = [['agenda', 'Agenda'], ['treinamentos', 'Treinamentos'], ['operadores', 'Operadores'], ['instrutores', 'Instrutores']];

export function lerRota(hash = window.location.hash) {
  const partes = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  const aba = ABAS.some(([k]) => k === partes[0]) ? partes[0] : 'agenda';
  return { aba, id: aba === 'treinamentos' && partes[1] ? partes[1] : null };
}

function Entrar({ sb }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  async function entrar(e) {
    e.preventDefault();
    setErro('');
    setOcupado(true);
    const { error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: senha });
    setOcupado(false);
    if (error) setErro(/invalid login credentials/i.test(error.message) ? 'E-mail ou senha incorretos.' : /fetch|network/i.test(error.message) ? 'Sem conexão com o servidor.' : error.message);
  }
  return (
    <div className="adm-entrar">
      <form className="sec" onSubmit={entrar}>
        <img src={LOGO_URL} alt="Kimtech" className="adm-entrar-logo" />
        <h1>Painel de treinamentos</h1>
        <p className="dica">Acesso do administrador. Use o mesmo e-mail e senha do Supabase.</p>
        {erro && <div className="aviso" role="alert">{erro}</div>}
        <label>E-mail<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>Senha<input type="password" autoComplete="current-password" value={senha} onChange={e => setSenha(e.target.value)} required /></label>
        <button type="submit" className="btn prim larg" disabled={ocupado}>{ocupado ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  );
}

export default function AdminApp({ api: apiPronta = null }) {
  const api = useMemo(() => apiPronta || criarApi(criarClienteAdmin()), [apiPronta]);
  const sb = api.sb;
  const [sessao, setSessao] = useState(undefined);
  const [admin, setAdmin] = useState(null); // null = conferindo; true; { erro }
  const [rota, setRota] = useState(() => lerRota());
  const [instrutores, setInstrutores] = useState([]);
  const [listas, setListas] = useState({ fabricantes: [], maquinas: [], clientes: [] });
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSessao(data.session ?? null)).catch(() => setSessao(null));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSessao(s ?? null));
    return () => data.subscription.unsubscribe();
  }, [sb]);

  useEffect(() => {
    const f = () => setRota(lerRota());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);

  const uid = sessao && sessao.user ? sessao.user.id : null;
  const recarregarInstrutores = useCallback(() => api.instrutores().then(setInstrutores).catch(() => {}), [api]);

  useEffect(() => {
    if (!uid) { setAdmin(null); return; }
    let vivo = true;
    (async () => {
      try {
        const ok = await api.ehAdmin();
        if (!vivo) return;
        if (!ok) { setAdmin({ semPapel: true, erro: 'Este login não é de administrador. O arquivo 09_agenda_avisos_admin.sql libera o login adm@; para outro login, defina papel = admin no perfil dele.' }); return; }
        setAdmin(true);
        const [ins, li] = await Promise.all([api.instrutores(), api.listas()]);
        if (!vivo) return;
        setInstrutores(ins);
        setListas(li);
      } catch (e) {
        if (vivo) setAdmin(a => (a === true ? a : { erro: e.message }));
      }
    })();
    return () => { vivo = false; };
  }, [uid, api]);

  // Mensagem de retorno das ações (some sozinha)
  const avisar = useCallback((texto, tipo = 'ok') => setMsg({ texto, tipo, n: Date.now() }), []);
  useEffect(() => {
    if (!msg) return;
    const h = setTimeout(() => setMsg(null), 9000);
    return () => clearTimeout(h);
  }, [msg]);

  if (sessao === undefined) return <div className="centro">Carregando…</div>;
  if (!sessao) return <Entrar sb={sb} />;
  const sair = () => sb.auth.signOut({ scope: 'local' });
  if (admin === null) return <div className="centro">Conferindo acesso…</div>;
  if (admin !== true) {
    return (
      <div className="adm-entrar">
        <div className="sec">
          <h1>{admin.semPapel ? 'Sem acesso ao painel' : 'Painel indisponível'}</h1>
          <div className="aviso" role="alert">{admin.erro}</div>
          <button type="button" className="btn larg" onClick={sair}>Sair</button>
        </div>
      </div>
    );
  }

  return (
    <div className="adm">
      <header className="adm-cab">
        <div className="faixa" aria-hidden="true" />
        <div className="adm-cab-linha">
          <img className="cab-logo" src={LOGO_URL} alt="Kimtech" />
          <span className="adm-marca">Painel de treinamentos</span>
          <nav className="adm-abas" aria-label="Seções">
            {ABAS.map(([k, rot]) => <a key={k} href={`#/${k}`} aria-current={rota.aba === k ? 'page' : undefined}>{rot}</a>)}
          </nav>
          <span className="adm-usuario">{sessao.user.email}</span>
          <button type="button" className="cab-acao" onClick={sair}>Sair</button>
        </div>
      </header>
      <main className="adm-main">
        {rota.aba === 'agenda' && <Agenda api={api} instrutores={instrutores} listas={listas} avisar={avisar} />}
        {rota.aba === 'treinamentos' && !rota.id && <Treinamentos api={api} instrutores={instrutores} />}
        {rota.aba === 'treinamentos' && rota.id && <Treinamento key={rota.id} api={api} id={rota.id} avisar={avisar} />}
        {rota.aba === 'operadores' && <Operadores api={api} />}
        {rota.aba === 'instrutores' && <Instrutores api={api} instrutores={instrutores} recarregar={recarregarInstrutores} avisar={avisar} />}
      </main>
      {msg && (
        <div className={`adm-msg ${msg.tipo}`} role="status" key={msg.n}>
          <span>{msg.texto}</span>
          <button type="button" aria-label="Fechar mensagem" onClick={() => setMsg(null)}>×</button>
        </div>
      )}
    </div>
  );
}
