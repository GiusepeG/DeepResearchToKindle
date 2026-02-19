#!/usr/bin/env node

/**
 * Deep Research to Kindle (DRK)
 *
 * Automates: Gemini Deep Research → HTML Capture → Send to Kindle
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

// ─── Config ────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROFILE_DIR = resolve(homedir(), ".drk-profile");
const TEMPLATE_PATH = resolve(__dirname, "template.html");
const DOWNLOADS_DIR = resolve(homedir(), "Downloads");
const GEMINI_URL = "https://gemini.google.com/app";
const KINDLE_URL = "https://www.amazon.com.br/sendtokindle";

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const MAX_POLL_TIME_MS = 15 * 60_000; // 15 minutes

// ─── Utilities ─────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toLocaleTimeString("pt-BR");
  console.log(`[DRK ${ts}] ${msg}`);
}

function sanitizeFilename(text) {
  return text
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 80)
    .replace(/-+$/, "");
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

// ─── Browser Helpers ───────────────────────────────────────────────────────────

async function launchBrowser(profilePath = PROFILE_DIR) {
  log(`Launching browser (profile: ${profilePath})`);
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = context.pages()[0] || (await context.newPage());
  return { context, page };
}

async function navigateToGemini(page) {
  log("Navigating to Gemini...");
  await page.goto(GEMINI_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  // Wait for the chat input to be ready
  await page.waitForTimeout(3000);
  log("Gemini loaded.");
}

// ─── Deep Research Flow ────────────────────────────────────────────────────────

async function enableDeepResearch(page) {
  log('Enabling Deep Research mode...');

  // Click "Ferramentas" (Tools button)
  const toolsBtn = page.getByRole("button", { name: /Ferramentas/i });
  await toolsBtn.waitFor({ state: "visible", timeout: 10_000 });
  await toolsBtn.click();
  await page.waitForTimeout(1500);

  // Click "Deep Research" in the dropdown
  const drBtn = page.locator('text=/Deep Research/i');
  await drBtn.waitFor({ state: "visible", timeout: 5_000 });
  await drBtn.click();
  await page.waitForTimeout(2000);

  log("Deep Research mode enabled.");
}

async function submitQuery(page, query) {
  log(`Submitting query: "${query.substring(0, 50)}..."`);

  // Wait for the input area
  // Often a contenteditable div or textarea
  const input = page.locator('rich-textarea div[contenteditable="true"], textarea, div[role="textbox"]').first();
  await input.waitFor({ state: "visible", timeout: 15_000 });

  // Type the query
  await input.click();
  await input.fill(query);
  await page.waitForTimeout(1000); // Brief pause

  // Press Enter to submit
  log("Pressing Enter to submit...");
  await page.keyboard.press('Enter');

  // Wait for the response to start generating or the input to clear/change state
  await page.waitForTimeout(2000);

  log("Query submitted.");
}

async function confirmResearchStart(page) {
  log('Looking for "Iniciar investigação/pesquisa" confirmation...');

  // The new Deep Research flow presents a plan first.
  // We must click "Iniciar investigação", "Start research", or similar.
  // Common labels: "Iniciar investigação", "Start", "Confirm", "Looks good", "Iniciar"

  const possibleButtons = [
    /Iniciar investigação/i,
    /Start investigation/i,
    /Iniciar pesquisa/i,
    /Start research/i,
    /Looks good/i,
    /Confirmar/i
  ];

  const startTime = Date.now();
  const maxWait = 60_000; // Wait up to 60s for the plan to appear and the button to be clickable

  while (Date.now() - startTime < maxWait) {
    try {
      // Check for any of the buttons
      for (const label of possibleButtons) {
        const btn = page.getByRole("button", { name: label }).first();
        if (await btn.isVisible()) {
          log(`Found confirmation button: "${label}"`);
          await btn.click();
          log("Research started (Plan confirmed).");
          await page.waitForTimeout(5000); // Wait for UI transition
          return;
        }
      }

      // Also check for "Editar plano" (Edit plan) which implies the plan is visible. 
      // If we see "Editar plano" but no start button yet, we wait.
      // If the start button is there but strict mode failed, try loose locator.
      const looseBtn = page.locator('button:has-text("Iniciar"), button:has-text("Start")').first();
      if (await looseBtn.isVisible()) {
        // Filter out "New chat" or other irrelevant buttons if needed
        // But usually "Iniciar" in this context is correct.
        const text = await looseBtn.innerText();
        if (text.includes("investiga") || text.includes("pesquisa")) {
          log(`Found loose confirmation button: "${text}"`);
          await looseBtn.click();
          await page.waitForTimeout(5000);
          return;
        }
      }

    } catch (e) {
      // Ignore errors and keep polling
    }
    await page.waitForTimeout(2000);
  }

  log("⚠️ No confirmation button found after 60s. Research may have started automatically or selector changed.");
}

async function pollForCompletion(page) {
  log("Polling for research completion...");
  const startTime = Date.now();

  // Gemini Deep Research uses a status chip: deep-research-entry-chip-content
  // When complete, it shows "Concluído" (Portuguese) or "Completed" (English).
  // We also check for the immersive report container to appear.

  // --- Phase 1: Wait for research to START ---
  log("  Phase 1: Waiting for research to begin...");

  let researchStarted = false;
  const phase1Deadline = Date.now() + 120_000; // 2 min max

  while (Date.now() < phase1Deadline) {
    // Check for the Deep Research status chip (appears during research)
    const chipStatus = await page.evaluate(() => {
      const chip = document.querySelector('deep-research-entry-chip-content');
      return chip ? chip.innerText.trim() : '';
    }).catch(() => '');

    if (chipStatus) {
      log(`  ✓ Deep Research status detected: "${chipStatus}"`);
      researchStarted = true;
      // If already completed, skip to phase 2
      if (/Conclu[íi]do|Completed/i.test(chipStatus)) {
        log("  ✓ Research already completed!");
        break;
      }
      break;
    }

    // Also check for text indicators
    const indicators = page.locator('text=/Pesquisando|Researching|Analisando|Analyzing/i');
    if (await indicators.isVisible().catch(() => false)) {
      log("  ✓ Research activity detected.");
      researchStarted = true;
      break;
    }

    await sleep(5_000);
  }

  if (!researchStarted) {
    log("  ⚠️  Could not detect research start, proceeding to poll for completion...");
  }

  // --- Phase 2: Wait for COMPLETION ---
  log("  Phase 2: Waiting for research to complete...");

  // Minimum wait after start before checking completion
  const minWaitUntil = Date.now() + 60_000;

  while (Date.now() - startTime < MAX_POLL_TIME_MS) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    log(`  ⏳ Polling... (${elapsed}s elapsed)`);

    // Primary: Check Deep Research status chip for "Concluído"
    const chipStatus = await page.evaluate(() => {
      const chip = document.querySelector('deep-research-entry-chip-content');
      return chip ? chip.innerText.trim() : '';
    }).catch(() => '');

    if (/Conclu[íi]do|Completed/i.test(chipStatus)) {
      // Wait a bit more for the report to fully render
      await sleep(5_000);
      log('✅ Research complete! Status: "' + chipStatus + '"');
      return true;
    }

    // If chip shows active status, keep waiting
    if (chipStatus && !/Conclu[íi]do|Completed/i.test(chipStatus)) {
      log(`  📊 Status: "${chipStatus}"`);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    // If we haven't waited the minimum time yet, keep waiting
    if (Date.now() < minWaitUntil) {
      await sleep(10_000);
      continue;
    }

    // Fallback: check if the immersive report container has content
    const reportLength = await page.evaluate(() => {
      const container = document.querySelector('.container[scrollable="true"]');
      return container ? (container.innerText || '').trim().length : 0;
    }).catch(() => 0);

    if (reportLength > 500) {
      log(`✅ Research complete! Report container has ${reportLength} characters.`);
      return true;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  log("⚠️  Max poll time reached. Research may or may not be complete.");
  return false;
}

async function extractResponseContent(page) {
  log('Extracting research content from page DOM...');

  // Gemini Deep Research renders the full report in an immersive right panel.
  // The report container is: div.container[scrollable="true"]
  // We need to scroll through it to ensure all content is loaded, then extract.

  // First, try to scroll the report container to load all lazy content
  await page.evaluate(async () => {
    const container = document.querySelector('.container[scrollable="true"]');
    if (container) {
      // Scroll to bottom in steps to trigger lazy loading
      const scrollStep = 1000;
      let scrollTop = 0;
      while (scrollTop < container.scrollHeight) {
        scrollTop += scrollStep;
        container.scrollTop = scrollTop;
        await new Promise(r => setTimeout(r, 200));
      }
      // Scroll back to top
      container.scrollTop = 0;
    }
  }).catch(() => { });

  await page.waitForTimeout(2000);

  const content = await page.evaluate(() => {
    // Strategy 1 (PRIMARY): Immersive report container
    // This is the right panel in Gemini's Deep Research split-view
    const reportContainer = document.querySelector('.container[scrollable="true"]');
    if (reportContainer) {
      const text = reportContainer.innerText;
      if (text && text.trim().length > 200) {
        return text.trim();
      }
    }

    // Strategy 2: Look for model response containers
    const responseSelectors = [
      'model-response .markdown',
      'model-response message-content',
      'message-content .markdown',
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

    // Strategy 3: Find the element with the most text content
    const candidates = document.querySelectorAll(
      'message-content, .message-content, [class*="response"], .markdown'
    );

    let longestText = '';
    for (const el of candidates) {
      const text = (el.innerText || '').trim();
      if (text.length > longestText.length) {
        longestText = text;
      }
    }

    if (longestText.length > 200) {
      return longestText;
    }

    // Strategy 4: Last resort — main content area
    const mainArea = document.querySelector('main, [role="main"]');
    if (mainArea) {
      return mainArea.innerText.trim();
    }

    return '';
  });

  if (!content || content.trim().length < 200) {
    log(`DOM extraction got only ${(content || '').length} characters, trying clipboard fallback...`);
    return await copyViaClipboard(page);
  }

  log(`✅ Extracted ${content.length} characters from DOM.`);
  return content;
}

async function copyViaClipboard(page) {
  log('Attempting clipboard-based copy as fallback...');

  // Try to find and click the Copy button using various patterns
  const copySelectors = [
    'button[aria-label*="copi"]',        // "Copiar" / "Copy" (case-insensitive via aria)
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
        // Click the last matching button (closest to the latest response)
        await btns.last().click();
        await page.waitForTimeout(2000);
        const clipboard = readClipboard();
        if (clipboard.trim().length > 100) {
          log(`Clipboard fallback succeeded: ${clipboard.length} characters.`);
          return clipboard;
        }
      }
    } catch {
      continue;
    }
  }

  throw new Error('Could not extract research content. Try copying manually.');
}

// ─── HTML & Kindle ─────────────────────────────────────────────────────────────

function saveHtml(query, clipboardContent) {
  const title = query.substring(0, 80);
  const filename = `${sanitizeFilename(query)}.html`;
  const filepath = resolve(DOWNLOADS_DIR, filename);

  const html = buildHtml(title, clipboardContent);
  writeFileSync(filepath, html, "utf-8");

  log(`📄 HTML saved: ${filepath}`);
  return filepath;
}

const GMAIL_COMPOSER_URL = "https://mail.google.com/mail/?view=cm&fs=1&to=gg_Ac98@kindle.com&su=Convert&body=Deep+Research+Report";

async function sendViaGmailWeb(page, htmlFilePath) {
  log("Opening Gmail...");
  await page.goto(GMAIL_COMPOSER_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });

  // Wait for the Compose window to load
  // The "Send" button is a good indicator that the composer is ready
  // It usually has aria-label="Send" or "Enviar"
  log("Waiting for Gmail Composer...");
  const sendBtn = page.locator('div[role="button"][aria-label*="Enviar"], div[role="button"][aria-label*="Send"]').first();
  try {
    await sendBtn.waitFor({ state: "visible", timeout: 20_000 });
  } catch {
    // Fallback: check for the "To" field or Subject field if Send button isn't found immediately
    await page.locator('input[name="subjectbox"]').waitFor({ state: "visible", timeout: 10_000 });
  }
  log("Gmail Composer ready.");

  // --- Attach File ---
  log("Attaching file...");

  // The attach button usually has a paperclip icon and command="Files" or aria-label="Attach files"/"Anexar arquivos"
  const attachBtn = page.locator('div[command="Files"], div[aria-label="Anexar arquivos"], div[aria-label="Attach files"]').first();
  await attachBtn.waitFor({ state: "visible", timeout: 10_000 });

  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 15_000 }),
    attachBtn.click(),
  ]);
  await fileChooser.setFiles(htmlFilePath);
  log("File selected.");

  // Wait for attachment to upload
  // The attachment usually appears as a card/link. We can wait a bit or look for a progress bar to disappear.
  // A safe bet is getting the file size (which means it's processed).
  // "div[role='progressbar']" might appear during upload.
  log("Waiting for attachment upload...");
  await page.waitForTimeout(5000); // Give it time to upload (HTML files are small)

  // Verify attachment presence (optional but good) via aria-label containing filename
  const fileName = htmlFilePath.split("/").pop();
  const attachmentIndicator = page.locator(`div[aria-label*="${fileName}"]`);
  if (await attachmentIndicator.count() > 0) {
    log("Attachment verified.");
  }

  // --- Send ---
  log("Sending email...");
  // Press Ctrl+Enter (Cmd+Enter on Mac) to send - faster and more reliable than finding the button
  await page.keyboard.press('Meta+Enter'); // Mac
  // Fallback: click send if keyboard shortcut doesn't trigger navigation/toast
  await page.waitForTimeout(1000);

  // Check if sent
  // Look for "Message sent" / "Mensagem enviada" toast
  // Or simply wait for the page to change (since ?view=cm usually closes or clears after send)

  try {
    log("Waiting for confirmation...");
    await page.locator('text=/Mensagem enviada|Message sent/i').waitFor({ state: "visible", timeout: 10_000 });
    log("✅ Email sent successfully!");
  } catch {
    // If we're in the dedicated window mode (?view=cm), it might close or redirect to Inbox on send.
    // If the URL changed to inbox, or the composer cleared, it's likely sent.
    log("⚠️  Confirmation toast not detected, but command executed.");
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Parse --profile argument
  let profilePath = undefined;
  const profileIndex = args.indexOf("--profile");
  if (profileIndex !== -1 && args[profileIndex + 1]) {
    profilePath = resolve(process.cwd(), args[profileIndex + 1]);
    // Remove the flag and value from args so they don't interfere with other parsing
    args.splice(profileIndex, 2);
  }

  const loginOnly = args.includes("--login-only");
  const kindleOnly = args.includes("--kindle-only");
  const query = args.filter((a) => !a.startsWith("--")).join(" ");

  if (!loginOnly && !kindleOnly && !query) {
    console.log(`
📚 Deep Research to Kindle (DRK)

Usage:
  node drk.mjs "Your research query"        Full automation flow
  node drk.mjs --login-only                 Open browser to log in (first-time setup)
  node drk.mjs --kindle-only <path>         Send an existing HTML file via Gmail
  node drk.mjs --profile <path>             Use a specific browser profile directory

Options:
  --login-only    Just open the browser for manual login (Google), then exit
  --no-kindle     Skip the email delivery step (just generate HTML)
  --kindle-only   Skip research, just send a file via Gmail to Kindle
  --profile       Path to a custom browser profile directory (e.g., to share sessions)

Examples:
  node drk.mjs "What are the latest advances in CRISPR?"
  node drk.mjs --login-only
  node drk.mjs --profile ./my-custom-profile --login-only
  node drk.mjs --kindle-only ~/Downloads/My-Report.html

Note:
  Authentication relies on your persistent browser profile.
  Default profile: ~/.drk-profile
  Target: gg_Ac98@kindle.com
`);
    process.exit(0);
  }

  const skipKindle = args.includes("--no-kindle");

  const { context, page } = await launchBrowser(profilePath);

  try {
    if (loginOnly) {
      log("🔑 Login mode — browser is open.");
      log(`   Profile: ${profilePath || PROFILE_DIR}`);
      log("   Please log in to Gmail (giusepegraciolli@gmail.com).");
      log("   Also ensure you are logged into Gemini.");
      log("   Press Ctrl+C when done.");
      await navigateToGemini(page);
      // Keep alive until user closes
      await new Promise(() => { });
    }

    if (kindleOnly) {
      // Send an existing file via Gmail (skip research)
      const filePath = query || resolve(DOWNLOADS_DIR, "What-are-the-latest-advances-in-CRISPR-gene-editing-in-2025.html");
      if (!existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      log(`Kindle-only mode: sending ${filePath}`);
      await sendViaGmailWeb(page, filePath);
      log("🎉 Done!");
      await context.close();
      return;
    }

    // --- Full automation flow ---
    await navigateToGemini(page);
    await enableDeepResearch(page);
    await submitQuery(page, query);
    await confirmResearchStart(page);
    await pollForCompletion(page);
    // Extract content directly from the page DOM (much more reliable than clipboard)
    const researchContent = await extractResponseContent(page);
    if (!researchContent || researchContent.trim().length < 100) {
      throw new Error("Could not extract research content. Try copying manually from the browser.");
    }
    log(`Research content: ${researchContent.length} characters.`);

    const htmlFilePath = saveHtml(query, researchContent);

    if (!skipKindle) {
      await sendViaGmailWeb(page, htmlFilePath);
    } else {
      log("⏭️  Skipping email delivery (--no-kindle flag).");
    }

    log("🎉 Done!");
  } catch (err) {
    log(`❌ Error: ${err.message}`);
    console.error(err);
    process.exit(1);
  } finally {
    await context.close();
  }
}

main();
