"use strict";

require("dotenv").config();
const crypto = require("crypto");
const path = require("path");
const express = require("express");

const PORT = Number(process.env.PORT) || 3000;
const N8N_WEBHOOK_URL =
  process.env.N8N_WEBHOOK_URL || "http://localhost:5678/webhook/prompt";
const MAX_PROMPT_LENGTH = 500;
const N8N_TIMEOUT_MS = 10000;

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

/** Browsers currently listening for results (Server-Sent Events). */
const clients = new Set();

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

/** Converts a markdown table to an HTML table; anything else becomes escaped paragraphs. */
function markdownToHtml(md) {
  const lines = String(md || "").trim().split("\n").filter((l) => l.trim());
  const isRow = (l) => l.includes("|");
  const isDivider = (l) => /^[\s|:-]+$/.test(l);
  const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

  let html = "";
  let i = 0;
  while (i < lines.length) {
    if (isRow(lines[i]) && lines[i + 1] && isDivider(lines[i + 1])) {
      const head = cells(lines[i]).map((h) => `<th>${escapeHtml(h)}</th>`).join("");
      i += 2;
      let body = "";
      while (i < lines.length && isRow(lines[i])) {
        body += `<tr>${cells(lines[i]).map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`;
        i++;
      }
      html += `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    } else {
      html += `<p>${escapeHtml(lines[i])}</p>`;
      i++;
    }
  }
  return html;
}

function safeImageUrl(value) {
  try {
    const u = new URL(String(value));
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "";
  } catch {
    return "";
  }
}

// Browser -> backend -> n8n webhook
app.post("/inputPrompt", async (req, res) => {
  const prompt = typeof req.body?.data === "string" ? req.body.data.trim() : "";
  if (!prompt) return res.status(400).json({ success: false, error: "Prompt is required." });
  if (prompt.length > MAX_PROMPT_LENGTH)
    return res
      .status(400)
      .json({ success: false, error: `Prompt must be ${MAX_PROMPT_LENGTH} characters or fewer.` });

  const requestId = crypto.randomUUID();
  try {
    const r = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatInput: prompt, requestId }),
      signal: AbortSignal.timeout(N8N_TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`n8n responded with HTTP ${r.status}`);
    res.status(202).json({ success: true, requestId });
  } catch (err) {
    console.error("n8n call failed:", err.message);
    res.status(502).json({
      success: false,
      error: "Could not reach the n8n webhook. Is n8n running and the workflow active?",
    });
  }
});

// n8n -> backend (workflow's final HTTP Request node)
app.post("/getResponse", (req, res) => {
  const { text, image, requestId } = req.body || {};
  if (typeof text !== "string" && typeof image !== "string")
    return res.status(400).json({ success: false, error: "Expected `text` and/or `image`." });

  const payload = JSON.stringify({
    requestId: typeof requestId === "string" ? requestId : "",
    text: markdownToHtml(text),
    image: safeImageUrl(image),
  });
  clients.forEach((client) => client.write(`data: ${payload}\n\n`));
  res.json({ success: true });
});

// Backend -> browser (live updates)
app.get("/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  res.write(": connected\n\n");
  clients.add(res);
  req.on("close", () => clients.delete(res));
});

app.get("/health", (_req, res) => res.json({ ok: true }));

if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
}

module.exports = { app, markdownToHtml, safeImageUrl };
