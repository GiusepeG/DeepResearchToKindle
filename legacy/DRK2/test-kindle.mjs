#!/usr/bin/env node

/**
 * Test script: Extract content from an existing Gemini Deep Research page
 * and test the Kindle sharing flow (save .html + send via Gmail).
 *
 * Usage: node test-kindle.mjs <gemini-url>
 */

import { chromium } from "playwright";
import { marked } from "marked";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROFILE_DIR = resolve(homedir(), ".drk-profile");
const DOWNLOADS_DIR = resolve(homedir(), "Downloads");
const TEMPLATE_PATH = resolve(__dirname, "template.html");
const KINDLE_EMAIL = "gg_Ac98@kindle.com";
const GMAIL_COMPOSER_URL = `https://mail.google.com/mail/?view=cm&fs=1&to=${KINDLE_EMAIL}&su=Convert&body=Deep+Research+Report`;

function ts() { return new Date().toLocaleTimeString("pt-BR"); }
function log(msg) { console.log(`[TEST ${ts()}] ${msg}`); }
function logSub(msg) { console.log(`[TEST ${ts()}]    ${msg}`); }

function sanitizeFilename(text) {
    return text.replace(/[^\w\sÀ-ú-]/g, "").replace(/\s+/g, "-").substring(0, 100).replace(/-+$/, "");
}

function extractHeadline(content) {
    const match = content.match(/^#\s+(.+)$/m);
    if (match && match[1]) return match[1].trim();
    const lines = content.split("\n").filter(l => l.trim().length > 0);
    return lines.length > 0 ? lines[0].replace(/^#+\s*/, "").trim() : "Research-Report";
}

function buildHtml(title, markdownContent) {
    const template = readFileSync(TEMPLATE_PATH, "utf-8");
    const htmlContent = marked.parse(markdownContent);
    const date = new Date().toLocaleDateString("pt-BR", { year: "numeric", month: "long", day: "numeric" });
    return template
        .replace(/\{\{TITLE\}\}/g, title)
        .replace("{{CONTENT}}", htmlContent)
        .replace("{{DATE}}", date);
}

async function main() {
    const url = process.argv[2];
    if (!url) {
        console.log("Usage: node test-kindle.mjs <gemini-research-url>");
        process.exit(1);
    }

    log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    log("🧪 Teste de compartilhamento ao Kindle");
    log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Step 1: Launch browser
    log("[1/4] 🚀 Lançando navegador...");
    const context = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: false,
        viewport: { width: 1280, height: 900 },
        args: ["--disable-blink-features=AutomationControlled"],
    });
    const page = context.pages()[0] || (await context.newPage());
    logSub("✅ Navegador pronto.");

    try {
        // Step 2: Navigate to the research URL
        log("[2/4] 🌐 Navegando para a pesquisa existente...");
        logSub(`URL: ${url}`);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForTimeout(5000);
        logSub("✅ Página carregada.");

        // Step 3: Extract content
        log("[3/4] 📄 Extraindo conteúdo...");

        // Scroll to load lazy content
        await page.evaluate(async () => {
            const container = document.querySelector('.container[scrollable="true"]');
            if (container) {
                const step = 1000;
                let top = 0;
                while (top < container.scrollHeight) {
                    top += step;
                    container.scrollTop = top;
                    await new Promise(r => setTimeout(r, 200));
                }
                container.scrollTop = 0;
            }
        }).catch(() => { });
        await page.waitForTimeout(2000);

        const content = await page.evaluate(() => {
            const reportContainer = document.querySelector('.container[scrollable="true"]');
            if (reportContainer) {
                const text = reportContainer.innerText;
                if (text && text.trim().length > 200) return text.trim();
            }
            const selectors = [
                "model-response .markdown",
                "message-content .markdown",
                '[data-message-author-role="model"] .markdown',
            ];
            for (const sel of selectors) {
                const els = document.querySelectorAll(sel);
                if (els.length > 0) {
                    const last = els[els.length - 1];
                    if (last.innerText && last.innerText.trim().length > 200) return last.innerText.trim();
                }
            }
            const candidates = document.querySelectorAll('message-content, .markdown');
            let longest = "";
            for (const el of candidates) {
                const t = (el.innerText || "").trim();
                if (t.length > longest.length) longest = t;
            }
            return longest;
        });

        if (!content || content.trim().length < 100) {
            log("❌ Conteúdo insuficiente extraído.");
            await context.close();
            process.exit(1);
        }

        const headline = extractHeadline(content);
        const filename = `${sanitizeFilename(headline)}.html`;
        const filepath = resolve(DOWNLOADS_DIR, filename);

        // Convert to HTML for Kindle compatibility
        const html = buildHtml(headline, content);
        writeFileSync(filepath, html, "utf-8");

        logSub(`✅ Extraídos ${content.length} caracteres.`);
        logSub(`Headline: "${headline}"`);
        logSub(`Arquivo: ${filepath}`);

        // Step 4: Send via Gmail
        log("[4/4] 📧 Enviando e-mail para " + KINDLE_EMAIL + "...");

        logSub("Abrindo Gmail Composer...");
        await page.goto(GMAIL_COMPOSER_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });

        logSub("Aguardando compositor...");
        const sendBtn = page.locator('div[role="button"][aria-label*="Enviar"], div[role="button"][aria-label*="Send"]').first();
        try {
            await sendBtn.waitFor({ state: "visible", timeout: 20_000 });
        } catch {
            await page.locator('input[name="subjectbox"]').waitFor({ state: "visible", timeout: 10_000 });
        }
        logSub("✅ Gmail Composer pronto.");

        logSub("Anexando arquivo .html...");
        const attachBtn = page.locator('div[command="Files"], div[aria-label="Anexar arquivos"], div[aria-label="Attach files"]').first();
        await attachBtn.waitFor({ state: "visible", timeout: 10_000 });

        const [fileChooser] = await Promise.all([
            page.waitForEvent("filechooser", { timeout: 15_000 }),
            attachBtn.click(),
        ]);
        await fileChooser.setFiles(filepath);
        logSub("✅ Arquivo selecionado.");

        logSub("Aguardando upload...");
        await page.waitForTimeout(5000);

        logSub("Enviando e-mail...");
        await page.keyboard.press("Meta+Enter");
        await page.waitForTimeout(1000);

        try {
            await page.locator("text=/Mensagem enviada|Message sent/i").waitFor({ state: "visible", timeout: 10_000 });
            logSub("✅ E-mail enviado com sucesso!");
        } catch {
            logSub("⚠️  Confirmação não detectada, mas comando executado.");
        }

        console.log();
        log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        log("🎉 Teste concluído!");
        log(`   Arquivo: ${filepath}`);
        log(`   Headline: "${headline}"`);
        log(`   Enviado para: ${KINDLE_EMAIL}`);
        log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    } catch (err) {
        log(`❌ Erro: ${err.message}`);
        console.error(err);
        process.exit(1);
    } finally {
        await context.close();
    }
}

main();
