const box = document.getElementById("responseBox");
const form = document.getElementById("promptForm");
const input = document.getElementById("promptInput");
const btn = document.getElementById("submitBtn");

let pendingId = null;
let timeoutId = null;

function setStatus(message, isError = false) {
  box.replaceChildren();
  const p = document.createElement("p");
  p.className = isError ? "error" : "muted";
  p.textContent = message;
  box.append(p);
}

function setLoading() {
  box.innerHTML = '<div class="status"><div class="spinner"></div><span>Workflow is running… this can take a minute.</span></div>';
}

function finish() {
  pendingId = null;
  clearTimeout(timeoutId);
  btn.disabled = false;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = input.value.trim();
  if (!data) return;

  btn.disabled = true;
  setLoading();
  try {
    const res = await fetch("/inputPrompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    pendingId = body.requestId;
    timeoutId = setTimeout(() => {
      finish();
      setStatus("Still no answer. Check that the n8n workflow is active and its last node can reach this app.", true);
    }, 120000);
  } catch (err) {
    finish();
    setStatus(err.message, true);
  }
});

const events = new EventSource("/events");
events.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  // Ignore answers that belong to someone else's question.
  if (msg.requestId && pendingId && msg.requestId !== pendingId) return;
  if (!pendingId && msg.requestId) return;

  // `text` is HTML produced (and escaped) by the server; `image` is a validated http(s) URL.
  box.innerHTML = "";
  if (msg.image) {
    const img = document.createElement("img");
    img.src = msg.image;
    img.alt = "Image returned by the workflow";
    box.append(img);
  }
  if (msg.text) box.insertAdjacentHTML("beforeend", msg.text);
  if (!box.hasChildNodes()) setStatus("The workflow returned an empty response.");
  finish();
};
