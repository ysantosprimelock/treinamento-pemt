import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

export const configurado = !!SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.startsWith('COLE_');

// Corta requisições presas (sinal fraco) para o app poder tentar de novo depois.
function fetchComTempo(url, opcoes = {}) {
  const ctl = new AbortController();
  const limite = setTimeout(() => ctl.abort(), 90000);
  if (opcoes.signal) opcoes.signal.addEventListener('abort', () => ctl.abort());
  return fetch(url, { ...opcoes, signal: ctl.signal }).finally(() => clearTimeout(limite));
}

export const supabase = createClient(SUPABASE_URL, configurado ? SUPABASE_ANON_KEY : 'nao-configurado', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  global: { fetch: fetchComTempo }
});
