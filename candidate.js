(() => {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const app = document.getElementById("app");
  const token = new URLSearchParams(location.search).get("t");

  const TRACKS = {
    js: { label: "JavaScript / TypeScript (Node, React, Angular, Vue)", lang: "JavaScript" },
    java: { label: "Java (Spring)", lang: "Java" },
    dotnet: { label: "C# (.NET)", lang: "C#" },
    php: { label: "PHP (Laravel)", lang: "PHP" },
    python: { label: "Python (Django, Flask)", lang: "Python" }
  };

  const STEPS = [
    { label: "Quiz", title: "Part 1: Fundamentals quiz",
      intro: "Ten short questions on the web, databases, Git, security and your language. Pick one answer per question. Aim to spend about 8 minutes here." },
    { label: "Stage 1", title: "Stage 1: Data",
      intro: "Start the MiniEvent problem by working with its database." },
    { label: "Stage 2", title: "Stage 2: Business rules",
      intro: "Write the rules that decide whether a booking is allowed." },
    { label: "Stage 3", title: "Stage 3: A bug in production",
      intro: "Some events are overbooked. Find out why and fix it." },
    { label: "Stage 4", title: "Stage 4: Security review",
      intro: "A colleague wrote the endpoint that shows a booking. Review it and make it safe." }
  ];

  const SCENARIO = [
    "MiniEvent is a small web platform where users book seats for events. Each event has a limited capacity.",
    "Database tables: events(id, title, capacity, starts_at) and bookings(id, event_id, user_id, created_at)."
  ];

  let sb = null;
  let state = null;
  let offset = 0;            // server time minus local time, in ms
  let timerId = null;
  let ending = false;
  let listenersOn = false;
  const drafts = new Map();  // question id -> latest unsaved payload
  const timers = new Map();  // question id -> debounce timeout
  let inFlight = 0;
  let lastError = false;

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

  function render(...nodes) {
    app.replaceChildren(...nodes);
    window.scrollTo(0, 0);
  }

  function showMessage(title, text) {
    stopTimer();
    render(el("main", { class: "message panel" }, el("h1", { text: title }), el("p", { text })));
  }

  // Deterministic shuffle so a reload shows the same order to the same candidate.
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

  function backupKey(qid) { return "mt:" + token + ":" + qid; }
  function backup(qid, text) { try { localStorage.setItem(backupKey(qid), text); } catch (_) { /* ignore */ } }
  function readBackup(qid) { try { return localStorage.getItem(backupKey(qid)); } catch (_) { return null; } }

  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, Object.assign({ p_token: token }, args || {}));
    if (error) throw error;
    return data;
  }

  // ------------------------------------------------------------ start

  async function init() {
    if (!token) {
      return showMessage("This link is incomplete", "Open the full link from your invitation email. It ends with ?t= followed by a code.");
    }
    if (!window.supabase || !cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("YOUR-PROJECT")) {
      return showMessage("The assessment is not configured yet", "Contact the recruiter who sent you this link.");
    }
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    try {
      const info = await rpc("peek_test");
      if (!info || info.error) {
        return showMessage("This link is not valid", "Check that you copied the complete link from your invitation, or contact the recruiter.");
      }
      if (info.finished) return showDone(false);
      if (info.started) {
        const s = await rpc("start_test", { p_track: null });
        rpc("log_event", { p_type: "resumed", p_detail: null }).catch(() => {});
        return enter(s);
      }
      showWelcome(info);
    } catch (e) {
      showMessage("This link is not valid", "Check that you copied the complete link from your invitation, or contact the recruiter.");
    }
  }

  function showWelcome(info) {
    const company = cfg.COMPANY_NAME || "our team";
    const needTrack = !info.track;
    let select = null;
    if (needTrack) {
      select = el("select", { id: "track" },
        el("option", { value: "", text: "Choose the language you know best" }),
        Object.entries(TRACKS).map(([k, t]) => el("option", { value: k, text: t.label })));
    }
    const err = el("p", { class: "error-text hidden" });
    const startBtn = el("button", { class: "primary", text: "Start the timer" });

    startBtn.addEventListener("click", async () => {
      const track = needTrack ? select.value : null;
      if (needTrack && !track) {
        err.textContent = "Choose a language before you start.";
        err.classList.remove("hidden");
        select.focus();
        return;
      }
      startBtn.disabled = true;
      startBtn.textContent = "Starting…";
      try {
        const s = await rpc("start_test", { p_track: track });
        if (s.error) throw new Error(s.error);
        enter(s);
      } catch (e) {
        startBtn.disabled = false;
        startBtn.textContent = "Start the timer";
        err.textContent = "The test could not start. Check your internet connection and try again.";
        err.classList.remove("hidden");
      }
    });

    render(el("main", { class: "welcome panel" },
      el("h1", { text: "Hello " + info.name }),
      el("p", { text: "This is the technical assessment for the junior full-stack developer position at " + company + "." }),
      el("ul", {},
        el("li", { text: "You have " + info.duration + " minutes. The timer starts when you press the button below and does not pause, even if you close the page." }),
        el("li", { text: "First a short quiz, then one problem in four stages that get progressively harder. Each stage unlocks when you submit the previous one, and you cannot go back." }),
        el("li", { text: "Few candidates finish every stage. Go as far as you can and write clear answers: partial answers earn points." }),
        el("li", { text: "Your answers are saved automatically. If your connection drops, reopen the same link to continue." }),
        el("li", { text: "To keep the test fair, leaving this tab and pasting text into answers are recorded and shared with the recruiter." }),
        el("li", { text: "Use a computer rather than a phone. You may not use AI assistants or ask anyone for help." })
      ),
      needTrack ? el("div", { style: "margin-bottom:1.2rem" }, el("label", { for: "track", text: "Your language for the code questions" }), select) : null,
      !needTrack ? el("p", { class: "muted", text: "Your language for the code questions: " + (TRACKS[info.track] ? TRACKS[info.track].label : info.track) }) : null,
      err,
      startBtn
    ));
  }

  function enter(s) {
    if (!s || s.error) {
      if (s && (s.error === "TIME_UP" || s.error === "ALREADY_SUBMITTED")) return showDone(true);
      return showMessage("Something went wrong", "Reload the page to continue where you stopped.");
    }
    if (s.finished) return showDone(false);
    state = s;
    offset = Date.parse(s.server_now) - Date.now();
    attachListeners();
    renderStep();
    startTimer();
  }

  // ------------------------------------------------------------ step screen

  function renderStep() {
    const step = state.step;
    const meta = STEPS[step];
    const track = TRACKS[state.track] || { label: state.track, lang: "your language" };

    const timer = el("div", { class: "timer", id: "timer", role: "timer", "aria-live": "off" }, "--:--");
    const top = el("header", { class: "topbar" },
      el("div", { class: "topbar-inner" },
        el("div", { class: "who" }, el("strong", { text: state.name }), el("span", { text: track.label })),
        timer),
      el("div", { class: "rail", "aria-label": "Progress" },
        STEPS.map((s, i) => el("div", {
          class: i < step ? "done" : i === step ? "current" : "",
          "aria-current": i === step ? "step" : null,
          text: s.label
        }))));

    let questions = state.questions.slice();
    if (step === 0) questions = shuffle(questions, token + ":quiz");

    const body = el("main", { class: "page" },
      el("div", { class: "step-head" }, el("h1", { text: meta.title }), el("p", { text: meta.intro })),
      step >= 1 ? el("div", { class: "scenario" }, SCENARIO.map(t => el("p", { text: t }))) : null,
      questions.map((q, i) => renderQuestion(q, i + 1, track)));

    const isLast = step === 4;
    const nextBtn = el("button", {
      class: "primary",
      text: isLast ? "Submit my test" : step === 0 ? "Submit the quiz and open Stage 1" : "Submit Stage " + step + " and open Stage " + (step + 1)
    });
    nextBtn.addEventListener("click", () => goNext(nextBtn));
    const footer = el("div", { class: "footer-bar" },
      el("div", { class: "footer-inner" }, el("div", { class: "save-state", id: "save-state", "aria-live": "polite", text: "All answers saved" }), nextBtn));

    render(top, body, footer);
    tick();
  }

  function renderQuestion(q, number, track) {
    const saved = (state.saved && state.saved[q.id]) || {};
    const box = el("section", { class: "question", "aria-labelledby": "q-" + q.id });
    const pts = q.points + (Number(q.points) === 1 ? " point" : " points");
    box.append(el("div", { class: "q-meta" },
      el("span", { text: q.title ? number + ". " + q.title : "Question " + number }),
      el("span", { text: pts })));
    box.append(el("div", { class: "q-prompt", id: "q-" + q.id, text: q.prompt }));
    if (q.snippet) box.append(el("pre", { class: "snippet" }, el("code", { text: q.snippet })));

    if (q.kind === "choice") {
      const order = shuffle(q.options.map((t, i) => i), token + ":" + q.id);
      const group = el("div", { class: "options", role: "radiogroup" });
      order.forEach(idx => {
        const input = el("input", { type: "radio", name: q.id, value: String(idx) });
        if (saved.choice === idx) input.checked = true;
        const looksLikeCode = /^(SELECT|\[|\(|@|git |\d)/.test(q.options[idx]);
        const label = el("label", { class: "option" + (input.checked ? " selected" : "") },
          input, el("span", { class: looksLikeCode ? "code" : null, text: q.options[idx] }));
        input.addEventListener("change", () => {
          group.querySelectorAll(".option").forEach(o => o.classList.remove("selected"));
          label.classList.add("selected");
          queueSave(q.id, { choice: idx }, 0);
        });
        group.append(label);
      });
      box.append(group);
    } else {
      const lang = q.answer_hint || track.lang;
      const local = readBackup(q.id);
      const initial = saved.text != null ? saved.text : "";
      const ta = el("textarea", {
        class: "code", spellcheck: "false", autocomplete: "off", autocapitalize: "off",
        "aria-label": "Your answer", placeholder: lang === "SQL" ? "-- Write your SQL here" : "Write your answer in " + lang
      });
      ta.value = local && local.length > initial.length ? local : initial;
      if (ta.value !== initial) queueSave(q.id, { text: ta.value }, 500);
      ta.addEventListener("input", () => { backup(q.id, ta.value); queueSave(q.id, { text: ta.value }, 1500); });
      ta.addEventListener("blur", () => flushOne(q.id));
      ta.addEventListener("keydown", e => {
        if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          const s = ta.selectionStart, end = ta.selectionEnd;
          ta.setRangeText("    ", s, end, "end");
          ta.dispatchEvent(new Event("input"));
        }
      });
      ta.addEventListener("paste", e => {
        const text = (e.clipboardData && e.clipboardData.getData("text")) || "";
        logEvent("paste", text.length + " characters in " + (q.title || q.id));
      });
      box.append(el("label", { class: "editor-label" },
        el("span", { text: "Your answer (" + lang + ")" }),
        el("span", { text: "Tab inserts spaces" })), ta);
    }
    return box;
  }

  // ------------------------------------------------------------ saving

  function setSaveState() {
    const node = document.getElementById("save-state");
    if (!node) return;
    if (lastError) { node.textContent = "Not saved yet. Check your connection; retrying…"; node.classList.add("error"); return; }
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
        p_text: payload.text !== undefined ? payload.text : null
      });
      inFlight--;
      if (r && r.error) {
        if (r.error === "TIME_UP" || r.error === "ALREADY_SUBMITTED") { showDone(true); return false; }
        if (r.error === "QUESTION_LOCKED") { await reloadState(); return false; }
      }
      lastError = false;
      if (state && state.saved) state.saved[qid] = Object.assign({}, state.saved[qid], payload);
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
    try { enter(await rpc("start_test", { p_track: null })); } catch (_) { /* keep current screen */ }
  }

  async function goNext(btn) {
    const unanswered = state.questions.filter(q => {
      const local = drafts.get(q.id);
      const saved = (state.saved || {})[q.id] || {};
      if (q.kind === "choice") return (local ? local.choice : saved.choice) == null;
      const text = local ? local.text : saved.text;
      return !text || !String(text).trim();
    }).length;
    const isLast = state.step === 4;
    let msg = isLast
      ? "Submit your test now? You will not be able to change your answers."
      : "Submit this part and open the next one? You will not be able to come back to it.";
    if (unanswered > 0) msg = unanswered + (unanswered === 1 ? " question is" : " questions are") + " still unanswered.\n\n" + msg;
    if (!confirm(msg)) return;

    btn.disabled = true;
    btn.textContent = "Submitting…";
    const ok = await flushAll();
    if (!ok && drafts.size > 0) {
      btn.disabled = false;
      btn.textContent = "Try again";
      alert("Some answers could not be saved. Check your internet connection, then try again.");
      return;
    }
    try {
      const s = await rpc("next_step", { p_from: state.step });
      if (s.finished) return showDone(false);
      enter(s);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Try again";
      alert("The next stage could not open. Check your internet connection, then try again.");
    }
  }

  // ------------------------------------------------------------ timer

  function startTimer() {
    stopTimer();
    timerId = setInterval(tick, 250);
  }
  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }
  function tick() {
    if (!state) return;
    const left = Date.parse(state.deadline) - (Date.now() + offset);
    const node = document.getElementById("timer");
    if (node) {
      const total = Math.max(0, Math.ceil(left / 1000));
      const m = Math.floor(total / 60), s = total % 60;
      node.textContent = String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
      node.classList.toggle("warn", total <= 300 && total > 60);
      node.classList.toggle("danger", total <= 60);
      node.setAttribute("aria-label", m + " minutes " + s + " seconds left");
    }
    if (left <= 0 && !ending) timeUp();
  }

  async function timeUp() {
    ending = true;
    stopTimer();
    app.querySelectorAll("input, textarea, button").forEach(n => { n.disabled = true; });
    try { await flushAll(); } catch (_) { /* server keeps what it already has */ }
    try { await rpc("finish_test"); } catch (_) { /* the server closes the test anyway */ }
    showDone(true);
  }

  function showDone(timeOver) {
    ending = true;
    stopTimer();
    window.removeEventListener("beforeunload", beforeUnload);
    render(el("main", { class: "message panel" },
      el("h1", { text: timeOver ? "Time is up" : "Your test is submitted" }),
      el("p", { text: timeOver
        ? "Your answers saved before the end of the timer have been sent to the recruiter."
        : "Thank you. Your answers have been sent to the recruiter." }),
      el("p", { class: "muted", text: "You can close this page. The recruitment team will contact you about the next steps." })));
  }

  // ------------------------------------------------------------ integrity

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
