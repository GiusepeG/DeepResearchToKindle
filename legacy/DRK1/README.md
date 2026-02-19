# Deep Research to Kindle (DRK)

Este projeto automatiza o envio de pesquisas profundas do Google Gemini ("Deep Research") diretamente para o seu Kindle via e-mail.

O script executa todo o fluxo:
1. Abre o navegador controlado.
2. Acessa o Google Gemini e ativa o modo "Deep Research".
3. Envia sua pergunta e aguarda a conclusão da pesquisa.
4. Extrai o relatório completo.
5. Converte o relatório para um arquivo HTML formatado.
6. Envia este arquivo automaticamente para o seu e-mail Kindle (`gg_Ac98@kindle.com`) usando o Gmail.

## 📋 Pré-requisitos

- **Node.js**: Versão 18 ou superior.
- **Conta Google**: Acesso ao Google Gemini e Gmail.

## 🚀 Instalação

1. **Clone ou baixe este repositório** para uma pasta local.

2. **Instale as dependências**:
   No terminal, dentro da pasta do projeto, execute:
   ```bash
   npm install
   ```

3. **Instale os navegadores do Playwright** (necessário apenas na primeira vez):
   ```bash
   npx playwright install chromium
   ```

## ⚙️ Configuração Inicial (Login)

Antes de usar a automação, você precisa fazer login nas suas contas (Google Gemini e Gmail) para que o script possa salvar sua sessão.

1. Execute o modo de login:
   ```bash
   node drk.mjs --login-only
   ```
2. Uma janela do navegador será aberta.
3. Faça login no **Google** (Gemini) e no **Gmail**.
4. Após logar, você pode fechar o navegador ou pressionar `Ctrl+C` no terminal.
   *Sua sessão ficará salva na pasta `.drk-profile` no seu diretório de usuário.*

## 📖 Como Usar

### 1. Fazer uma Pesquisa Completa
Para iniciar uma nova pesquisa e enviá-la para o Kindle:

```bash
node drk.mjs "Qual a história da Revolução Francesa e seus principais impactos?"
```
*O script fará todo o processo automaticamente.*

### 2. Apenas Enviar um Arquivo Existente
Se você já tem um arquivo HTML e quer enviá-lo para o Kindle sem fazer uma nova pesquisa:

```bash
node drk.mjs --kindle-only "/caminho/para/seu/arquivo.html"
```

### 3. Opções Adicionais

| Comando | Descrição |
| :--- | :--- |
| `--login-only` | Abre o navegador apenas para login manual. |
| `--no-kindle` | Faz a pesquisa e salva o HTML, mas **não envia** o e-mail. |
| `--profile <caminho>` | Usa uma pasta de perfil de navegador personalizada. |
| `--help` | Exibe a ajuda no terminal. |

## 📁 Estrutura de Arquivos

- **drk.mjs**: O script principal da automação.
- **template.html**: Modelo usado para gerar o arquivo HTML final (pode ser customizado).
- **.drk-profile/**: Pasta onde os dados da sessão do navegador (cookies, login) são salvos (criada automaticamente).

## ⚠️ Notas Importantes

- **E-mail de Destino**: O script está configurado para enviar para `gg_Ac98@kindle.com`. Para alterar, edite a constante `KINDLE_URL` ou a URL do Gmail dentro do arquivo `drk.mjs`.
- **Autenticação**: O script depende de você estar logado. Se a sessão expirar, rode `node drk.mjs --login-only` novamente.
