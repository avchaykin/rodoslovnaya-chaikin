// Закрытая копия древа и семейный чат. Вход по ссылке на email, данные древа,
// фото и сообщения отдаёт функция в Яндекс Облаке (yc/function); кому открыт
// доступ, решает список адресов в её настройках, а не этот публичный файл.
const API = window.TREE_API_URL;
const SESSION_KEY = "cm-session";
const NAME_KEY = "cm-display-name";
const GENERAL = "general";
const POLL_MS = 30000;

const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: k => { try { localStorage.removeItem(k); } catch {} },
};

// ─── Стили ────────────────────────────────────────────────────────────────
const css = document.createElement("style");
css.textContent = `
  .cm-auth { font: inherit; font-size: 12.5px; height: 28px; padding: 0 10px; border-radius: 14px; flex: none;
    border: 1px solid var(--accent); background: transparent; color: var(--accent); cursor: pointer; }
  .cm-auth.on { border-color: var(--line); color: var(--muted); }
  .cm-sec { margin-top: 22px; }
  .cm-sec h3 { font-family: var(--font-body); font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
    color: var(--muted); margin: 0 0 8px; display: flex; gap: 8px; align-items: baseline; }
  .cm-list { display: flex; flex-direction: column; gap: 8px; max-height: 60vh; overflow-y: auto; padding: 4px 2px; }
  .cm-item { max-width: 85%; align-self: flex-start; background: var(--bg); border: 1px solid var(--line);
    border-radius: 12px 12px 12px 4px; padding: 6px 10px 8px; font-size: 14px; }
  .cm-item.mine { align-self: flex-end; border-radius: 12px 12px 4px 12px;
    background: color-mix(in srgb, var(--accent) 12%, var(--paper)); border-color: color-mix(in srgb, var(--accent) 35%, var(--line)); }
  .cm-item .who { font-size: 11.5px; color: var(--muted); display: flex; gap: 8px; align-items: baseline; }
  .cm-item .who b { color: var(--accent); }
  .cm-item .text { white-space: pre-line; overflow-wrap: anywhere; margin-top: 2px; }
  .cm-item img { display: block; max-width: 100%; max-height: 320px; border-radius: 8px; margin-top: 6px; cursor: zoom-in; }
  .cm-del { font: inherit; font-size: 11.5px; color: var(--muted); background: none; border: 0; padding: 0; cursor: pointer;
    text-decoration: underline; text-underline-offset: 2px; margin-left: auto; }
  .cm-form { display: grid; grid-template-columns: auto 1fr auto; gap: 6px; align-items: end; margin-top: 10px; }
  .cm-form textarea { min-height: 40px; height: 40px; resize: vertical; }
  .cm-attach { font: inherit; font-size: 18px; width: 40px; height: 40px; border-radius: 8px; border: 1px solid var(--line);
    background: transparent; color: var(--muted); cursor: pointer; }
  .cm-attach:hover { color: var(--ink); border-color: var(--accent); }
  .cm-preview { grid-column: 1 / -1; display: flex; gap: 8px; align-items: center; font-size: 12.5px; color: var(--muted); }
  .cm-preview img { height: 56px; border-radius: 6px; }
  .cm-preview[hidden] { display: none; }
  .cm-form .cm-err { grid-column: 1 / -1; }
  #cm-lightbox { padding: 8px; width: auto; max-width: 96vw; background: #111; border: 0; }
  #cm-lightbox img { display: block; max-width: calc(96vw - 16px); max-height: 88vh; }
  #cm-lightbox .cap { color: #ddd; font-size: 13px; margin-top: 6px; white-space: pre-line; max-width: 80ch; }
  .cm-note { font-size: 13px; color: var(--muted); }
  .cm-err { font-size: 13px; color: var(--female); }
  #cm-dialog form { display: grid; gap: 12px; }
  #cm-dialog p { margin: 0; font-size: 14px; }
`;
document.head.appendChild(css);

// ─── Разметка ────────────────────────────────────────────────────────────
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const authBtn = el("button", "cm-auth", "Войти");
authBtn.type = "button";
const statusEl = document.getElementById("status");
statusEl?.parentNode.insertBefore(authBtn, statusEl.nextSibling);

const dialog = el("dialog");
dialog.id = "cm-dialog";
dialog.innerHTML = `
  <form method="dialog">
    <h2 id="cm-d-title">Вход для комментариев</h2>
    <p id="cm-d-text"></p>
    <label id="cm-d-label">Email<input id="cm-d-input" type="email" autocomplete="email" required></label>
    <div class="cm-err" id="cm-d-err"></div>
    <div class="actions">
      <button class="btn primary" id="cm-d-ok" value="ok">Отправить ссылку</button>
      <button class="btn" value="cancel" formnovalidate>Отмена</button>
    </div>
  </form>`;
document.body.appendChild(dialog);
const $d = id => dialog.querySelector("#" + id);

const lightbox = el("dialog");
lightbox.id = "cm-lightbox";
lightbox.addEventListener("click", () => lightbox.close());
document.body.appendChild(lightbox);
function showImage(src, caption) {
  lightbox.innerHTML = "";
  const img = el("img");
  img.src = src;
  img.alt = caption || "";
  lightbox.append(img);
  if (caption) lightbox.append(el("div", "cap", caption));
  lightbox.showModal();
}

// Фото уменьшаем в браузере перед отправкой (до ~1 МБ),
// 1600 px — текст писем ещё читается.
const MAX_SIDE = 1600, MAX_CHARS = 900000;
async function shrinkImage(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  for (let side = MAX_SIDE; side >= 600; side = Math.round(side * 0.8)) {
    const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    for (const q of [0.82, 0.7, 0.6]) {
      const url = c.toDataURL("image/jpeg", q);
      if (url.length <= MAX_CHARS) return url;
    }
  }
  throw new Error("too-big");
}

// Общее обсуждение — отдельной панелью рядом с журналом
const generalPanel = el("section", "panel");
generalPanel.innerHTML = `<h3>Семейный чат</h3><p class="tl-note">Сообщения и фото (родных, писем, документов) видят и пишут только члены семьи из списка, после входа по ссылке на email. Обсуждение конкретного человека — в его карточке.</p>`;
const generalBox = el("div");
generalPanel.appendChild(generalBox);
document.querySelector("main.info")?.appendChild(generalPanel);


// ─── Состояние и API ─────────────────────────────────────────────────────
let user = null; // { email }
const threads = new Map(); // personId -> { box, items, error, draft, image, loaded }

class ApiError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }

async function api(method, op, { body, query = {}, raw = false } = {}) {
  const url = new URL(API);
  url.search = new URLSearchParams({ op, ...query });
  const headers = {};
  const session = store.get(SESSION_KEY);
  if (session) headers["X-Session"] = session;
  if (body) headers["Content-Type"] = "application/json";
  const r = await fetch(url, { method, headers, body: body && JSON.stringify(body) });
  if (!r.ok) {
    let code = "server";
    try { code = (await r.json()).error || code; } catch {}
    throw new ApiError(r.status, code);
  }
  return raw ? r : r.json();
}

// Картинки отдаются только с токеном, поэтому грузим их fetch'ем и показываем через blob:
const blobs = new Map();
function imageUrl(kind, id) {
  const key = kind + "/" + id;
  if (!blobs.has(key)) {
    blobs.set(key, api("GET", "image", { query: { kind, id }, raw: true })
      .then(r => r.blob()).then(b => URL.createObjectURL(b))
      .catch(e => { blobs.delete(key); throw e; }));
  }
  return blobs.get(key);
}

function ask({ title, text, label, type = "text", value = "", ok }) {
  $d("cm-d-title").textContent = title;
  $d("cm-d-text").textContent = text;
  $d("cm-d-label").firstChild.textContent = label;
  const input = $d("cm-d-input");
  input.type = type;
  input.value = value;
  $d("cm-d-ok").textContent = ok;
  $d("cm-d-err").textContent = "";
  dialog.showModal();
  input.focus();
  return new Promise(resolve => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "ok" ? input.value.trim() : null), { once: true });
  });
}

function displayName() {
  return store.get(NAME_KEY) || (user?.email || "").split("@")[0];
}

function fmtDate(ms) {
  return ms ? new Date(ms).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}

// ─── Ветка комментариев ──────────────────────────────────────────────────
function renderThread(personId) {
  const t = threads.get(personId);
  if (!t) return;
  const { box } = t;
  box.innerHTML = "";
  if (!user) return;
  if (t.error) { box.appendChild(el("div", "cm-err", t.error)); return; }
  if (!t.loaded) { box.appendChild(el("div", "cm-note", "Загружаю…")); return; }
  const list = el("div", "cm-list");
  const items = [...t.items].sort((a, b) => a.ts - b.ts);
  if (!items.length) list.appendChild(el("div", "cm-note", "Сообщений пока нет."));
  for (const c of items) {
    const mine = c.email === user.email;
    const it = el("div", "cm-item" + (mine ? " mine" : ""));
    const who = el("div", "who");
    who.append(el("b", null, c.author || c.email), el("span", null, fmtDate(c.ts)));
    if (mine) {
      const del = el("button", "cm-del", "удалить");
      del.type = "button";
      del.addEventListener("click", async () => {
        del.disabled = true;
        try { await api("POST", "delete", { body: { person: personId, id: c.id } }); await refreshThread(personId); }
        catch { del.disabled = false; del.textContent = "не удалилось"; }
      });
      who.appendChild(del);
    }
    it.appendChild(who);
    if (c.image) {
      const img = el("img");
      img.alt = c.text || "Фото";
      imageUrl("chat", c.image).then(src => {
        img.src = src;
        img.addEventListener("click", () => showImage(src, c.text));
      }).catch(() => { img.alt = "фото не загрузилось"; });
      it.appendChild(img);
    }
    if (c.text) it.appendChild(el("div", "text", c.text));
    list.appendChild(it);
  }
  box.appendChild(list);
  requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });

  const form = el("form", "cm-form");
  const file = el("input");
  file.type = "file";
  file.accept = "image/*";
  file.hidden = true;
  const attach = el("button", "cm-attach", "📎");
  attach.type = "button";
  attach.title = "Прикрепить фото (родных, писем, документов)";
  attach.addEventListener("click", () => file.click());
  const ta = el("textarea");
  ta.placeholder = personId === GENERAL ? "Сообщение или подпись к фото…" : "Что вы помните об этом человеке, поправка, вопрос, подпись к фото…";
  ta.maxLength = 4000;
  ta.value = t.draft || "";
  ta.addEventListener("input", () => { t.draft = ta.value; });
  ta.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) form.requestSubmit(); });
  const btn = el("button", "btn primary", "Отправить");
  btn.type = "submit";
  const preview = el("div", "cm-preview");
  preview.hidden = !t.image;
  const err = el("div", "cm-err");
  const showPreview = () => {
    preview.innerHTML = "";
    preview.hidden = !t.image;
    if (!t.image) return;
    const img = el("img");
    img.src = t.image;
    const rm = el("button", "cm-del", "убрать фото");
    rm.type = "button";
    rm.style.marginLeft = "0";
    rm.addEventListener("click", () => { t.image = null; showPreview(); });
    preview.append(img, el("span", null, `${Math.round(t.image.length * 0.75 / 1024)} КБ`), rm);
  };
  file.addEventListener("change", async () => {
    const f = file.files[0];
    file.value = "";
    if (!f) return;
    err.textContent = "Готовлю фото…";
    try { t.image = await shrinkImage(f); err.textContent = ""; showPreview(); }
    catch { err.textContent = "Не получилось открыть это изображение. Попробуйте JPG или PNG."; }
  });
  showPreview();
  form.append(file, attach, ta, btn, preview, err);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const text = ta.value.trim();
    if (!text && !t.image) return;
    btn.disabled = true;
    err.textContent = t.image ? "Отправляю фото…" : "";
    try {
      await api("POST", "post", { body: { person: personId, text, author: displayName(), image: t.image || undefined } });
      t.draft = "";
      t.image = null;
      await refreshThread(personId);
    } catch {
      err.textContent = "Сообщение не сохранилось. Попробуйте ещё раз.";
      btn.disabled = false;
    }
  });
  box.appendChild(form);
}

async function refreshThread(personId) {
  const t = threads.get(personId);
  if (!t || !user) return;
  try {
    const { messages } = await api("GET", "thread", { query: { person: personId } });
    const changed = !t.loaded || t.error || JSON.stringify(messages) !== JSON.stringify(t.items);
    t.items = messages; t.loaded = true; t.error = "";
    // Не перерисовываем без изменений, чтобы не сбить набор текста
    if (changed) renderThread(personId);
  } catch (e) {
    if (e.status === 401 || e.status === 403) return signOutLocal();
    t.error = "Сообщения не загрузились. Обновите страницу.";
    renderThread(personId);
  }
}

function attachThread(personId, box) {
  let t = threads.get(personId);
  if (!t) { t = { box, items: [], error: "", draft: "", image: null, loaded: false }; threads.set(personId, t); }
  t.box = box;
  renderThread(personId);
  refreshThread(personId);
}

// Пока открыт чат и вкладка видна, раз в 30 секунд проверяем новые сообщения
setInterval(() => {
  if (!user || document.visibilityState !== "visible") return;
  for (const [id, t] of threads) if (t.box.isConnected && t.loaded) refreshThread(id);
}, POLL_MS);

// Секция в карточке человека: добавляем после каждой перерисовки справки
const drawerBody = document.getElementById("d-body");
let drawerThread = null;
function syncDrawer() {
  const key = typeof drawerKey === "string" ? drawerKey : null; // eslint-disable-line no-undef
  if (!user || !drawerBody || !key || key.startsWith("slot:")) return;
  let sec = drawerBody.querySelector(".cm-sec");
  if (sec && sec.dataset.key === key) return;
  sec?.remove();
  sec = el("section", "cm-sec");
  sec.dataset.key = key;
  sec.appendChild(el("h3", null, "Чат семьи об этом человеке"));
  const box = el("div");
  sec.appendChild(box);
  drawerBody.appendChild(sec);
  if (drawerThread && drawerThread !== key) threads.delete(drawerThread);
  drawerThread = key;
  attachThread(key, box);
}
if (drawerBody) new MutationObserver(syncDrawer).observe(drawerBody, { childList: true });

// ─── Вход ────────────────────────────────────────────────────────────────
const gateText = document.getElementById("gate-text");
const gateLogin = document.getElementById("gate-login");
const gateLogout = document.getElementById("gate-logout");
const GATE_HELLO = "Страница доступна только членам семьи. Войдите по ссылке, которая придёт на ваш email.";
const gate = (text, { login = false, logout = false } = {}) => {
  if (gateText) gateText.textContent = text;
  if (gateLogin) gateLogin.hidden = !login;
  if (gateLogout) gateLogout.hidden = !logout;
};

const ERRORS = {
  "not-allowed": "Этого адреса нет в списке семьи. Напишите Александру, чтобы он его добавил.",
  "cooldown": "Письмо только что отправлено. Подождите минуту, прежде чем запросить ещё одно.",
  "daily-limit": "На сегодня писем отправлено слишком много. Попробуйте завтра.",
  "bad-email": "Похоже, в адресе опечатка.",
};

async function startSignIn() {
  const email = await ask({
    title: "Вход",
    text: "Пришлём ссылку для входа на ваш email. Её можно открыть в любом браузере.",
    label: "Email", type: "email", value: "", ok: "Отправить ссылку",
  });
  if (!email) return;
  gate("Отправляю письмо…");
  try {
    await api("POST", "login-request", { body: { email } });
    gate(`Письмо со ссылкой отправлено на ${email}. Откройте его и нажмите «Войти». Если письма нет, проверьте «Спам».`, { login: true });
    if (gateLogin) gateLogin.textContent = "Отправить ещё раз";
  } catch (e) {
    gate(ERRORS[e.code] || "Не получилось отправить письмо. Попробуйте ещё раз чуть позже.", { login: true });
  }
}

async function completeSignInFromLink() {
  const token = new URLSearchParams(location.search).get("login");
  if (!token) return;
  history.replaceState(null, "", location.pathname);
  gate("Вхожу…");
  try {
    const { session } = await api("POST", "login-confirm", { body: { token } });
    store.set(SESSION_KEY, session);
  } catch (e) {
    gate(e.code === "not-allowed" ? ERRORS["not-allowed"] : "Ссылка устарела (она действует сутки). Запросите новую.", { login: true });
    throw e;
  }
}

function signOutLocal() {
  store.del(SESSION_KEY);
  location.reload(); // убираем древо со страницы
}

async function askName() {
  const name = await ask({
    title: "Как вас подписывать?",
    text: "Имя будет видно рядом с вашими сообщениями, например «Галина» или «тётя Таня».",
    label: "Имя", value: displayName(), ok: "Сохранить",
  });
  if (name) { store.set(NAME_KEY, name); authBtn.textContent = name; for (const id of threads.keys()) renderThread(id); }
}

authBtn.addEventListener("click", async () => {
  if (!user) return startSignIn();
  if (confirm(`Вы вошли как ${user.email} (подпись «${displayName()}»).\nОК — выйти, Отмена — сменить подпись.`)) signOutLocal();
  else await askName();
});
gateLogin?.addEventListener("click", () => startSignIn());
gateLogout?.addEventListener("click", () => signOutLocal());

// ─── Загрузка древа ──────────────────────────────────────────────────────
async function loadTree() {
  gate("Загружаю древо…");
  const data = await api("GET", "tree");
  const ids = [...new Set(Object.values(data.people || {}).map(p => p.photo).filter(Boolean))];
  await Promise.all(ids.map(id => imageUrl("photos", id)
    .then(src => { window.__TREE_PHOTOS__[id] = src; })
    .catch(() => {})));
  window.__resolveTree?.(data);
  document.body.classList.remove("locked");
}

async function start() {
  if (!API) { gate("Вход ещё не настроен."); authBtn.hidden = true; return; }
  try { await completeSignInFromLink(); } catch { return; }
  if (!store.get(SESSION_KEY)) { gate(GATE_HELLO, { login: true }); return; }
  try {
    user = await api("GET", "me");
    await loadTree();
  } catch (e) {
    if (e.status === 401) { store.del(SESSION_KEY); gate(GATE_HELLO, { login: true }); return; }
    if (e.status === 403) { gate(ERRORS["not-allowed"], { logout: true }); return; }
    gate("Древо не загрузилось. Проверьте интернет и обновите страницу.", { logout: true });
    return;
  }
  authBtn.textContent = displayName();
  authBtn.classList.add("on");
  authBtn.title = `Вы вошли как ${user.email}. Нажмите, чтобы выйти или сменить подпись.`;
  attachThread(GENERAL, generalBox);
  syncDrawer();
  if (!store.get(NAME_KEY)) askName();
}
start();
