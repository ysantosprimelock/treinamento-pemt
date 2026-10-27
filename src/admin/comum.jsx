// Peças comuns do painel admin
import { useEffect, useRef } from 'react';
import { fmtData } from '../lib/util.js';

export { fmtData };
export const fmtDataHoraIso = iso => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
export const fmtCpf = c => {
  const d = String(c || '').replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : String(c || '');
};
export const hora = h => (h ? String(h).slice(0, 5) : '');
export const somarAnos = (iso, n) => {
  if (!iso) return '';
  const [a, m, d] = iso.split('-').map(Number);
  const x = new Date(Date.UTC(a + n, m - 1, d));
  if (x.getUTCMonth() !== m - 1) x.setUTCDate(0); // 29/02 → 28/02
  return x.toISOString().slice(0, 10);
};
export const diasAtras = n => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
export const lugar = (local, cidade, uf) => [local, [cidade, uf].filter(Boolean).join('/')].filter(Boolean).join(' — ');

// Resultado da prova como aparece para o admin (inclui a decisão do instrutor, que o cliente não vê)
export function resultado(av) {
  if (!av) return { txt: 'Sem avaliação', det: '', cls: '' };
  const nota = av.total ? `${av.acertos} de ${av.total}` : '';
  const cls = av.aprovado ? 'ok' : 'err';
  if (av.modo === 'instrutor') return { txt: av.aprovado ? 'Aprovado pelo instrutor' : 'Reprovado pelo instrutor', det: 'sem prova', cls };
  if (av.decisao_instrutor !== null && av.decisao_instrutor !== undefined) {
    return { txt: av.aprovado ? 'Aprovado pelo instrutor' : 'Reprovado pelo instrutor', det: `nota ${nota}`, cls };
  }
  return { txt: av.aprovado ? 'Aprovado' : 'Reprovado', det: nota ? `nota ${nota}` : '', cls };
}
export const MODO = { qr: 'Celular (QR)', papel: 'Papel', instrutor: 'Sem prova' };

// CSV para Excel (separador ; e acentos corretos)
export function baixarCsv(nome, cabecalho, linhas) {
  const cel = v => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // texto que o Excel leria como fórmula
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const texto = '\uFEFF' + [cabecalho, ...linhas].map(l => l.map(cel).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Janela({ titulo, aoFechar, children, largo = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') aoFechar(); };
    document.addEventListener('keydown', esc);
    const foco = ref.current && ref.current.querySelector('input, select, textarea, button');
    if (foco) foco.focus();
    return () => document.removeEventListener('keydown', esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="adm-fundo" onMouseDown={e => { if (e.target === e.currentTarget) aoFechar(); }}>
      <div className={`adm-janela${largo ? ' larga' : ''}`} role="dialog" aria-modal="true" aria-label={titulo} ref={ref}>
        <div className="adm-janela-cab">
          <h2>{titulo}</h2>
          <button type="button" className="adm-fechar" aria-label="Fechar" onClick={aoFechar}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Erro({ msg }) {
  return msg ? <div className="aviso" role="alert">{msg}</div> : null;
}
