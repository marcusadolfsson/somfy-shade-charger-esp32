// Shade charger: one-row-per-shade table at the top of the ESPHome web page.
// Served as /0.js via web_server.js_include. It reads the page's own live
// event stream (/events) and the same entities HA sees -- nothing here holds
// state of its own. Rows follow the order of the "Relay 1 shade" options.
(function () {
  "use strict";
  const S = {};                       // name_id -> {state, value, option}
  let shades = [];                    // display order

  const css = `
  #sc-wrap{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:16px;max-width:1400px}
  #sc-wrap h2{font-size:18px;margin:0 0 8px}
  #sc-scroll{overflow-x:auto}
  #sc-table{border-collapse:collapse;width:100%;font-size:14px}
  #sc-table th{text-align:left;font-weight:600;padding:6px 8px;border-bottom:2px solid #ccc;white-space:nowrap}
  #sc-table td{padding:6px 8px;border-bottom:1px solid #e3e3e3;vertical-align:top}
  #sc-table td.name{font-weight:600;white-space:nowrap}
  #sc-table td.num{white-space:nowrap}
  .sc-pill{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600;white-space:nowrap}
  .sc-idle{background:#eee;color:#444}.sc-run{background:#d8f0dc;color:#17602a}
  .sc-pause{background:#fff0c2;color:#7a5a00}.sc-fault{background:#fbd5d5;color:#8a1111}
  .sc-warn{color:#b35c00;font-weight:600}
  #sc-table button{padding:4px 12px;border-radius:6px;border:1px solid #888;background:#fafafa;cursor:pointer}
  #sc-table button:disabled{opacity:.4;cursor:default}
  .sc-dim{color:#888}
  #sc-q{margin-top:14px}
  #sc-q h3{font-size:15px;margin:0 0 6px}
  #sc-qt{border-collapse:collapse;font-size:14px;min-width:420px}
  #sc-qt th{text-align:left;font-weight:600;padding:4px 10px;border-bottom:2px solid #ccc}
  #sc-qt td{padding:4px 10px;border-bottom:1px solid #e3e3e3}
  #sc-qbtn{margin-left:12px;padding:3px 10px;border-radius:6px;border:1px solid #888;background:#fafafa;cursor:pointer;font-size:13px}
  #sc-note{font-size:13px;line-height:1.5;margin:10px 2px 0;max-width:1100px}
  #sc-note b{font-weight:600}
  @media (prefers-color-scheme: dark){
    #sc-wrap{color:#ddd}#sc-table th{border-color:#555}#sc-table td{border-color:#333}
    .sc-idle{background:#333;color:#ccc}.sc-run{background:#1d4026;color:#a6e0b3}
    .sc-pause{background:#4a3c10;color:#f0d68a}.sc-fault{background:#4d1c1c;color:#f3b0b0}
    #sc-table button{background:#2a2a2a;color:#ddd;border-color:#666}
  }`;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  const st = (id) => (S[id] && (S[id].state ?? S[id].value)) ?? "";

  let wrap = null;
  // Put the table just under the page header. The header is inside esp-app's
  // shadow DOM, so the table carries its own <style> (page CSS can't reach in).
  // If the header can't be found (frontend changed), fall back to the page top.
  function place(tries) {
    const app = document.querySelector("esp-app");
    const hdr = app && app.shadowRoot && app.shadowRoot.querySelector("header");
    if (hdr) { if (wrap.previousElementSibling !== hdr) hdr.after(wrap); return; }
    if (tries > 0) { setTimeout(() => place(tries - 1), 250); return; }
    if (!wrap.isConnected) document.body.insertBefore(wrap, document.body.firstChild);
  }

  // The table replaces these per-shade sections on this page. Their entities
  // stay (HA, the dashboard and InfluxDB use them) -- only the page hides them.
  const HIDE = ["Charge one shade", "Last charge per shade", "Learned per shade"];
  function hideSections() {
    const app = document.querySelector("esp-app");
    const tbl = app && app.shadowRoot && app.shadowRoot.querySelector("esp-entity-table");
    const root = tbl && tbl.shadowRoot;
    if (!root) return;
    // Each section is a .tab-header followed by its .tab-container; all
    // sections share one parent, so hide exactly that pair -- never the parent.
    for (const h of root.querySelectorAll(".tab-header")) {
      if (!HIDE.includes(h.textContent.trim())) continue;
      const body = h.nextElementSibling;
      if (h.style.display !== "none") h.style.display = "none";
      if (body && body.classList.contains("tab-container") && body.style.display !== "none")
        body.style.display = "none";
    }
  }

  function mount() {
    if (wrap) return;
    wrap = el("div"); wrap.id = "sc-wrap";
    const style = el("style"); style.textContent = css; wrap.appendChild(style);
    wrap.appendChild(el("h2", "", "Shades"));
    const scroll = el("div"); scroll.id = "sc-scroll";
    const t = el("table"); t.id = "sc-table";
    const hr = el("tr");
    ["Shade", "Status", "Last check", "Battery (est.)", "Last charge", "Learned", ""].forEach(h => hr.appendChild(el("th", "", h)));
    const thead = el("thead"); thead.appendChild(hr); t.appendChild(thead);
    t.appendChild(el("tbody"));
    scroll.appendChild(t); wrap.appendChild(scroll);
    const qd = el("div"); qd.id = "sc-q";
    const qh = el("h3", "", "Queue");
    const qb = el("button", "", "Charge queue now"); qb.id = "sc-qbtn";
    qb.title = "Run every queued charge now, ignoring the Auto Charge Start/Stop hours";
    qb.onclick = () => { qb.disabled = true;
      fetch("/button/" + encodeURIComponent("Charge queue now") + "/press", { method: "POST", body: "" })
        .catch(() => {}).finally(() => setTimeout(() => { qb.disabled = false; }, 3000)); };
    qh.appendChild(qb); qd.appendChild(qh);
    const qt = el("table"); qt.id = "sc-qt";
    const qhr = el("tr"); ["#", "Shade", "Job", "When"].forEach(h => qhr.appendChild(el("th", "", h)));
    const qth = el("thead"); qth.appendChild(qhr); qt.appendChild(qth); qt.appendChild(el("tbody"));
    qd.appendChild(qt); wrap.appendChild(qd);
    const note = el("div"); note.id = "sc-note"; wrap.appendChild(note);
    place(40);
    // The app may re-render its shadow tree; put the table back if it goes missing.
    setInterval(() => { if (!wrap.isConnected) place(4); }, 2000);
    setInterval(hideSections, 1000);
  }

  function statusFor(name, lastLine) {
    const s = st("text_sensor/Status");
    if (s.startsWith("FAULT")) {
      // "FAULT - <why> on <Shade>, press Clear fault" -- that shade is the fault,
      // the rest are only blocked until it is cleared.
      const m = /^FAULT - (.+?) on (.+?), press/.exec(s);
      if (m && m[2] === name) return ["Fault: " + m[1], "sc-fault"];
      return ["Blocked (fault)", "sc-pause"];
    }
    if (s.startsWith(name + ":")) {
      const rest = s.slice(name.length + 1).trim();
      let m;
      if (/paused/.test(rest)) return ["Paused", "sc-pause"];
      if (/resuming/.test(rest)) return ["Resuming", "sc-run"];
      if (/checking/.test(rest)) return ["Checking", "sc-run"];
      if (/starting/.test(rest)) return ["Starting", "sc-run"];
      if ((m = rest.match(/^([0-9.]+) A \(peak/))) return ["Charging " + Number(m[1]).toFixed(2) + " A", "sc-run"];
    }
    // Queue: "Bedroom 3: charge; Den: charge from 02:00; Den: check"
    const q = st("text_sensor/Queue");
    if (q && q !== "empty") {
      const items = q.split("; ");
      for (let i = 0; i < items.length; i++) {
        const k = items[i].lastIndexOf(": ");
        if (k < 0 || items[i].slice(0, k) !== name) continue;
        const what = items[i].slice(k + 2);
        if (what === "check") return ["Queued #" + (i + 1) + " (check)", "sc-pause"];
        const m = /^charge from (\d\d:\d\d)$/.exec(what);
        if (m) return ["Queued #" + (i + 1) + ", waits for " + m[1], "sc-pause"];
        return ["Queued #" + (i + 1), "sc-pause"];
      }
    }
    if (/NO DRAW|DROPPED OUT|TIME CAP|OVERCURRENT|sensor fault/i.test(lastLine))
      return ["Idle ⚠", "sc-idle sc-warn"];
    return ["Idle", "sc-idle"];
  }

  function render() {
    const tb = wrap && wrap.querySelector("#sc-table tbody");
    if (!tb || !shades.length) return;
    const s = st("text_sensor/Status");
    const busy = /^(.+?): (?:[0-9.]+ A \(peak|starting|checking|resuming|paused)/.exec(s);
    const faulted = s.startsWith("FAULT");
    tb.textContent = "";
    for (const name of shades) {
      const line = st("text_sensor/" + name);            // last charge line
      const learnedFull = st("text_sensor/Learned " + name);
      let learned = learnedFull, check = "";
      const ci = learnedFull.indexOf(" - checked ");
      if (ci >= 0) { learned = learnedFull.slice(0, ci); check = learnedFull.slice(ci + 11); }
      learned = learned.replace(" - use per day known after its next full charge", "")
                       .replace("no completed charge yet", "no full charge yet");
      let details = line, volt = "";
      const vi = line.indexOf(" - start ");
      if (vi >= 0) { details = line.slice(0, vi); volt = line.slice(vi + 9); }
      if (line === "never charged") details = "never charged";
      // Last check: date/time only. Battery: from the newer of the last check
      // reading and the last charge's start voltage.
      let checkWhen = check, checkV = null;
      const cm = /^(.*?): ([0-9.]+) V$/.exec(check);
      if (cm) { checkWhen = cm[1]; checkV = parseFloat(cm[2]); }
      else if (/: no draw$/.test(check)) checkWhen = check.replace(/: no draw$/, " (no draw)");
      const startV = volt ? parseFloat(volt) : null;
      let v = startV;
      if (checkV && (!startV || when(checkWhen) >= when(details))) v = checkV;
      const pct = socFromV(v);
      const batt = pct === null ? "" : "~" + (Math.round(pct / 5) * 5) + " %";

      const tr = el("tr");
      tr.appendChild(el("td", "name", name));
      const [label, cls] = statusFor(name, line);
      const td = el("td"); td.appendChild(el("span", "sc-pill " + cls, label)); tr.appendChild(td);
      tr.appendChild(el("td", "num" + (checkWhen ? "" : " sc-dim"), checkWhen || "—"));
      const bt0 = el("td", "num" + (batt ? "" : " sc-dim"), batt || "—");
      if (v) bt0.title = v.toFixed(2) + " V at the shade";
      tr.appendChild(bt0);
      tr.appendChild(el("td", /NO DRAW|DROPPED|TIME CAP|OVERCURRENT/.test(details) ? "sc-warn" : "", details || "—"));
      tr.appendChild(el("td", "", learned || "—"));
      const bt = el("td"); const b = el("button", "", "Charge");
      const mine = busy && busy[1] === name;
      b.disabled = mine || faulted;
      b.title = faulted ? "Clear the fault first" : mine ? "Running now" : "Queue a charge";
      b.onclick = () => {
        b.disabled = true;
        fetch("/button/" + encodeURIComponent("Charge " + name) + "/press", { method: "POST", body: "" })
          .catch(() => {}).finally(() => setTimeout(() => { b.disabled = false; }, 3000));
      };
      bt.appendChild(b); tr.appendChild(bt);
      tb.appendChild(tr);
    }
    renderQueue();
    renderNote();
  }

  function renderQueue() {
    const tb = wrap && wrap.querySelector("#sc-qt tbody");
    if (!tb) return;
    tb.textContent = "";
    const s = st("text_sensor/Status");
    const run = /^(.+?): (?:[0-9.]+ A \(peak|starting|checking|resuming|paused)/.exec(s);
    let n = 0;
    const row = (cells, cls) => { const tr = el("tr", cls || ""); cells.forEach(c => tr.appendChild(el("td", "", c))); tb.appendChild(tr); };
    if (run) row(["\u25b6", run[1], /checking/.test(s) ? "check" : "charge", "running now"], "");
    const q = st("text_sensor/Queue");
    if (q && q !== "empty") {
      for (const it of q.split("; ")) {
        const k = it.lastIndexOf(": ");
        if (k < 0) continue;
        const what = it.slice(k + 2);
        const m = /^charge from (\d\d:\d\d)$/.exec(what);
        row([String(++n), it.slice(0, k), what === "check" ? "check" : "charge",
             m ? "waits for " + m[1] : "next up"]);
      }
    }
    if (!run && n === 0) row(["", "empty", "", ""], "sc-dim");
  }

  // "Auto check" explained, with the live settings filled in.
  function num(id, d) { const v = parseFloat(st(id)); return isNaN(v) ? d : v; }
  function renderNote() {
    const note = wrap && wrap.querySelector("#sc-note");
    if (!note) return;
    const every = num("number/Auto check every", 0), hour = num("number/Auto Charge Start", 2);
    const below = num("number/Charge below", 13.4), maxh = num("number/Max hours per shade", 8);
    const pause = num("number/Pause minutes", 2);
    const hh = String(Math.round(hour)).padStart(2, "0");
    const until = num("number/Auto Charge Stop", 8);
    const uu = String(Math.round(until)).padStart(2, "0");
    const winTxt = Math.round(until) === Math.round(hour) ? "any time"
      : `only between <b>${hh}:00 and ${uu}:00</b>; one still running at ${uu}:00 stops and goes back to the front of the queue, and the queue picks up again at ${hh}:00 the next day (<i>Charge queue now</i> runs it immediately and ignores these hours)`;
    const qtxt = st("text_sensor/Queue");
    const head = every > 0
      ? `<b>Auto check:</b> every <b>${every} day${every === 1 ? "" : "s"} at ${hh}:00</b> (Auto Charge Start), counted from the last check run (scheduled or <i>Check all</i>), the charger checks each shade in turn.`
      : `<b>Auto check is off</b> (set <i>Auto check every</i> above 0). <i>Check all</i> runs one now.`;
    const last = st("text_sensor/Last check run");
    const nxt = st("text_sensor/Next auto check");
    const lastHtml = (nxt ? `<div style="margin-bottom:4px"><b>Next auto check:</b> ${nxt.replace(/[<>&]/g, "")}</div>` : "") +
      (last ? `<div style="margin-bottom:4px"><b>Last check run:</b> ${last.replace(/[<>&]/g, "")}</div>` : "") +
      "";
    note.innerHTML = lastHtml + head +
      ` First it checks them all: each is connected for 30 s and its pack voltage read (corrected for its cable), then disconnected (~6 mAh).` +
      ` Then it queues a charge for every shade that read <b>below ${below.toFixed(2)} V</b> (very roughly 70 %), <b>lowest voltage first</b>;` +
      ` the pack ends each charge itself (at most <b>${maxh} h per shade</b>). Shades with no draw are skipped.` +
      ` These automatic charges run ${winTxt}. Checks, and charges you start yourself (a shade's Charge button, or Charge all), run any time.` +
      ` Checks don't count as charges. A shade moved while charging still moves: HA pauses the charge for ${pause} min.`;
  }

  // Rough state of charge from the voltage 30 s into a charge (cable-corrected).
  // From the first packs measured (2026-10-08..11), assuming ~2.5 Ah packs:
  // 12.26 V took 2.27 Ah (~9 %), 13.20 V took 0.83 Ah (~67 %), ~13.6 V ~full.
  const SOC = [[12.10, 0], [12.26, 9], [13.20, 67], [13.60, 100]];
  function socFromV(v) {
    if (!(v > 0)) return null;
    if (v <= SOC[0][0]) return 0;
    for (let i = 1; i < SOC.length; i++) {
      const [v0, p0] = SOC[i - 1], [v1, p1] = SOC[i];
      if (v <= v1) return p0 + (p1 - p0) * (v - v0) / (v1 - v0);
    }
    return 100;
  }
  const MON = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
  function when(txt) {            // "Oct 11 18:04" -> comparable number
    const m = /^([A-Z][a-z]{2}) (\d{1,2}) (\d{2}):(\d{2})/.exec(txt || "");
    return m ? ((MON[m[1]] * 31 + +m[2]) * 24 + +m[3]) * 60 + +m[4] : -1;
  }

  let pending = false;
  function schedule() { if (!pending) { pending = true; setTimeout(() => { pending = false; render(); }, 150); } }

  function onState(ev) {
    let d; try { d = JSON.parse(ev.data); } catch (e) { return; }
    const key = d.name_id || d.id;
    if (!key) return;
    S[key] = d;
    if (key === "select/Relay 1 shade" && Array.isArray(d.option)) {
      const order = d.option.filter(o => o !== "(none)");
      if (order.join("|") !== shades.join("|")) shades = order;
    }
    schedule();
  }

  function connect() {
    const es = new EventSource("/events");
    es.addEventListener("state", onState);
    es.onerror = () => { es.close(); setTimeout(connect, 5000); };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { mount(); connect(); });
  else { mount(); connect(); }
})();
