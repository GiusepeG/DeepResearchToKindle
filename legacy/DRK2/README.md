# Deep Research to Kindle v2 (DRK2)

Versão aprimorada do DRK com melhorias na experiência do usuário.

## ✨ Novidades

| Feature | Descrição |
|:---|:---|
| **Seleção de Modelo** | Menu interativo: Flash (rápido), Thinking (raciocínio), Pro |
| **Envio como .md** | Preserva a formatação Markdown original do Gemini |
| **Nome automático** | Arquivo nomeado com o headline (H1) da resposta |
| **CLI em tempo real** | Etapas numeradas com ícones e status de polling |

## 🚀 Setup

```bash
cd DRK2
npm install
npx playwright install chromium
```

### Login (primeira vez)
```bash
node drk.mjs --login-only
```

## 📖 Uso

```bash
node drk.mjs "Sua pergunta de pesquisa"
```

O script vai:
1. Perguntar qual modelo usar (Flash / Thinking / Pro)
2. Navegar até o Gemini e ativar Deep Research
3. Enviar a query e aguardar (com polling em tempo real)
4. Extrair o conteúdo e salvar como `.md`
5. Enviar o `.md` como anexo via Gmail para o Kindle

### Opções

| Comando | Descrição |
|:---|:---|
| `--login-only` | Abrir browser para login manual |
| `--no-kindle` | Gerar .md sem enviar e-mail |
| `--kindle-only <path>` | Enviar um .md existente |
| `--profile <path>` | Perfil de browser customizado |

## 📧 Destino

- Kindle: `gg_Ac98@kindle.com`
- Gmail: `giusepegraciolli@gmail.com`
