(() => {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const app = document.getElementById("app");

  const STACKS = [["js", "JavaScript / TypeScript"], ["java", "Java"], ["csharp", "C# / .NET"], ["php", "PHP"], ["python", "Python"]];
  const PROG_LANGS = ["js", "java", "csharp", "php", "python"];
  const LANG_LABEL = {
    js: "JavaScript / TS", java: "Java", csharp: "C#", php: "PHP", python: "Python",
    sql: "SQL", general: "Web and tools", design: "Software design", algorithms: "Algorithms",
    any: "Not specified", other: "Other language"
  };
  const DECISIONS = [["", "Not decided"], ["shortlisted", "Shortlisted"], ["interview", "Interview"], ["on_hold", "On hold"], ["rejected", "Rejected"], ["hired", "Hired"]];
  const EVENT_NAMES = {
    tab_hidden: "Left the tab", focus_lost: "Window lost focus", paste: "Pasted text",
    copy: "Copied text", resumed: "Reopened the test"
  };

  let sb = null;
  let rows = [];
  let skills = [];
  let questions = [];
  let stages = [];
  let view = "candidates";
  let search = "";
  let statusFilter = "";
  let lastCreated = null;
  const MAX_QUESTIONS = 35;   // upper limit on questions per candidate

  // ================================================================ helpers

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

  const num = v => Number(v || 0);
  const pct = (a, b) => (num(b) ? Math.round(100 * num(a) / num(b)) : 0);
  const fmtDate = d => d ? new Date(d).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
  function fmtDur(ms) {
    if (ms == null || isNaN(ms) || ms < 0) return "";
    const s = Math.round(ms / 1000);
    return Math.floor(s / 60) + " min " + String(s % 60).padStart(2, "0") + " s";
  }
  const fmtPts = v => String(Math.round(num(v) * 10) / 10);

  function testUrl(token) {
    const url = new URL("index.html", location.origin + location.pathname);
    url.searchParams.set("t", token);
    return url.href;
  }

  function status(c) {
    if (!c.started_at) return { key: "invited", label: "Invited" };
    if (c.submitted_at) return c.current_step === 99 ? { key: "completed", label: "Completed" } : { key: "timeover", label: "Ended early" };
    if (Date.now() > Date.parse(c.deadline) + 15000) return { key: "timeover", label: "Ended early" };
    return { key: "progress", label: "In progress" };
  }
  function stageTitle(step) {
    const s = stages.find(x => x.step === step);
    return s ? s.title : "Stage " + step;
  }
  function reached(c) {
    if (!c.started_at || c.current_step == null) return "";
    if (c.current_step === 99) return "All stages";
    const pos = stages.filter(s => s.step <= c.current_step && s.choice_count + s.code_count > 0).length;
    return "Stage " + (pos || c.current_step) + ": " + stageTitle(c.current_step);
  }
  function timeUsed(c) {
    if (!c.started_at) return null;
    const end = c.submitted_at ? Date.parse(c.submitted_at) : Math.min(Date.now(), Date.parse(c.deadline));
    return end - Date.parse(c.started_at);
  }
  const total = c => num(c.auto_total) + num(c.manual_total);
  const decisionLabel = d => (DECISIONS.find(x => x[0] === (d || "")) || DECISIONS[0])[1];

  function skillsOf(id) { return skills.filter(s => s.candidate_id === id); }
  function bestLanguage(id) {
    const list = skillsOf(id).filter(s => PROG_LANGS.includes(s.lang) && num(s.possible) > 0);
    if (!list.length) return null;
    list.sort((a, b) => (num(b.earned) / num(b.possible)) - (num(a.earned) / num(a.possible)) || num(b.possible) - num(a.possible));
    const s = list[0];
    if (!num(s.earned)) return null;
    return { lang: s.lang, pct: pct(s.earned, s.possible), questions: num(s.questions), pending: num(s.pending) };
  }

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

  function modal(title, text, okLabel, cancelLabel) {
    return new Promise(resolve => {
      const ok = el("button", { class: "primary", text: okLabel });
      const cancel = cancelLabel ? el("button", { text: cancelLabel }) : null;
      const bg = el("div", { class: "modal-bg" }, el("div", { class: "modal", role: "dialog", "aria-modal": "true" },
        el("h2", { text: title }), el("p", { text }), el("div", { class: "modal-actions" }, cancel, ok)));
      const close = v => { bg.remove(); resolve(v); };
      ok.addEventListener("click", () => close(true));
      if (cancel) cancel.addEventListener("click", () => close(false));
      document.body.append(bg);
      (cancel || ok).focus();
    });
  }

  function toast(text) {
    let host = document.querySelector(".toast-host");
    if (!host) { host = el("div", { class: "toast-host", role: "status", "aria-live": "polite" }); document.body.append(host); }
    const t = el("div", { class: "toast", text });
    host.append(t);
    setTimeout(() => t.remove(), 4000);
  }

  // Horizontal bars: one hue, value in ink, details on hover.
  function barChart(items) {
    return el("div", { class: "bars" }, items.map(it => {
      const p = it.possible ? Math.round(100 * it.earned / it.possible) : null;
      const tip = it.name + ": " + fmtPts(it.earned) + " of " + fmtPts(it.possible) + " points" +
        (it.questions != null ? ", " + it.questions + (it.questions === 1 ? " question" : " questions") : "") +
        (it.pending ? ", " + it.pending + " written answer(s) not scored yet" : "");
      return el("div", { class: "bar-row" + (p === null ? " na" : ""), title: tip },
        el("span", { class: "name", text: it.name }),
        el("span", { class: "bar-track" }, !p ? null : el("span", { class: "bar-fill", style: "width:" + p + "%" })),
        el("span", { class: "val" }, p === null ? "n/a" : p + "%" + (it.pending ? " *" : ""),
          el("small", { text: it.sub || (fmtPts(it.earned) + " / " + fmtPts(it.possible) + " pts") })));
    }));
  }

  // ================================================================ auth

  async function init() {
    if (!window.supabase || !cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("YOUR-PROJECT")) {
      app.replaceChildren(el("main", { class: "login" }, el("div", { class: "panel" },
        el("h1", { text: "Configuration needed" }),
        el("p", { text: "Open config.js and fill in SUPABASE_URL and SUPABASE_ANON_KEY from your Supabase project settings." }))));
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
    const err = el("p", { class: "error-text", role: "alert", text: message || "" });
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
        else if (m.includes("logins are disabled") || m.includes("provider is not enabled")) err.textContent = "Email sign-in is turned off. In Supabase > Authentication > Sign In / Providers, enable the Email provider.";
        else if (m.includes("api key") || m.includes("fetch") || m.includes("network") || m.includes("path")) err.textContent = "Cannot reach Supabase. Check SUPABASE_URL and the key in config.js. (" + error.message + ")";
        else err.textContent = "Sign-in failed: " + error.message;
        return;
      }
      checkAdmin();
    });
    app.replaceChildren(el("main", { class: "login" }, el("div", { class: "panel" },
      el("h1", { text: "Back office" }),
      el("p", { class: "muted", text: (cfg.COMPANY_NAME ? cfg.COMPANY_NAME + " " : "") + "technical assessments" }),
      form)));
  }

  async function checkAdmin() {
    const { data, error } = await sb.rpc("is_admin");
    if (error || !data) {
      await sb.auth.signOut();
      showLogin("This account is not allowed to see results. Add its email to the admins table in Supabase.");
      return;
    }
    showShell();
  }

  // ================================================================ shell

  async function load() {
    const [r, s, q, st] = await Promise.all([
      sb.from("results").select("*").order("created_at", { ascending: false }),
      sb.from("skill_scores").select("*"),
      sb.from("questions").select("*").order("stage").order("id"),
      sb.from("stages").select("*").order("step")
    ]);
    for (const res of [r, s, q, st]) if (res.error) throw res.error;
    rows = r.data || [];
    skills = s.data || [];
    questions = q.data || [];
    stages = st.data || [];
  }

  let mainHost = null;
  function showShell() {
    const tab = (id, label) => el("button", {
      role: "tab", "aria-selected": String(view === id), text: label,
      onclick: () => { view = id; showShell(); }
    });
    const refreshBtn = el("button", { text: "Refresh" });
    refreshBtn.addEventListener("click", async () => { refreshBtn.disabled = true; await refresh(); refreshBtn.disabled = false; });
    const outBtn = el("button", { text: "Sign out", onclick: async () => { await sb.auth.signOut(); showLogin(); } });
    mainHost = el("main", { class: "a-main" }, el("p", { class: "muted", text: "Loading…" }));
    app.replaceChildren(
      el("header", { class: "a-header" }, el("div", { class: "inner" },
        el("h1", { text: (cfg.COMPANY_NAME ? cfg.COMPANY_NAME + " " : "") + "Assessments" }),
        el("nav", { class: "a-tabs", role: "tablist" }, tab("candidates", "Candidates"), tab("settings", "Test settings")),
        el("div", { class: "tools", style: "display:flex;gap:.5rem" }, refreshBtn, outBtn))),
      mainHost);
    refresh();
  }

  async function refresh() {
    try {
      await load();
      if (view === "settings") drawSettings(); else drawCandidates();
    } catch (e) {
      mainHost.replaceChildren(el("div", { class: "panel" },
        el("p", { class: "error-text", text: "Data could not load: " + (e.message || e) }),
        el("p", { class: "muted small", text: "If you just updated the files, run 01_schema.sql and 02_questions.sql again in the Supabase SQL Editor." })));
    }
  }

  // ================================================================ candidates view

  function drawCandidates() {
    const finished = rows.filter(c => c.submitted_at);
    const avg = finished.length ? Math.round(finished.reduce((n, c) => n + pct(total(c), c.max_points), 0) / finished.length) : null;
    const kpi = (v, l) => el("div", { class: "kpi" }, el("b", { text: v }), el("span", { text: l }));
    const kpis = el("section", { class: "kpis", "aria-label": "Summary" },
      kpi(String(rows.length), "Candidates invited"),
      kpi(String(rows.filter(c => status(c).key === "progress").length), "Taking the test now"),
      kpi(String(finished.length), "Finished"),
      kpi(avg === null ? "–" : avg + "%", "Average score of finished tests"),
      kpi(String(rows.filter(c => num(c.pending_reviews) > 0).length), "Waiting for your review"));

    const tableHost = el("div");
    mainHost.replaceChildren(kpis, inviteCard(), tableHost);
    drawTable(tableHost);
  }

  function inviteCard() {
    const name = el("input", { id: "inv-name", required: true, placeholder: "First and last name" });
    const email = el("input", { id: "inv-email", type: "email", placeholder: "name@example.com" });
    const position = el("input", { id: "inv-position", placeholder: "For example: Junior full-stack" });
    const duration = el("input", { id: "inv-duration", type: "number", min: "5", max: "240", value: "30" });
    const checks = STACKS.map(([v, l]) => {
      const box = el("input", { type: "checkbox", value: v, checked: true });
      return { box, node: el("label", { class: "toggle" }, box, el("span", { text: l })) };
    });
    const btn = el("button", { class: "primary", type: "submit", text: "Create test link" });
    const result = el("div");
    const form = el("form", { class: "invite-grid" },
      el("div", {}, el("label", { for: "inv-name", text: "Candidate" }), name),
      el("div", {}, el("label", { for: "inv-email", text: "Email (optional)" }), email),
      el("div", {}, el("label", { for: "inv-position", text: "Position (internal, optional)" }), position),
      el("div", {}, el("label", { for: "inv-duration", text: "Minutes" }), duration),
      el("div", { class: "stacks-field" },
        el("label", { text: "Technologies in the test" }),
        el("div", { class: "toggle-group" }, checks.map(c => c.node)),
        el("div", { class: "field-hint", text: "Questions are drawn at random from these stacks, plus web, SQL and security basics. Each candidate gets a different set." })),
      el("div", { class: "submit-field" }, btn));

    form.addEventListener("submit", async e => {
      e.preventDefault();
      if (!name.value.trim()) { name.focus(); return; }
      const stacks = checks.filter(c => c.box.checked).map(c => c.box.value);
      if (!stacks.length) { result.replaceChildren(el("p", { class: "error-text", text: "Select at least one technology." })); return; }
      btn.disabled = true;
      const { data, error } = await sb.from("candidates").insert({
        full_name: name.value.trim(),
        email: email.value.trim() || null,
        position: position.value.trim() || null,
        stacks,
        duration_minutes: Math.min(240, Math.max(5, parseInt(duration.value, 10) || 30))
      }).select().single();
      btn.disabled = false;
      if (error) { result.replaceChildren(el("p", { class: "error-text", text: "The link could not be created: " + error.message })); return; }
      lastCreated = data;
      await load();
      drawCandidates();
    });

    if (lastCreated) result.append(linkBox(lastCreated));
    return el("section", { class: "panel" }, el("h2", { text: "Invite a candidate" }), form, result);
  }

  function linkBox(c) {
    const url = testUrl(c.token);
    const copyBtn = el("button", { type: "button", text: "Copy link" });
    copyBtn.addEventListener("click", () => copy(url, copyBtn));
    const subject = "Your technical assessment";
    const body = "Hello " + c.full_name + ",\n\nHere is the link to your technical assessment:\n" + url +
      "\n\nThe assessment lasts " + c.duration_minutes + " minutes. The timer starts when you press the start button, so open it when you are ready, on a computer with a stable internet connection.\n\nGood luck!";
    const mail = el("a", { class: "button", href: "mailto:" + encodeURIComponent(c.email || "") + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body), text: "Write the invitation email" });
    return el("div", { class: "link-box" },
      el("strong", { text: "Test link for " + c.full_name }),
      el("input", { readonly: true, value: url, onclick: e => e.target.select(), "aria-label": "Test link" }),
      el("div", { class: "link-actions" }, copyBtn, mail));
  }

  function drawTable(host) {
    host.id = "table-host";
    const searchInput = el("input", { type: "search", placeholder: "Search name, email or position", value: search, "aria-label": "Search candidates" });
    const filter = el("select", { "aria-label": "Filter by status" },
      [["", "All statuses"], ["invited", "Invited"], ["progress", "In progress"], ["completed", "Completed"], ["timeover", "Ended early"], ["review", "Waiting for review"]]
        .map(([v, l]) => el("option", { value: v, text: l, selected: statusFilter === v })));

    const list = rows.filter(c => {
      const hay = (c.full_name + " " + (c.email || "") + " " + (c.position || "")).toLowerCase();
      if (search && !hay.includes(search.toLowerCase())) return false;
      if (statusFilter === "review") return num(c.pending_reviews) > 0;
      if (statusFilter) return status(c).key === statusFilter;
      return true;
    });

    const tbody = el("tbody");
    list.forEach(c => {
      const st = status(c);
      const p = pct(total(c), c.max_points);
      const best = bestLanguage(c.id);
      const tr = el("tr", { class: "clickable", tabindex: "0" },
        el("td", {}, c.full_name, el("span", { class: "sub", text: [c.email, c.position].filter(Boolean).join(", ") })),
        el("td", {}, el("span", { class: "pill " + st.key, text: st.label })),
        el("td", {}, c.started_at ? el("div", { class: "score-cell" },
          el("span", { text: p + "%" }), el("span", { class: "minibar" }, el("i", { style: "width:" + p + "%" })),
          el("span", { class: "muted small", text: fmtPts(total(c)) + " / " + fmtPts(c.max_points) })) : ""),
        el("td", { text: best ? LANG_LABEL[best.lang] + " " + best.pct + "%" : "" }),
        el("td", { text: reached(c) }),
        el("td", { text: fmtDur(timeUsed(c)) }),
        el("td", { class: "num" }, num(c.flag_count) ? el("span", { class: "flag", text: String(c.flag_count) }) : "0"),
        el("td", { text: num(c.pending_reviews) ? num(c.pending_reviews) + " to score" : (c.submitted_at ? "Done" : "") }),
        el("td", {}, el("span", { class: "decision " + (c.decision || ""), text: c.decision ? decisionLabel(c.decision) : "" })),
        el("td", { class: "muted", text: fmtDate(c.created_at) }));
      tr.addEventListener("click", () => openCandidate(c.id));
      tr.addEventListener("keydown", e => { if (e.key === "Enter") openCandidate(c.id); });
      tbody.append(tr);
    });

    const csvBtn = el("button", { text: "Export CSV", onclick: exportCsv });
    const pdfBtn = el("button", { text: "Export PDF", onclick: () => pdfSummary(list) });
    const table = list.length
      ? el("div", { class: "table-wrap" }, el("table", {},
          el("thead", {}, el("tr", {},
            ["Candidate", "Status", "Score", "Best language", "Reached", "Time used"].map(h => el("th", { text: h })),
            el("th", { class: "num", text: "Signals" }), el("th", { text: "Review" }), el("th", { text: "Decision" }), el("th", { text: "Invited" }))),
          tbody))
      : el("p", { class: "empty", text: rows.length ? "No candidate matches these filters." : "No candidates yet. Create a test link above to invite your first candidate." });

    searchInput.addEventListener("input", () => {
      search = searchInput.value;
      drawTable(host);
      const again = host.querySelector("input[type=search]");
      again.focus();
      again.setSelectionRange(search.length, search.length);
    });
    filter.addEventListener("change", () => { statusFilter = filter.value; drawTable(host); });

    host.replaceChildren(el("section", { class: "panel" },
      el("div", { class: "table-tools" }, el("h2", { text: "Candidates (" + list.length + ")" }), searchInput, filter, pdfBtn, csvBtn),
      table));
  }

  // ================================================================ candidate detail

  async function openCandidate(id) {
    const c = rows.find(r => r.id === id);
    if (!c) return;
    const [as, an, ev] = await Promise.all([
      sb.from("assignments").select("*").eq("candidate_id", id).order("step").order("position"),
      sb.from("answers").select("*").eq("candidate_id", id),
      sb.from("events").select("*").eq("candidate_id", id).order("at")
    ]);
    const assigned = as.data || [];
    const answers = {};
    (an.data || []).forEach(x => { answers[x.question_id] = x; });
    const events = ev.data || [];
    const qById = {};
    questions.forEach(q => { qById[q.id] = q; });

    const bg = el("div", { class: "drawer-bg" });
    const close = async () => { bg.remove(); drawer.remove(); document.removeEventListener("keydown", esc); await load(); drawCandidates(); };
    const esc = e => { if (e.key === "Escape" && !document.querySelector(".modal-bg")) close(); };
    bg.addEventListener("click", close);
    document.addEventListener("keydown", esc);

    const st = status(c);
    const closeBtn = el("button", { text: "Close", onclick: close });
    const body = el("div", { class: "drawer-body" });
    const drawer = el("aside", { class: "drawer", role: "dialog", "aria-modal": "true", "aria-label": "Results of " + c.full_name },
      el("div", { class: "drawer-head" },
        el("div", { class: "title" }, el("h2", { text: c.full_name }),
          el("div", { class: "muted small", text: [c.email, c.position, "Stacks: " + (c.stacks || []).map(s => LANG_LABEL[s]).join(", ")].filter(Boolean).join("  |  ") })),
        el("span", { class: "pill " + st.key, text: st.label }),
        closeBtn),
      body);

    const renderBody = () => {
      const keep = drawer.scrollTop;
      body.replaceChildren(
        summaryBlock(c, assigned, answers),
        c.started_at ? profileBlock(c, assigned, answers, qById) : el("div", { class: "panel" }, el("p", { class: "muted", text: "The candidate has not started the test yet. Their questions are drawn when they press Start." })),
        decisionBlock(c),
        c.started_at ? answersBlock(c, assigned, answers, qById, renderBody) : null,
        eventsBlock(c, events),
        actionsBlock(c, close, { assigned, answers, events, qById }));
      drawer.scrollTop = keep;
    };
    renderBody();
    document.body.append(bg, drawer);
    closeBtn.focus();
  }

  function scoreOf(q, a) {
    if (!a) return 0;
    return q.kind === "choice" ? num(a.auto_score) : num(a.manual_score);
  }

  function summaryBlock(c, assigned, answers) {
    const stat = (v, l) => el("div", { class: "stat" }, el("b", { text: v }), el("span", { text: l }));
    const answered = assigned.filter(a => {
      const x = answers[a.question_id];
      return x && (x.choice != null || (x.answer_text && x.answer_text.trim()));
    }).length;
    return el("div", { class: "stats" },
      stat(c.started_at ? pct(total(c), c.max_points) + "%" : "–", fmtPts(total(c)) + " of " + fmtPts(c.max_points) + " points" + (num(c.pending_reviews) ? ", " + c.pending_reviews + " to score" : "")),
      stat(assigned.length ? answered + " / " + assigned.length : "–", "Questions answered"),
      stat(reached(c) ? reached(c).split(":")[0] : "–", "Furthest stage reached"),
      stat(fmtDur(timeUsed(c)) || "–", "Time used of " + c.duration_minutes + " min"));
  }

  function profileBlock(c, assigned, answers, qById) {
    // By technology (from the stages the candidate reached)
    const mine = skillsOf(c.id).map(s => ({
      lang: s.lang, name: LANG_LABEL[s.lang] || s.lang, earned: num(s.earned), possible: num(s.possible),
      questions: num(s.questions), pending: num(s.pending)
    })).sort((a, b) => (b.possible ? b.earned / b.possible : -1) - (a.possible ? a.earned / a.possible : -1) || b.possible - a.possible);
    const progs = mine.filter(s => PROG_LANGS.includes(s.lang) && s.possible > 0);
    let callout = null;
    if (progs.length) {
      const best = progs[0], worst = progs[progs.length - 1];
      const few = best.questions < 3 ? " This is based on few questions: confirm it in the interview." : "";
      callout = el("div", { class: "callout", text:
        "Strongest language: " + best.name + " (" + pct(best.earned, best.possible) + "% on " + best.questions + " questions)." +
        (progs.length > 1 ? " Weakest: " + worst.name + " (" + pct(worst.earned, worst.possible) + "%)." : "") + few });
    }
    const langPanel = el("section", { class: "panel" },
      el("h3", { text: "Score by technology" }), callout,
      mine.length ? barChart(mine) : el("p", { class: "muted", text: "No data yet." }),
      el("p", { class: "chart-note", text: "Counts the stages the candidate reached. * includes written answers not scored yet. Hover a bar for details." }));

    // By stage
    const steps = [...new Set(assigned.map(a => a.step))].sort((a, b) => a - b);
    const t = c.step_times || {};
    const keys = steps.map(String);
    const stageItems = steps.map((s, i) => {
      const qs = assigned.filter(a => a.step === s).map(a => qById[a.question_id]).filter(Boolean);
      const possible = qs.reduce((n, q) => n + num(q.points), 0);
      const earned = qs.reduce((n, q) => n + scoreOf(q, answers[q.id]), 0);
      const pending = qs.filter(q => q.kind === "code" && answers[q.id] && answers[q.id].manual_score == null && (answers[q.id].answer_text || "").trim()).length;
      const startT = t[keys[i]] ? Date.parse(t[keys[i]]) : null;
      const nextKey = keys.slice(i + 1).find(k => t[k]);
      const endT = nextKey ? Date.parse(t[nextKey]) : (t.end ? Date.parse(t.end) : null);
      const reachedIt = c.current_step != null && s <= c.current_step;
      return {
        name: (i + 1) + ". " + stageTitle(s), earned, possible: reachedIt ? possible : 0, pending, questions: qs.length,
        sub: !reachedIt ? "not reached" : (startT && endT ? fmtDur(endT - startT) : (startT ? "in progress" : ""))
      };
    });
    const stagePanel = el("section", { class: "panel" },
      el("h3", { text: "Score by stage" }),
      barChart(stageItems),
      el("p", { class: "chart-note", text: "The small line under each value is the time spent on that stage." }));

    return el("div", { class: "two-col" }, langPanel, stagePanel);
  }

  function decisionBlock(c) {
    const select = el("select", { id: "decision" }, DECISIONS.map(([v, l]) => el("option", { value: v, text: l, selected: (c.decision || "") === v })));
    const notes = el("textarea", { id: "notes", placeholder: "Notes for the team" });
    notes.value = c.notes || "";
    const save = el("button", { class: "primary", text: "Save" });
    save.addEventListener("click", async () => {
      save.disabled = true;
      const { error } = await sb.from("candidates").update({ decision: select.value || null, notes: notes.value.trim() || null }).eq("id", c.id);
      save.disabled = false;
      if (error) { toast("Not saved: " + error.message); return; }
      c.decision = select.value || null; c.notes = notes.value.trim() || null;
      toast("Decision saved");
    });
    return el("section", { class: "panel" }, el("h3", { text: "Decision" }),
      el("div", { class: "decision-grid" },
        el("div", {}, el("label", { for: "decision", text: "Status" }), select),
        el("div", {}, el("label", { for: "notes", text: "Notes" }), notes),
        save));
  }

  function answersBlock(c, assigned, answers, qById, rerender) {
    const steps = [...new Set(assigned.map(a => a.step))].sort((a, b) => a - b);
    return el("div", { style: "display:grid;gap:.8rem" },
      el("h3", { style: "margin:.3rem 0 0", text: "Answers" }),
      steps.map((s, i) => {
        const qs = assigned.filter(a => a.step === s).map(a => qById[a.question_id]).filter(Boolean);
        const reachedIt = c.current_step != null && s <= c.current_step;
        const earned = qs.reduce((n, q) => n + scoreOf(q, answers[q.id]), 0);
        const possible = qs.reduce((n, q) => n + num(q.points), 0);
        const pending = qs.filter(q => q.kind === "code" && answers[q.id] && answers[q.id].manual_score == null && (answers[q.id].answer_text || "").trim()).length;
        return el("details", { class: "stage-review", open: pending > 0 },
          el("summary", {},
            el("span", { class: "s-title", text: (i + 1) + ". " + stageTitle(s) }),
            pending ? el("span", { class: "chip lang", text: pending + " to score" }) : null,
            el("span", { class: "s-meta", text: reachedIt ? fmtPts(earned) + " / " + fmtPts(possible) + " pts" : "Not reached" })),
          el("div", { class: "review-list" }, qs.map(q => reviewCard(q, answers[q.id], c, rerender))));
      }));
  }

  function reviewCard(q, a, c, rerender) {
    const langName = q.lang === "any" ? (a && a.answer_lang ? LANG_LABEL[a.answer_lang] : null) : LANG_LABEL[q.lang];
    const card = el("div", { class: "review" },
      el("div", { class: "r-top" },
        el("span", { class: "r-title", text: q.title || (q.kind === "choice" ? "Multiple choice" : "Written answer") }),
        langName ? el("span", { class: "chip lang", text: langName }) : null,
        el("span", { class: "chip", text: fmtPts(q.points) + " pts" })),
      el("div", { class: "q-prompt", text: q.prompt }));
    if (q.snippet) card.append(el("details", { class: "rubric" }, el("summary", { text: "Show the code given to the candidate" }), el("pre", { class: "answer", text: q.snippet })));

    if (q.kind === "choice") {
      if (!a || a.choice == null) card.append(el("div", { class: "answer-line none", text: "No answer" }));
      else {
        const right = a.choice === q.correct;
        card.append(el("div", { class: "answer-line " + (right ? "right" : "wrong"), text: (right ? "Correct: " : "Wrong: ") + q.options[a.choice] }));
        if (!right) card.append(el("div", { class: "answer-line right", text: "Expected: " + q.options[q.correct] }));
      }
      return card;
    }

    const text = a && a.answer_text && a.answer_text.trim() ? a.answer_text : null;
    card.append(text ? el("pre", { class: "answer", text }) : el("div", { class: "answer-line none", text: "No answer" }));
    if (q.rubric) card.append(el("details", { class: "rubric", open: !!text && a.manual_score == null },
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
        save.disabled = true;
        const { error } = await sb.from("answers").update({ manual_score: v }).eq("candidate_id", c.id).eq("question_id", q.id);
        save.disabled = false;
        if (error) { note.textContent = "Not saved: " + error.message; return; }
        a.manual_score = v;
        await load();
        Object.assign(c, rows.find(r => r.id === c.id) || {});
        toast("Score saved");
        rerender();
      });
      card.append(el("div", { class: "score-input" }, input, el("span", { text: "/ " + fmtPts(q.points) }), save, note));
    }
    return card;
  }

  function eventsBlock(c, events) {
    if (!c.started_at) return null;
    const panel = el("section", { class: "panel" }, el("h3", { text: "Integrity signals" }));
    if (!events.length) { panel.append(el("p", { class: "muted small", text: "No signals recorded." })); return panel; }
    const counts = {};
    events.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
    const start = Date.parse(c.started_at);
    panel.append(
      el("p", { text: Object.entries(counts).map(([k, n]) => (EVENT_NAMES[k] || k) + ": " + n).join(", ") }),
      el("p", { class: "muted small", text: "These are signals, not proof. Discuss them in the interview, for example by asking the candidate to explain a pasted answer." }),
      el("details", { class: "rubric" }, el("summary", { text: "Show the timeline" }),
        el("div", { class: "events-list" }, events.map(e =>
          el("span", { text: "+" + fmtDur(Date.parse(e.at) - start) + "   " + (EVENT_NAMES[e.type] || e.type) + (e.detail ? " (" + e.detail + ")" : "") })))));
    return panel;
  }

  function actionsBlock(c, close, ctx) {
    const pdfBtn = el("button", { class: "primary", text: "Download PDF report" });
    pdfBtn.addEventListener("click", () => pdfCandidate(rows.find(r => r.id === c.id) || c, ctx));
    const copyBtn = el("button", { text: "Copy test link" });
    copyBtn.addEventListener("click", () => copy(testUrl(c.token), copyBtn));
    const resetBtn = el("button", { text: "Reset attempt" });
    resetBtn.addEventListener("click", async () => {
      const ok = await modal("Reset this attempt?", "This deletes " + c.full_name + "'s answers and lets them start again with a fresh timer and new questions. Use it only after a technical problem.", "Reset attempt", "Cancel");
      if (!ok) return;
      await sb.from("answers").delete().eq("candidate_id", c.id);
      await sb.from("events").delete().eq("candidate_id", c.id);
      await sb.from("assignments").delete().eq("candidate_id", c.id);
      const { error } = await sb.from("candidates").update({
        started_at: null, deadline: null, submitted_at: null, current_step: null, step_times: {}
      }).eq("id", c.id);
      if (error) { toast("Reset failed: " + error.message); return; }
      close();
    });
    const delBtn = el("button", { class: "danger", text: "Delete candidate" });
    delBtn.addEventListener("click", async () => {
      const ok = await modal("Delete this candidate?", "This deletes " + c.full_name + " and all their answers. It cannot be undone.", "Delete", "Cancel");
      if (!ok) return;
      const { error } = await sb.from("candidates").delete().eq("id", c.id);
      if (error) { toast("Delete failed: " + error.message); return; }
      close();
    });
    return el("div", { class: "drawer-actions" }, pdfBtn, copyBtn, resetBtn, delBtn);
  }

  // ================================================================ settings view

  function drawSettings() {
    const bank = {};
    questions.filter(q => q.active).forEach(q => {
      const k = q.stage + ":" + q.kind;
      bank[k] = (bank[k] || 0) + 1;
    });
    const avgPts = (stage, kind) => {
      const qs = questions.filter(q => q.active && q.stage === stage && q.kind === kind);
      return qs.length ? qs.reduce((n, q) => n + num(q.points), 0) / qs.length : 0;
    };

    const inputs = [];
    const totalLine = el("span", { class: "muted" });
    let totalQuestions = 0;
    const updateTotal = () => {
      let n = 0, pts = 0;
      inputs.forEach(r => {
        const ch = Math.min(parseInt(r.choice.value, 10) || 0, bank[r.step + ":choice"] || 0);
        const co = Math.min(parseInt(r.code.value, 10) || 0, bank[r.step + ":code"] || 0);
        n += ch + co;
        pts += ch * avgPts(r.step, "choice") + co * avgPts(r.step, "code");
      });
      totalQuestions = n;
      totalLine.textContent = "Each candidate gets up to " + n + " questions worth about " + Math.round(pts) + " points (limit " + MAX_QUESTIONS + ")." +
        (n > MAX_QUESTIONS ? " Too many questions: lower some counts before saving." : "");
      totalLine.className = n > MAX_QUESTIONS ? "error-text" : "muted";
    };

    const tbody = el("tbody", {}, stages.map(s => {
      const title = el("input", { type: "text", value: s.title, "aria-label": "Title of stage " + s.step });
      const choice = el("input", { type: "number", min: "0", max: "30", value: String(s.choice_count), "aria-label": "Multiple-choice questions for stage " + s.step });
      const code = el("input", { type: "number", min: "0", max: "5", value: String(s.code_count), "aria-label": "Written questions for stage " + s.step });
      choice.addEventListener("input", updateTotal);
      code.addEventListener("input", updateTotal);
      inputs.push({ step: s.step, title, choice, code });
      return el("tr", {},
        el("td", { class: "num", text: String(s.step) }),
        el("td", {}, title),
        el("td", {}, choice, el("div", { class: "field-hint", text: (bank[s.step + ":choice"] || 0) + " in the bank" })),
        el("td", {}, code, el("div", { class: "field-hint", text: (bank[s.step + ":code"] || 0) + " in the bank" })));
    }));
    updateTotal();

    const save = el("button", { class: "primary", text: "Save settings" });
    save.addEventListener("click", async () => {
      if (totalQuestions > MAX_QUESTIONS) { toast("At most " + MAX_QUESTIONS + " questions per candidate. Lower some counts."); return; }
      save.disabled = true;
      for (const r of inputs) {
        const { error } = await sb.from("stages").update({
          title: r.title.value.trim() || "Stage " + r.step,
          choice_count: Math.max(0, Math.min(30, parseInt(r.choice.value, 10) || 0)),
          code_count: Math.max(0, Math.min(5, parseInt(r.code.value, 10) || 0))
        }).eq("step", r.step);
        if (error) { save.disabled = false; toast("Not saved: " + error.message); return; }
      }
      save.disabled = false;
      toast("Settings saved. They apply to candidates who start from now on.");
      await refresh();
    });

    const cols = ["general", "sql", "design", "algorithms", ...PROG_LANGS, "any"];
    const matrix = el("table", { class: "matrix" },
      el("thead", {}, el("tr", {}, el("th", { text: "Stage" }), cols.map(l => el("th", { class: "num", text: LANG_LABEL[l] === "Not specified" ? "Any language" : LANG_LABEL[l] })))),
      el("tbody", {}, stages.map(s => el("tr", {},
        el("td", { text: s.step + ". " + s.title }),
        cols.map(l => {
          const n = questions.filter(q => q.active && q.stage === s.step && q.lang === l).length;
          return el("td", { class: "num" + (n ? "" : " zero"), text: String(n) });
        })))));

    mainHost.replaceChildren(
      el("section", { class: "panel" },
        el("h2", { text: "Questions drawn for each candidate" }),
        el("p", { class: "muted", text: "Each candidate gets a random selection, balanced across the technologies chosen at invitation. Set a count to 0 to skip that part. Changes apply to candidates who start after you save." }),
        el("div", { class: "table-wrap" }, el("table", { class: "settings-table" },
          el("thead", {}, el("tr", {}, el("th", { class: "num", text: "Stage" }), el("th", { text: "Title" }), el("th", { text: "Multiple-choice" }), el("th", { text: "Written" }))),
          tbody)),
        el("div", { class: "settings-foot" }, totalLine, el("span", { class: "spacer" }), save)),
      el("section", { class: "panel" },
        el("h2", { text: "Question bank by technology" }),
        el("p", { class: "muted", text: "Active questions available per stage. Add or edit questions in Supabase > Table Editor > questions, or in 02_questions.sql." }),
        el("div", { class: "table-wrap" }, matrix)));
  }

  // ================================================================ PDF reports

  const BRAND = [31, 79, 138], INK = [22, 32, 43], MUTED = [98, 112, 128], LINE = [219, 225, 232], SOFT = [232, 239, 248];

  // The built-in PDF fonts only cover Latin-1: replace anything else.
  function clean(s) {
    return String(s == null ? "" : s)
      .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
      .replace(/[–—−]/g, "-").replace(/…/g, "...")
      .replace(/\t/g, "    ").replace(/[^\n\r\x20-\x7E -ÿ]/g, "?");
  }
  function slug(s) { return clean(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "report"; }
  function pdfLib() {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      toast("The PDF tool did not load. Check your internet connection and reload the page.");
      return null;
    }
    return window.jspdf.jsPDF;
  }
  function pdfHeader(doc, title, sub) {
    const w = doc.internal.pageSize.getWidth();
    doc.setFillColor(...BRAND); doc.rect(0, 0, w, 3, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...MUTED);
    doc.text(clean((cfg.COMPANY_NAME ? cfg.COMPANY_NAME + "  |  " : "") + "Generated on " + fmtDate(new Date().toISOString())), 15, 12);
    doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(...INK);
    doc.text(clean(title), 15, 21);
    if (!sub) return 29;
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...BRAND);
    doc.text(clean(sub), 15, 29);
    return 35;
  }
  function pdfFooter(doc, label) {
    const n = doc.getNumberOfPages();
    const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...MUTED);
      doc.text(clean(label + "  |  Confidential"), 15, h - 8);
      doc.text("Page " + i + " of " + n, w - 15, h - 8, { align: "right" });
    }
  }
  function ensure(doc, y, need) {
    if (y + need > doc.internal.pageSize.getHeight() - 16) { doc.addPage(); return 18; }
    return y;
  }
  function pdfSection(doc, y, text, need) {
    y = ensure(doc, y + 3, need || 16);
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...INK);
    doc.text(clean(text), 15, y);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(15, y + 2, doc.internal.pageSize.getWidth() - 15, y + 2);
    return y + 8;
  }
  function pdfParagraph(doc, y, text, opts) {
    const o = opts || {};
    doc.setFont("helvetica", o.bold ? "bold" : "normal"); doc.setFontSize(o.size || 10);
    doc.setTextColor(...(o.color || INK));
    const lines = doc.splitTextToSize(clean(text), doc.internal.pageSize.getWidth() - 30);
    lines.forEach(line => { y = ensure(doc, y, 5); doc.text(line, 15, y); y += (o.size || 10) * 0.45; });
    return y + 1.5;
  }
  // Horizontal bars, one hue, value in ink.
  function pdfBars(doc, y, items) {
    const w = doc.internal.pageSize.getWidth();
    const xb = 64, bw = w - 15 - 44 - xb;
    items.forEach(it => {
      y = ensure(doc, y, 7);
      const p = it.possible ? Math.round(100 * it.earned / it.possible) : null;
      doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...INK);
      doc.text(clean(it.name), 15, y + 3.3);
      doc.setFillColor(...SOFT); doc.roundedRect(xb, y, bw, 4.4, 1, 1, "F");
      if (p) { doc.setFillColor(...BRAND); doc.roundedRect(xb, y, Math.max(2, bw * p / 100), 4.4, 1, 1, "F"); }
      doc.setFont("helvetica", "bold"); doc.text(p === null ? "n/a" : p + "%" + (it.pending ? "*" : ""), xb + bw + 4, y + 3.3);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
      doc.text(clean(it.sub || (fmtPts(it.earned) + " / " + fmtPts(it.possible) + " pts")), w - 15, y + 3.3, { align: "right" });
      y += 7.2;
    });
    return y + 1;
  }

  function techItems(c) {
    return skillsOf(c.id).map(s => ({
      lang: s.lang, name: LANG_LABEL[s.lang] || s.lang, earned: num(s.earned), possible: num(s.possible),
      questions: num(s.questions), pending: num(s.pending)
    })).sort((a, b) => (b.possible ? b.earned / b.possible : -1) - (a.possible ? a.earned / a.possible : -1) || b.possible - a.possible);
  }
  function stageItemsFor(c, assigned, answers, qById) {
    const steps = [...new Set(assigned.map(a => a.step))].sort((a, b) => a - b);
    const t = c.step_times || {};
    const keys = steps.map(String);
    return steps.map((s, i) => {
      const qs = assigned.filter(a => a.step === s).map(a => qById[a.question_id]).filter(Boolean);
      const possible = qs.reduce((n, q) => n + num(q.points), 0);
      const earned = qs.reduce((n, q) => n + scoreOf(q, answers[q.id]), 0);
      const pending = qs.filter(q => q.kind === "code" && answers[q.id] && answers[q.id].manual_score == null && (answers[q.id].answer_text || "").trim()).length;
      const startT = t[keys[i]] ? Date.parse(t[keys[i]]) : null;
      const nextKey = keys.slice(i + 1).find(k => t[k]);
      const endT = nextKey ? Date.parse(t[nextKey]) : (t.end ? Date.parse(t.end) : null);
      const reachedIt = c.current_step != null && s <= c.current_step;
      return {
        step: s, name: (i + 1) + ". " + stageTitle(s), earned, possible: reachedIt ? possible : 0, fullPossible: possible,
        pending, questions: qs.length, reached: reachedIt,
        sub: !reachedIt ? "not reached" : (startT && endT ? fmtDur(endT - startT) : (startT ? "in progress" : ""))
      };
    });
  }
  function strengthSentence(items) {
    const progs = items.filter(s => PROG_LANGS.includes(s.lang) && s.possible > 0);
    if (!progs.length) return "";
    const best = progs[0], worst = progs[progs.length - 1];
    if (!best.earned) return "No points yet in the programming languages tested.";
    return "Strongest language: " + best.name + " (" + pct(best.earned, best.possible) + "% on " + best.questions + " questions)." +
      (progs.length > 1 ? " Weakest: " + worst.name + " (" + pct(worst.earned, worst.possible) + "%)." : "") +
      (best.questions < 3 ? " Based on few questions: confirm in the interview." : "");
  }

  function pdfCandidate(c, ctx) {
    const JsPDF = pdfLib();
    if (!JsPDF) return;
    const { assigned, answers, events, qById } = ctx;
    const doc = new JsPDF({ unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const st = status(c);

    let y = pdfHeader(doc, "Technical assessment report", c.full_name);
    y = pdfParagraph(doc, y, [c.email, c.position, "Stacks: " + (c.stacks || []).map(s => LANG_LABEL[s]).join(", "), "Status: " + st.label].filter(Boolean).join("   |   "), { size: 9.5, color: MUTED });
    y = pdfParagraph(doc, y, ["Invited " + fmtDate(c.created_at), c.started_at ? "Started " + fmtDate(c.started_at) : "Not started yet", c.submitted_at ? "Submitted " + fmtDate(c.submitted_at) : null].filter(Boolean).join("   |   "), { size: 9.5, color: MUTED });
    y += 2;

    // Key figures
    const answered = assigned.filter(a => {
      const x = answers[a.question_id];
      return x && (x.choice != null || (x.answer_text && x.answer_text.trim()));
    }).length;
    const figs = [
      [c.started_at ? pct(total(c), c.max_points) + "%" : "-", "Score: " + fmtPts(total(c)) + " of " + fmtPts(c.max_points) + " points"],
      [assigned.length ? answered + " / " + assigned.length : "-", "Questions answered"],
      [reached(c) ? reached(c).split(":")[0] : "-", "Furthest stage reached"],
      [fmtDur(timeUsed(c)) || "-", "Time used of " + c.duration_minutes + " min"]
    ];
    const bw = (W - 30 - 9) / 4;
    figs.forEach((f, i) => {
      const x = 15 + i * (bw + 3);
      doc.setDrawColor(...LINE); doc.setFillColor(248, 250, 252); doc.setLineWidth(0.3);
      doc.roundedRect(x, y, bw, 19, 2, 2, "FD");
      doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(...INK); doc.text(clean(f[0]), x + 4, y + 8.5);
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...MUTED); doc.text(doc.splitTextToSize(clean(f[1]), bw - 8), x + 4, y + 13.5);
    });
    y += 24;
    if (num(c.pending_reviews)) y = pdfParagraph(doc, y, num(c.pending_reviews) + " written answer(s) are not scored yet, so the score may still rise.", { size: 9, color: MUTED });

    // Decision
    y = pdfSection(doc, y, "Decision");
    y = pdfParagraph(doc, y, "Decision: " + (c.decision ? decisionLabel(c.decision) : "Not decided yet"), { bold: true });
    y = pdfParagraph(doc, y, c.notes ? "Notes: " + c.notes : "No notes.", { size: 9.5, color: c.notes ? INK : MUTED });

    if (c.started_at) {
      // By technology
      const tech = techItems(c);
      y = pdfSection(doc, y, "Score by technology", 40);
      const sentence = strengthSentence(tech);
      if (sentence) y = pdfParagraph(doc, y, sentence, { size: 9.5, color: BRAND, bold: true }) + 1;
      y = pdfBars(doc, y, tech);
      y = pdfParagraph(doc, y, "Counts only the stages the candidate reached. * includes written answers not scored yet.", { size: 8, color: MUTED });

      // By stage
      y = pdfSection(doc, y, "Score and time by stage", 40);
      y = pdfBars(doc, y, stageItemsFor(c, assigned, answers, qById));

      // Question by question
      y = pdfSection(doc, y, "Question by question", 35);
      const body = [];
      let n = 0;
      assigned.forEach(a => {
        const q = qById[a.question_id];
        if (!q) return;
        n++;
        const x = answers[q.id];
        const reachedIt = c.current_step != null && a.step <= c.current_step;
        let result;
        if (!reachedIt) result = "Not reached";
        else if (q.kind === "choice") result = !x || x.choice == null ? "No answer" : (x.choice === q.correct ? "Correct" : "Wrong");
        else result = !x || !(x.answer_text || "").trim() ? "No answer" : (x.manual_score == null ? "To score" : "Scored");
        const langName = q.lang === "any" ? (x && x.answer_lang ? LANG_LABEL[x.answer_lang] : "Any") : (LANG_LABEL[q.lang] || "");
        const label = q.title ? q.title + ": " + q.prompt : q.prompt;
        body.push([String(n), stageTitle(a.step), clean(label.length > 110 ? label.slice(0, 107) + "..." : label), clean(langName), result,
          fmtPts(scoreOf(q, x)) + " / " + fmtPts(q.points)]);
      });
      doc.autoTable({
        startY: y, head: [["#", "Stage", "Question", "Technology", "Result", "Points"]], body,
        margin: { left: 15, right: 15, bottom: 16 }, theme: "grid",
        styles: { font: "helvetica", fontSize: 8, cellPadding: 1.6, textColor: INK, lineColor: LINE, lineWidth: 0.2 },
        headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold" },
        columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 28 }, 3: { cellWidth: 26 }, 4: { cellWidth: 20 }, 5: { cellWidth: 16, halign: "right" } },
        didParseCell: d => {
          if (d.section !== "body" || d.column.index !== 4) return;
          const v = d.cell.raw;
          if (v === "Correct" || v === "Scored") d.cell.styles.textColor = [43, 122, 75];
          else if (v === "Wrong") d.cell.styles.textColor = [180, 35, 24];
          else if (v === "To score") d.cell.styles.textColor = [154, 88, 0];
          else d.cell.styles.textColor = MUTED;
        }
      });
      y = doc.lastAutoTable.finalY + 4;

      // Written answers in full
      const written = assigned.map(a => qById[a.question_id]).filter(q => q && q.kind === "code" && answers[q.id] && (answers[q.id].answer_text || "").trim());
      if (written.length) {
        y = pdfSection(doc, y, "Written answers", 45);
        written.forEach(q => {
          const x = answers[q.id];
          const langName = q.lang === "any" ? (x.answer_lang ? LANG_LABEL[x.answer_lang] : "language not given") : LANG_LABEL[q.lang];
          const scoreText = x.manual_score == null ? "not scored yet" : fmtPts(x.manual_score) + " / " + fmtPts(q.points) + " pts";
          y = ensure(doc, y, 20);
          doc.autoTable({
            startY: y, head: [[clean((q.title || "Written answer") + " (" + langName + "): " + scoreText)]],
            body: [[clean(x.answer_text)]],
            margin: { left: 15, right: 15, bottom: 16 }, theme: "grid",
            styles: { font: "courier", fontSize: 8, cellPadding: 2.5, textColor: INK, lineColor: LINE, lineWidth: 0.2, overflow: "linebreak" },
            headStyles: { font: "helvetica", fillColor: SOFT, textColor: INK, fontStyle: "bold", fontSize: 9 }
          });
          y = doc.lastAutoTable.finalY + 4;
        });
      }

      // Integrity
      y = pdfSection(doc, y, "Integrity signals");
      const counts = {};
      events.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
      const list = Object.entries(counts).map(([k, v]) => (EVENT_NAMES[k] || k) + ": " + v).join(", ");
      y = pdfParagraph(doc, y, list || "No signals recorded.", { size: 9.5 });
      pdfParagraph(doc, y, "Signals are not proof. Discuss them with the candidate in the interview.", { size: 8.5, color: MUTED });
    }

    pdfFooter(doc, c.full_name + "  |  Technical assessment report");
    doc.save("assessment-" + slug(c.full_name) + ".pdf");
  }

  function pdfSummary(list) {
    const JsPDF = pdfLib();
    if (!JsPDF) return;
    if (!list.length) { toast("No candidates to export."); return; }
    const doc = new JsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
    let y = pdfHeader(doc, "Assessment results", list.length + (list.length === 1 ? " candidate" : " candidates") +
      (search || statusFilter ? " (filtered list)" : ""));

    const finished = list.filter(c => c.submitted_at);
    const avg = finished.length ? Math.round(finished.reduce((n, c) => n + pct(total(c), c.max_points), 0) / finished.length) + "%" : "-";
    const dec = {};
    list.forEach(c => { const k = decisionLabel(c.decision); dec[k] = (dec[k] || 0) + 1; });
    y = pdfParagraph(doc, y, "Finished: " + finished.length + "   |   Average score of finished tests: " + avg +
      "   |   Waiting for review: " + list.filter(c => num(c.pending_reviews) > 0).length, { size: 10 });
    y = pdfParagraph(doc, y, "Decisions: " + Object.entries(dec).map(([k, v]) => k + " " + v).join(", "), { size: 10 });

    const langs = ["js", "java", "csharp", "php", "python", "sql", "general", "design", "algorithms"];
    const short = { js: "JS/TS", java: "Java", csharp: "C#", php: "PHP", python: "Python", sql: "SQL", general: "Web", design: "Design", algorithms: "Algo" };
    const sorted = list.slice().sort((a, b) => (b.started_at ? pct(total(b), b.max_points) : -1) - (a.started_at ? pct(total(a), a.max_points) : -1));
    const body = sorted.map(c => {
      const sk = skillsOf(c.id);
      const best = bestLanguage(c.id);
      return [
        clean(c.full_name + (c.position ? "\n" + c.position : "")),
        status(c).label,
        c.started_at ? pct(total(c), c.max_points) + "%\n" + fmtPts(total(c)) + "/" + fmtPts(c.max_points) : "",
        best ? clean(LANG_LABEL[best.lang] + " " + best.pct + "%") : "",
        ...langs.map(l => { const s = sk.find(x => x.lang === l); return s && num(s.possible) ? pct(s.earned, s.possible) + "%" : ""; }),
        clean(reached(c).split(":")[0]),
        fmtDur(timeUsed(c)).replace(" min ", "m ").replace(" s", "s"),
        String(num(c.flag_count)),
        num(c.pending_reviews) ? String(num(c.pending_reviews)) : "",
        c.decision ? decisionLabel(c.decision) : ""
      ];
    });
    doc.autoTable({
      startY: y + 1,
      head: [["Candidate", "Status", "Score", "Best language", ...langs.map(l => short[l]), "Reached", "Time", "Signals", "To score", "Decision"]],
      body, margin: { left: 12, right: 12, bottom: 16 }, theme: "grid",
      styles: { font: "helvetica", fontSize: 7.5, cellPadding: 1.4, textColor: INK, lineColor: LINE, lineWidth: 0.2, valign: "middle" },
      headStyles: { fillColor: BRAND, textColor: 255, fontStyle: "bold" },
      columnStyles: Object.assign({ 0: { cellWidth: 38, fontStyle: "bold" }, 2: { halign: "right" }, 3: { cellWidth: 24 } },
        Object.fromEntries([...langs.map((_, i) => 4 + i), langs.length + 6, langs.length + 7].map(i => [i, { halign: "right" }]))),
      didParseCell: d => {
        if (d.section === "body" && d.column.index === langs.length + 8) {
          const v = d.cell.raw;
          if (v === "Rejected") d.cell.styles.textColor = [180, 35, 24];
          else if (v && v !== "On hold") { d.cell.styles.textColor = [43, 122, 75]; d.cell.styles.fontStyle = "bold"; }
        }
      }
    });
    y = doc.lastAutoTable.finalY + 4;
    y = pdfParagraph(doc, y, "Language columns show the score on the questions of that technology, for the stages each candidate reached. With 1 or 2 questions per language, treat them as signals to confirm in the interview.", { size: 8, color: MUTED });

    const withNotes = sorted.filter(c => c.notes);
    if (withNotes.length) {
      y = pdfSection(doc, y, "Decision notes");
      doc.autoTable({
        startY: y, head: [["Candidate", "Decision", "Notes"]],
        body: withNotes.map(c => [clean(c.full_name), c.decision ? decisionLabel(c.decision) : "Not decided", clean(c.notes)]),
        margin: { left: 12, right: 12, bottom: 16 }, theme: "grid",
        styles: { font: "helvetica", fontSize: 8.5, cellPadding: 1.8, textColor: INK, lineColor: LINE, lineWidth: 0.2 },
        headStyles: { fillColor: SOFT, textColor: INK, fontStyle: "bold" },
        columnStyles: { 0: { cellWidth: 50, fontStyle: "bold" }, 1: { cellWidth: 30 } }
      });
    }

    pdfFooter(doc, "Assessment results");
    doc.save("assessment-results-" + new Date().toISOString().slice(0, 10) + ".pdf");
  }

  // ================================================================ export

  function exportCsv() {
    const langs = ["general", "sql", "design", "algorithms", ...PROG_LANGS];
    const head = ["Name", "Email", "Position", "Stacks", "Status", "Decision", "Score %", "Points", "Max points",
      ...langs.map(l => LANG_LABEL[l] + " %"), "Best language", "Reached", "Started", "Submitted", "Minutes used",
      "Signals", "Written answers to score", "Notes"];
    const lines = [head].concat(rows.map(c => {
      const sk = skillsOf(c.id);
      const best = bestLanguage(c.id);
      const used = timeUsed(c);
      return [c.full_name, c.email || "", c.position || "", (c.stacks || []).join(" "), status(c).label, c.decision ? decisionLabel(c.decision) : "",
        c.started_at ? pct(total(c), c.max_points) : "", fmtPts(total(c)), fmtPts(c.max_points),
        ...langs.map(l => { const s = sk.find(x => x.lang === l); return s && num(s.possible) ? pct(s.earned, s.possible) : ""; }),
        best ? LANG_LABEL[best.lang] : "", reached(c), c.started_at || "", c.submitted_at || "",
        used != null ? (used / 60000).toFixed(1) : "", num(c.flag_count), num(c.pending_reviews), c.notes || ""];
    }));
    const csv = lines.map(r => r.map(v => {
      const s = String(v);
      return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const link = el("a", { href: URL.createObjectURL(blob), download: "assessment-results.csv" });
    document.body.append(link);
    link.click();
    link.remove();
  }

  init();
})();
