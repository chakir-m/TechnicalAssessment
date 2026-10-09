(() => {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const app = document.getElementById("app");

  const TRACKS = {
    js: "JavaScript / Node", java: "Java / Spring", dotnet: "C# / .NET",
    php: "PHP / Laravel", python: "Python / Django"
  };
  const STEP_NAMES = ["Quiz", "Stage 1: Data", "Stage 2: Business rules", "Stage 3: Concurrency bug", "Stage 4: Security"];
  const EVENT_NAMES = {
    tab_hidden: "Left the tab", focus_lost: "Window lost focus", paste: "Pasted text",
    copy: "Copied text", resumed: "Reopened the test"
  };

  let sb = null;
  let rows = [];
  let questions = [];
  let search = "";

  // ------------------------------------------------------------ helpers

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  const fmtDate = d => d ? new Date(d).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "";
  function fmtDur(ms) {
    if (ms == null || isNaN(ms) || ms < 0) return "";
    const s = Math.round(ms / 1000);
    return Math.floor(s / 60) + " min " + String(s % 60).padStart(2, "0") + " s";
  }
  const num = v => Number(v || 0);

  function testUrl(token) {
    const base = location.href.split("?")[0].split("#")[0].replace(/admin\.html$/, "");
    return (base.endsWith("/") ? base : base + "/") + "index.html?t=" + token;
  }

  function status(c) {
    if (!c.started_at) return { key: "invited", label: "Invited" };
    if (c.submitted_at) return c.current_step >= 5 ? { key: "completed", label: "Completed" } : { key: "timeover", label: "Time over" };
    if (Date.now() > Date.parse(c.deadline) + 15000) return { key: "timeover", label: "Time over" };
    return { key: "progress", label: "In progress" };
  }
  function reached(c) {
    if (!c.started_at) return "";
    if (c.current_step >= 5) return "All stages";
    return c.current_step === 0 ? "Quiz" : "Stage " + c.current_step;
  }
  function timeUsed(c) {
    if (!c.started_at) return null;
    const end = c.submitted_at ? Date.parse(c.submitted_at) : Math.min(Date.now(), Date.parse(c.deadline));
    return end - Date.parse(c.started_at);
  }
  function total(c) { return num(c.auto_total) + num(c.manual_total); }

  async function copy(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      const old = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => { btn.textContent = old; }, 1500);
    } catch (_) {
      prompt("Copy this link:", text);
    }
  }

  // ------------------------------------------------------------ auth

  async function init() {
    if (!window.supabase || !cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("YOUR-PROJECT")) {
      app.replaceChildren(el("main", { class: "message panel" },
        el("h1", { text: "Configuration needed" }),
        el("p", { text: "Open config.js and fill in SUPABASE_URL and SUPABASE_ANON_KEY from your Supabase project settings." })));
      return;
    }
    const baseUrl = (function (u) { try { return new URL(String(u).trim()).origin; } catch (_) { return String(u).trim(); } })(cfg.SUPABASE_URL);
    sb = window.supabase.createClient(baseUrl, String(cfg.SUPABASE_ANON_KEY).trim());
    const { data } = await sb.auth.getSession();
    if (data.session) checkAdmin(); else showLogin();
  }

  function showLogin(message) {
    const email = el("input", { type: "email", id: "email", autocomplete: "username", required: true });
    const pass = el("input", { type: "password", id: "password", autocomplete: "current-password", required: true });
    const err = el("p", { class: "error-text", text: message || "" });
    const btn = el("button", { class: "primary", type: "submit", text: "Sign in" });
    const form = el("form", {},
      el("div", {}, el("label", { for: "email", text: "Email" }), email),
      el("div", {}, el("label", { for: "password", text: "Password" }), pass),
      err, btn);
    form.addEventListener("submit", async e => {
      e.preventDefault();
      btn.disabled = true;
      const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
      btn.disabled = false;
      if (error) {
        const m = (error.message || "").toLowerCase();
        if (m.includes("invalid login credentials")) err.textContent = "Email or password is incorrect.";
        else if (m.includes("email not confirmed")) err.textContent = "This account is not confirmed. In Supabase > Authentication > Users, confirm the user or recreate it with Auto Confirm User ticked.";
        else if (m.includes("logins are disabled") || m.includes("provider is not enabled") || m.includes("signups not allowed")) err.textContent = "Email sign-in is turned off. In Supabase > Authentication > Sign In / Providers, enable the Email provider (keep only new sign-ups turned off).";
        else if (m.includes("api key") || m.includes("fetch") || m.includes("network")) err.textContent = "Cannot reach Supabase. Check SUPABASE_URL and the publishable key in config.js. (" + error.message + ")";
        else err.textContent = "Sign-in failed: " + error.message;
        return;
      }
      checkAdmin();
    });
    app.replaceChildren(el("main", { class: "login panel" },
      el("h1", { text: "Back office" }),
      el("p", { class: "muted", text: (cfg.COMPANY_NAME || "") + " technical assessments" }),
      form));
  }

  async function checkAdmin() {
    const { data, error } = await sb.rpc("is_admin");
    if (error || !data) {
      await sb.auth.signOut();
      showLogin("This account is not allowed to see results. Add its email to the admins table in Supabase.");
      return;
    }
    showDashboard();
  }

  // ------------------------------------------------------------ dashboard

  async function load() {
    const [r, q] = await Promise.all([
      sb.from("results").select("*").order("created_at", { ascending: false }),
      questions.length ? Promise.resolve({ data: questions }) : sb.from("questions").select("*").order("position")
    ]);
    if (r.error) throw r.error;
    rows = r.data || [];
    questions = q.data || [];
  }

  async function showDashboard() {
    const refreshBtn = el("button", { text: "Refresh" });
    const csvBtn = el("button", { text: "Export CSV" });
    const outBtn = el("button", { text: "Sign out" });
    const tableHost = el("div");

    refreshBtn.addEventListener("click", async () => { refreshBtn.disabled = true; await refresh(tableHost); refreshBtn.disabled = false; });
    csvBtn.addEventListener("click", exportCsv);
    outBtn.addEventListener("click", async () => { await sb.auth.signOut(); showLogin(); });

    app.replaceChildren(
      el("header", { class: "admin-top" }, el("div", { class: "inner" },
        el("h1", { text: (cfg.COMPANY_NAME ? cfg.COMPANY_NAME + ": " : "") + "Technical assessments" }),
        refreshBtn, csvBtn, outBtn)),
      el("main", { class: "admin-main" }, inviteCard(tableHost), tableHost));
    await refresh(tableHost);
  }

  async function refresh(host) {
    try { await load(); drawTable(host); }
    catch (e) { host.replaceChildren(el("p", { class: "error-text", text: "Results could not load: " + (e.message || e) })); }
  }

  function inviteCard(tableHost) {
    const name = el("input", { id: "inv-name", required: true, placeholder: "Full name" });
    const email = el("input", { id: "inv-email", type: "email", placeholder: "name@example.com" });
    const track = el("select", { id: "inv-track" },
      el("option", { value: "", text: "Candidate chooses" }),
      Object.entries(TRACKS).map(([k, v]) => el("option", { value: k, text: v })));
    const duration = el("input", { id: "inv-duration", type: "number", min: "5", max: "240", value: "30" });
    const btn = el("button", { class: "primary", type: "submit", text: "Create link" });
    const result = el("div");
    const form = el("form", { class: "invite-form" },
      el("div", {}, el("label", { for: "inv-name", text: "Candidate" }), name),
      el("div", {}, el("label", { for: "inv-email", text: "Email (optional)" }), email),
      el("div", {}, el("label", { for: "inv-track", text: "Language" }), track),
      el("div", {}, el("label", { for: "inv-duration", text: "Minutes" }), duration),
      btn);

    form.addEventListener("submit", async e => {
      e.preventDefault();
      if (!name.value.trim()) { name.focus(); return; }
      btn.disabled = true;
      const { data, error } = await sb.from("candidates").insert({
        full_name: name.value.trim(),
        email: email.value.trim() || null,
        track: track.value || null,
        duration_minutes: Math.min(240, Math.max(5, parseInt(duration.value, 10) || 30))
      }).select().single();
      btn.disabled = false;
      if (error) { result.replaceChildren(el("p", { class: "error-text", text: "The link could not be created: " + error.message })); return; }
      result.replaceChildren(linkBox(data));
      form.reset();
      duration.value = "30";
      refresh(tableHost);
    });

    return el("section", { class: "panel" }, el("h2", { text: "Invite a candidate" }), form, result);
  }

  function linkBox(c) {
    const url = testUrl(c.token);
    const copyBtn = el("button", { type: "button", text: "Copy link" });
    copyBtn.addEventListener("click", () => copy(url, copyBtn));
    const subject = "Technical assessment" + (cfg.COMPANY_NAME ? ", " + cfg.COMPANY_NAME : "");
    const body = "Hello " + c.full_name + ",\n\nHere is the link to your technical assessment:\n" + url +
      "\n\nThe test lasts " + c.duration_minutes + " minutes. The timer starts when you press the start button, so open it when you are ready, on a computer with a stable internet connection.\n\nGood luck!";
    const mail = el("a", { href: "mailto:" + encodeURIComponent(c.email || "") + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body), text: "Open an email to the candidate" });
    return el("div", { class: "link-box" },
      el("strong", { text: "Link for " + c.full_name }),
      el("input", { readonly: true, value: url, onclick: e => e.target.select() }),
      el("div", { class: "link-actions" }, copyBtn, mail));
  }

  function drawTable(host) {
    const searchInput = el("input", { type: "search", placeholder: "Search a name or email", value: search, "aria-label": "Search candidates" });
    const list = rows.filter(c => !search || (c.full_name + " " + (c.email || "")).toLowerCase().includes(search.toLowerCase()));
    const tbody = el("tbody");
    list.forEach(c => {
      const st = status(c);
      const pct = num(c.max_points) ? Math.round(100 * total(c) / num(c.max_points)) : 0;
      const tr = el("tr", { tabindex: "0" },
        el("td", {}, c.full_name, el("span", { class: "sub", text: c.email || "" })),
        el("td", { text: c.track ? TRACKS[c.track] : "Not chosen yet" }),
        el("td", {}, el("span", { class: "pill " + st.key, text: st.label })),
        el("td", { class: "score-cell" }, c.started_at ? [total(c) + " / " + num(c.max_points) + " (" + pct + "%)",
          el("span", { class: "bar" }, el("i", { style: "width:" + pct + "%" }))] : ""),
        el("td", { text: reached(c) }),
        el("td", { text: fmtDur(timeUsed(c)) }),
        el("td", {}, num(c.flag_count) ? el("span", { class: "flag", text: String(c.flag_count) }) : "0"),
        el("td", { text: num(c.pending_reviews) ? num(c.pending_reviews) + " to score" : (c.started_at ? "Done" : "") }),
        el("td", { class: "muted", text: fmtDate(c.created_at) }));
      tr.addEventListener("click", () => openCandidate(c.id, host));
      tr.addEventListener("keydown", e => { if (e.key === "Enter") openCandidate(c.id, host); });
      tbody.append(tr);
    });

    const table = list.length
      ? el("div", { class: "table-wrap" }, el("table", {},
          el("thead", {}, el("tr", {}, ["Candidate", "Language", "Status", "Score", "Reached", "Time used", "Signals", "Code review", "Invited"].map(h => el("th", { text: h })))),
          tbody))
      : el("p", { class: "empty", text: rows.length ? "No candidate matches this search." : "No candidates yet. Create a link above to invite your first candidate." });

    searchInput.addEventListener("input", () => {
      search = searchInput.value;
      drawTable(host);
      const again = host.querySelector("input[type=search]");
      again.focus();
      again.setSelectionRange(search.length, search.length);
    });

    host.replaceChildren(el("section", { class: "panel" },
      el("div", { class: "table-tools" }, el("h2", { text: "Candidates (" + rows.length + ")" }), searchInput), table));
  }

  // ------------------------------------------------------------ candidate drawer

  async function openCandidate(id, tableHost) {
    const c = rows.find(r => r.id === id);
    if (!c) return;
    const [a, ev] = await Promise.all([
      sb.from("answers").select("*").eq("candidate_id", id),
      sb.from("events").select("*").eq("candidate_id", id).order("at")
    ]);
    const answers = {};
    (a.data || []).forEach(x => { answers[x.question_id] = x; });
    const events = ev.data || [];

    const bg = el("div", { class: "drawer-bg" });
    const close = () => { bg.remove(); drawer.remove(); document.removeEventListener("keydown", esc); refresh(tableHost); };
    const esc = e => { if (e.key === "Escape") close(); };
    bg.addEventListener("click", close);
    document.addEventListener("keydown", esc);

    const st = status(c);
    const closeBtn = el("button", { text: "Close" });
    closeBtn.addEventListener("click", close);

    const drawer = el("aside", { class: "drawer", role: "dialog", "aria-modal": "true", "aria-label": "Results of " + c.full_name },
      el("div", { class: "drawer-head" },
        el("div", { class: "title" }, el("h2", { text: c.full_name }),
          el("span", { class: "muted small", text: [c.email, c.track ? TRACKS[c.track] : null, st.label].filter(Boolean).join(", ") })),
        closeBtn),
      el("div", { class: "drawer-body" },
        statsBlock(c),
        stepTimes(c),
        c.started_at ? STEP_NAMES.map((n, i) => stepBlock(c, i, answers)) : el("p", { class: "muted", text: "The candidate has not started the test yet." }),
        eventsBlock(c, events),
        actionsBlock(c, close)));

    document.body.append(bg, drawer);
    closeBtn.focus();
  }

  function statsBlock(c) {
    const stat = (v, l) => el("div", { class: "stat" }, el("b", { text: v }), el("span", { text: l }));
    return el("div", { class: "stats" },
      stat(total(c) + " / " + num(c.max_points), "Total score"),
      stat(num(c.auto_total) + "", "Auto-graded points"),
      stat(num(c.manual_total) + (num(c.pending_reviews) ? " (" + c.pending_reviews + " left)" : ""), "Your code review points"),
      stat(reached(c) || "Not started", "Furthest step"));
  }

  function stepTimes(c) {
    const t = c.step_times || {};
    const keys = ["0", "1", "2", "3", "4"].filter(k => t[k]);
    if (!keys.length) return null;
    const parts = keys.map((k, i) => {
      const start = Date.parse(t[k]);
      const next = keys[i + 1] ? Date.parse(t[keys[i + 1]]) : (t.end ? Date.parse(t.end) : null);
      return (k === "0" ? "Quiz" : "Stage " + k) + ": " + (next ? fmtDur(next - start) : "in progress");
    });
    return el("p", { class: "small muted", text: "Started " + fmtDate(c.started_at) + ". Time per step: " + parts.join(", ") + "." });
  }

  function stepBlock(c, step, answers) {
    const qs = questions.filter(q => (q.track === "core" || q.track === c.track) &&
      (step === 0 ? q.section === "mcq" : q.section === "stage" && q.stage === step));
    const notReached = c.current_step < step;
    let got = 0, max = 0;
    qs.forEach(q => {
      max += num(q.points);
      const a = answers[q.id];
      if (a) got += q.kind === "choice" ? num(a.auto_score) : num(a.manual_score);
    });
    return el("section", { class: "step-block" },
      el("h3", {}, STEP_NAMES[step], el("span", { text: notReached ? "Not reached" : got + " / " + max })),
      notReached ? null : qs.map(q => reviewCard(q, answers[q.id], c)));
  }

  function reviewCard(q, a, c) {
    const card = el("div", { class: "review" });
    card.append(el("div", { class: "q-meta" }, el("span", { text: q.title || q.id }), el("span", { text: q.points + " pts" })));
    card.append(el("div", { class: "q-prompt", text: q.prompt }));
    if (q.snippet) {
      card.append(el("details", { class: "rubric" }, el("summary", { text: "Show the code shown to the candidate" }),
        el("pre", { class: "answer" }, q.snippet)));
    }
    if (q.kind === "choice") {
      if (!a || a.choice == null) {
        card.append(el("div", { class: "answer-line none", text: "No answer" }));
      } else {
        const right = a.choice === q.correct;
        card.append(el("div", { class: "answer-line " + (right ? "right" : "wrong"),
          text: (right ? "Correct: " : "Wrong: ") + q.options[a.choice] }));
        if (!right) card.append(el("div", { class: "answer-line right", text: "Expected: " + q.options[q.correct] }));
      }
      return card;
    }

    const text = a && a.answer_text && a.answer_text.trim() ? a.answer_text : null;
    card.append(text ? el("pre", { class: "answer" }, text) : el("div", { class: "answer-line none", text: "No answer" }));
    if (q.rubric) card.append(el("details", { class: "rubric", open: !!text && (a.manual_score == null) },
      el("summary", { text: "Scoring guide" }), el("div", { text: q.rubric })));
    if (text) {
      const input = el("input", { type: "number", min: "0", max: String(q.points), step: "0.5",
        value: a.manual_score != null ? String(a.manual_score) : "", "aria-label": "Score for " + (q.title || q.id) });
      const save = el("button", { text: "Save score" });
      const note = el("span", { class: "small muted", text: a.manual_score != null ? "Saved" : "Not scored yet" });
      save.addEventListener("click", async () => {
        let v = parseFloat(input.value);
        if (isNaN(v)) { input.focus(); return; }
        v = Math.max(0, Math.min(num(q.points), v));
        input.value = String(v);
        save.disabled = true;
        const { error } = await sb.from("answers").update({ manual_score: v })
          .eq("candidate_id", c.id).eq("question_id", q.id);
        save.disabled = false;
        if (error) { note.textContent = "Not saved: " + error.message; return; }
        note.textContent = "Saved";
        a.manual_score = v;
      });
      card.append(el("div", { class: "score-input" }, input, el("span", { text: "/ " + q.points }), save, note));
    }
    return card;
  }

  function eventsBlock(c, events) {
    if (!c.started_at) return null;
    if (!events.length) return el("section", {}, el("h3", { text: "Integrity signals" }), el("p", { class: "muted small", text: "No signals recorded." }));
    const counts = {};
    events.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
    const start = Date.parse(c.started_at);
    return el("section", {},
      el("h3", { text: "Integrity signals" }),
      el("p", { class: "small", text: Object.entries(counts).map(([k, n]) => (EVENT_NAMES[k] || k) + ": " + n).join(", ") }),
      el("p", { class: "small muted", text: "These are signals, not proof. Discuss them with the candidate in the interview, for example by asking them to explain a pasted answer." }),
      el("details", { class: "rubric" }, el("summary", { text: "Show the timeline" }),
        el("div", { class: "events-list" }, events.map(e =>
          el("span", { text: "+" + fmtDur(Date.parse(e.at) - start) + "  " + (EVENT_NAMES[e.type] || e.type) + (e.detail ? " (" + e.detail + ")" : "") })))));
  }

  function actionsBlock(c, close) {
    const copyBtn = el("button", { text: "Copy test link" });
    copyBtn.addEventListener("click", () => copy(testUrl(c.token), copyBtn));
    const resetBtn = el("button", { text: "Reset attempt" });
    resetBtn.addEventListener("click", async () => {
      if (!confirm("Delete " + c.full_name + "'s answers and let them start again with a fresh timer? Use this only after a technical problem.")) return;
      await sb.from("answers").delete().eq("candidate_id", c.id);
      await sb.from("events").delete().eq("candidate_id", c.id);
      const { error } = await sb.from("candidates").update({
        started_at: null, deadline: null, submitted_at: null, current_step: 0, step_times: {}
      }).eq("id", c.id);
      if (error) { alert("Reset failed: " + error.message); return; }
      close();
    });
    const delBtn = el("button", { class: "danger", text: "Delete candidate" });
    delBtn.addEventListener("click", async () => {
      if (!confirm("Delete " + c.full_name + " and all their answers? This cannot be undone.")) return;
      const { error } = await sb.from("candidates").delete().eq("id", c.id);
      if (error) { alert("Delete failed: " + error.message); return; }
      close();
    });
    return el("div", { class: "drawer-actions" }, copyBtn, resetBtn, delBtn);
  }

  // ------------------------------------------------------------ export

  function exportCsv() {
    const head = ["Name", "Email", "Language", "Status", "Auto points", "Review points", "Total", "Max", "Percent",
      "Furthest step", "Started", "Submitted", "Minutes used", "Signals", "Code answers to score"];
    const lines = [head].concat(rows.map(c => {
      const pct = num(c.max_points) ? Math.round(100 * total(c) / num(c.max_points)) : "";
      const used = timeUsed(c);
      return [c.full_name, c.email || "", c.track ? TRACKS[c.track] : "", status(c).label,
        num(c.auto_total), num(c.manual_total), total(c), num(c.max_points), pct, reached(c),
        c.started_at || "", c.submitted_at || "", used != null ? (used / 60000).toFixed(1) : "",
        num(c.flag_count), num(c.pending_reviews)];
    }));
    const csv = lines.map(r => r.map(v => {
      const s = String(v);
      return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(",")).join("\r\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const link = el("a", { href: URL.createObjectURL(blob), download: "assessment-results.csv" });
    document.body.append(link);
    link.click();
    link.remove();
  }

  init();
})();
