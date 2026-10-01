# Handcrafted The Barbershop — Website

Site oficial da **Handcrafted The Barbershop** — 1336 El Camino Real, Millbrae, CA 94030 · (650) 763-1332.

Site de uma página, responsivo, em inglês (público americano), com agendamento via [Booksy](https://handcrafted1336.booksy.com), status "Open now / Closed" em tempo real (fuso da Califórnia), galeria com lightbox, avaliações, mapa e formulário de contato com backend próprio.

## Stack

- **Frontend:** HTML semântico + CSS puro + JavaScript (ES modules), sem build step.
- **Backend:** Node.js 22 **sem dependências**: Vercel Functions (`api/`) e servidor HTTP nativo para uso local (`dev-server.js`), com a mesma lógica em `lib/`.
- **Testes:** `node:test` (horários + API).

## Como rodar

```bash
npm start          # http://localhost:3000
npm run dev        # reinicia ao salvar
npm test           # 27 testes
```

Variáveis de ambiente (opcionais):

| Variável | Uso |
| --- | --- |
| `PORT` | Porta do servidor (padrão `3000`) |
| `DATA_DIR` | Pasta onde as mensagens do formulário são salvas localmente (padrão `./data`) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Redis (Upstash) para guardar as mensagens. Necessário na Vercel |
| `ADMIN_TOKEN` | Libera `GET /api/messages` com `Authorization: Bearer <token>` |
| `CONTACT_WEBHOOK_URL` | Encaminha cada mensagem para Slack/Discord/Zapier (campo `text`) |

## API

| Rota | Descrição |
| --- | --- |
| `GET /api/status` | Aberto/fechado agora, no fuso `America/Los_Angeles` |
| `GET /api/info` | Dados do negócio + status |
| `POST /api/contact` | Recebe `{ name, contact, service?, message }` (JSON). Validação, honeypot anti-spam e limite de 5 envios / 10 min por IP |
| `GET /api/messages` | Lista mensagens recebidas (requer `ADMIN_TOKEN`) |
| `GET /healthz` | Health check |

O servidor também envia cabeçalhos de segurança (CSP, nosniff, etc.), ETag/cache para imagens e uma página 404 personalizada.

## Estrutura

```
dev-server.js             Servidor local (estático + API)
vercel.json               Configuração da Vercel
api/                      Vercel Functions
lib/                      Lógica da API, armazenamento e cabeçalhos (compartilhados)
public/
  index.html              Página principal (SEO, Open Graph, JSON-LD BarberShop)
  404.html
  css/styles.css          Design (preto + dourado do letreiro, faixa de barber pole)
  js/main.js              Menu, animações, horários, lightbox, formulário
  js/hours.js             Lógica de horário compartilhada entre navegador e servidor
  data/business.json      ✏️ Telefone, endereço, link Booksy, nota e HORÁRIOS
  assets/img/             Fotos (JPG + WebP) e og-image
test/                     Testes
```

## ✏️ Antes de publicar — confirmar com a barbearia

1. **Horário de abertura.** Só o fechamento às 21h foi confirmado. O site está com **9h–21h todos os dias** como provisório. Edite `public/data/business.json` (site e API leem dali) e a linha `"openingHours"` do JSON-LD em `public/index.html`.
2. **Serviços.** A lista (Haircut, Fades & Tapers, Hair Designs, Kids' Cuts, Beard & Line-Up) foi montada a partir das fotos e avaliações. Preços não aparecem no site de propósito — o botão leva ao Booksy, que fica sempre atualizado.
3. **Avaliações.** Os três depoimentos foram retraduzidos para o inglês a partir da versão em português do Google. Vale trocar pelo texto original em inglês de cada review.
4. **Foto do interior.** Confirme que a foto do salão (teto com luzes hexagonais) é mesmo da unidade de Millbrae.

## Deploy na Vercel

O projeto já está pronto para a Vercel (`vercel.json` + funções em `api/`):

- O site estático é servido a partir de `public/`.
- `api/status.js`, `api/info.js`, `api/contact.js` e `api/messages.js` viram Vercel Functions (Node 22). Elas usam o mesmo código de `lib/api.js` que roda no servidor local.
- Os cabeçalhos de segurança do `vercel.json` são os mesmos do servidor local (um teste garante isso).

### Passo a passo

1. Acesse **https://vercel.com/new** e entre com o GitHub.
2. Importe o repositório **Ziddeira/handcrafted-barbershop**.
3. Em *Framework Preset* escolha **Other** e deixe *Root Directory* e *Output Directory* vazios. O `vercel.json` já define tudo (e sobrepõe o preset, se a Vercel sugerir outro).
4. Clique em **Deploy**. A cada `git push` a Vercel publica de novo sozinha (a branch principal vira produção; as outras viram links de preview).

### Formulário de contato na Vercel

O disco da Vercel é somente leitura, então as mensagens precisam de um destino. Configure em *Project → Settings → Environment Variables* pelo menos uma das opções:

| Opção | Variáveis |
| --- | --- |
| **Banco Redis (recomendado)**: em *Storage*, adicione **Upstash Redis** pelo Marketplace. As variáveis são criadas automaticamente | `KV_REST_API_URL` + `KV_REST_API_TOKEN` (ou `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) |
| **Aviso no Slack/Discord/Zapier** | `CONTACT_WEBHOOK_URL` |
| **Ler as mensagens** em `GET /api/messages` (exige o Redis) | `ADMIN_TOKEN` |

Sem nenhum destino configurado, o formulário responde "Online messages aren't available right now. Please call us at (650) 763-1332." e nenhuma mensagem se perde em silêncio. Depois de adicionar variáveis, faça um *Redeploy*.

Para ler as mensagens:

```bash
curl -H "Authorization: Bearer SEU_ADMIN_TOKEN" https://SEU-SITE.vercel.app/api/messages
```

### Domínio próprio

Em *Project → Settings → Domains*, adicione o domínio (ex.: `handcraftedbarbershop.com`) e siga as instruções de DNS.

## Outras hospedagens

- **Qualquer host Node** (Render, Railway, Fly.io, VPS): `npm start`. As mensagens vão para `./data/messages.jsonl` (ou para o Redis/webhook, se configurados).
- **Só estático** (Netlify, GitHub Pages): publique a pasta `public/`. O formulário mostra a mensagem de "ligue para nós".
