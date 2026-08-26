const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

function safeUrl(value) {
  if (typeof value === "string" && (value.startsWith("data:image/") || value.startsWith("/api/files/content"))) {
    return value;
  }
  try {
    const url = new URL(value, window.location.href);
    return ["http:", "https:", "mailto:", "data:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function inline(value) {
  let out = escapeHtml(value);
  out = out.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+[^)]*)?\)/g, (_, alt, raw) => {
    const url = safeUrl(raw);
    return url ? `<div class="chat-image-wrap"><img src="${escapeHtml(url)}" alt="${escapeHtml(alt || "Generated visual")}" class="chat-image" loading="lazy" /></div>` : escapeHtml(alt || "");
  });
  out = out.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  out = out.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+[^)]*)?\)/g, (_, label, raw) => {
    const url = safeUrl(raw);
    return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
  });
  return out;
}

function highlight(code, language) {
  if (!language) return escapeHtml(code);
  const keywords = new Set("const let var function return if else for while class def import from async await True False None true false null SELECT FROM WHERE".split(" "));
  const pattern = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|#[^\n]*|\b[A-Za-z_$][\w$]*\b)/g;
  let result = "", cursor = 0, match;
  while ((match = pattern.exec(code))) {
    result += escapeHtml(code.slice(cursor, match.index));
    const token = match[0];
    const klass = token.startsWith("//") || token.startsWith("#") ? "token-comment" : (token.startsWith('"') || token.startsWith("'") ? "token-string" : (keywords.has(token) ? "token-keyword" : ""));
    result += klass ? `<span class="${klass}">${escapeHtml(token)}</span>` : escapeHtml(token);
    cursor = match.index + token.length;
  }
  return result + escapeHtml(code.slice(cursor));
}

export function renderMarkdown(md) {
  if (!md) return "";
  const blocks = [];
  let source = String(md).replace(/```([^\n]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const language = lang.trim();
    const clean = code.replace(/\n$/, "");
    const lines = highlight(clean, language).split("\n").map(line => `<span class="code-line">${line || " "}</span>`).join("");
    const index = blocks.push(`<pre class="code-block"><div class="code-toolbar"><span class="code-language">${escapeHtml(language || "text")}</span><button class="line-btn" type="button" aria-label="Toggle code line numbers">Lines</button><button class="wrap-btn" type="button" aria-label="Toggle code wrapping">Wrap</button><button class="copy-btn" type="button" aria-label="Copy code" title="Copy code">Copy</button></div><code class="language-${escapeHtml(language)}">${lines}</code></pre>`) - 1;
    return `\u0000${index}\u0000`;
  });
  source = source.replace(/(^|\n)(\|[^\n]+\|)\n\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\n((?:\|[^\n]+\|\n?)+)/gm, (_, prefix, header, rows) => {
    const cells = line => line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
    const head = cells(header).map(cell => `<th>${inline(cell)}</th>`).join("");
    const body = rows.trim().split(/\n/).map(row => `<tr>${cells(row).map(cell => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("");
    return `${prefix}\u0000${blocks.push(`<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`) - 1}\u0000`;
  });
  const lines = source.split(/\r?\n/);
  const output = [];
  let list = null;
  const closeList = () => { if (list) { output.push(`</${list}>`); list = null; } };
  for (const line of lines) {
    const fence = line.match(/^\u0000(\d+)\u0000$/);
    if (fence) { closeList(); output.push(blocks[Number(fence[1])]); continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*+]\s+(?:\[([ xX])\]\s+)?(.+)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (heading) { closeList(); const n = heading[1].length; output.push(`<h${n}>${inline(heading[2])}</h${n}>`); }
    else if (bullet) { if (list !== "ul") { closeList(); output.push("<ul>"); list = "ul"; } const checked = bullet[1] ? ` data-checked="${bullet[1].toLowerCase() === "x"}"` : ""; output.push(`<li${checked}>${inline(bullet[2])}</li>`); }
    else if (ordered) { if (list !== "ol") { closeList(); output.push("<ol>"); list = "ol"; } output.push(`<li>${inline(ordered[1])}</li>`); }
    else if (/^>\s?/.test(line)) { closeList(); output.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`); }
    else if (!line.trim()) { closeList(); output.push(""); }
    else { closeList(); output.push(`<p>${inline(line)}</p>`); }
  }
  closeList();
  return output.join("");
}

export function attachCopyHandlers(root) {
  root.addEventListener("click", async event => {
    const wrapButton = event.target.closest?.(".wrap-btn");
    if (wrapButton) {
      const pre = wrapButton.closest("pre");
      pre.classList.toggle("wrapped");
      wrapButton.textContent = pre.classList.contains("wrapped") ? "Scroll" : "Wrap";
      return;
    }
    const lineButton = event.target.closest?.(".line-btn");
    if (lineButton) {
      const pre = lineButton.closest("pre");
      pre.classList.toggle("line-numbered");
      lineButton.textContent = pre.classList.contains("line-numbered") ? "No lines" : "Lines";
      return;
    }
    const button = event.target.closest?.(".copy-btn");
    if (!button) return;
    await navigator.clipboard.writeText(button.closest("pre").querySelector("code").textContent);
    button.textContent = "Copied";
    button.setAttribute("aria-label", "Code copied");
    setTimeout(() => { button.textContent = "Copy"; button.setAttribute("aria-label", "Copy code"); }, 1200);
  });
}
