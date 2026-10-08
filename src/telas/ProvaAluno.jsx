// Página do operador (aberta pelo QR code). Sem login: o acesso é pelo token do link.
// Uma questão por tela, letras grandes e botão "Ouvir" para quem tem dificuldade de leitura.
import { useEffect, useMemo, useState } from 'react';
import { supabase, configurado } from '../supabase';
import { criarProvaApi } from '../lib/provaApi';
import { mascaraCpf, cpfValido } from '../lib/cpf';
import { fmtData } from '../lib/util';
import Cabecalho from '../componentes/Cabecalho';
import { LETRAS } from '../prova/correcao.js';

const temVoz = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';

function falar(texto) {
  try {
    const s = window.speechSynthesis;
    s.cancel();
    const u = new window.SpeechSynthesisUtterance(texto);
    u.lang = 'pt-BR';
    u.rate = 0.9;
    const voz = (s.getVoices() || []).find(v => /^pt(-|_)BR/i.test(v.lang));
    if (voz) u.voice = voz;
    s.speak(u);
  } catch { /* sem voz neste aparelho */ }
}
const calar = () => { try { if (temVoz()) window.speechSynthesis.cancel(); } catch { /* ignore */ } };

export default function ProvaAluno({ token, api: apiTeste }) {
  const api = useMemo(() => apiTeste || criarProvaApi(supabase), [apiTeste]);
  const [etapa, setEtapa] = useState('carregando'); // carregando | erro | cpf | confirmar | questao | revisar | enviando | resultado
  const [prova, setProva] = useState(null);
  const [erro, setErro] = useState('');
  const [cpf, setCpf] = useState('');
  const [nome, setNome] = useState('');
  const [i, setI] = useState(0);
  const [resp, setResp] = useState([]);
  const [resultado, setResultado] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!apiTeste && !configurado) { setErro('Sistema não configurado.'); setEtapa('erro'); return; }
    api.publica(token)
      .then(p => { setProva(p); setResp(p.questoes.map(() => null)); setEtapa('cpf'); })
      .catch(e => { setErro(e.message || 'Não foi possível abrir a prova.'); setEtapa('erro'); });
  }, [api, token, apiTeste]);

  useEffect(() => { calar(); window.scrollTo && window.scrollTo({ top: 0 }); }, [etapa, i]);

  async function identificar() {
    if (!cpfValido(cpf)) { setErro('CPF inválido. Confira os números.'); return; }
    setOcupado(true); setErro('');
    try {
      const r = await api.identificar(token, cpf);
      setNome(r.primeiro_nome || '');
      setEtapa('confirmar');
    } catch (e) {
      setErro(e.message || 'Não foi possível conferir o CPF. Verifique a internet.');
    } finally { setOcupado(false); }
  }

  async function enviar() {
    setEtapa('enviando'); setErro('');
    try {
      const r = await api.responder(token, cpf, resp);
      setResultado(r);
      setEtapa('resultado');
    } catch (e) {
      setErro(e.message || 'Não foi possível enviar. Verifique a internet e tente de novo.');
      setEtapa('revisar'); // as respostas continuam marcadas
    }
  }

  function refazer() {
    setResp(prova.questoes.map(() => null));
    setResultado(null);
    setI(0);
    setEtapa('questao');
  }

  const q = prova && prova.questoes[i];
  const total = prova ? prova.questoes.length : 0;
  const faltam = resp.map((r, k) => (r === null ? k : null)).filter(k => k !== null);

  return (
    <div className="aluno">
      <Cabecalho titulo="Prova – Operador de PEMT" sub={prova && prova.cliente ? <span className="cab-sub">{prova.cliente}{prova.data ? ' · ' + fmtData(prova.data) : ''}</span> : null} />
      <main>
        {etapa === 'carregando' && <div className="centro">Abrindo a prova…</div>}

        {etapa === 'erro' && (
          <div className="aviso" role="alert"><b>Não foi possível abrir a prova</b><p>{erro}</p></div>
        )}

        {etapa === 'cpf' && (
          <section className="sec aluno-cpf">
            <h1 className="aluno-tit">Digite o seu CPF</h1>
            <p className="dica">São {total} perguntas. Para passar, acerte {prova.minimo_acertos}.</p>
            <label>CPF
              <input inputMode="numeric" autoComplete="off" maxLength={14} placeholder="000.000.000-00" value={cpf}
                onChange={e => { setCpf(mascaraCpf(e.target.value)); setErro(''); }}
                onKeyDown={e => { if (e.key === 'Enter') identificar(); }} />
            </label>
            {erro && <p className="erro-campo" role="alert" style={{ marginTop: 0, marginBottom: 12 }}>{erro}</p>}
            <button type="button" className="btn prim larg" disabled={ocupado || cpf.length < 14} onClick={identificar}>{ocupado ? 'Conferindo…' : 'Continuar'}</button>
          </section>
        )}

        {etapa === 'confirmar' && (
          <section className="sec">
            <h1 className="aluno-tit">Você é {nome}?</h1>
            <p className="dica">CPF {cpf}</p>
            <div className="dois">
              <button type="button" className="btn" onClick={() => { setEtapa('cpf'); setNome(''); }}>Não</button>
              <button type="button" className="btn prim" onClick={() => { setI(0); setEtapa('questao'); }}>Sim, começar</button>
            </div>
          </section>
        )}

        {etapa === 'questao' && q && (
          <section className="sec">
            <p className="dica" style={{ margin: 0 }}>Pergunta {i + 1} de {total}</p>
            <div className="progresso" aria-hidden="true"><span style={{ width: `${((i + 1) / total) * 100}%` }} /></div>
            {temVoz() && (
              <button type="button" className="btn peq ouvir" onClick={() => falar(`${q.p} ${q.a.map((a, k) => `${LETRAS[k]}: ${a}.`).join(' ')}`)}>Ouvir a pergunta</button>
            )}
            <h1 className="pergunta">{q.p}</h1>
            <ul className="opcoes">
              {q.a.map((a, k) => (
                <li key={k}>
                  <button type="button" className="opcao" aria-pressed={resp[i] === k}
                    onClick={() => setResp(r => r.map((x, j) => (j === i ? k : x)))}>
                    <span className="letra">{LETRAS[k]}</span><span>{a}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(etapa === 'revisar' || etapa === 'enviando') && prova && (
          <section className="sec">
            <h1 className="aluno-tit">Conferir respostas</h1>
            <p className="dica">Toque em um número para mudar a resposta.</p>
            <ul className="revisao">
              {resp.map((r, k) => (
                <li key={k}>
                  <button type="button" className={r === null ? 'falta' : ''} onClick={() => { setI(k); setEtapa('questao'); }}>
                    {k + 1}: {r === null ? '—' : LETRAS[r]}
                  </button>
                </li>
              ))}
            </ul>
            {faltam.length > 0 && <p className="erro-campo" style={{ marginBottom: 10 }}>Falta responder: {faltam.map(k => k + 1).join(', ')}.</p>}
            {erro && <div className="aviso" role="alert"><p>{erro}</p></div>}
            <button type="button" className="btn prim larg" disabled={faltam.length > 0 || etapa === 'enviando'} onClick={enviar}>
              {etapa === 'enviando' ? 'Enviando…' : 'Enviar prova'}
            </button>
          </section>
        )}

        {etapa === 'resultado' && resultado && (
          <section className={`sec resultado ${resultado.aprovado ? 'ok' : 'err'}`}>
            <p className="grande">{resultado.aprovado ? 'APROVADO' : 'NÃO PASSOU'}</p>
            <p>Você acertou <b>{resultado.acertos}</b> de {resultado.total}.</p>
            {resultado.aprovado
              ? <p>Prova enviada ao instrutor. Pode fechar esta página.</p>
              : <>
                  <p>Para passar, precisa acertar {resultado.minimo_acertos}. Fale com o instrutor e faça de novo.</p>
                  <button type="button" className="btn prim larg" onClick={refazer}>Fazer a prova de novo</button>
                </>}
          </section>
        )}
      </main>

      {etapa === 'questao' && q && (
        <nav className="barra">
          <button type="button" className="btn voltar" onClick={() => (i > 0 ? setI(i - 1) : setEtapa('confirmar'))}>Voltar</button>
          <button type="button" className="btn prim" disabled={resp[i] === null}
            onClick={() => (i < total - 1 ? setI(i + 1) : setEtapa('revisar'))}>
            {i < total - 1 ? 'Próxima' : 'Conferir'}
          </button>
        </nav>
      )}
    </div>
  );
}
