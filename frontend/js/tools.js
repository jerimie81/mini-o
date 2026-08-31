import { api } from "./api.js";
class ToolPanel {
  async render() {
    const list = document.getElementById("tool-list") || document.getElementById("menu-tool-list");
    if (!list) return;
    try {
      const tools = await api.tools();
      if (!list) return;
      list.innerHTML = "";
      if (!tools.length) list.innerHTML = "<li class='empty-state'>No tools are registered.</li>";
      const groups = new Map();
      tools.forEach(tool => { const group = groups.get(tool.category || "general") || []; group.push(tool); groups.set(tool.category || "general", group); });
      groups.forEach((entries, category) => {
        const heading = document.createElement("li"); heading.className = "tool-group-heading"; heading.textContent = category[0].toUpperCase() + category.slice(1); list.appendChild(heading);
        entries.forEach(tool => {
        const li = document.createElement("li");
        li.innerHTML = `<label class="tool-enabled"><input type="checkbox" checked data-tool="${tool.name}" /> Enabled</label><code></code><span class="confirm"></span><span class="tool-risk"></span><p></p><p class="tool-effects"></p><details><summary>Inputs and schema</summary><pre></pre></details><div class="tool-policy"><select aria-label="Approval policy"><option value="confirm">Confirm</option><option value="allow">Always allow</option><option value="deny">Deny</option></select><select aria-label="Approval scope"><option value="once">Once</option><option value="conversation">Conversation</option><option value="session">Session</option></select></div>`;
        li.querySelector("code").textContent = tool.name;
        li.querySelector(".confirm").textContent = tool.requires_confirmation ? " ⚠ confirmation" : "";
        li.querySelector(".tool-risk").textContent = ` · risk: ${tool.risk || "low"}`;
        li.querySelector("p").textContent = tool.description;
        li.querySelector(".tool-effects").textContent = `Side effects: ${(tool.side_effects || []).join(", ") || "none"}`;
        li.querySelector("pre").textContent = JSON.stringify(tool.parameters, null, 2);
        const enabled = localStorage.getItem(`mini-o.tool.${tool.name}`) !== "false"; li.querySelector("input").checked = enabled;
        li.querySelector("input").onchange = event => { localStorage.setItem(`mini-o.tool.${tool.name}`, String(event.target.checked)); const current = JSON.parse(localStorage.getItem("mini-o.enabled-tools") || "null") || tools.map(item => item.name); const next = event.target.checked ? [...new Set([...current, tool.name])] : current.filter(name => name !== tool.name); localStorage.setItem("mini-o.enabled-tools", JSON.stringify(next)); };
        const policy = tool.policy || {}; li.querySelectorAll("select")[0].value = policy.mode || "confirm"; li.querySelectorAll("select")[1].value = policy.scope || "conversation";
        li.querySelectorAll("select").forEach((select, index, selects) => select.onchange = async () => { const body = index === 0 ? { mode: select.value } : { scope: select.value }; try { await api.updateToolPolicy(tool.name, body); } catch (error) { select.value = index === 0 ? policy.mode || "confirm" : policy.scope || "conversation"; } });
        list.appendChild(li);
        });
      });
    } catch (error) { if (list) list.textContent = error.message; }
  }
}
export { ToolPanel };
