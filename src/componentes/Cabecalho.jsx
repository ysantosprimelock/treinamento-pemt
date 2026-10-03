const BASE = (import.meta.env && import.meta.env.BASE_URL) || './';
export const LOGO_URL = BASE + 'logo-kimtech.png';

export default function Cabecalho({ titulo, sub, direita, children }) {
  return (
    <header className="cab">
      <div className="faixa" aria-hidden="true" />
      <div className="cab-linha">
        <img className="cab-logo" src={LOGO_URL} alt="Kimtech" />
        <div className="cab-texto">
          {titulo && <span className="cab-titulo">{titulo}</span>}
          {sub}
        </div>
        {direita}
      </div>
      {children}
    </header>
  );
}
