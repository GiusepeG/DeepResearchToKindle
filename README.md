# 📚 Deep Research to Kindle (DRK)

Automatiza pesquisas com Gemini Deep Research e envia diretamente ao Kindle como EPUB.

**Fluxo:** Gemini → Google Docs → EPUB → Amazon Send to Kindle

## ✨ Por que EPUB?

O EPUB é formato nativo do Kindle — preserva headings, listas, tabelas e formatação rica sem conversão manual. O DRK utiliza o pipeline nativo do Gemini: exporta diretamente para Google Docs e baixa como EPUB.

## 🚀 Início Rápido

### Pré-requisitos

- [Node.js](https://nodejs.org/) ≥ 18
- Conta Google (Gemini + Google Docs)
- Conta Amazon (Send to Kindle)

### Instalação

```bash
git clone https://github.com/GiusepeG/DeepResearchToKindle.git
cd DeepResearchToKindle
npm install
npx playwright install chromium
```

### Primeiro uso — Login

```bash
node drk.mjs --login-only
```

Faça login nas seguintes contas no navegador:
1. **Google** (Gemini + Docs)
2. **Amazon** (Send to Kindle)

Pressione `Ctrl+C` quando terminar. As sessões ficam salvas em `~/.drk-profile`.

## 📖 Uso

### Pesquisa completa (padrão: modelo Raciocínio)

```bash
node drk.mjs "Quais os avanços recentes em edição genética CRISPR?"
```

### Escolher modelo via CLI

```bash
node drk.mjs --model flash "Resumo da arquitetura medieval"
node drk.mjs --model pro "Análise geopolítica do Oriente Médio"
```

### Exportar pesquisa existente

```bash
node drk.mjs --send-only https://gemini.google.com/app/1de4d1cd9d823b42
```

### Apenas baixar EPUB (sem enviar ao Kindle)

```bash
node drk.mjs --no-kindle "Sua pesquisa aqui"
```

## ⚙️ Opções

| Flag               | Descrição                                         |
|--------------------|---------------------------------------------------|
| `--model <nome>`   | Modelo: `flash`, `thinking` (padrão), `pro`       |
| `--send-only <url>`| Exportar pesquisa Gemini existente para Kindle     |
| `--no-kindle`      | Baixar EPUB sem enviar ao Kindle                  |
| `--login-only`     | Abrir browser para login manual                    |
| `--profile <path>` | Perfil de browser customizado                      |

## 🧠 Modelos Disponíveis

| Alias              | Modelo                     |
|--------------------|----------------------------|
| `flash` / `rapido` | ⚡ Rápido (Flash)          |
| `thinking` / `raciocinio` | 🧠 Raciocínio (Thinking) — **PADRÃO** |
| `pro`              | 🚀 Pro                    |

## 📂 Estrutura

```
DeepResearchToKindle/
├── drk.mjs           ← Script principal
├── package.json
├── .gitignore
├── README.md
└── legacy/           ← Versões anteriores (DRK1, DRK2)
    ├── DRK1/
    ├── DRK2/
    ├── drk-v1.mjs
    ├── template.html
    └── SKILL.md
```

## 🔧 Como Funciona

```
1. 🚀 Lança navegador com perfil persistente
2. 🌐 Navega para o Gemini
3. 🔧 Seleciona o modelo (padrão: Raciocínio)
4. 📝 Envia query + ativa Deep Research
5. 📤 Exporta para Google Docs
6. 📥 Baixa EPUB do Google Docs
7. 📧 Faz upload no Amazon Send to Kindle
```

## 📜 Licença

MIT
