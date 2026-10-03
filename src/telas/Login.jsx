import { useState } from 'react';
import { supabase } from '../supabase';
import Cabecalho from '../componentes/Cabecalho';

export default function Login({ online }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setErro('');
    if (!online) { setErro('Sem internet. Para entrar é preciso estar conectado.'); return; }
    setCarregando(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: senha });
    setCarregando(false);
    if (error) {
      setErro(/invalid login credentials/i.test(error.message) ? 'E-mail ou senha incorretos.'
        : /fetch|network/i.test(error.message) ? 'Sem conexão com o servidor. Tente de novo.'
        : 'Não foi possível entrar: ' + error.message);
    }
  }

  return (
    <>
      <Cabecalho titulo="Treinamento PEMT" />
      <div className="login">
        <form className="sec" onSubmit={entrar}>
          <h2>Entrar</h2>
          <p className="dica">Use o e-mail e a senha de instrutor fornecidos pela Kimtech.</p>
          {erro && <div className="aviso" role="alert">{erro}</div>}
          <label>E-mail<input type="email" autoComplete="username" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
          <label>Senha<input type="password" autoComplete="current-password" value={senha} onChange={e => setSenha(e.target.value)} required /></label>
          <button className="btn prim larg" type="submit" disabled={carregando}>{carregando ? 'Entrando…' : 'Entrar'}</button>
        </form>
      </div>
    </>
  );
}
