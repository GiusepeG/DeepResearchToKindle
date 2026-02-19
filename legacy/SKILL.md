---
name: deep-research-to-kindle
version: 3.0.0
description: Deep Research to Kindle (DRK) - Node.js tool to run Gemini Deep Research, export as HTML, and send to Kindle via Gmail.
---

# Deep Research to Kindle (DRK)

Automated workflow: **Gemini Deep Research → HTML Extraction → Send via Gmail to Kindle**.

Built as a standalone Node.js tool using **Playwright**.

## Features

- **Persistent Browser Profile**: Log in once, reused for all future runs.
- **Deep Research Automation**: Handles the full flow (query -> poll -> complete).
- **Direct DOM Extraction**: Extracts the full research report directly from Gemini's immersive panel (waiting for lazy load).
- **Kindle Optimization**: Converts Markdown to clean, readable HTML.
- **Gmail Delivery**: Automates Gmail Web to send the report to your Kindle email (`gg_Ac98@kindle.com`).

## Prerequisites

1.  **Node.js** (v18+)
2.  **Google Account** (for Gemini & Gmail)
    *   Must use `giusepegraciolli@gmail.com`
3.  **Kindle Email**
    *   Target: `gg_Ac98@kindle.com`
    *   Ensure `giusepegraciolli@gmail.com` is in your Approved Personal Document E-mail List on Amazon.

## Setup

1.  Install dependencies:
    ```bash
    npm install
    ```
2.  **First-time Login** (Crucial):
    ```bash
    npm run login
    ```
    *   This opens a browser.
    *   Log in to **Google** (Gemini & Gmail).
    *   Close the browser/terminal when done.

## Usage

### Run a Research Task
```bash
npm start "Your research topic here"
```
Example:
```bash
npm start "The history of the printing press and its impact on literacy"
```

### Options
-   **Skip Email**: Generate HTML only.
    ```bash
    node drk.mjs --no-kindle "Topic..."
    ```
-   **Send Existing File**: Skip research, just send a file.
    ```bash
    node drk.mjs --kindle-only "~/Downloads/My-Report.html"
    ```
-   **Custom Profile**: Use a specific browser profile path (e.g., to share sessions).
    ```bash
    node drk.mjs --profile ./my-custom-profile "Topic..."
    ```

## How It Works

1.  **Launch**: Opens standardized browser context (Default: `~/.drk-profile`).
2.  **Research**: Uses Gemini Pro Deep Research mode.
3.  **Extract**: Scrapes the shadow DOM of the research report.
4.  **Format**: Uses `marked` to create a Kindle-friendly HTML file.
5.  **Deliver**: Opens Gmail Composer, attaches the file, and sends to your Kindle email.
