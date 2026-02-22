#!/usr/bin/env node

/**
 * Deep Research to Kindle (DRK)
 *
 * Fluxo:
 *   Gemini Deep Research → Google Docs → EPUB → Send to Kindle
 *
 * Usage:
 *   node drk.mjs "Your research query"
 *   node drk.mjs --model flash "query"       Usar modelo Flash
 *   node drk.mjs --send-only <gemini-url>    Exportar pesquisa existente
 *   node drk.mjs --login-only                Abrir browser para login
 */

import { chromium } from "playwright";
import { existsSync, readdirSync, statSync } from "fs";
import { resolve, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

// ─── Config ────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROFILE_DIR = resolve(homedir(), ".drk-profile");
const DOWNLOADS_DIR = resolve(homedir(), "Downloads");
const GEMINI_URL = "https://gemini.google.com/app";
const SEND_TO_KINDLE_URL = "https://www.amazon.com.br/sendtokindle";

const POLL_INTERVAL_MS = 30_000;
const MAX_POLL_TIME_MS = 15 * 60_000;

const TOTAL_STEPS = 7;

// ─── Models ────────────────────────────────────────────────────────────────────

const MODELS = [
    { key: "1", label: "⚡ Rápido (Flash)", geminiName: "Rápido", testId: "bard-mode-option-rápido" },
    { key: "2", label: "🧠 Raciocínio (Thinking)", geminiName: "Raciocínio", testId: "bard-mode-option-raciocínio" },
    { key: "3", label: "🚀 Pro", geminiName: "Pro", testId: "bard-mode-option-pro" },
];

// ─── CLI Logging ───────────────────────────────────────────────────────────────

const SEPARATOR = "━".repeat(50);

function ts() {
    return new Date().toLocaleTimeString("pt-BR");
}

function log(msg) {
    console.log(`[DRK ${ts()}] ${msg}`);
}

function logStep(step, msg) {
    console.log(`[DRK ${ts()}] [${step}/${TOTAL_STEPS}] ${msg}`);
}

function logSub(msg) {
    console.log(`[DRK ${ts()}]        ${msg}`);
}

function logBanner() {
    console.log();
    log(SEPARATOR);
    log("📚 Deep Research to Kindle");
    log("   Gemini → Google Docs → EPUB → Kindle");
    log(SEPARATOR);
}

// ─── Model Resolution ──────────────────────────────────────────────────────────

const DEFAULT_MODEL = MODELS[1]; // Raciocínio (Thinking) is the default

function resolveModel(modelArg) {
    if (!modelArg) return DEFAULT_MODEL;
    const lower = modelArg.toLowerCase();
    // Match by key, name, or alias
    const aliases = {
        "1": MODELS[0], "flash": MODELS[0], "rapido": MODELS[0], "rápido": MODELS[0],
        "2": MODELS[1], "thinking": MODELS[1], "raciocinio": MODELS[1], "raciocínio": MODELS[1],
        "3": MODELS[2], "pro": MODELS[2],
    };
    return aliases[lower] || DEFAULT_MODEL;
}

// ─── Utilities ─────────────────────────────────────────────────────────────────

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * Find the most recent .epub file in Downloads that appeared after `afterTime`.
 */
function findRecentEpub(afterTime) {
    try {
        const files = readdirSync(DOWNLOADS_DIR)
            .filter((f) => extname(f).toLowerCase() === ".epub")
            .map((f) => {
                const fullPath = resolve(DOWNLOADS_DIR, f);
                const stat = statSync(fullPath);
                return { path: fullPath, name: f, mtime: stat.mtimeMs };
            })
            .filter((f) => f.mtime > afterTime)
            .sort((a, b) => b.mtime - a.mtime);

        return files.length > 0 ? files[0] : null;
    } catch {
        return null;
    }
}

// ─── Browser Helpers ───────────────────────────────────────────────────────────

async function launchBrowser(profilePath = PROFILE_DIR) {
    logStep(1, "🚀 Lançando navegador...");
    logSub(`Perfil: ${profilePath}`);

    const context = await chromium.launchPersistentContext(profilePath, {
        headless: false,
        viewport: { width: 1280, height: 900 },
        args: ["--disable-blink-features=AutomationControlled"],
        acceptDownloads: true,
    });
    const page = context.pages()[0] || (await context.newPage());

    logSub("✅ Navegador pronto.");
    return { context, page };
}

async function navigateToGemini(page, url = GEMINI_URL) {
    logStep(2, "🌐 Navegando para o Gemini...");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(3000);
    logSub("✅ Gemini carregado.");
}

// ─── Model Selection ───────────────────────────────────────────────────────────

async function selectModel(page, model) {
    logStep(3, `🔧 Selecionando modelo: ${model.geminiName}...`);

    try {
        const dropdownIcon = page.locator('mat-icon.dropdown-icon[fonticon="keyboard_arrow_down"]').first();
        await dropdownIcon.waitFor({ state: "visible", timeout: 10_000 });
        await dropdownIcon.click();
        await page.waitForTimeout(1500);
        logSub("Menu de modelos aberto.");

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
    try {
        const toolsBtn = page.getByRole("button", { name: /Ferramentas/i });
        await toolsBtn.waitFor({ state: "visible", timeout: 10_000 });
        await toolsBtn.click();
        await page.waitForTimeout(1500);

        const drBtn = page.locator("text=/Deep Research/i");
        await drBtn.waitFor({ state: "visible", timeout: 5_000 });
        await drBtn.click();
        await page.waitForTimeout(2000);
        logSub("✅ Deep Research ativado.");
    } catch (err) {
        logSub("⚠️ Botão de Deep Research não encontrado. Continuando pesquisa normal...");
    }
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

    // Phase 1: Detect start
    logSub("Fase 1: Detectando início da pesquisa...");
    let researchStarted = false;
    const phase1Deadline = Date.now() + 120_000;

    while (Date.now() < phase1Deadline) {
        const chipStatus = await page.evaluate(() => {
            const chip = document.querySelector("deep-research-entry-chip-content");
            return chip ? chip.innerText.trim() : "";
        }).catch(() => "");

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

    // Phase 2: Wait for completion
    logSub("Fase 2: Aguardando conclusão...");
    const minWaitUntil = Date.now() + 60_000;

    while (Date.now() - startTime < MAX_POLL_TIME_MS) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);

        const chipStatus = await page.evaluate(() => {
            const chip = document.querySelector("deep-research-entry-chip-content");
            return chip ? chip.innerText.trim() : "";
        }).catch(() => "");

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

        const reportLength = await page.evaluate(() => {
            const container = document.querySelector('.container[scrollable="true"]');
            return container ? (container.innerText || "").trim().length : 0;
        }).catch(() => 0);

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

// ─── Export to Google Docs ─────────────────────────────────────────────────────

async function exportToGoogleDocs(page) {
    logStep(5, "📤 Exportando para o Google Docs...");

    // Click "Compartilhar e exportar" button
    logSub('Clicando "Compartilhar e exportar"...');
    const exportBtn = page.locator('button[data-test-id="export-menu-button"]').first();
    await exportBtn.waitFor({ state: "visible", timeout: 10_000 });
    await exportBtn.click();
    await page.waitForTimeout(1500);
    logSub("✅ Menu aberto.");

    // Click "Exportar para o Google Docs"
    logSub('Clicando "Exportar para o Google Docs"...');
    const docsBtn = page.locator('button[data-test-id="export-to-docs-button"]').first();
    await docsBtn.waitFor({ state: "visible", timeout: 5_000 });
    await docsBtn.click();
    logSub("✅ Exportação iniciada.");

    // Wait for Google Docs to open in a new tab
    logSub("Aguardando Google Docs abrir...");

    // The export creates a Google Doc and may show a toast/notification with a link,
    // or open a new tab. We wait for a new page to appear.
    let docsPage = null;
    const maxWait = 30_000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
        const pages = page.context().pages();
        for (const p of pages) {
            const url = p.url();
            if (url.includes("docs.google.com/document")) {
                docsPage = p;
                break;
            }
        }
        if (docsPage) break;

        // Also check for a toast notification with a link to the Doc
        try {
            const docsLink = page.locator('a[href*="docs.google.com/document"]').first();
            if (await docsLink.isVisible({ timeout: 1000 }).catch(() => false)) {
                const href = await docsLink.getAttribute("href");
                logSub(`Link encontrado: ${href}`);
                // Open in same tab context
                docsPage = await page.context().newPage();
                await docsPage.goto(href, { waitUntil: "domcontentloaded", timeout: 30_000 });
                break;
            }
        } catch {
            // ignore
        }

        await sleep(2000);
    }

    if (!docsPage) {
        // Fallback: check for snackbar/toast with "Abrir documento"
        logSub('Procurando botão "Abrir documento" no toast...');
        try {
            const openDocBtn = page.locator('text=/Abrir documento|Open document|Abrir no Docs|Open in Docs/i').first();
            await openDocBtn.waitFor({ state: "visible", timeout: 10_000 });

            // Get the link or click to open new tab
            const [newPage] = await Promise.all([
                page.context().waitForEvent("page", { timeout: 15_000 }),
                openDocBtn.click(),
            ]);
            docsPage = newPage;
        } catch (err) {
            throw new Error(`Google Docs não abriu após exportação: ${err.message}`);
        }
    }

    await docsPage.waitForLoadState("domcontentloaded");
    await docsPage.waitForTimeout(3000);
    logSub(`✅ Google Docs aberto: ${docsPage.url().substring(0, 60)}...`);

    return docsPage;
}

// ─── Download EPUB from Google Docs ────────────────────────────────────────────

async function downloadEpubFromDocs(docsPage) {
    logStep(6, "📥 Baixando EPUB do Google Docs...");

    // Click File menu (Arquivo)
    logSub('Abrindo menu "Arquivo"...');
    const fileMenu = docsPage.locator('#docs-file-menu').first();
    await fileMenu.waitFor({ state: "visible", timeout: 10_000 });
    await fileMenu.click();
    await docsPage.waitForTimeout(1500);
    logSub("✅ Menu Arquivo aberto.");

    // Click "Download" / "Baixar" / "Fazer download" submenu
    logSub('Clicando "Baixar"...');

    // Google Docs uses specific menu item IDs — try multiple approaches
    let downloadClicked = false;
    const downloadSelectors = [
        ':scope [id*="download"]',
        ':scope .goog-menuitem:has-text("download")',
    ];

    // First try: look for menu item by ID
    for (const sel of downloadSelectors) {
        try {
            const item = docsPage.locator(sel).first();
            if (await item.isVisible({ timeout: 2_000 }).catch(() => false)) {
                await item.click();
                downloadClicked = true;
                break;
            }
        } catch {
            // try next
        }
    }

    // Second try: look for text-based match
    if (!downloadClicked) {
        const downloadItem = docsPage.getByText(/Fazer download|Baixar|Download/i).first();
        await downloadItem.waitFor({ state: "visible", timeout: 5_000 });
        await downloadItem.click();
        downloadClicked = true;
    }

    await docsPage.waitForTimeout(1500);
    logSub("✅ Submenu download aberto.");

    // Click EPUB option
    logSub('Selecionando EPUB...');
    const epubOption = docsPage.getByText(/EPUB/i).first();
    await epubOption.waitFor({ state: "visible", timeout: 5_000 });

    // Wait for download event
    const downloadPromise = docsPage.waitForEvent("download", { timeout: 30_000 });
    await epubOption.click();

    logSub("Aguardando download...");
    const download = await downloadPromise;

    // Save to Downloads
    const suggestedName = download.suggestedFilename();
    const savePath = resolve(DOWNLOADS_DIR, suggestedName);
    await download.saveAs(savePath);

    logSub(`✅ EPUB baixado: ${suggestedName}`);
    logSub(`   Caminho: ${savePath}`);

    return savePath;
}

// ─── Send to Kindle ────────────────────────────────────────────────────────────

async function sendToKindle(page, epubPath) {
    logStep(7, "📧 Enviando EPUB para o Kindle...");

    // Navigate to Send to Kindle
    logSub(`Navegando para ${SEND_TO_KINDLE_URL}...`);
    await page.goto(SEND_TO_KINDLE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(3000);
    logSub("✅ Página carregada.");

    // Upload file using the "Select files from device" button
    logSub("Fazendo upload do EPUB...");

    // The button triggers a file chooser
    const uploadBtn = page.locator('#s2k-dnd-add-your-files-button, button:has-text("Selecionar arquivos"), button:has-text("Select files")').first();
    await uploadBtn.waitFor({ state: "visible", timeout: 10_000 });

    const [fileChooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 15_000 }),
        uploadBtn.click(),
    ]);
    await fileChooser.setFiles(epubPath);
    logSub("✅ Arquivo selecionado.");

    // Wait for the file to be processed/uploaded
    logSub("Aguardando processamento...");
    await page.waitForTimeout(5000);

    // Click Send button
    logSub('Clicando "Enviar"...');
    const sendBtn = page.locator('#s2k-r2s-send-button, button:has-text("Enviar"), button:has-text("Send")').first();
    await sendBtn.waitFor({ state: "visible", timeout: 15_000 });
    await sendBtn.click();

    logSub("Aguardando confirmação...");
    await page.waitForTimeout(5000);

    // Check for success
    try {
        const success = page.locator('text=/enviado|sent|sucesso|success|entregue|delivered/i').first();
        await success.waitFor({ state: "visible", timeout: 15_000 });
        logSub("✅ EPUB enviado ao Kindle com sucesso!");
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

    // Parse --model
    let modelArg = undefined;
    const modelIndex = args.indexOf("--model");
    if (modelIndex !== -1 && args[modelIndex + 1]) {
        modelArg = args[modelIndex + 1];
        args.splice(modelIndex, 2);
    }

    const loginOnly = args.includes("--login-only");
    const sendOnly = args.includes("--send-only");
    const skipKindle = args.includes("--no-kindle");
    const query = args.filter((a) => !a.startsWith("--")).join(" ");

    // --- Help ---
    if (!loginOnly && !sendOnly && !query) {
        console.log(`
📚 Deep Research to Kindle (DRK)

Fluxo: Gemini → Google Docs → EPUB → Send to Kindle

Uso:
  node drk.mjs "Sua query de pesquisa"            Pesquisa completa (modelo: Raciocínio)
  node drk.mjs --model flash "query"               Usar modelo Flash
  node drk.mjs --model pro "query"                 Usar modelo Pro
  node drk.mjs --send-only <gemini-url>            Exportar pesquisa existente para Kindle
  node drk.mjs --login-only                        Abrir browser para login

Modelos:
  flash | rapido     ⚡ Rápido (Flash)
  thinking | raciocinio   🧠 Raciocínio (Thinking) [PADRÃO]
  pro                🚀 Pro

Opções:
  --model <nome>    Escolher modelo (padrão: raciocínio)
  --login-only      Apenas login manual (Google + Amazon)
  --no-kindle       Exportar e baixar EPUB, sem enviar ao Kindle
  --send-only       Abrir pesquisa existente e enviar (pula a pesquisa)
  --profile         Caminho para perfil customizado

Exemplos:
  node drk.mjs "Quais os avanços recentes em edição genética CRISPR?"
  node drk.mjs --model pro "História da arquitetura medieval"
  node drk.mjs --send-only https://gemini.google.com/app/1de4d1cd9d823b42
`);
        process.exit(0);
    }

    logBanner();

    // --- Login-only ---
    if (loginOnly) {
        const { context, page } = await launchBrowser(profilePath);
        log("🔑 Modo login — browser aberto.");
        logSub(`Perfil: ${profilePath || PROFILE_DIR}`);
        logSub("Faça login no Google (Gemini, Docs, Gmail), Amazon e Claude.");
        logSub("Pressione Ctrl+C quando terminar.");
        await navigateToGemini(page);

        const kindlePage = await context.newPage();
        await kindlePage.goto(SEND_TO_KINDLE_URL, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => { });

        const claudePage = await context.newPage();
        await claudePage.goto("https://claude.ai", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => { });

        await new Promise(() => { });
    }

    // --- Send-only mode (existing research) ---
    if (sendOnly) {
        const geminiUrl = query;
        if (!geminiUrl || !geminiUrl.includes("gemini.google.com")) {
            log("❌ Forneça a URL de uma pesquisa Gemini existente.");
            process.exit(1);
        }

        const { context, page } = await launchBrowser(profilePath);
        try {
            logStep(2, "🌐 Navegando para a pesquisa existente...");
            logSub(`URL: ${geminiUrl}`);
            await page.goto(geminiUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
            await page.waitForTimeout(5000);
            logSub("✅ Página carregada.");

            const docsPage = await exportToGoogleDocs(page);
            const epubPath = await downloadEpubFromDocs(docsPage);

            // Close the Docs tab
            await docsPage.close();

            if (!skipKindle) {
                await sendToKindle(page, epubPath);
            } else {
                log("⏭️  Envio ao Kindle pulado (--no-kindle).");
            }

            console.log();
            log(SEPARATOR);
            log("🎉 Concluído!");
            log(`   EPUB: ${epubPath}`);
            log(SEPARATOR);
        } catch (err) {
            log(`❌ Erro: ${err.message}`);
            console.error(err);
            process.exit(1);
        } finally {
            await context.close();
        }
        return;
    }

    // --- Model selection (default: Raciocínio, override with --model) ---
    const model = resolveModel(modelArg);
    log(`Modelo: ${model.label}`);
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

        // Export to Google Docs
        const docsPage = await exportToGoogleDocs(page);

        // Download EPUB
        const epubPath = await downloadEpubFromDocs(docsPage);

        // Close the Docs tab
        await docsPage.close();

        // Send to Kindle
        if (!skipKindle) {
            await sendToKindle(page, epubPath);
        } else {
            logStep(7, "⏭️  Envio ao Kindle pulado (--no-kindle).");
        }

        console.log();
        log(SEPARATOR);
        log("🎉 Concluído!");
        log(`   EPUB: ${epubPath}`);
        if (!skipKindle) {
            log("   Enviado ao Kindle via Send to Kindle.");
        }
        log(SEPARATOR);
    } catch (err) {
        log(`❌ Erro: ${err.message}`);
        if (typeof page !== 'undefined' && page) {
            try { await page.screenshot({ path: 'error.png' }); } catch (e) { }
        }
        console.error(err);
        process.exit(1);
    } finally {
        await context.close();
    }
}

main();
