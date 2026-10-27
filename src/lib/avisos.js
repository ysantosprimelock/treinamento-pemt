// Avisos no celular (Web Push): o instrutor recebe uma notificação quando a Kimtech agenda um treinamento para ele.
// O aparelho se inscreve no serviço de push do navegador e a inscrição é guardada no banco (push_salvar).
import { VAPID_PUBLIC_KEY } from '../config.js';

export function suportaAvisos(w = globalThis) {
  return !!(VAPID_PUBLIC_KEY && w.navigator && 'serviceWorker' in w.navigator && 'PushManager' in w && 'Notification' in w);
}

// 'granted' | 'denied' | 'default' | 'sem-suporte'
export function permissaoAvisos(w = globalThis) {
  return suportaAvisos(w) ? w.Notification.permission : 'sem-suporte';
}

export function chaveParaBytes(b64url) {
  const b = String(b64url).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function mesmaChave(buf, b64url) {
  if (!buf) return true; // navegador não informa a chave usada: mantém a inscrição
  const a = new Uint8Array(buf), b = chaveParaBytes(b64url);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// pedir: mostra a pergunta de permissão do navegador (só depois de um toque do usuário).
// Sem pedir: só renova a inscrição se a permissão já foi dada (ex.: ao abrir o app).
// Devolve { ok, estado } — estado: 'ativo' | 'pedir' | 'bloqueado' | 'sem-suporte'
export async function ativarAvisos(supabase, { pedir = false, w = globalThis } = {}) {
  if (!suportaAvisos(w)) return { ok: false, estado: 'sem-suporte' };
  let perm = w.Notification.permission;
  if (perm === 'default' && pedir) perm = await w.Notification.requestPermission();
  if (perm === 'denied') return { ok: false, estado: 'bloqueado' };
  if (perm !== 'granted') return { ok: false, estado: 'pedir' };

  const reg = await w.navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !mesmaChave(sub.options && sub.options.applicationServerKey, VAPID_PUBLIC_KEY)) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  const { error } = await supabase.rpc('push_salvar', {
    p: { endpoint: j.endpoint, p256dh: j.keys && j.keys.p256dh, auth: j.keys && j.keys.auth, user_agent: w.navigator.userAgent }
  });
  if (error) throw error;
  return { ok: true, estado: 'ativo' };
}

// Ao sair da conta: este aparelho deixa de receber os avisos desse usuário
export async function desligarAvisos(supabase, w = globalThis) {
  try {
    if (!suportaAvisos(w)) return;
    const reg = await w.navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) await supabase.rpc('push_remover', { p_endpoint: sub.endpoint });
  } catch { /* sem internet: a inscrição fica com este usuário até alguém entrar de novo neste aparelho */ }
}
