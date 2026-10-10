import { useEffect, useRef } from 'react';

export default function PadAssinatura({ nome, aoConfirmar, aoCancelar, dica = 'Assine com o dedo dentro do quadro. No notebook: segure o clique do touchpad ou do mouse e escreva.', textoOk = 'Confirmar assinatura' }) {
  const dlg = useRef(null);
  const cv = useRef(null);
  const st = useRef({ desenhando: false, pontos: 0, ctx: null });

  function iniciar() {
    const c = cv.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0A1A2A';
    st.current = { desenhando: false, pontos: 0, ctx };
  }

  useEffect(() => {
    const d = dlg.current;
    if (!d.open) d.showModal();
    const id = requestAnimationFrame(iniciar);
    const aoEsc = e => { e.preventDefault(); aoCancelar(); };
    d.addEventListener('cancel', aoEsc);
    return () => { cancelAnimationFrame(id); d.removeEventListener('cancel', aoEsc); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pos = e => {
    const r = cv.current.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  function baixo(e) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const s = st.current;
    s.desenhando = true;
    const [x, y] = pos(e);
    s.ctx.beginPath();
    s.ctx.moveTo(x, y);
    s.ctx.lineTo(x + 0.01, y + 0.01);
    s.ctx.stroke();
  }
  function move(e) {
    const s = st.current;
    if (!s.desenhando) return;
    e.preventDefault();
    const [x, y] = pos(e);
    s.ctx.lineTo(x, y);
    s.ctx.stroke();
    s.ctx.beginPath();
    s.ctx.moveTo(x, y);
    s.pontos++;
  }
  function cima() { st.current.desenhando = false; }

  function confirmar() {
    if (st.current.pontos < 12) {
      alert('Assinatura muito curta. Assine dentro do quadro.');
      return;
    }
    const out = document.createElement('canvas');
    out.width = 600;
    out.height = 225;
    const c = out.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, 600, 225);
    c.drawImage(cv.current, 0, 0, 600, 225);
    out.toBlob(b => { if (b) aoConfirmar(b); else alert('Não foi possível salvar a assinatura. Tente de novo.'); }, 'image/png');
  }

  return (
    <dialog ref={dlg} aria-labelledby="assin-nome">
      <div className="dlg">
        <h3 id="assin-nome">{nome}</h3>
        <p className="dica">{dica}</p>
        <canvas ref={cv} className="pad" onPointerDown={baixo} onPointerMove={move} onPointerUp={cima} onPointerCancel={cima} onPointerLeave={cima} />
        <div className="dlg-bts">
          <button type="button" className="btn" onClick={iniciar}>Limpar</button>
          <button type="button" className="btn" onClick={aoCancelar}>Cancelar</button>
          <button type="button" className="btn prim" onClick={confirmar}>{textoOk}</button>
        </div>
      </div>
    </dialog>
  );
}
