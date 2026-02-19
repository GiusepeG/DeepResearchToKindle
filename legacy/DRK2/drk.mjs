#!/usr/bin/env node

/**
 * Deep Research to Kindle v2 (DRK2)
 *
 * Melhorias sobre DRK1:
 *   - Seleção interativa de modelo (Flash / Thinking / Pro)
 *   - Envia resultado como anexo .md (preserva formatação)
 *   - Nome do arquivo = headline H1 da resposta
 *   - Feedback em tempo real com etapas numeradas
 *
 * Usage:
 *   node drk.mjs "Your research query"
 *   node drk.mjs --login-only
 */

import { chromium } from "playwright";
import { marked } from "marked";
import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { createInterface } from "readline";

// ─── Config ────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROFILE_DIR = resolve(homedir(), ".drk-profile");
const DOWNLOADS_DIR = resolve(homedir(), "Downloads");
const TEMPLATE_PATH = resolve(__dirname, "template.html");
const GEMINI_URL = "https://gemini.google.com/app";

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const MAX_POLL_TIME_MS = 15 * 60_000; // 15 minutes

const KINDLE_EMAIL = "gg_Ac98@kindle.com";
const GMAIL_COMPOSER_URL = `https://mail.google.com/mail/?view=cm&fs=1&to=${KINDLE_EMAIL}&su=Convert&body=Deep+Research+Report`;

const TOTAL_STEPS = 6;

// ─── Models ────────────────────────────────────────────────────────────────────

const MODELS = [
    { key: "1", label: "⚡ Rápido (Flash)", geminiName: "Rápido", testId: "bard-mode-option-rápido" },
    { key: "2", label: "🧠 Raciocínio (Thinking)", geminiName: "Raciocínio", testId: "bard-mode-option-raciocínio" },
    { key: "3", label: "🚀 Pro", geminiName: "Pro", testId: "bard-mode-option-pro" },
];

// ─── CLI Logging ───────────────────────────────────────────────────────────────

const SEPARATOR = "━".repeat(46);

function ts() {
    return new Date().toLocaleTimeString("pt-BR");
}

function log(msg) {
    console.log(`[DRK2 ${ts()}] ${msg}`);
}

function logStep(step, msg) {
    console.log(`[DRK2 ${ts()}] [${step}/${TOTAL_STEPS}] ${msg}`);
}

function logSub(msg) {
    console.log(`[DRK2 ${ts()}]        ${msg}`);
}

function logBanner() {
    console.log();
    log(SEPARATOR);
    log("📚 Deep Research to Kindle v2");
    log(SEPARATOR);
}

// ─── Interactive Model Prompt ──────────────────────────────────────────────────

function askModelChoice() {
    return new Promise((resolve) => {
        console.log();
        log("Escolha o modelo:");
        for (const m of MODELS) {
            console.log(`   ${m.key}. ${m.label}`);
        }
        console.log();

        const rl = createInterface({ input: process.stdin, output: process.stdout });
        rl.question(`[DRK2 ${ts()}] Modelo (1/2/3): `, (answer) => {
            rl.close();
            const choice = answer.trim();
            const model = MODELS.find((m) => m.key === choice);
            if (!model) {
                log("⚠️  Escolha inválida, usando Pro como padrão.");
                resolve(MODELS[2]); // default Pro
            } else {
                resolve(model);
            }
        });
    });
}

// ─── Utilities ─────────────────────────────────────────────────────────────────

function sanitizeFilename(text) {
    return text
        .replace(/[^\w\sÀ-ú-]/g, "")
        .replace(/\s+/g, "-")
        .substring(0, 100)
        .replace(/-+$/, "");
}

function buildHtml(title, markdownContent) {
    const template = readFileSync(TEMPLATE_PATH, "utf-8");
    const htmlContent = marked.parse(markdownContent);
    const date = new Date().toLocaleDateString("pt-BR", {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
    return template
        .replace(/\{\{TITLE\}\}/g, title)
        .replace("{{CONTENT}}", htmlContent)
        .replace("{{DATE}}", date);
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function readClipboard() {
    try {
        return execSync("pbpaste", { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
    } catch {
        return "";
    }
}

function extractHeadline(markdownContent) {
    // Try to find the first H1 heading in the content
    const match = markdownContent.match(/^#\s+(.+)$/m);
    if (match && match[1]) {
        return match[1].trim();
    }
    // Fallback: first non-empty line
    const lines = markdownContent.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length > 0) {
        return lines[0].replace(/^#+\s*/, "").trim();
    }
    return "Research-Report";
}

// ─── Browser Helpers ───────────────────────────────────────────────────────────

async function launchBrowser(profilePath = PROFILE_DIR) {
    logStep(1, "🚀 Lançando navegador...");
    logSub(`Perfil: ${profilePath}`);

    const context = await chromium.launchPersistentContext(profilePath, {
        headless: false,
        viewport: { width: 1280, height: 900 },
        args: ["--disable-blink-features=AutomationControlled"],
    });
    const page = context.pages()[0] || (await context.newPage());

    logSub("✅ Navegador pronto.");
    return { context, page };
}

async function navigateToGemini(page) {
    logStep(2, "🌐 Navegando para o Gemini...");
    await page.goto(GEMINI_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(3000);
    logSub("✅ Gemini carregado.");
}

// ─── Model Selection on Gemini UI ──────────────────────────────────────────────

async function selectModel(page, model) {
    logStep(3, `🔧 Selecionando modelo: ${model.geminiName}...`);

    try {
        // Step 1: Click the dropdown arrow icon to open the model menu
        const dropdownIcon = page.locator('mat-icon.dropdown-icon[fonticon="keyboard_arrow_down"]').first();
        await dropdownIcon.waitFor({ state: "visible", timeout: 10_000 });
        await dropdownIcon.click();
        await page.waitForTimeout(1500);
        logSub("Menu de modelos aberto.");

        // Step 2: Click the model option by its data-test-id
        const modelOption = page.locator(`button[data-test-id="${model.testId}"]`).first();
        await modelOption.waitFor({ state: "visible", timeout: 5_000 });
        await modelOption.click();
        await page.waitForTimeout(1000);

        logSub(`✅ Modelo ${model.geminiName} selecionado.`);
    } catch (err) {
        logSub(`⚠️  Erro ao selecionar modelo: ${err.message}`);
        logSub("Continuando com modelo padrão...");
    }
}

// ─── Deep Research Flow ────────────────────────────────────────────────────────

async function enableDeepResearch(page) {
    logSub("🔬 Ativando Deep Research...");

    // Click "Ferramentas" (Tools button)
    const toolsBtn = page.getByRole("button", { name: /Ferramentas/i });
    await toolsBtn.waitFor({ state: "visible", timeout: 10_000 });
    await toolsBtn.click();
    await page.waitForTimeout(1500);

    // Click "Deep Research" in the dropdown
    const drBtn = page.locator("text=/Deep Research/i");
    await drBtn.waitFor({ state: "visible", timeout: 5_000 });
    await drBtn.click();
    await page.waitForTimeout(2000);

    logSub("✅ Deep Research ativado.");
}

async function submitQuery(page, query) {
    logStep(4, `📝 Enviando query: "${query.substring(0, 60)}..."`);

    const input = page
        .locator('rich-textarea div[contenteditable="true"], textarea, div[role="textbox"]')
        .first();
    await input.waitFor({ state: "visible", timeout: 15_000 });

    await input.click();
    await input.fill(query);
    await page.waitForTimeout(1000);

    logSub("Pressionando Enter...");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);

    logSub("✅ Query enviada.");
}

async function confirmResearchStart(page) {
    logSub('🔍 Procurando botão "Iniciar investigação"...');

    const possibleButtons = [
        /Iniciar investigação/i,
        /Start investigation/i,
        /Iniciar pesquisa/i,
        /Start research/i,
        /Looks good/i,
        /Confirmar/i,
    ];

    const startTime = Date.now();
    const maxWait = 60_000;

    while (Date.now() - startTime < maxWait) {
        try {
            for (const label of possibleButtons) {
                const btn = page.getByRole("button", { name: label }).first();
                if (await btn.isVisible()) {
                    logSub(`Botão encontrado: "${label}"`);
                    await btn.click();
                    logSub("✅ Pesquisa iniciada (plano confirmado).");
                    await page.waitForTimeout(5000);
                    return;
                }
            }

            const looseBtn = page
                .locator('button:has-text("Iniciar"), button:has-text("Start")')
                .first();
            if (await looseBtn.isVisible()) {
                const text = await looseBtn.innerText();
                if (text.includes("investiga") || text.includes("pesquisa")) {
                    logSub(`Botão encontrado (loose): "${text}"`);
                    await looseBtn.click();
                    await page.waitForTimeout(5000);
                    return;
                }
            }
        } catch {
            // Ignore and keep polling
        }
        await page.waitForTimeout(2000);
    }

    logSub("⚠️  Nenhum botão de confirmação encontrado após 60s.");
}

async function pollForCompletion(page) {
    logSub("⏳ Aguardando conclusão da pesquisa...");
    const startTime = Date.now();

    // --- Phase 1: Wait for research to START ---
    logSub("Fase 1: Detectando início da pesquisa...");

    let researchStarted = false;
    const phase1Deadline = Date.now() + 120_000;

    while (Date.now() < phase1Deadline) {
        const chipStatus = await page
            .evaluate(() => {
                const chip = document.querySelector("deep-research-entry-chip-content");
                return chip ? chip.innerText.trim() : "";
            })
            .catch(() => "");

        if (chipStatus) {
            logSub(`Status detectado: "${chipStatus}"`);
            researchStarted = true;
            if (/Conclu[íi]do|Completed/i.test(chipStatus)) {
                logSub("✅ Pesquisa já concluída!");
                break;
            }
            break;
        }

        const indicators = page.locator("text=/Pesquisando|Researching|Analisando|Analyzing/i");
        if (await indicators.isVisible().catch(() => false)) {
            logSub("Atividade de pesquisa detectada.");
            researchStarted = true;
            break;
        }

        await sleep(5_000);
    }

    if (!researchStarted) {
        logSub("⚠️  Não detectou início. Continuando polling...");
    }

    // --- Phase 2: Wait for COMPLETION ---
    logSub("Fase 2: Aguardando conclusão...");
    const minWaitUntil = Date.now() + 60_000;

    while (Date.now() - startTime < MAX_POLL_TIME_MS) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);

        const chipStatus = await page
            .evaluate(() => {
                const chip = document.querySelector("deep-research-entry-chip-content");
                return chip ? chip.innerText.trim() : "";
            })
            .catch(() => "");

        if (/Conclu[íi]do|Completed/i.test(chipStatus)) {
            await sleep(5_000);
            logSub(`✅ Pesquisa concluída! Status: "${chipStatus}" (${elapsed}s)`);
            return true;
        }

        if (chipStatus && !/Conclu[íi]do|Completed/i.test(chipStatus)) {
            logSub(`⏳ Polling... (${elapsed}s) — Status: "${chipStatus}"`);
            await sleep(POLL_INTERVAL_MS);
            continue;
        }

        if (Date.now() < minWaitUntil) {
            logSub(`⏳ Polling... (${elapsed}s)`);
            await sleep(10_000);
            continue;
        }

        // Fallback: check report container
        const reportLength = await page
            .evaluate(() => {
                const container = document.querySelector('.container[scrollable="true"]');
                return container ? (container.innerText || "").trim().length : 0;
            })
            .catch(() => 0);

        if (reportLength > 500) {
            logSub(`✅ Pesquisa concluída! Relatório com ${reportLength} caracteres. (${elapsed}s)`);
            return true;
        }

        logSub(`⏳ Polling... (${elapsed}s)`);
        await sleep(POLL_INTERVAL_MS);
    }

    logSub("⚠️  Tempo máximo de polling atingido.");
    return false;
}

// ─── Content Extraction ────────────────────────────────────────────────────────

async function extractResponseContent(page) {
    logStep(5, "📄 Extraindo conteúdo da pesquisa...");

    // Scroll the report container to trigger lazy loading
    await page
        .evaluate(async () => {
            const container = document.querySelector('.container[scrollable="true"]');
            if (container) {
                const scrollStep = 1000;
                let scrollTop = 0;
                while (scrollTop < container.scrollHeight) {
                    scrollTop += scrollStep;
                    container.scrollTop = scrollTop;
                    await new Promise((r) => setTimeout(r, 200));
                }
                container.scrollTop = 0;
            }
        })
        .catch(() => { });

    await page.waitForTimeout(2000);

    const content = await page.evaluate(() => {
        // Strategy 1: Immersive report container
        const reportContainer = document.querySelector('.container[scrollable="true"]');
        if (reportContainer) {
            const text = reportContainer.innerText;
            if (text && text.trim().length > 200) {
                return text.trim();
            }
        }

        // Strategy 2: Model response containers
        const responseSelectors = [
            "model-response .markdown",
            "model-response message-content",
            "message-content .markdown",
            '[data-message-author-role="model"] .markdown',
        ];

        for (const sel of responseSelectors) {
            const elements = document.querySelectorAll(sel);
            if (elements.length > 0) {
                const lastEl = elements[elements.length - 1];
                if (lastEl.innerText && lastEl.innerText.trim().length > 200) {
                    return lastEl.innerText.trim();
                }
            }
        }

        // Strategy 3: Longest text
        const candidates = document.querySelectorAll(
            'message-content, .message-content, [class*="response"], .markdown'
        );
        let longestText = "";
        for (const el of candidates) {
            const text = (el.innerText || "").trim();
            if (text.length > longestText.length) {
                longestText = text;
            }
        }
        if (longestText.length > 200) return longestText;

        // Strategy 4: main area
        const mainArea = document.querySelector('main, [role="main"]');
        if (mainArea) return mainArea.innerText.trim();

        return "";
    });

    if (!content || content.trim().length < 200) {
        logSub(`DOM extraction insuficiente (${(content || "").length} chars), tentando clipboard...`);
        return await copyViaClipboard(page);
    }

    logSub(`✅ Extraídos ${content.length} caracteres.`);
    return content;
}

async function copyViaClipboard(page) {
    logSub("Tentando cópia via clipboard...");

    const copySelectors = [
        'button[aria-label*="copi"]',
        'button[data-tooltip*="Copiar"]',
        'button[data-tooltip*="Copy"]',
        'button[mattooltip*="Copiar"]',
        'button[mattooltip*="Copy"]',
    ];

    for (const selector of copySelectors) {
        try {
            const btns = page.locator(selector);
            const count = await btns.count();
            if (count > 0) {
                await btns.last().click();
                await page.waitForTimeout(2000);
                const clipboard = readClipboard();
                if (clipboard.trim().length > 100) {
                    logSub(`✅ Clipboard: ${clipboard.length} caracteres.`);
                    return clipboard;
                }
            }
        } catch {
            continue;
        }
    }

    throw new Error("Não foi possível extrair o conteúdo. Tente copiar manualmente.");
}

// ─── Save & Send ───────────────────────────────────────────────────────────────

function saveHtmlFile(query, markdownContent) {
    // Extract headline from content for filename
    const headline = extractHeadline(markdownContent);
    const filename = `${sanitizeFilename(headline)}.html`;
    const filepath = resolve(DOWNLOADS_DIR, filename);

    // Convert markdown to HTML for Kindle compatibility
    const html = buildHtml(headline, markdownContent);
    writeFileSync(filepath, html, "utf-8");

    logSub(`Headline: "${headline}"`);
    logSub(`Arquivo salvo: ${filepath}`);
    return { filepath, headline };
}

async function sendViaGmailWeb(page, mdFilePath) {
    logStep(6, `📧 Enviando e-mail para ${KINDLE_EMAIL}...`);

    logSub("Abrindo Gmail Composer...");
    await page.goto(GMAIL_COMPOSER_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // Wait for Compose window
    logSub("Aguardando compositor...");
    const sendBtn = page
        .locator(
            'div[role="button"][aria-label*="Enviar"], div[role="button"][aria-label*="Send"]'
        )
        .first();
    try {
        await sendBtn.waitFor({ state: "visible", timeout: 20_000 });
    } catch {
        await page.locator('input[name="subjectbox"]').waitFor({ state: "visible", timeout: 10_000 });
    }
    logSub("✅ Gmail Composer pronto.");

    // Attach file
    logSub("Anexando arquivo .md...");
    const attachBtn = page
        .locator(
            'div[command="Files"], div[aria-label="Anexar arquivos"], div[aria-label="Attach files"]'
        )
        .first();
    await attachBtn.waitFor({ state: "visible", timeout: 10_000 });

    const [fileChooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 15_000 }),
        attachBtn.click(),
    ]);
    await fileChooser.setFiles(mdFilePath);
    logSub("✅ Arquivo selecionado.");

    // Wait for upload
    logSub("Aguardando upload...");
    await page.waitForTimeout(5000);

    const fileName = mdFilePath.split("/").pop();
    const attachmentIndicator = page.locator(`div[aria-label*="${fileName}"]`);
    if ((await attachmentIndicator.count()) > 0) {
        logSub("✅ Anexo verificado.");
    }

    // Send
    logSub("Enviando e-mail...");
    await page.keyboard.press("Meta+Enter");
    await page.waitForTimeout(1000);

    try {
        await page
            .locator("text=/Mensagem enviada|Message sent/i")
            .waitFor({ state: "visible", timeout: 10_000 });
        logSub("✅ E-mail enviado com sucesso!");
    } catch {
        logSub("⚠️  Confirmação não detectada, mas comando executado.");
    }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);

    // Parse --profile
    let profilePath = undefined;
    const profileIndex = args.indexOf("--profile");
    if (profileIndex !== -1 && args[profileIndex + 1]) {
        profilePath = resolve(process.cwd(), args[profileIndex + 1]);
        args.splice(profileIndex, 2);
    }

    const loginOnly = args.includes("--login-only");
    const kindleOnly = args.includes("--kindle-only");
    const skipKindle = args.includes("--no-kindle");
    const query = args.filter((a) => !a.startsWith("--")).join(" ");

    // --- Help ---
    if (!loginOnly && !kindleOnly && !query) {
        console.log(`
📚 Deep Research to Kindle v2 (DRK2)

Uso:
  node drk.mjs "Sua query de pesquisa"        Fluxo completo de automação
  node drk.mjs --login-only                   Abrir browser para login (setup inicial)
  node drk.mjs --kindle-only <caminho>        Enviar um .md existente via Gmail
  node drk.mjs --profile <caminho>            Usar perfil de browser customizado

Opções:
  --login-only    Apenas abrir o browser para login manual (Google)
  --no-kindle     Pular o envio por e-mail (apenas gerar o .md)
  --kindle-only   Pular pesquisa, apenas enviar arquivo via Gmail
  --profile       Caminho para um diretório de perfil customizado

Novidades do DRK2:
  ✨ Seleção interativa de modelo (Flash / Thinking / Pro)
  📎 Envia como anexo .md (preserva formatação Markdown)
  📝 Nome do arquivo = headline H1 da resposta
  📊 Feedback em tempo real na CLI

Exemplos:
  node drk.mjs "Quais os avanços recentes em edição genética CRISPR?"
  node drk.mjs --login-only
  node drk.mjs --kindle-only ~/Downloads/Meu-Relatorio.md

Destino Kindle: ${KINDLE_EMAIL}
`);
        process.exit(0);
    }

    logBanner();

    // --- Login-only mode ---
    if (loginOnly) {
        const { context, page } = await launchBrowser(profilePath);
        log("🔑 Modo login — browser aberto.");
        logSub(`Perfil: ${profilePath || PROFILE_DIR}`);
        logSub("Faça login no Gmail (giusepegraciolli@gmail.com) e Gemini.");
        logSub("Pressione Ctrl+C quando terminar.");
        await navigateToGemini(page);
        await new Promise(() => { });
    }

    // --- Kindle-only mode ---
    if (kindleOnly) {
        const filePath = query || resolve(DOWNLOADS_DIR, "Research-Report.md");
        if (!existsSync(filePath)) {
            log(`❌ Arquivo não encontrado: ${filePath}`);
            process.exit(1);
        }
        logStep(1, `📧 Modo kindle-only: enviando ${filePath}`);
        const { context, page } = await launchBrowser(profilePath);
        await sendViaGmailWeb(page, filePath);
        log("🎉 Concluído!");
        log(SEPARATOR);
        await context.close();
        return;
    }

    // --- Interactive model selection ---
    const model = await askModelChoice();
    log(`Modelo escolhido: ${model.label}`);
    console.log();

    // --- Full automation flow ---
    const { context, page } = await launchBrowser(profilePath);

    try {
        await navigateToGemini(page);
        await selectModel(page, model);
        await enableDeepResearch(page);
        await submitQuery(page, query);
        await confirmResearchStart(page);
        await pollForCompletion(page);

        // Extract content
        const researchContent = await extractResponseContent(page);
        if (!researchContent || researchContent.trim().length < 100) {
            throw new Error("Não foi possível extrair conteúdo. Tente copiar manualmente do browser.");
        }
        logSub(`Total: ${researchContent.length} caracteres.`);

        // Save as .md with headline-based filename
        const { filepath: htmlFilePath, headline } = saveHtmlFile(query, researchContent);

        if (!skipKindle) {
            await sendViaGmailWeb(page, htmlFilePath);
        } else {
            logStep(6, "⏭️  Envio por e-mail pulado (--no-kindle).");
        }

        console.log();
        log(SEPARATOR);
        log("🎉 Concluído!");
        log(`   Arquivo: ${htmlFilePath}`);
        log(`   Headline: "${headline}"`);
        if (!skipKindle) {
            log(`   Enviado para: ${KINDLE_EMAIL}`);
        }
        log(SEPARATOR);
    } catch (err) {
        log(`❌ Erro: ${err.message}`);
        console.error(err);
        process.exit(1);
    } finally {
        await context.close();
    }
}

main();
