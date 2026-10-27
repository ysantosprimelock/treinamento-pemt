// @ts-nocheck
// =====================================================================
// Supabase Edge Function: enviar-push
// Envia um aviso (Web Push) para os celulares dos instrutores escolhidos.
// Só funciona quando quem chama é administrador: a lista de aparelhos vem da
// função push_destinos do banco, chamada com o login de quem pediu o envio.
//
// Segredos da função (Edge Functions > Secrets):
//   VAPID_PUBLIC_KEY   chave pública (a mesma de src/config.js do app)
//   VAPID_PRIVATE_KEY  chave privada (NUNCA vai para o app nem para o GitHub)
//   VAPID_SUBJECT      opcional, ex.: mailto:adm@kimtechmanutencao.com.br
//
// Sem bibliotecas externas: criptografia do Web Push (RFC 8291) e assinatura VAPID (RFC 8292)
// feitas com a Web Crypto do próprio Deno.
// =====================================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const enc = new TextEncoder();

export function b64urlParaBytes(s) {
  const b = String(s || '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesParaB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function juntar(...partes) {
  const out = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
}

async function hmac(chave, dados) {
  const k = await crypto.subtle.importKey('raw', chave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, dados));
}

// Criptografa o conteúdo do aviso para um aparelho (aes128gcm, RFC 8291).
// opcoes.parLocal / opcoes.salt existem só para os testes.
export async function criptografar(conteudo, p256dh, authSecretB64, opcoes = {}) {
  const uaPublic = b64urlParaBytes(p256dh);
  const authSecret = b64urlParaBytes(authSecretB64);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('Chave p256dh do aparelho inválida.');
  if (authSecret.length < 16) throw new Error('Chave auth do aparelho inválida.');

  const local = opcoes.parLocal || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const segredo = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const prkKey = await hmac(authSecret, segredo);
  const ikm = await hmac(prkKey, juntar(enc.encode('WebPush: info\0'), uaPublic, asPublic, Uint8Array.of(1)));
  const salt = opcoes.salt || crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, juntar(enc.encode('Content-Encoding: aes128gcm\0'), Uint8Array.of(1)))).slice(0, 16);
  const nonce = (await hmac(prk, juntar(enc.encode('Content-Encoding: nonce\0'), Uint8Array.of(1)))).slice(0, 12);

  const chaveAes = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 },
    chaveAes, juntar(conteudo, Uint8Array.of(2))));

  const cab = new Uint8Array(16 + 4 + 1 + asPublic.length);
  cab.set(salt, 0);
  new DataView(cab.buffer).setUint32(16, 4096);
  cab[20] = asPublic.length;
  cab.set(asPublic, 21);
  return juntar(cab, cifrado);
}

// Assinatura VAPID (JWT ES256) que identifica o remetente para o serviço de push
export async function jwtVapid(audiencia, assunto, chavePublica, chavePrivada, agora = Date.now()) {
  const pub = b64urlParaBytes(chavePublica);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID_PUBLIC_KEY inválida.');
  const jwk = { kty: 'EC', crv: 'P-256', x: bytesParaB64url(pub.slice(1, 33)), y: bytesParaB64url(pub.slice(33, 65)), d: chavePrivada, ext: true };
  const chave = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const cab = bytesParaB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const dados = bytesParaB64url(enc.encode(JSON.stringify({ aud: audiencia, exp: Math.floor(agora / 1000) + 12 * 3600, sub: assunto })));
  const ass = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, chave, enc.encode(cab + '.' + dados)));
  return `${cab}.${dados}.${bytesParaB64url(ass)}`;
}

export async function enviarPush(destino, conteudoTexto, vapid, fetchFn = fetch) {
  const url = new URL(destino.endpoint);
  if (url.protocol !== 'https:') throw new Error('Endereço de push sem https.');
  const jwt = await jwtVapid(url.origin, vapid.subject, vapid.publicKey, vapid.privateKey);
  const corpo = await criptografar(enc.encode(conteudoTexto), destino.p256dh, destino.auth);
  const r = await fetchFn(destino.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'high',
      Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`
    },
    body: corpo,
    signal: AbortSignal.timeout(15000)
  });
  const ok = r.status >= 200 && r.status < 300;
  const msg = ok ? '' : (await r.text().catch(() => '')).slice(0, 200);
  return { endpoint: destino.endpoint, status: r.status, ok, vencida: r.status === 404 || r.status === 410, msg };
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const curto = (s, n) => String(s == null ? '' : s).slice(0, n);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// env: função que lê um segredo/variável (Deno.env.get no Supabase)
export async function tratar(req, env, fetchFn = fetch) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ erro: 'Use POST.' }, 405);

  const vapid = {
    publicKey: env('VAPID_PUBLIC_KEY'),
    privateKey: env('VAPID_PRIVATE_KEY'),
    subject: env('VAPID_SUBJECT') || 'mailto:adm@kimtechmanutencao.com.br'
  };
  if (!vapid.publicKey || !vapid.privateKey) {
    return json({ erro: 'Faltam os segredos VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY na função enviar-push.' }, 500);
  }
  const base = String(env('SUPABASE_URL') || '').replace(/\/+$/, '');
  if (!base) return json({ erro: 'SUPABASE_URL não disponível na função.' }, 500);

  const autorizacao = req.headers.get('Authorization') || '';
  const apikey = req.headers.get('apikey') || env('SUPABASE_ANON_KEY') || '';
  if (!/^Bearer\s+\S+/.test(autorizacao)) return json({ erro: 'Entre como administrador.' }, 401);

  let pedido;
  try { pedido = await req.json(); } catch { return json({ erro: 'Pedido inválido.' }, 400); }
  const usuarios = [...new Set((Array.isArray(pedido.usuarios) ? pedido.usuarios : []).filter(u => UUID.test(String(u))))].slice(0, 50);
  if (!usuarios.length) return json({ erro: 'Informe para quem enviar o aviso.' }, 400);

  const rpc = (nome, args) => fetchFn(`${base}/rest/v1/rpc/${nome}`, {
    method: 'POST',
    headers: { apikey, Authorization: autorizacao, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });

  // O banco confere se quem chamou é admin e devolve os aparelhos inscritos
  const r = await rpc('push_destinos', { p_usuarios: usuarios });
  if (!r.ok) {
    let msg = 'Sem permissão para enviar avisos.';
    try { const e = await r.json(); if (e && e.message) msg = e.message; } catch { /* corpo não é JSON */ }
    return json({ erro: msg }, r.status === 401 ? 401 : 403);
  }
  const destinos = await r.json();

  const aviso = JSON.stringify({
    titulo: curto(pedido.titulo, 80) || 'Treinamento PEMT',
    corpo: curto(pedido.corpo, 300),
    url: curto(pedido.url, 300) || './',
    tag: curto(pedido.tag, 64) || 'agenda'
  });

  const resultados = await Promise.all((destinos || []).map(d =>
    enviarPush(d, aviso, vapid, fetchFn).catch(e => ({ endpoint: d.endpoint, status: 0, ok: false, vencida: false, msg: String((e && e.message) || e) }))));

  const vencidas = resultados.filter(x => x.vencida).map(x => x.endpoint);
  if (vencidas.length) await rpc('push_descartar', { p_endpoints: vencidas }).catch(() => {});

  return json({
    aparelhos: resultados.length,
    enviados: resultados.filter(x => x.ok).length,
    removidos: vencidas.length,
    falhas: resultados.filter(x => !x.ok && !x.vencida).length,
    erros: resultados.filter(x => !x.ok && !x.vencida).map(x => `${x.status || 'rede'} ${x.msg}`.trim()).slice(0, 5)
  });
}

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  Deno.serve(req => tratar(req, k => Deno.env.get(k)).catch(e => json({ erro: String((e && e.message) || e) }, 500)));
}
