# Handcrafted The Barbershop — Website

Site oficial da **Handcrafted The Barbershop** — 1336 El Camino Real, Millbrae, CA 94030 · (650) 763-1332.

Site de uma página, responsivo, em inglês (público americano), com agendamento via [Booksy](https://handcrafted1336.booksy.com), status "Open now / Closed" em tempo real (fuso da Califórnia), galeria com lightbox, avaliações, mapa e formulário de contato com backend próprio.

## Stack

- **Frontend:** HTML semântico + CSS puro + JavaScript (ES modules), sem build step.
- **Backend:** Node.js (≥ 18) **sem dependências** — servidor HTTP nativo (`server.js`).
- **Testes:** `node:test` (horários + API).

## Como rodar

```bash
npm start          # http://localhost:3000
npm run dev        # reinicia ao salvar
npm test           # 17 testes
```

Variáveis de ambiente (opcionais):

| Variável | Uso |
| --- | --- |
| `PORT` | Porta do servidor (padrão `3000`) |
| `DATA_DIR` | Pasta onde as mensagens do formulário são salvas (padrão `./data`) |
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
server.js                 Servidor + API
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

## Deploy

- **Com backend (recomendado):** qualquer host Node — Render, Railway, Fly.io, um VPS — com `npm start`. Use um disco persistente para `DATA_DIR`, ou configure `CONTACT_WEBHOOK_URL`.
- **Só estático:** a pasta `public/` funciona sozinha (Netlify, GitHub Pages, Vercel). Status e horários continuam funcionando; o formulário mostra a mensagem de "ligue para nós" caso não haja backend.
