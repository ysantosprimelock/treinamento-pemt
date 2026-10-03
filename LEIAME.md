# App Treinamento PEMT

App instalável (Android/Chrome) para o instrutor registrar a turma, as fotos, os operadores e as assinaturas em campo. Tudo é salvo no celular a cada passo e enviado ao Supabase quando há internet.

## Estado dos testes

| O que | Como foi testado | Resultado |
|---|---|---|
| Fila de envio (não perder dados) | Banco local simulado + Supabase falso: queda de rede, queda no meio do envio, recusa do servidor, sessão expirada, app fechado no meio, envio duplo | 32/32 |
| Telas | Navegador simulado (jsdom): preenchimento, validações, máscara de CPF, salvamento automático, finalização | 19/19 |
| Compilação | `vite build` | OK |
| **Celular real + Supabase real** | **Não testado** | Faça o teste do final deste arquivo |

Câmera, compressão de fotos, quadro de assinatura e login real só podem ser verificados no aparelho.

## 1. Chave pública do Supabase

No Supabase: **Project Settings → API Keys**, copie a chave **anon / publishable**. Ela vai em `src/config.js`, na linha `SUPABASE_ANON_KEY` (passo 3).

- A chave pública pode ficar no app: quem protege os dados são as regras do banco.
- A chave **secreta** (service_role / secret) **nunca** vai para o app nem para o GitHub.
- Confira se `SUPABASE_URL` em `src/config.js` é a URL do seu projeto.

## 2. Criar o repositório no GitHub

1. github.com → **New repository**. Nome, por exemplo: `treinamento-pemt`.
2. Visibilidade: no plano gratuito, o GitHub Pages só publica repositório **público** (confira em docs.github.com se isso mudou). O código fica visível, mas não contém segredos.
3. Crie o repositório sem README.

## 3. Enviar os arquivos

1. Na página do repositório: **uploading an existing file**.
2. Arraste **todo o conteúdo** desta pasta (`src`, `public`, `testes`, `.github`, `index.html`, `package.json`, `package-lock.json`, `vite.config.js`, `.gitignore`, `LEIAME.md`). Não envie `node_modules` nem `dist`, se existirem.
3. **Commit changes**.
4. Confira se a pasta `.github/workflows/deploy.yml` aparece no repositório. Se não aparecer (alguns sistemas escondem pastas que começam com ponto): **Add file → Create new file**, nome `.github/workflows/deploy.yml`, cole o conteúdo do arquivo e salve.
5. Abra `src/config.js` no GitHub (ícone de lápis), cole a chave pública no lugar de `COLE_AQUI_A_CHAVE_PUBLICA` e salve (commit).

## 4. Ligar o GitHub Pages

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Aba **Actions**: aguarde a execução "Publicar no GitHub Pages" ficar verde (1–3 minutos).
3. O endereço aparece na execução e em Settings → Pages, no formato `https://SEU-USUARIO.github.io/treinamento-pemt/`.

Se a execução falhar, abra-a e copie a mensagem de erro do passo que ficou vermelho.

Cada alteração salva no GitHub publica uma nova versão sozinha. O celular pega a versão nova na próxima vez que abrir o app com internet.

## 5. Ajuste no Supabase

**Authentication → URL Configuration → Site URL**: coloque o endereço do GitHub Pages. Isso não afeta o login por senha, mas deixa os e-mails do Supabase (ex.: redefinição de senha) apontando para o app.

## 6. Instalar no Android

1. Abra o endereço no **Chrome**.
2. Entre com o e-mail e a senha do instrutor.
3. Menu ⋮ → **Instalar app** (ou **Adicionar à tela inicial**).

## 7. Teste obrigatório antes de usar com cliente

Com o instrutor de teste, no celular que vai a campo:

- [ ] Login funciona e o nome do instrutor aparece no topo.
- [ ] Novo treinamento → turma com 2 fabricantes e 2 máquinas → 3 fotos pela câmera → 2 operadores (testar CPF inválido) → 2 assinaturas → **Finalizar e enviar**.
- [ ] Em até 1 minuto o contador volta a 0 e o treinamento aparece em "Enviados".
- [ ] No pgAdmin, os dados chegaram:
  `select cliente, data_treinamento, instrutor_nome, drive_status from public.treinamentos;`
  `select * from public.vw_lista_presenca order by treinamento_id, ordem;`
- [ ] No Supabase → Storage → `treinamentos`: as fotos e assinaturas estão na pasta do instrutor.
- [ ] **Teste sem internet**: modo avião → faça um treinamento completo → ele fica em "Aguardando envio" → feche o app → reabra (ainda em modo avião) → o treinamento continua lá → tire o modo avião → ele é enviado sozinho (ou toque em "Enviar agora").
- [ ] **Queda no meio**: com fotos grandes, ative o modo avião durante o envio → depois desative → envio conclui sem duplicar (confira no pgAdmin que existe só 1 registro).
- [ ] Fechar o app no meio de um treinamento e reabrir: os dados digitados, fotos e assinaturas continuam.

## Regras de uso que protegem os dados

- **Não limpe os dados do Chrome/do app** enquanto houver treinamento "Em andamento" ou "Aguardando envio": isso apaga a cópia do celular antes de ela chegar ao servidor.
- Envie no mesmo dia, assim que houver internet. Se o celular for perdido ou quebrar antes do envio, os dados que estavam só nele se perdem; nenhum app evita isso.
- Depois de confirmados pelo servidor, os treinamentos ficam no celular por 7 dias como cópia de segurança e depois são apagados de lá (continuam no Supabase).
- "Sair" não apaga nada do celular; os pendentes são enviados quando o mesmo instrutor entrar de novo.

## Como funciona o envio

1. Ao finalizar, o treinamento vira "Na fila".
2. O app sobe as fotos e assinaturas para o Storage (pasta do instrutor) e depois chama `registrar_treinamento` no banco, que grava tudo numa transação.
3. Só depois da confirmação do banco ele vira "Enviado".
4. Sem internet: tenta de novo quando a conexão volta, ao reabrir o app e a cada minuto (com intervalo crescente entre falhas).
5. Se o servidor recusar (ex.: dado inválido), aparece **Precisa de correção** com o motivo e o botão **Corrigir**.

## Desenvolvimento local (opcional)

Requer Node.js 20+: `npm install`, `npm run dev`, `npm test`, `npm run test:telas`, `npm run build`.
