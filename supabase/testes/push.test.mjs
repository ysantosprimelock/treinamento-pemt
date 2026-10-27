// Testes da função enviar-push (Web Push). Roda no Node 20+:
//   node supabase/testes/push.test.mjs
// A criptografia é conferida contra o exemplo oficial da RFC 8291 e contra uma
// biblioteca independente (http_ece), que decifra o aviso como o celular faria.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ece = require('http_ece');
const aqui = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(os.tmpdir(), `enviar-push-${process.pid}.mjs`);
fs.copyFileSync(path.join(aqui, '..', 'functions', 'enviar-push', 'index.ts'), tmp);
const F = await import(pathToFileURL(tmp).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FALHA ' + m); } };
const b64u = b => Buffer.from(b).toString('base64url');

console.log('1) Exemplo oficial da RFC 8291 (mesmas chaves e salt => mesmo resultado, byte a byte)');
{
  const asPub = Buffer.from('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8', 'base64url');
  const jwk = { kty: 'EC', crv: 'P-256', d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', x: b64u(asPub.subarray(1, 33)), y: b64u(asPub.subarray(33)), ext: true };
  const privateKey = await crypto.webcrypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicKey = await crypto.webcrypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const saida = await F.criptografar(new TextEncoder().encode('When I grow up, I want to be a watermelon'),
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg',
    { parLocal: { privateKey, publicKey }, salt: Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url') });
  const esperado = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';
  ok(b64u(saida) === esperado, 'cifra igual à da RFC 8291');
}

// Um "celular" de teste: par de chaves ECDH + segredo auth, como o navegador gera
function celular() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, sub: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
}
const decifrar = (cel, corpo) => ece.decrypt(Buffer.from(corpo), { version: 'aes128gcm', privateKey: cel.ecdh, authSecret: cel.auth.toString('base64url') }).toString('utf8');

console.log('2) Decifrado por biblioteca independente (http_ece)');
{
  const cel = celular();
  const texto = JSON.stringify({ titulo: 'Novo treinamento', corpo: 'ACME LTDA – 30/10 às 08:00 – PÁTIO 3, FORTALEZA/CE ✓' });
  const corpo = await F.criptografar(new TextEncoder().encode(texto), cel.sub.p256dh, cel.sub.auth);
  ok(decifrar(cel, corpo) === texto, 'o celular consegue ler o aviso (com acentos e símbolos)');
  const corpo2 = await F.criptografar(new TextEncoder().encode(texto), cel.sub.p256dh, cel.sub.auth);
  ok(b64u(corpo) !== b64u(corpo2), 'cada envio usa chave e salt novos');
  let e = null; try { await F.criptografar(new Uint8Array(1), 'abc', cel.sub.auth); } catch (x) { e = x; }
  ok(e && /p256dh/.test(e.message), 'chave do aparelho inválida: erro claro');
}

const vapid = (() => {
  const e = crypto.createECDH('prime256v1'); e.generateKeys();
  return { publicKey: e.getPublicKey().toString('base64url'), privateKey: e.getPrivateKey().toString('base64url'), subject: 'mailto:adm@kimtechmanutencao.com.br' };
})();

async function conferirJwt(jwt, pub, aud) {
  const [h, c, s] = jwt.split('.');
  const p = Buffer.from(pub, 'base64url');
  const k = await crypto.webcrypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64u(p.subarray(1, 33)), y: b64u(p.subarray(33)) }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valida = await crypto.webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, Buffer.from(s, 'base64url'), new TextEncoder().encode(h + '.' + c));
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  const cab = JSON.parse(Buffer.from(h, 'base64url').toString());
  return valida && cab.alg === 'ES256' && claims.aud === aud && claims.sub.startsWith('mailto:') && claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600;
}

console.log('3) Assinatura VAPID');
{
  const jwt = await F.jwtVapid('https://fcm.googleapis.com', vapid.subject, vapid.publicKey, vapid.privateKey);
  ok(await conferirJwt(jwt, vapid.publicKey, 'https://fcm.googleapis.com'), 'JWT ES256 válido, com aud, sub e validade de até 24 h');
}

console.log('4) Função completa (banco e serviço de push simulados)');
const ADMIN_TOKEN = 'Bearer token-do-admin';
const U1 = '00000000-0000-4000-8000-00000000000a';
const cel1 = celular(), cel2 = celular();
function simular({ admin = true, destinos } = {}) {
  const log = { rpc: [], push: [] };
  const fetchFn = async (url, op) => {
    if (url.includes('/rest/v1/rpc/')) {
      const nome = url.split('/rpc/')[1];
      log.rpc.push({ nome, op, args: JSON.parse(op.body) });
      if (nome === 'push_destinos') {
        if (!admin) return new Response(JSON.stringify({ code: '42501', message: 'Acesso restrito ao administrador.' }), { status: 403 });
        return new Response(JSON.stringify(destinos || [
          { endpoint: 'https://fcm.googleapis.com/fcm/send/um', ...cel1.sub, usuario_id: U1 },
          { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/dois', ...cel2.sub, usuario_id: U1 }
        ]), { status: 200 });
      }
      return new Response('1', { status: 200 });
    }
    log.push.push({ url, op });
    if (url.endsWith('/dois')) return new Response('', { status: 410 });
    return new Response('', { status: 201 });
  };
  return { log, fetchFn };
}
const env = extra => k => ({ VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, SUPABASE_URL: 'https://abc.supabase.co/', ...extra })[k];
const pedido = (corpo, headers = {}) => new Request('https://abc.supabase.co/functions/v1/enviar-push', {
  method: 'POST', headers: { Authorization: ADMIN_TOKEN, apikey: 'sb_publishable_x', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(corpo)
});
{
  const s = simular();
  const r = await F.tratar(pedido({ usuarios: [U1, U1, 'nao-e-uuid'], titulo: 'Novo treinamento agendado', corpo: 'ACME LTDA – 30/10', url: 'https://treinamento.kimtechmanutencao.com.br/?agenda=1' }), env(), s.fetchFn);
  const j = await r.json();
  ok(r.status === 200 && j.aparelhos === 2 && j.enviados === 1 && j.removidos === 1 && j.falhas === 0, `resumo: 2 aparelhos, 1 enviado, 1 vencido removido (${JSON.stringify(j)})`);
  const d = s.log.rpc.find(x => x.nome === 'push_destinos');
  ok(d && d.op.headers.Authorization === ADMIN_TOKEN && d.op.headers.apikey === 'sb_publishable_x' && JSON.stringify(d.args.p_usuarios) === JSON.stringify([U1]), 'banco consultado com o login de quem pediu (sem repetir usuário nem aceitar id inválido)');
  ok(s.log.rpc[0].op && s.log.rpc[0].op.headers && !String(d.op.headers.Authorization).includes('service_role'), 'não usa a chave secreta do Supabase');
  const desc = s.log.rpc.find(x => x.nome === 'push_descartar');
  ok(desc && JSON.stringify(desc.args.p_endpoints) === JSON.stringify(['https://updates.push.services.mozilla.com/wpush/v2/dois']), 'inscrição vencida (410) é apagada do banco');
  const p1 = s.log.push.find(x => x.url.endsWith('/um'));
  const h = p1.op.headers;
  ok(h['Content-Encoding'] === 'aes128gcm' && h.TTL === '86400' && h['Content-Type'] === 'application/octet-stream', 'cabeçalhos do Web Push');
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(h.Authorization);
  ok(m && m[2] === vapid.publicKey && await conferirJwt(m[1], vapid.publicKey, 'https://fcm.googleapis.com'), 'Authorization vapid com JWT para a origem do serviço de push');
  const aviso = JSON.parse(decifrar(cel1, p1.op.body));
  ok(aviso.titulo === 'Novo treinamento agendado' && aviso.corpo === 'ACME LTDA – 30/10' && aviso.url.endsWith('?agenda=1') && aviso.tag === 'agenda', 'o celular lê título, texto e link do aviso');
}
{
  const s = simular({ admin: false });
  const r = await F.tratar(pedido({ usuarios: [U1] }), env(), s.fetchFn);
  const j = await r.json();
  ok(r.status === 403 && /administrador/.test(j.erro) && s.log.push.length === 0, 'quem não é admin: 403 e nada é enviado');
}
{
  const s = simular();
  let r = await F.tratar(pedido({ usuarios: [U1] }, { Authorization: '' }), env(), s.fetchFn);
  ok(r.status === 401 && s.log.rpc.length === 0, 'sem login: 401');
  r = await F.tratar(pedido({ usuarios: ['x'] }), env(), s.fetchFn);
  ok(r.status === 400, 'sem destinatário válido: 400');
  r = await F.tratar(pedido({ usuarios: [U1] }), env({ VAPID_PRIVATE_KEY: '' }), s.fetchFn);
  ok(r.status === 500 && /VAPID/.test((await r.json()).erro), 'sem as chaves VAPID: erro explicando o que falta');
  r = await F.tratar(new Request('https://x/f', { method: 'OPTIONS' }), env(), s.fetchFn);
  ok(r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === '*' && /apikey/.test(r.headers.get('Access-Control-Allow-Headers')), 'pré-verificação do navegador (CORS)');
  r = await F.tratar(new Request('https://x/f', { method: 'POST', headers: { Authorization: ADMIN_TOKEN }, body: '{' }), env(), s.fetchFn);
  ok(r.status === 400, 'corpo inválido: 400');
}
{
  const s = simular({ destinos: [] });
  const r = await F.tratar(pedido({ usuarios: [U1] }), env(), s.fetchFn);
  const j = await r.json();
  ok(r.status === 200 && j.aparelhos === 0 && j.enviados === 0, 'instrutor sem aparelho inscrito: responde 0 aparelhos (sem erro)');
}
{
  const falha = async (url, op) => url.includes('/rpc/push_destinos')
    ? new Response(JSON.stringify([{ endpoint: 'https://fcm.googleapis.com/x', ...cel1.sub }]), { status: 200 })
    : url.includes('/rpc/') ? new Response('1') : Promise.reject(new Error('timeout'));
  const r = await F.tratar(pedido({ usuarios: [U1] }), env(), falha);
  const j = await r.json();
  ok(r.status === 200 && j.falhas === 1 && j.removidos === 0 && /timeout/.test(j.erros[0]), 'queda de rede no serviço de push: conta como falha, sem apagar a inscrição');
}

fs.rmSync(tmp, { force: true });
console.log(`\nResultado: ${pass} ok, ${fail} falha(s)`);
process.exit(fail ? 1 : 0);
