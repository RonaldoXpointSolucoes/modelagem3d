# Modelagem 3D com IA

SaaS mobile-first (PWA): o usuário descreve um objeto, a IA gera a malha 3D, ele manipula no celular e exporta para o **SketchUp**.

```
Celular (PWA React + R3F) ──JWT──▶ API Node/Fastify (Coolify) ──▶ Meshy (IA 3D)
        │  ▲ Realtime                    │        └──▶ Assimp: GLB → DAE / OBJ / STL
        ▼  │                             ▼
      Appwrite (Auth, DB, Storage) ◀── API key      Sua API Pix ──webhook──▶ API
```

## Pastas

| Pasta | O que é |
|---|---|
| `backend/` | API Fastify: créditos, geração 3D, conversão SketchUp, Pix, webhook. `npm test` roda 8 testes com Appwrite falso. |
| `frontend/` | PWA Vite + React Three Fiber: login, cena 3D, bottom sheets, menu radial, Pix com confetes. |
| `scripts/setup-appwrite.mjs` | Cria database, coleções, índices e bucket no Appwrite (idempotente). |

## Regras de segurança

- O front **nunca** fala com a IA nem com o Pix. Toda ação que custa dinheiro passa pela API.
- Coleções e bucket têm `documentSecurity`/`fileSecurity`: o usuário só **lê** os próprios documentos; **só o backend escreve**.
- Downloads passam pela API (`/api/projects/:id/file/:fmt`), que confere dono e plano.
- Webhook Pix exige `X-Webhook-Secret` e **reconfirma o status na API Pix** antes de creditar. É idempotente.
- Rode o backend com **1 réplica** (o saldo é serializado por usuário em memória; o Appwrite 1.7 não tem incremento atômico).

## SketchUp

A IA entrega GLB. O backend converte para:

- **.DAE (Collada)** – recomendado: SketchUp → *Arquivo → Importar* → Collada.
- **.OBJ + .MTL (zip)** – SketchUp Pro 2021+.
- **.STL** – impressão 3D / extensão STL do SketchUp.

Gravar **.SKP nativo** exige o SketchUp C SDK (só Windows/macOS). Fica como etapa futura (worker Windows).
**.STEP B-Rep paramétrico** (plano Avançado) também é etapa futura: malha de IA não é sólido paramétrico.

## Editar modelos do SketchUp (ida e volta)

1. SketchUp: **Arquivo → Exportar → Modelo 3D → COLLADA (.dae)** (com texturas: zip do .dae + pasta).
2. App: **⬆ Importar** → o backend converte para GLB preservando grupos/componentes, nomes, materiais, unidades e eixo Z.
3. Editar: toque numa peça (grupo/componente) → mover / girar / escalar, **Abrir** (entra no grupo; toque duplo também), duplicar, cor, apagar, renomear, desfazer. **☰ Peças** lista tudo.
4. **💾 Salvar** → o app exporta GLB, o backend gera nova versão em DAE/OBJ/STL.
5. **⇩ Exportar → SketchUp (.DAE)** → no SketchUp, **Arquivo → Importar**.

Não passam pelo Collada: cotas, textos, cenas, tags/camadas e atributos de componentes dinâmicos.
Rotas: `POST /api/import` (multipart, grátis, até 30 MB) e `POST /api/projects/:id/save` (GLB binário).

## Planos (fonte única: `backend/src/config.js`)

| Plano | Mensal | Créditos/mês | Projetos | Exporta | Texturas HD |
|---|---|---|---|---|---|
| Grátis | – | 10 no cadastro | 3 | PNG | – |
| Básico | R$ 29,90 | 50 | 20 | PNG, GLB, OBJ, DAE, STL | – |
| Médio | R$ 79,90 | 200 | ilimitado | idem | ✓ |
| Avançado | R$ 199,90 | 600 | ilimitado | idem + STEP (futuro) | ✓ |

Custo: 1 crédito (só malha) · 4 créditos (com texturas). Falha da IA = estorno automático.

## Rodar local

```bash
cd backend && cp .env.example .env   # preencher APPWRITE_API_KEY
npm install && node --env-file=.env src/server.js

cd frontend && cp .env.example .env.local   # VITE_API_URL=http://localhost:3000
npm install && npm run dev
```

## Deploy no Coolify

1. `node scripts/setup-appwrite.mjs` (com as variáveis `APPWRITE_*`).
2. **API**: app Dockerfile, base dir `/backend`, porta 3000, domínio `https://api3d.xpointsolucoes.com.br`, variáveis do `backend/.env.example`.
3. **App**: app Dockerfile, base dir `/frontend`, porta 80, domínio `https://3d.xpointsolucoes.com.br`, variáveis `VITE_*` marcadas como *Build Variable*.
4. Na sua API Pix, cadastrar webhook `https://api3d.xpointsolucoes.com.br/api/webhooks/pix` com header `X-Webhook-Secret`.

## Adaptar a API Pix

Editar `backend/src/providers/pix.js` → `httpProvider` (3 funções: `createCharge`, `getStatus`, `parseWebhook`).
