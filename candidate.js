(() => {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const app = document.getElementById("app");
  const token = new URLSearchParams(location.search).get("t");

  const LANG_LABEL = { js: "JavaScript", java: "Java", csharp: "C#", php: "PHP", python: "Python", sql: "SQL" };
  const SNIPPET_LABEL = { javascript: "JavaScript", jsx: "React (JSX)", java: "Java", csharp: "C#", php: "PHP", python: "Python", sql: "SQL" };
  const ANSWER_LANGS = [
    ["js", "JavaScript / TypeScript"], ["java", "Java"], ["csharp", "C#"],
    ["php", "PHP"], ["python", "Python"], ["other", "Other"]
  ];
  const MODES = {
    javascript: "javascript", jsx: "jsx", java: "text/x-java", csharp: "text/x-csharp",
    php: { name: "php", startOpen: true }, python: "python", sql: "text/x-sql",
    js: "javascript"
  };
  const SCENARIO = [
    "MiniEvent is a web platform where users book seats for events. Each event has a limited capacity.",
    "Main tables: events(id, title, capacity, starts_at) and bookings(id, event_id, user_id, created_at)."
  ];

  let sb = null;
  let state = null;          // last state returned by the server
  let answers = {};          // question id -> { choice, text, lang } (local view)
  let qIndex = 0;            // question shown in the current stage
  let offset = 0;            // server time minus local time, in ms
  let timerId = null;
  let ending = false;
  let listenersOn = false;
  let editor = null;
  let warned = {};
  const drafts = new Map();  // question id -> payload waiting to be saved
  const timers = new Map();
  let inFlight = 0;
  let lastError = false;

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

  function seeded(seedText) {
    let h = 1779033703 ^ seedText.length;
    for (let i = 0; i < seedText.length; i++) {
      h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return () => {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    };
  }
  function shuffle(list, seedText) {
    const rnd = seeded(seedText);
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function backupKey(qid) { return "ta:" + token + ":" + qid; }
  function backup(qid, text) { try { localStorage.setItem(backupKey(qid), text); } catch (_) { /* ignore */ } }
  function readBackup(qid) { try { return localStorage.getItem(backupKey(qid)); } catch (_) { return null; } }

  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, Object.assign({ p_token: token }, args || {}));
    if (error) throw error;
    return data;
  }

  function highlight(pre, code, lang) {
    const mode = MODES[lang];
    if (window.CodeMirror && CodeMirror.runMode && mode) {
      pre.classList.add("cm-s-default");
      try { CodeMirror.runMode(code, mode, pre); return; } catch (_) { /* fall back to plain text */ }
    }
    pre.textContent = code;
  }

  function modal(title, text, okLabel, cancelLabel) {
    return new Promise(resolve => {
      const ok = el("button", { class: "primary", text: okLabel });
      const cancel = cancelLabel ? el("button", { text: cancelLabel }) : null;
      const box = el("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "modal-title" },
        el("h2", { id: "modal-title", text: title }), el("p", { text }),
        el("div", { class: "modal-actions" }, cancel, ok));
      const bg = el("div", { class: "modal-bg" }, box);
      const close = v => { bg.remove(); document.removeEventListener("keydown", onKey, true); resolve(v); };
      const onKey = e => { if (e.key === "Escape" && cancel) { e.stopPropagation(); close(false); } };
      ok.addEventListener("click", () => close(true));
      if (cancel) cancel.addEventListener("click", () => close(false));
      document.addEventListener("keydown", onKey, true);
      document.body.append(bg);
      (cancel || ok).focus();
    });
  }

  function toast(text, kind) {
    let host = document.querySelector(".toast-host");
    if (!host) { host = el("div", { class: "toast-host", role: "status", "aria-live": "polite" }); document.body.append(host); }
    const t = el("div", { class: "toast" + (kind ? " " + kind : ""), text });
    host.append(t);
    setTimeout(() => t.remove(), 6000);
  }

  function showMessage(title, text) {
    stopTimer();
    app.replaceChildren(el("main", { class: "c-center" },
      el("div", { class: "panel" }, el("h1", { text: title }), el("p", { class: "muted", text }))));
  }

  // ================================================================ start

  async function init() {
    if (!token) {
      return showMessage("This link is incomplete", "Open the full link from your invitation. It ends with ?t= followed by a code.");
    }
    if (!window.supabase || !cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("YOUR-PROJECT")) {
      return showMessage("The assessment is not available yet", "Contact the person who sent you this link.");
    }
    const baseUrl = (function (u) { try { return new URL(String(u).trim()).origin; } catch (_) { return String(u).trim(); } })(cfg.SUPABASE_URL);
    sb = window.supabase.createClient(baseUrl, String(cfg.SUPABASE_ANON_KEY).trim(), {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    try {
      const info = await rpc("peek_test");
      if (!info || info.error) {
        return showMessage("This link is not valid", "Check that you copied the complete link from your invitation, or contact the person who sent it.");
      }
      if (info.finished) return showDone(false);
      if (info.started) {
        const s = await rpc("start_test");
        rpc("log_event", { p_type: "resumed", p_detail: null }).catch(() => {});
        return enter(s);
      }
      showWelcome(info);
    } catch (e) {
      showMessage("The assessment could not load", "Check your internet connection, then reload the page.");
    }
  }

  function showWelcome(info) {
    const stages = info.stages || [];
    const total = stages.reduce((n, s) => n + Number(s.count || 0), 0);
    const agree = el("input", { type: "checkbox", id: "agree" });
    const startBtn = el("button", { class: "primary", text: "Start the assessment", disabled: true });
    const err = el("p", { class: "error-text hidden", role: "alert" });
    agree.addEventListener("change", () => { startBtn.disabled = !agree.checked; });

    startBtn.addEventListener("click", async () => {
      startBtn.disabled = true;
      startBtn.textContent = "Starting…";
      try {
        const s = await rpc("start_test");
        if (s.error) throw new Error(s.error);
        enter(s);
      } catch (e) {
        startBtn.disabled = false;
        startBtn.textContent = "Start the assessment";
        err.textContent = "The assessment could not start. Check your internet connection and try again.";
        err.classList.remove("hidden");
      }
    });

    app.replaceChildren(el("main", { class: "c-center" }, el("div", { class: "panel" },
      el("h1", { text: "Technical assessment" }),
      el("p", { class: "muted", text: "Hello " + info.name + ". Read these instructions before you start." }),
      el("div", { class: "facts" },
        el("div", { class: "fact" }, el("b", { text: info.duration + " min" }), el("span", { text: "Total time" })),
        el("div", { class: "fact" }, el("b", { text: String(stages.length) }), el("span", { text: "Stages, from easy to harder" })),
        el("div", { class: "fact" }, el("b", { text: String(total) }), el("span", { text: "Questions" }))),
      el("h2", { text: "What you will do" }),
      el("ol", { class: "overview" }, stages.map(s => el("li", {},
        el("span", { text: s.title }), el("span", { class: "n", text: s.count + (s.count === 1 ? " question" : " questions") })))),
      el("h2", { text: "Rules" }),
      el("ul", { class: "rules" },
        el("li", { text: "The timer starts when you press the button below and does not pause, even if you close the page." }),
        el("li", { text: "Questions cover several languages and frameworks. Answer what you know and move on when you are unsure." }),
        el("li", { text: "Each stage unlocks when you submit the previous one, and you cannot go back to a submitted stage." }),
        el("li", { text: "Go as far as you can and write clear answers: partial answers earn points." }),
        el("li", { text: "Your answers are saved automatically. If your connection drops, reopen the same link to continue." }),
        el("li", { text: "To keep the test fair, leaving this tab and pasting text into answers are recorded." }),
        el("li", { text: "Use a computer rather than a phone. Do not use AI assistants or ask anyone for help." })),
      el("label", { class: "confirm-line", for: "agree" }, agree, el("span", { text: "I have read the instructions and I am ready to start." })),
      err,
      startBtn)));
  }

  function enter(s) {
    if (!s || s.error) {
      if (s && (s.error === "TIME_UP" || s.error === "ALREADY_SUBMITTED")) return showDone(true);
      if (s && s.error === "NO_QUESTIONS") return showMessage("The assessment is not ready", "No questions are available yet. Contact the person who sent you this link.");
      return showMessage("Something went wrong", "Reload the page to continue where you stopped.");
    }
    if (s.finished) return showDone(false);
    const sameStage = state && state.step === s.step;
    state = s;
    offset = Date.parse(s.server_now) - Date.now();
    answers = {};
    for (const [qid, v] of Object.entries(s.saved || {})) answers[qid] = { choice: v.choice, text: v.text, lang: v.lang };
    for (const [qid, p] of drafts) answers[qid] = Object.assign({}, answers[qid], p);
    if (!sameStage) {
      const firstOpen = state.questions.findIndex(q => !isAnswered(q));
      qIndex = firstOpen >= 0 ? firstOpen : 0;
    }
    qIndex = Math.min(qIndex, Math.max(0, state.questions.length - 1));
    attachListeners();
    renderStage();
    startTimer();
  }

  // ================================================================ stage screen

  function stageInfo() {
    const steps = state.steps || [];
    const idx = steps.findIndex(s => s.step === state.step);
    return { steps, idx, stage: steps[idx] || { title: "", intro: "" } };
  }

  function isAnswered(q) {
    const a = answers[q.id];
    if (!a) return false;
    if (q.kind === "choice") return a.choice !== null && a.choice !== undefined;
    return !!(a.text && String(a.text).trim());
  }

  function renderStage() {
    const { steps, idx, stage } = stageInfo();

    const header = el("header", { class: "c-header" }, el("div", { class: "c-header-inner" },
      el("div", { class: "c-brand" }, el("strong", { text: "Technical assessment" }), el("span", { text: state.name })),
      el("span", { class: "save-state", id: "save-state", "aria-live": "polite", text: "All answers saved" }),
      el("button", { class: "quiet", text: "End test", onclick: endEarly }),
      el("div", { class: "timer", id: "timer", role: "timer" }, "--:--")));

    const stageList = el("ol", { class: "stage-list" }, steps.map((s, i) => el("li", {
      class: i < idx ? "done" : i === idx ? "current" : "",
      "aria-current": i === idx ? "step" : null
    }, el("span", { class: "num", text: i < idx ? "✓" : String(i + 1) }),
       el("span", { text: s.title }),
       el("span", { class: "count", text: String(s.count) }))));

    const side = el("aside", { class: "c-side" },
      el("div", { class: "panel stages-panel" }, el("h2", { text: "Stages" }), stageList),
      el("div", { class: "panel" },
        el("h2", { text: "Questions in this stage" }),
        el("div", { class: "q-grid", id: "q-grid" }),
        el("div", { class: "legend" }, el("span", { class: "l-answered", text: "Answered" }), el("span", { text: "Not answered" }))));

    const main = el("main", { class: "c-main" },
      el("div", { class: "stage-head" },
        el("div", { class: "stage-kicker", text: "Stage " + (idx + 1) + " of " + steps.length }),
        el("h1", { text: stage.title }),
        el("p", { text: stage.intro })),
      stage.scenario ? el("details", { class: "scenario", open: true },
        el("summary", { text: "Context: the MiniEvent platform" }),
        el("div", {}, SCENARIO.map(t => el("p", { text: t })))) : null,
      el("div", { id: "q-host" }));

    app.replaceChildren(header, el("div", { class: "c-layout" }, side, main));
    window.scrollTo(0, 0);
    renderQuestion();
    tick();
    setSaveState();
  }

  function renderNav() {
    const grid = document.getElementById("q-grid");
    if (!grid) return;
    grid.replaceChildren(...state.questions.map((q, i) => el("button", {
      class: "q-dot" + (isAnswered(q) ? " answered" : "") + (i === qIndex ? " current" : ""),
      "aria-label": "Question " + (i + 1) + (isAnswered(q) ? ", answered" : ", not answered"),
      "aria-current": i === qIndex ? "true" : null,
      text: String(i + 1),
      onclick: () => go(i)
    })));
  }

  function go(i) {
    if (i < 0 || i >= state.questions.length) return;
    const cur = state.questions[qIndex];
    if (cur) flushOne(cur.id);
    qIndex = i;
    renderQuestion();
    const host = document.getElementById("q-host");
    if (host && host.getBoundingClientRect().top < 0) host.scrollIntoView({ block: "start" });
  }

  function renderQuestion() {
    const host = document.getElementById("q-host");
    if (!host) return;
    editor = null;
    const q = state.questions[qIndex];
    if (!q) { host.replaceChildren(el("div", { class: "panel", text: "No questions in this stage." })); return; }
    const total = state.questions.length;
    const isLast = qIndex === total - 1;
    const { idx, steps } = stageInfo();
    const lastStage = idx === steps.length - 1;

    const langLabel = q.snippet_lang ? SNIPPET_LABEL[q.snippet_lang] : LANG_LABEL[q.lang];
    const card = el("section", { class: "panel q-card", "aria-labelledby": "q-prompt" },
      el("div", { class: "q-top" },
        el("span", { class: "q-count", text: "Question " + (qIndex + 1) + " of " + total }),
        langLabel ? el("span", { class: "chip lang", text: langLabel }) : null,
        el("span", { class: "chip", text: q.points + (Number(q.points) === 1 ? " point" : " points") })),
      q.title ? el("h2", { text: q.title }) : null,
      el("div", { class: "q-prompt", id: "q-prompt", text: q.prompt }));

    if (q.snippet) {
      const pre = el("pre", { class: "snippet", tabindex: "0", "aria-label": "Code" });
      highlight(pre, q.snippet, q.snippet_lang);
      card.append(pre);
    }

    if (q.kind === "choice") card.append(renderOptions(q));
    else card.append(...renderEditor(q));

    const prev = el("button", { text: "Previous", disabled: qIndex === 0, onclick: () => go(qIndex - 1) });
    const next = isLast
      ? el("button", { class: "primary", text: lastStage ? "Submit and finish" : "Submit stage " + (idx + 1), onclick: submitStage })
      : el("button", { class: "primary", text: "Next question", onclick: () => go(qIndex + 1) });
    const hint = q.kind === "choice"
      ? el("span", { class: "kbd-hint" }, "Keys ", el("kbd", { text: "1" }), "–", el("kbd", { text: "4" }), " choose, ", el("kbd", { text: "Enter" }), " next")
      : null;

    host.replaceChildren(card, el("div", { class: "q-nav" }, prev, el("span", { class: "spacer" }), hint, next));
    renderNav();
    if (editor) setTimeout(() => editor.refresh(), 0);
  }

  function renderOptions(q) {
    const order = shuffle(q.options.map((_, i) => i), token + ":" + q.id);
    const group = el("div", { class: "options", role: "radiogroup", "aria-labelledby": "q-prompt", id: "options" });
    const current = answers[q.id] ? answers[q.id].choice : null;
    order.forEach((idx, pos) => {
      const input = el("input", { type: "radio", name: "opt-" + q.id, value: String(idx) });
      if (current === idx) input.checked = true;
      const text = q.options[idx];
      const looksLikeCode = /^(SELECT|\[|@|git |_db\.|encoder\.|raw\.|\d)/.test(text);
      const label = el("label", { class: "option" + (input.checked ? " selected" : ""), "data-pos": String(pos) },
        input, el("span", { class: "key", "aria-hidden": "true", text: String.fromCharCode(65 + pos) }),
        el("span", { class: looksLikeCode ? "code" : null, text }));
      input.addEventListener("change", () => choose(q, idx));
      group.append(label);
    });
    return group;
  }

  function choose(q, idx) {
    answers[q.id] = Object.assign({}, answers[q.id], { choice: idx });
    document.querySelectorAll("#options .option").forEach(o => {
      const input = o.querySelector("input");
      o.classList.toggle("selected", Number(input.value) === idx);
      input.checked = Number(input.value) === idx;
    });
    queueSave(q.id, { choice: idx }, 0);
    renderNav();
  }

  function renderEditor(q) {
    const a = answers[q.id] || {};
    const local = readBackup(q.id);
    let text = a.text || "";
    if (local && local.length > text.length) {
      text = local;
      answers[q.id] = Object.assign({}, a, { text });
      queueSave(q.id, payloadFor(q, text, a.lang), 400);
    }

    let langSelect = null;
    let modeLang = q.lang === "any" ? (a.lang || "") : q.lang;
    if (q.lang === "any") {
      langSelect = el("select", { id: "answer-lang", "aria-label": "Language of your answer" },
        el("option", { value: "", text: "Choose your language" }),
        ANSWER_LANGS.map(([v, l]) => el("option", { value: v, text: l, selected: a.lang === v })));
    }
    const label = q.lang === "any" ? "Your answer" : "Your answer (" + (LANG_LABEL[q.lang] || "any language") + ")";
    const head = el("div", { class: "answer-head" }, el("label", { for: "answer", text: label }), langSelect);
    const ta = el("textarea", {
      class: "code", id: "answer", spellcheck: "false", autocomplete: "off", autocapitalize: "off",
      placeholder: q.lang === "any" ? "Write your function here" : "Explain the problem, then write your fix"
    });
    ta.value = text;
    const wrap = el("div", { class: "editor-wrap" }, ta);
    const hint = el("div", { class: "hint-line", text: "Saved automatically. Comments and explanations are welcome." });

    const onText = value => {
      backup(q.id, value);
      const cur = answers[q.id] || {};
      answers[q.id] = Object.assign({}, cur, { text: value });
      queueSave(q.id, payloadFor(q, value, cur.lang), 1500);
      renderNavLight();
    };
    const onPaste = e => {
      const pasted = (e.clipboardData && e.clipboardData.getData("text")) || "";
      logEvent("paste", pasted.length + " characters in " + (q.title || q.id));
    };

    if (langSelect) {
      langSelect.addEventListener("change", () => {
        const v = langSelect.value || null;
        const cur = answers[q.id] || {};
        answers[q.id] = Object.assign({}, cur, { lang: v });
        queueSave(q.id, payloadFor(q, cur.text || "", v), 0);
        if (editor) editor.setOption("mode", MODES[v] || null);
      });
    }

    // Mount the editor after the textarea is in the page.
    setTimeout(() => {
      if (window.CodeMirror && ta.isConnected) {
        editor = CodeMirror.fromTextArea(ta, {
          mode: MODES[modeLang] || null, lineNumbers: true, indentUnit: 4, tabSize: 4,
          viewportMargin: Infinity, lineWrapping: false,
          extraKeys: { Tab: cm => cm.replaceSelection("    "), "Shift-Tab": false }
        });
        editor.on("change", cm => onText(cm.getValue()));
        editor.on("paste", (cm, e) => onPaste(e));
        editor.on("blur", () => flushOne(q.id));
      } else {
        ta.addEventListener("input", () => onText(ta.value));
        ta.addEventListener("paste", onPaste);
        ta.addEventListener("blur", () => flushOne(q.id));
        ta.addEventListener("keydown", e => {
          if (e.key === "Tab" && !e.shiftKey) {
            e.preventDefault();
            ta.setRangeText("    ", ta.selectionStart, ta.selectionEnd, "end");
            onText(ta.value);
          }
        });
      }
    }, 0);
    return [head, wrap, hint];
  }

  function payloadFor(q, text, lang) {
    return q.lang === "any" ? { text, lang: lang || null } : { text };
  }

  let navTimer = null;
  function renderNavLight() {
    clearTimeout(navTimer);
    navTimer = setTimeout(renderNav, 300);
  }

  // ================================================================ saving

  function setSaveState() {
    const node = document.getElementById("save-state");
    if (!node) return;
    if (lastError) { node.textContent = "Not saved: retrying…"; node.classList.add("error"); return; }
    node.classList.remove("error");
    node.textContent = inFlight > 0 || drafts.size > 0 ? "Saving…" : "All answers saved";
  }

  function queueSave(qid, payload, delay) {
    drafts.set(qid, payload);
    clearTimeout(timers.get(qid));
    timers.set(qid, setTimeout(() => flushOne(qid), delay));
    setSaveState();
  }

  async function flushOne(qid) {
    clearTimeout(timers.get(qid));
    timers.delete(qid);
    if (!drafts.has(qid)) return true;
    const payload = drafts.get(qid);
    drafts.delete(qid);
    inFlight++;
    setSaveState();
    try {
      const r = await rpc("save_answer", {
        p_question_id: qid,
        p_choice: payload.choice !== undefined ? payload.choice : null,
        p_text: payload.text !== undefined ? payload.text : null,
        p_lang: payload.lang !== undefined ? payload.lang : null
      });
      inFlight--;
      if (r && r.error) {
        if (r.error === "TIME_UP" || r.error === "ALREADY_SUBMITTED") { showDone(true); return false; }
        if (r.error === "QUESTION_LOCKED") { await reloadState(); return false; }
      }
      lastError = false;
      setSaveState();
      return true;
    } catch (e) {
      inFlight--;
      lastError = true;
      if (!drafts.has(qid)) drafts.set(qid, payload);
      timers.set(qid, setTimeout(() => flushOne(qid), 4000));
      setSaveState();
      return false;
    }
  }

  async function flushAll() {
    const ids = Array.from(drafts.keys());
    const results = await Promise.all(ids.map(flushOne));
    return results.every(Boolean);
  }

  async function reloadState() {
    try { enter(await rpc("start_test")); } catch (_) { /* keep the current screen */ }
  }

  async function submitStage() {
    const { idx, steps } = stageInfo();
    const lastStage = idx === steps.length - 1;
    const open = state.questions.filter(q => !isAnswered(q)).length;
    let text = lastStage
      ? "Your answers will be sent and the assessment will end."
      : "Stage " + (idx + 2) + " opens next. You will not be able to come back to this stage.";
    if (open > 0) text = open + (open === 1 ? " question is" : " questions are") + " not answered yet.\n\n" + text;
    const ok = await modal(lastStage ? "Submit and finish?" : "Submit stage " + (idx + 1) + "?", text,
      lastStage ? "Submit and finish" : "Submit stage", "Keep working");
    if (!ok) return;

    const saved = await flushAll();
    if (!saved && drafts.size > 0) {
      await modal("Answers not saved", "Some answers could not be saved. Check your internet connection, then try again.", "OK");
      return;
    }
    try {
      const s = await rpc("next_step", { p_from: state.step });
      if (s.finished) return showDone(false);
      enter(s);
      window.scrollTo(0, 0);
    } catch (e) {
      await modal("Connection problem", "The next stage could not open. Check your internet connection, then try again.", "OK");
    }
  }

  async function endEarly() {
    const ok = await modal("End the assessment now?",
      "Your saved answers will be sent. You will not be able to continue afterwards, even if time remains.",
      "End the assessment", "Keep working");
    if (!ok) return;
    ending = true;
    stopTimer();
    try { await flushAll(); } catch (_) { /* the server keeps what it has */ }
    try { await rpc("finish_test"); } catch (_) { /* the server closes it at the deadline anyway */ }
    showDone(false);
  }

  // ================================================================ timer

  function startTimer() {
    stopTimer();
    timerId = setInterval(tick, 250);
  }
  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }
  function tick() {
    if (!state || !state.deadline) return;
    const left = Date.parse(state.deadline) - (Date.now() + offset);
    const node = document.getElementById("timer");
    const total = Math.max(0, Math.ceil(left / 1000));
    if (node) {
      const m = Math.floor(total / 60), s = total % 60;
      node.textContent = String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
      node.classList.toggle("warn", total <= 300 && total > 60);
      node.classList.toggle("danger", total <= 60);
      node.setAttribute("aria-label", m + " minutes " + s + " seconds left");
    }
    if (total <= 300 && total > 60 && !warned.five) { warned.five = true; toast("5 minutes left.", "warn"); }
    if (total <= 60 && total > 0 && !warned.one) { warned.one = true; toast("1 minute left. Your answers are saved automatically.", "warn"); }
    if (left <= 0 && !ending) timeUp();
  }

  async function timeUp() {
    ending = true;
    stopTimer();
    app.querySelectorAll("input, textarea, button, select").forEach(n => { n.disabled = true; });
    if (editor) editor.setOption("readOnly", true);
    try { await flushAll(); } catch (_) { /* server keeps what it has */ }
    try { await rpc("finish_test"); } catch (_) { /* the server closes the test anyway */ }
    showDone(true);
  }

  function showDone(timeOver) {
    ending = true;
    stopTimer();
    window.removeEventListener("beforeunload", beforeUnload);
    const check = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    check.setAttribute("viewBox", "0 0 24 24");
    check.setAttribute("width", "26");
    check.setAttribute("height", "26");
    check.setAttribute("aria-hidden", "true");
    check.innerHTML = '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';
    app.replaceChildren(el("main", { class: "c-center" }, el("div", { class: "panel" },
      el("div", { class: "end-icon" }, check),
      el("h1", { text: timeOver ? "Time is up" : "Your assessment is submitted" }),
      el("p", { text: timeOver
        ? "The answers you saved before the end of the timer have been sent."
        : "Thank you. Your answers have been sent." }),
      el("p", { class: "muted", text: "You can close this page. You will be contacted about the next steps." }))));
  }

  // ================================================================ keyboard and integrity

  function onKeyDown(e) {
    if (!state || ending || document.querySelector(".modal-bg")) return;
    const t = e.target;
    const typing = t && (t.closest && t.closest(".CodeMirror") || /^(TEXTAREA|SELECT)$/.test(t.tagName) ||
      (t.tagName === "INPUT" && t.type !== "radio"));
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    const q = state.questions[qIndex];
    if (!q) return;
    if (q.kind === "choice") {
      let pos = -1;
      if (/^[1-9]$/.test(e.key)) pos = Number(e.key) - 1;
      else if (/^[a-iA-I]$/.test(e.key)) pos = e.key.toLowerCase().charCodeAt(0) - 97;
      if (pos >= 0) {
        const label = document.querySelector('#options .option[data-pos="' + pos + '"]');
        if (label) { e.preventDefault(); choose(q, Number(label.querySelector("input").value)); }
        return;
      }
    }
    if (e.key === "Enter" && !(t && /^(BUTTON|A|SUMMARY)$/.test(t.tagName))) {
      e.preventDefault();
      if (qIndex < state.questions.length - 1) go(qIndex + 1); else submitStage();
    }
  }

  const lastLogged = {};
  function logEvent(type, detail) {
    if (ending || !state) return;
    const now = Date.now();
    if (lastLogged[type] && now - lastLogged[type] < 3000) return;
    lastLogged[type] = now;
    rpc("log_event", { p_type: type, p_detail: detail || null }).catch(() => {});
  }

  function beforeUnload(e) {
    if (ending) return;
    e.preventDefault();
    e.returnValue = "";
  }

  function attachListeners() {
    if (listenersOn) return;
    listenersOn = true;
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { logEvent("tab_hidden"); flushAll(); }
    });
    window.addEventListener("blur", () => {
      setTimeout(() => { if (!document.hidden) logEvent("focus_lost"); }, 150);
    });
    document.addEventListener("copy", () => logEvent("copy"));
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("online", () => flushAll());
  }

  init();
})();
