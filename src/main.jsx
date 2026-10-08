import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import ProvaAluno from './telas/ProvaAluno';
import './styles.css';

// Link do QR code: <endereço do app>?prova=<token> abre só a prova do operador (sem login)
const tokenProva = new URLSearchParams(window.location.search).get('prova');

createRoot(document.getElementById('root')).render(
  <React.StrictMode>{tokenProva ? <ProvaAluno token={tokenProva} /> : <App />}</React.StrictMode>
);

// O celular do operador não precisa instalar nada: o service worker é só para o app do instrutor
if (!tokenProva && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(err => console.error('SW:', err));
  });
}
