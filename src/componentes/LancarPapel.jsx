import { useEffect, useRef, useState } from 'react';
import { LETRAS } from '../prova/correcao.js';

// Instrutor marca as respostas que o operador deu na folha de papel (ou em voz alta).
export default function LancarPapel({ prova, nome, inicial, temFoto, aoSalvar, aoCancelar }) {
  const dlg = useRef(null);
  const camRef = useRef(null);
  const [resp, setResp] = useState(() => (inicial && inicial.length === prova.questoes.length ? [...inicial] : prova.questoes.map(() => null)));
  const [foto, setFoto] = useState(null); // File novo (opcional)
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    const d = dlg.current;
    if (!d.open) d.showModal();
    const aoEsc = e => { e.preventDefault(); aoCancelar(); };
    d.addEventListener('cancel', aoEsc);
    return () => d.removeEventListener('cancel', aoEsc);
  }, [aoCancelar]);

  const faltam = resp.map((r, i) => (r === null ? i + 1 : null)).filter(Boolean);

  function salvar() {
    if (faltam.length) { setAviso(`Marque a resposta da(s) questão(ões): ${faltam.join(', ')}.`); return; }
    aoSalvar(resp, foto);
  }

  return (
    <dialog ref={dlg} className="dlg-papel" aria-labelledby="papel-tit">
      <div className="dlg">
        <h3 id="papel-tit">Prova em papel</h3>
        <p className="dica" style={{ marginBottom: 8 }}>{nome}. Marque a letra que o operador escolheu em cada questão.</p>
        <ol className="papel">
          {prova.questoes.map((q, i) => (
            <li key={i}>
              <span className="papel-q">{i + 1}. {q.p}</span>
              <div className="papel-bts" role="group" aria-label={`Questão ${i + 1}`}>
                {q.a.map((a, k) => (
                  <button key={k} type="button" className="papel-bt" aria-pressed={resp[i] === k} title={a}
                    onClick={() => { setResp(r => r.map((x, j) => (j === i ? k : x))); setAviso(''); }}>
                    {LETRAS[k]}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ol>
        <div className="papel-foto">
          <button type="button" className="btn peq" onClick={() => camRef.current.click()}>
            {foto ? 'Trocar foto da folha' : temFoto ? 'Trocar foto da folha' : 'Foto da folha (opcional)'}
          </button>
          <small>{foto ? 'Foto nova anexada.' : temFoto ? 'Foto já anexada.' : 'A foto entra no comprovante.'}</small>
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={e => { const f = e.target.files && e.target.files[0]; if (f) setFoto(f); e.target.value = ''; }} />
        </div>
        {aviso && <p className="erro-campo" role="alert" style={{ marginTop: 8 }}>{aviso}</p>}
        <div className="dlg-bts">
          <button type="button" className="btn" onClick={aoCancelar}>Cancelar</button>
          <button type="button" className="btn prim" onClick={salvar}>Salvar respostas</button>
        </div>
      </div>
    </dialog>
  );
}
