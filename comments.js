// Комментарии к статической копии древа: вход по ссылке на email (Firebase Auth),
// хранение в Firestore. Кто может читать и писать — решают правила Firestore
// (список адресов хранится там, а не в этом публичном репозитории).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signOut,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, query, where, onSnapshot,
  addDoc, deleteDoc, doc, serverTimestamp, getDoc, getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const cfg = window.COMMENTS_FIREBASE_CONFIG;
const EMAIL_KEY = "cm-email-for-signin";
const NAME_KEY = "cm-display-name";
const GENERAL = "general";

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

// Фото уменьшаем в браузере: хранятся прямо в Firestore (документ до 1 МБ),
// поэтому не нужен платный Cloud Storage. 1600 px — текст писем ещё читается.
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

// ─── Состояние ───────────────────────────────────────────────────────────
let auth = null, db = null, user = null;
const threads = new Map(); // personId -> { box, unsub, items, error }

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

function fmtDate(ts) {
  const d = ts?.toDate ? ts.toDate() : null;
  return d ? d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "только что";
}

// ─── Ветка комментариев ──────────────────────────────────────────────────
function renderThread(personId) {
  const t = threads.get(personId);
  if (!t) return;
  const { box } = t;
  box.innerHTML = "";
  if (!cfg) { box.appendChild(el("div", "cm-note", "Комментарии ещё не настроены.")); return; }
  if (!user) {
    const p = el("div", "cm-note", "Чтобы читать и писать комментарии, ");
    const a = el("button", "cm-del", "войдите по ссылке на email");
    a.type = "button";
    a.style.marginLeft = "0";
    a.addEventListener("click", startSignIn);
    p.append(a, ".");
    box.appendChild(p);
    return;
  }
  if (t.error) { box.appendChild(el("div", "cm-err", t.error)); return; }
  const list = el("div", "cm-list");
  const items = [...(t.items || [])].sort((a, b) => (a.createdAt?.toMillis?.() ?? Infinity) - (b.createdAt?.toMillis?.() ?? Infinity));
  if (!items.length) list.appendChild(el("div", "cm-note", "Комментариев пока нет."));
  for (const c of items) {
    const it = el("div", "cm-item" + (c.authorEmail === user.email ? " mine" : ""));
    const who = el("div", "who");
    who.append(el("b", null, c.author || c.authorEmail), el("span", null, fmtDate(c.createdAt)));
    if (c.authorEmail === user.email) {
      const del = el("button", "cm-del", "удалить");
      del.type = "button";
      del.addEventListener("click", async () => {
        try { await deleteDoc(doc(db, "comments", c.id)); }
        catch { alert("Не получилось удалить."); }
      });
      who.appendChild(del);
    }
    it.appendChild(who);
    if (c.image) {
      const img = el("img");
      img.src = c.image;
      img.alt = c.text || "Фото";
      img.loading = "lazy";
      img.addEventListener("click", () => showImage(c.image, c.text));
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
    const data = { personId, text, author: displayName(), authorEmail: user.email, createdAt: serverTimestamp() };
    if (t.image) data.image = t.image;
    try {
      await addDoc(collection(db, "comments"), data);
      t.draft = "";
      t.image = null;
    } catch {
      err.textContent = "Сообщение не сохранилось. Попробуйте ещё раз.";
      btn.disabled = false;
    }
  });
  box.appendChild(form);
}

function attachThread(personId, box) {
  let t = threads.get(personId);
  if (!t) { t = { box, items: [], error: "", unsub: null, draft: "" }; threads.set(personId, t); }
  t.box = box;
  if (user && db && !t.unsub) {
    t.unsub = onSnapshot(
      query(collection(db, "comments"), where("personId", "==", personId)),
      snap => { t.error = ""; t.items = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderThread(personId); },
      e => {
        t.error = e?.code === "permission-denied"
          ? `Адрес ${user.email} не в списке тех, кому открыты комментарии. Напишите Александру, чтобы он добавил его.`
          : "Комментарии не загрузились. Обновите страницу.";
        t.unsub = null;
        renderThread(personId);
      });
  }
  renderThread(personId);
}

function detachAll() {
  for (const t of threads.values()) { t.unsub?.(); t.unsub = null; t.items = []; t.error = ""; }
}

// Секция в карточке человека: добавляем после каждой перерисовки справки
const drawerBody = document.getElementById("d-body");
let drawerThread = null;
function syncDrawer() {
  const key = typeof drawerKey === "string" ? drawerKey : null; // eslint-disable-line no-undef
  if (!drawerBody || !key || key.startsWith("slot:")) return;
  let sec = drawerBody.querySelector(".cm-sec");
  if (sec && sec.dataset.key === key) return;
  sec?.remove();
  sec = el("section", "cm-sec");
  sec.dataset.key = key;
  sec.appendChild(el("h3", null, "Чат семьи об этом человеке"));
  const box = el("div");
  sec.appendChild(box);
  drawerBody.appendChild(sec);
  if (drawerThread && drawerThread !== key) {
    const old = threads.get(drawerThread);
    old?.unsub?.(); threads.delete(drawerThread);
  }
  drawerThread = key;
  attachThread(key, box);
}
if (drawerBody) new MutationObserver(syncDrawer).observe(drawerBody, { childList: true });

// ─── Вход ────────────────────────────────────────────────────────────────
async function startSignIn() {
  if (!auth) return;
  const email = await ask({
    title: "Вход для комментариев",
    text: "Пришлём ссылку для входа на ваш email. Откройте её в этом же браузере.",
    label: "Email", type: "email", value: store.get(EMAIL_KEY) || "", ok: "Отправить ссылку",
  });
  if (!email) return;
  try {
    await sendSignInLinkToEmail(auth, email, { url: location.href.split("#")[0].split("?")[0], handleCodeInApp: true });
    store.set(EMAIL_KEY, email);
    authBtn.textContent = "Ссылка отправлена";
    setTimeout(() => { if (!user) authBtn.textContent = "Войти"; }, 8000);
  } catch {
    alert("Не получилось отправить письмо. Проверьте адрес и попробуйте ещё раз.");
  }
}

async function completeSignInFromLink() {
  if (!isSignInWithEmailLink(auth, location.href)) return;
  let email = store.get(EMAIL_KEY);
  if (!email) {
    email = await ask({
      title: "Подтвердите email",
      text: "Ссылка открыта в другом браузере. Введите адрес, на который она пришла.",
      label: "Email", type: "email", ok: "Войти",
    });
    if (!email) return;
  }
  try {
    await signInWithEmailLink(auth, email, location.href);
    store.del(EMAIL_KEY);
    history.replaceState(null, "", location.pathname);
  } catch {
    alert("Ссылка устарела или уже использована. Запросите новую.");
  }
}

async function askName() {
  const name = await ask({
    title: "Как вас подписывать?",
    text: "Имя будет видно рядом с вашими комментариями, например «Галина» или «тётя Таня».",
    label: "Имя", value: displayName(), ok: "Сохранить",
  });
  if (name) { store.set(NAME_KEY, name); for (const id of threads.keys()) renderThread(id); }
}

authBtn.addEventListener("click", async () => {
  if (!auth) return;
  if (!user) return startSignIn();
  if (confirm(`Вы вошли как ${user.email} (подпись «${displayName()}»).\nОК — выйти, Отмена — сменить подпись.`)) await signOut(auth);
  else await askName();
});

// ─── Экран входа и загрузка древа ────────────────────────────────────────
// Данные древа и фото лежат в Firestore (tree/snapshot, treePhotos/*) и читаются
// только после входа адресом из списка — в публичных файлах сайта их нет.
const gateText = document.getElementById("gate-text");
const gateLogin = document.getElementById("gate-login");
const gateLogout = document.getElementById("gate-logout");
let treeLoaded = false;
const gate = (text, { login = false, logout = false } = {}) => {
  if (gateText) gateText.textContent = text;
  if (gateLogin) gateLogin.hidden = !login;
  if (gateLogout) gateLogout.hidden = !logout;
};
gateLogin?.addEventListener("click", () => startSignIn());
gateLogout?.addEventListener("click", () => signOut(auth));

async function loadTree() {
  if (treeLoaded) return;
  gate("Загружаю древо…");
  try {
    const [snap, photos] = await Promise.all([getDoc(doc(db, "tree", "snapshot")), getDocs(collection(db, "treePhotos"))]);
    if (!snap.exists()) { gate("Древо ещё не загружено. Напишите Александру.", { logout: true }); return; }
    photos.forEach(p => { window.__TREE_PHOTOS__[p.id] = p.data().dataUrl; });
    window.__resolveTree?.(JSON.parse(snap.data().json));
    treeLoaded = true;
    document.body.classList.remove("locked");
  } catch (e) {
    gate(e?.code === "permission-denied"
      ? `Адрес ${user?.email} не в списке тех, кому открыто древо. Напишите Александру, чтобы он добавил его.`
      : "Древо не загрузилось. Обновите страницу.", { logout: true });
  }
}

// ─── Запуск ──────────────────────────────────────────────────────────────
attachThread(GENERAL, generalBox);
if (!cfg) {
  authBtn.hidden = true;
  gate("Вход ещё не настроен.");
} else {
  const app = initializeApp(cfg);
  auth = getAuth(app);
  auth.languageCode = "ru";
  db = getFirestore(app);
  onAuthStateChanged(auth, u => {
    if (!u && treeLoaded) { location.reload(); return; } // вышел — убираем древо со страницы
    user = u;
    if (u) loadTree();
    else gate("Страница доступна только членам семьи. Войдите по ссылке, которая придёт на ваш email.", { login: true });
    detachAll();
    authBtn.textContent = u ? displayName() : "Войти";
    authBtn.classList.toggle("on", !!u);
    authBtn.title = u ? `Вы вошли как ${u.email}. Нажмите, чтобы выйти или сменить подпись.` : "Войти по ссылке на email, чтобы читать и писать комментарии";
    for (const [id, t] of threads) attachThread(id, t.box);
    if (u && !store.get(NAME_KEY)) askName();
  });
  completeSignInFromLink();
}
