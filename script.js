const DEFAULT_QUESTIONS = {
  "Arrays": [
    "Set Matrix Zeroes",
    "Pascal's Triangle I",
    "Kadane's Algorithm",
    "Find the Duplicate Number",
    "Find the Repeating and Missing Number",
    "Majority Element-I",
    "Majority Element-II",
    "Two Sum",
    "3 Sum",
    "4 Sum",
    "Longest Consecutive Sequence in an Array",
    "Largest Subarray with K Sum",
    "Remove Duplicates from Sorted Array",
    "Maximum Consecutive Ones",
    "Trapping Rainwater",
    "Search in matrix",
    "Sort an array of 0’, 1, 2"
  ],
  "Strings": [
    "Longest Substring Without Repeating Characters",
    "Reverse Every Word in a String",
    "Longest Common Prefix",
    "Valid Anagram"
  ],
  "Linked List": [
    "Reverse a Linked List",
    "Find Middle of Linked List",
    "Merge Two Sorted Lists",
    "Remove Nth Node from the Back of the Linked List",
    "Add Two Numbers as LinkedList",
    "Delete Node in a Linked List O(1)",
    "Find the Intersection Point of Y Linked List",
    "Detect a Loop in Linked List"
  ],
  "Greedy": [
    "N Meetings in One Room",
    "Minimum Number of Platforms Required for a Railway",
    "Job Sequencing Problem",
    "Minimum Coins",
    "Assign Cookies"
  ],
  "Binary Search / Heap": [
    "Single Element in Sorted Array",
    "Top K Frequent Elements"
  ],
  "Stack / Queue": [
    "Implement Stack using Arrays",
    "Implement Queue using Arrays",
    "Balanced Parenthesis",
    "Next Greater Element",
    "Next Smaller Element",
    "LRU Cache",
    "Largest Rectangle in a Histogram",
    "Sliding Window Maximum",
    "Stock Span Problem"
  ],
  "Graph": [
    "Rotten Oranges",
    "Clone Graph",
    "DFS",
    "Traversal Techniques",
    "Detect a Cycle in Undirected Graph using DFS",
    "Detect a Cycle in Directed Graph using DFS",
    "Topological Sort BFS",
    "Topological Sort DFS",
    "Number of Islands (Grid and Graph)"
  ],
  "Binary Tree": [
    "Inorder Traversal",
    "Preorder Traversal",
    "Postorder Traversal",
    "Right / Left View of Binary Tree",
    "Bottom View of Binary Tree",
    "Top View of Binary Tree",
    "Pre, Post, Inorder in One Traversal",
    "Print Root to Leaf Path in Binary Tree",
    "Level Order Traversal",
    "Maximum Depth in Binary Tree",
    "Diameter of Binary Tree",
    "Check for Balanced Binary Tree",
    "LCA in Binary Tree",
    "Check if Two Trees are Identical or Not",
    "Zig Zag or Spiral Traversal",
    "Boundary Traversal",
    "Maximum Path Sum",
    "Symmetric Binary Tree",
    "Check for Symmetrical Binary Trees",
    "Children Sum Property in Binary Tree"
  ],
  "Binary Search Tree (BST)": [
    "Search in BST",
    "Check if a Tree is a BST or Not",
    "LCA in BST"
  ]
};

const STORAGE_KEY = "dsa-progress-v1";
const THEME_KEY = "dsa-theme-v1";
const DATE_STATE_KEY = "dsa-progress-dates-v1";
const NOTES_KEY = "dsa-notes-v1";
const CLOUD_COLLECTION = "dsaProgress";
const QUESTIONS_COLLECTION = "questions";
const DIFFICULTY_OPTIONS = ["Easy", "Medium", "Hard"];
const LEETCODE_GRAPHQL_URLS = ["https://leetcode.com/graphql", "https://leetcode.cn/graphql"];

let auth = null;
let db = null;
let currentUser = null;
let isApplyingCloud = false;
let cloudSyncTimeout = null;
let cloudQuestions = [];
let renderedQuestions = {};
let questionsUnsubscribe = null;
let isAdminUser = false;

function getConfiguredAdminEmails() {
  const emails = window.FIREBASE_CONFIG?.adminEmails;
  if (!Array.isArray(emails)) return [];
  return emails.map((e) => String(e || "").trim().toLowerCase()).filter(Boolean);
}

async function refreshAdminStatus(user) {
  isAdminUser = false;
  if (!user || !db) return;

  const email = (user.email || "").toLowerCase();
  const configuredAdmins = getConfiguredAdminEmails();
  if (configuredAdmins.includes(email)) {
    isAdminUser = true;
    return;
  }

  // Optional fallback: mark user as admin with a Firestore doc at admins/{uid}
  try {
    const adminDoc = await db.collection("admins").doc(user.uid).get();
    if (adminDoc.exists) {
      isAdminUser = true;
      return;
    }
  } catch {
    // ignore fallback errors
  }

  // Optional fallback: custom auth claim
  try {
    const idTokenResult = await user.getIdTokenResult();
    if (idTokenResult?.claims?.admin === true) {
      isAdminUser = true;
    }
  } catch {
    // ignore claim check errors
  }
}

function makeQuestion(title, difficulty = "Medium", link = "", id = "") {
  return {
    id,
    title,
    difficulty: DIFFICULTY_OPTIONS.includes(difficulty) ? difficulty : "Medium",
    link: link || ""
  };
}

function buildDefaultQuestionMap() {
  const map = {};
  for (const [category, questions] of Object.entries(DEFAULT_QUESTIONS)) {
    map[category] = questions.map((title) => makeQuestion(title));
  }
  return map;
}

function mergeQuestions() {
  const merged = buildDefaultQuestionMap();
  const seen = new Set();

  for (const [category, questions] of Object.entries(merged)) {
    questions.forEach((q) => {
      seen.add(`${category.toLowerCase()}::${q.title.toLowerCase()}`);
    });
  }

  cloudQuestions.forEach((q) => {
    const category = (q.category || "General").trim() || "General";
    const dedupeKey = `${category.toLowerCase()}::${q.title.toLowerCase()}`;
    if (seen.has(dedupeKey)) return;

    if (!merged[category]) merged[category] = [];
    merged[category].push(makeQuestion(q.title, q.difficulty, q.link, q.id));
    seen.add(dedupeKey);
  });

  renderedQuestions = merged;
}

function questionKey(category, question) {
  if (question.id) return `qid__${question.id}`;
  return normalizeKey(category, question.title);
}

function difficultyClass(difficulty) {
  return `difficulty-${(difficulty || "Medium").toLowerCase()}`;
}

function parseLeetCodeSlug(link) {
  if (!link) return "";
  try {
    const url = new URL(link);
    if (!/leetcode\.(com|cn)$/i.test(url.hostname)) return "";
    const parts = url.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex((p) => p.toLowerCase() === "problems");
    if (idx === -1 || !parts[idx + 1]) return "";
    return parts[idx + 1].toLowerCase();
  } catch {
    return "";
  }
}

async function fetchLeetCodeMetaBySlug(slug) {
  if (!slug) return { title: "", difficulty: "" };

  const body = {
    query: `query getQuestionDetail($titleSlug: String!) { question(titleSlug: $titleSlug) { title difficulty } }`,
    variables: { titleSlug: slug }
  };

  for (const endpoint of LEETCODE_GRAPHQL_URLS) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) continue;
      const json = await res.json();
      const question = json?.data?.question;
      if (!question) continue;

      const difficulty = DIFFICULTY_OPTIONS.includes(question.difficulty) ? question.difficulty : "";
      const title = typeof question.title === "string" ? question.title.trim() : "";
      if (difficulty || title) {
        return { title, difficulty };
      }
    } catch {
      // continue to next endpoint
    }
  }

  return { title: "", difficulty: "" };
}

async function fetchLeetCodeMetaFromLink(link) {
  const slug = parseLeetCodeSlug(link);
  if (!slug) return { title: "", difficulty: "" };
  return fetchLeetCodeMetaBySlug(slug);
}

function refreshCategorySuggestions() {
  const datalist = document.getElementById("categorySuggestions");
  if (!datalist) return;
  datalist.innerHTML = "";

  Object.keys(renderedQuestions)
    .sort((a, b) => a.localeCompare(b))
    .forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      datalist.appendChild(option);
    });
}

function updateAddQuestionUI() {
  const form = document.getElementById("addQuestionForm");
  const status = document.getElementById("addQuestionStatus");
  const submitBtn = document.getElementById("addQuestionBtn");
  const syncBtn = document.getElementById("syncLeetCodeBtn");
  if (!form || !status || !submitBtn) return;

  if (!firebaseConfigured()) {
    status.textContent = "Configure Firebase to add questions";
    submitBtn.disabled = true;
    if (syncBtn) syncBtn.disabled = true;
    form.style.display = "none";
    return;
  }

  if (!currentUser) {
    status.textContent = "Only admin can add questions. Sign in as admin.";
    submitBtn.disabled = true;
    if (syncBtn) syncBtn.disabled = true;
    form.style.display = "none";
    return;
  }

  if (!isAdminUser) {
    status.textContent = "Only admin can add questions";
    submitBtn.disabled = true;
    if (syncBtn) syncBtn.disabled = true;
    form.style.display = "none";
    return;
  }

  form.style.display = "block";
  status.textContent = "Admin mode: you can add questions for all users";
  submitBtn.disabled = false;
  if (syncBtn) syncBtn.disabled = false;
}

async function addQuestionFromForm(event) {
  event.preventDefault();
  if (!db || !currentUser || !isAdminUser) {
    const status = document.getElementById("addQuestionStatus");
    if (status) status.textContent = "Only admin can add questions";
    return;
  }

  const titleInput = document.getElementById("qTitleInput");
  const categoryInput = document.getElementById("qCategoryInput");
  const difficultyInput = document.getElementById("qDifficultyInput");
  const linkInput = document.getElementById("qLinkInput");
  const status = document.getElementById("addQuestionStatus");

  let title = (titleInput?.value || "").trim();
  const category = (categoryInput?.value || "").trim() || "General";
  let difficulty = difficultyInput?.value || "Medium";
  const link = (linkInput?.value || "").trim();

  if (!title) {
    if (status) status.textContent = "Question title is required";
    return;
  }

  if (!DIFFICULTY_OPTIONS.includes(difficulty)) {
    if (status) status.textContent = "Invalid difficulty";
    return;
  }

  if (link && !/^https?:\/\//i.test(link)) {
    if (status) status.textContent = "Link must start with http:// or https://";
    return;
  }

  try {
    if (status) status.textContent = "Adding question...";

    const lcMeta = await fetchLeetCodeMetaFromLink(link);
    if (lcMeta.title) {
      title = lcMeta.title;
      if (titleInput) titleInput.value = lcMeta.title;
    }
    if (lcMeta.difficulty) {
      difficulty = lcMeta.difficulty;
      if (difficultyInput) difficultyInput.value = lcMeta.difficulty;
    }
    if (lcMeta.title || lcMeta.difficulty) {
      if (status) status.textContent = `Detected LeetCode data${lcMeta.title ? `, title: ${lcMeta.title}` : ""}${lcMeta.difficulty ? `, difficulty: ${lcMeta.difficulty}` : ""}. Saving...`;
    }

    await db.collection(QUESTIONS_COLLECTION).add({
      title,
      category,
      difficulty,
      link,
      isActive: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: currentUser.uid,
      createdByEmail: currentUser.email || ""
    });

    if (titleInput) titleInput.value = "";
    if (linkInput) linkInput.value = "";
    if (status) status.textContent = "Question added";
  } catch (error) {
    console.error("Failed to add question:", error);
    if (status) status.textContent = "Failed to add question";
  }
}

async function syncLeetCodeDifficulties() {
  const status = document.getElementById("addQuestionStatus");
  if (!db || !currentUser || !isAdminUser) {
    if (status) status.textContent = "Only admin can sync LeetCode data";
    return;
  }

  const linkedQuestions = cloudQuestions.filter((q) => q.id && parseLeetCodeSlug(q.link));
  if (!linkedQuestions.length) {
    if (status) status.textContent = "No LeetCode-linked questions to sync";
    return;
  }

  let updated = 0;
  if (status) status.textContent = `Syncing LeetCode title and difficulty (0/${linkedQuestions.length})...`;

  for (let i = 0; i < linkedQuestions.length; i += 1) {
    const q = linkedQuestions[i];
    const lcMeta = await fetchLeetCodeMetaFromLink(q.link);
    const updatePayload = {};
    if (lcMeta.difficulty && lcMeta.difficulty !== q.difficulty) {
      updatePayload.difficulty = lcMeta.difficulty;
    }
    if (lcMeta.title && lcMeta.title !== q.title) {
      updatePayload.title = lcMeta.title;
    }

    if (Object.keys(updatePayload).length) {
      try {
        await db.collection(QUESTIONS_COLLECTION).doc(q.id).set(updatePayload, { merge: true });
        updated += 1;
      } catch (error) {
        console.error("Failed LeetCode sync update for", q.id, error);
      }
    }
    if (status) status.textContent = `Syncing LeetCode title and difficulty (${i + 1}/${linkedQuestions.length})...`;
  }

  if (status) status.textContent = `LeetCode sync done. Updated ${updated} question(s)`;
}

function startQuestionsListener() {
  if (!db) return;
  if (questionsUnsubscribe) {
    questionsUnsubscribe();
    questionsUnsubscribe = null;
  }

  questionsUnsubscribe = db.collection(QUESTIONS_COLLECTION).onSnapshot((snapshot) => {
    const items = [];
    snapshot.forEach((doc) => {
      const data = doc.data() || {};
      if (data.isActive === false) return;
      if (!data.title || typeof data.title !== "string") return;

      items.push({
        id: doc.id,
        title: data.title.trim(),
        category: (data.category || "General").trim() || "General",
        difficulty: DIFFICULTY_OPTIONS.includes(data.difficulty) ? data.difficulty : "Medium",
        link: typeof data.link === "string" ? data.link.trim() : ""
      });
    });

    cloudQuestions = items;
    mergeQuestions();
    render();
    updateProgress();
    updateAddQuestionUI();
  }, (error) => {
    console.error("Questions listener error:", error);
    updateAddQuestionUI();
  });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function loadDateState() {
  try {
    return JSON.parse(localStorage.getItem(DATE_STATE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveDateState(state) {
  localStorage.setItem(DATE_STATE_KEY, JSON.stringify(state));
}

function loadNotes() {
  try {
    return JSON.parse(localStorage.getItem(NOTES_KEY)) || {};
  } catch {
    return {};
  }
}

function saveNotes(notes) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

function getNote(key) {
  const notes = loadNotes();
  return notes[key] || "";
}

function setNote(key, text) {
  const notes = loadNotes();
  if (text.trim()) {
    notes[key] = text;
  } else {
    delete notes[key];
  }
  saveNotes(notes);
  scheduleCloudSync();
}

function setSyncStatus(text) {
  const el = document.getElementById("syncStatus");
  if (el) el.textContent = text;
  // also update sidebar indicator
  setSyncIndicator(text);
}

function firebaseConfigured() {
  return !!(window.firebase && window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey);
}

function saveLocalTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
}

function loadLocalTheme() {
  return localStorage.getItem(THEME_KEY);
}

function scheduleCloudSync() {
  if (isApplyingCloud || !currentUser || !db) return;
  if (cloudSyncTimeout) clearTimeout(cloudSyncTimeout);
  cloudSyncTimeout = setTimeout(() => {
    syncToCloud().catch(() => setSyncStatus("Sync failed"));
  }, 300);
}

async function syncToCloud() {
  if (!currentUser || !db) return;
  setSyncStatus("Syncing...");
  const payload = {
    progress: loadState(),
    dates: loadDateState(),
    notes: loadNotes(),
    theme: document.documentElement.getAttribute("data-theme") || "dark",
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  await db.collection(CLOUD_COLLECTION).doc(currentUser.uid).set(payload, { merge: true });
  setSyncStatus("Synced");
}

async function loadFromCloud(uid) {
  try {
    const doc = await db.collection(CLOUD_COLLECTION).doc(uid).get();
    if (!doc.exists) {
      // First time - sync local data to cloud
      await syncToCloud();
      return;
    }

    const data = doc.data() || {};
    isApplyingCloud = true;
    try {
      if (data.progress && typeof data.progress === "object") saveState(data.progress);
      if (data.dates && typeof data.dates === "object") saveDateState(data.dates);
      if (data.notes && typeof data.notes === "object") saveNotes(data.notes);
      if (data.theme === "dark" || data.theme === "light") {
        applyTheme(data.theme);
        saveLocalTheme(data.theme);
      }
    } finally {
      isApplyingCloud = false;
    }
  } catch (error) {
    console.error("Error loading from cloud:", error);
    throw error;
  }
}

function updateAuthUI(user) {
  const loginBtn = document.getElementById("googleLoginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const authUser = document.getElementById("authUser");
  const adminBadge = document.getElementById("adminBadge");

  if (user) {
    authUser.textContent = user.email || "Signed in";
    loginBtn.style.display = "none";
    logoutBtn.style.display = "inline-block";
    if (adminBadge) adminBadge.style.display = isAdminUser ? "inline-flex" : "none";
  } else {
    authUser.textContent = "Not signed in";
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    if (adminBadge) adminBadge.style.display = "none";
    setSyncStatus("Local only");
  }

  updateAddQuestionUI();
}

function initFirebaseAuth() {
  if (!firebaseConfigured()) {
    setSyncStatus("Configure Firebase");
    updateAddQuestionUI();
    return;
  }

  firebase.initializeApp(window.FIREBASE_CONFIG);
  auth = firebase.auth();
  db = firebase.firestore();
  startQuestionsListener();

  document.getElementById("googleLoginBtn").addEventListener("click", async () => {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await auth.signInWithPopup(provider);
    } catch {
      setSyncStatus("Login failed");
    }
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await auth.signOut();
  });

  auth.onAuthStateChanged(async (user) => {
    currentUser = user;
    if (!user) {
      isAdminUser = false;
      updateAuthUI(user);
      return;
    }

    await refreshAdminStatus(user);
    updateAuthUI(user);

    try {
      setSyncStatus("Loading cloud data...");
      await loadFromCloud(user.uid);
      updateProgress();
      reapplyCheckboxesFromState();
      setSyncStatus("Synced");
      
      // Real-time listener for cross-device sync
      db.collection(CLOUD_COLLECTION).doc(user.uid).onSnapshot((doc) => {
        if (!doc.exists) return;
        const data = doc.data() || {};
        isApplyingCloud = true;
        try {
          if (data.progress && typeof data.progress === "object") saveState(data.progress);
          if (data.dates && typeof data.dates === "object") saveDateState(data.dates);
          if (data.notes && typeof data.notes === "object") saveNotes(data.notes);
          if (data.theme === "dark" || data.theme === "light") {
            applyTheme(data.theme);
            saveLocalTheme(data.theme);
          }
          updateProgress();
          reapplyCheckboxesFromState();
          setSyncStatus("Synced");
        } finally {
          isApplyingCloud = false;
        }
      }, (error) => {
        console.error("Snapshot listener error:", error);
      });
    } catch (error) {
      console.error("Auth state change error:", error);
      // Fall back to local storage even if cloud load fails
      setSyncStatus("Using local data (cloud unavailable)");
      updateProgress();
      reapplyCheckboxesFromState();
    }
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const btn = document.getElementById("themeToggleBtn");
  if (btn) {
    btn.textContent = theme === "light" ? "🌙 Dark" : "☀️ Light";
  }
}

function initTheme() {
  const saved = loadLocalTheme();
  if (saved === "light" || saved === "dark") {
    applyTheme(saved);
    return;
  }
  const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  applyTheme(prefersLight ? "light" : "dark");
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function reapplyCheckboxesFromState() {
  const state = loadState();
  document.querySelectorAll(".q-item input[type='checkbox']").forEach((checkbox) => {
    const checked = !!state[checkbox.dataset.key];
    checkbox.checked = checked;
    checkbox.closest(".q-item")?.classList.toggle("done", checked);
  });
}

function normalizeKey(category, question) {
  return `${category}__${question}`;
}

function shiftDate(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    year: "numeric"
  }).format(date);
}

function levelFromCount(count, max) {
  if (count <= 0 || max <= 0) return 0;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function renderHeatmap(countsByDate) {
  const grid = document.getElementById("sidebarHeatmapGrid") || document.getElementById("heatmapGrid");
  if (!grid) return;
  grid.innerHTML = "";

  const daysToShow = 84; // 12 weeks
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = shiftDate(end, -(daysToShow - 1));

  const maxCount = Math.max(0, ...Object.values(countsByDate));

  for (let i = 0; i < daysToShow; i += 1) {
    const d = shiftDate(start, i);
    const key = toISODate(d);
    const count = countsByDate[key] || 0;
    const level = levelFromCount(count, maxCount);

    const cell = document.createElement("div");
    cell.className = `heatmap-cell level-${level}`;
    cell.title = `${formatDate(d)}: ${count} solved`;
    grid.appendChild(cell);
  }
}

function updateStickyProgress(total, done) {
  const textEl = document.getElementById('stickyProgressText');
  const barEl = document.getElementById('stickyProgressBar');
  if (textEl) textEl.textContent = `${done} / ${total}`;
  if (barEl) {
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    barEl.style.width = pct + '%';
  }
}

function setSyncIndicator(status) {
  const circle = document.getElementById('syncStatusCircle');
  const label = document.getElementById('syncStatusLabel');
  if (!circle || !label) return;
  circle.classList.remove('local-only','syncing','synced');
  if (status === 'Local only' || status === 'Configure Firebase') {
    circle.classList.add('local-only');
  } else if (status === 'Syncing...' || status === 'Loading cloud data...') {
    circle.classList.add('syncing');
  } else if (status === 'Synced') {
    circle.classList.add('synced');
  }
  label.textContent = status;
}

function updateProgress() {
  const solvedState = loadState();
  const dateState = loadDateState();
  const allCheckboxes = [...document.querySelectorAll(".q-item input[type='checkbox']")];
  const total = allCheckboxes.length;
  const done = allCheckboxes.filter((x) => x.checked).length;

  const overallText = document.getElementById("overallText");
  const overallBar = document.getElementById("overallBar");
  if (overallText) overallText.textContent = `${done} / ${total}`;
  if (overallBar) overallBar.style.width = `${(done / Math.max(total, 1)) * 100}%`;

  updateStickyProgress(total, done);

  for (const category of Object.keys(renderedQuestions)) {
    const catBoxes = [...document.querySelectorAll(`input[data-category="${CSS.escape(category)}"]`)];
    const catDone = catBoxes.filter((x) => x.checked).length;
    const textEl = document.querySelector(`[data-category-progress="${CSS.escape(category)}"]`);
    const barEl = document.querySelector(`[data-category-bar="${CSS.escape(category)}"]`);

    if (textEl) textEl.textContent = `${catDone} / ${catBoxes.length}`;
    if (barEl) barEl.style.width = `${(catDone / Math.max(catBoxes.length, 1)) * 100}%`;
  }

  const countsByDate = {};
  Object.entries(dateState).forEach(([key, date]) => {
    if (solvedState[key] && typeof date === "string") {
      countsByDate[date] = (countsByDate[date] || 0) + 1;
    }
  });

  const todayCount = countsByDate[todayISO()] || 0;
  const solvedTodayText = document.getElementById("solvedTodayText");
  const sidebarSolvedToday = document.getElementById("sidebarSolvedToday");
  const sidebarTotalSolved = document.getElementById("sidebarTotalSolved");
  if (solvedTodayText) solvedTodayText.textContent = String(todayCount);
  if (sidebarSolvedToday) sidebarSolvedToday.textContent = String(todayCount);
  if (sidebarTotalSolved) sidebarTotalSolved.textContent = String(done);

  const dateWiseList = document.getElementById("dateWiseList");
  if (!dateWiseList) {
    renderHeatmap(countsByDate);
    return;
  }
  dateWiseList.innerHTML = "";
  const sortedDates = Object.keys(countsByDate).sort((a, b) => (a < b ? 1 : -1));

  if (!sortedDates.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No date-wise data yet";
    dateWiseList.appendChild(empty);
  } else {
    sortedDates.slice(0, 14).forEach((date) => {
      const row = document.createElement("div");
      row.className = "date-wise-row";
      row.innerHTML = `<span>${date}</span><span class="count">${countsByDate[date]}</span>`;
      dateWiseList.appendChild(row);
    });
  }

  renderHeatmap(countsByDate);
}

function render() {
  const root = document.getElementById("categories");
  const state = loadState();
  root.innerHTML = "";

  for (const [category, questions] of Object.entries(renderedQuestions)) {
    const details = document.createElement("details");
    details.className = "card";
    details.open = true;

    const summary = document.createElement("summary");
    summary.innerHTML = `
      <div class="category-head">
        <div class="category-title">${category}</div>
        <div class="category-meta" data-category-progress="${category}">0 / ${questions.length}</div>
      </div>
      <div class="progress" style="margin-top: 0.6rem;"><div data-category-bar="${category}"></div></div>
    `;

    const list = document.createElement("div");
    list.className = "q-list";

    questions.forEach((question) => {
      const key = questionKey(category, question);
      const checked = !!state[key];

      const item = document.createElement("div");
      item.className = `q-item ${checked ? "done" : ""}`;

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = checked;
      checkbox.dataset.key = key;
      checkbox.dataset.category = category;

      const label = document.createElement("label");
      if (question.link) {
        const anchor = document.createElement("a");
        anchor.href = question.link;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.textContent = question.title;
        label.appendChild(anchor);
      } else {
        label.textContent = question.title;
      }

      const difficultyTag = document.createElement("span");
      difficultyTag.className = `difficulty-badge ${difficultyClass(question.difficulty)}`;
      difficultyTag.textContent = question.difficulty || "Medium";

      checkbox.addEventListener("change", () => {
        const current = loadState();
        const dateCurrent = loadDateState();
        current[key] = checkbox.checked;
        if (checkbox.checked) {
          dateCurrent[key] = todayISO();
        } else {
          delete dateCurrent[key];
        }
        saveState(current);
        saveDateState(dateCurrent);
        item.classList.toggle("done", checkbox.checked);
        updateProgress();
        scheduleCloudSync();
      });

      const notesBtn = document.createElement("button");
      notesBtn.className = "notes-btn";
      notesBtn.textContent = "📝";
      notesBtn.title = "Add notes";
      notesBtn.addEventListener("click", () => {
        const existingNote = getNote(key);
        const newNote = prompt("Add your notes for this question:", existingNote);
        if (newNote !== null) {
          setNote(key, newNote);
          notesBtn.classList.toggle("has-notes", !!newNote.trim());
        }
      });

      const currentNote = getNote(key);
      if (currentNote) {
        notesBtn.classList.add("has-notes");
      }

      item.appendChild(checkbox);
      item.appendChild(label);
      item.appendChild(difficultyTag);
      item.appendChild(notesBtn);
      list.appendChild(item);
    });

    details.appendChild(summary);
    details.appendChild(list);
    root.appendChild(details);
  }

  refreshCategorySuggestions();
  updateProgress();
}

function wireActions() {
  updateAddQuestionUI();

  document.getElementById("themeToggleBtn").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    saveLocalTheme(next);
    scheduleCloudSync();
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    if (!confirm("Reset all saved progress?")) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(DATE_STATE_KEY);
    scheduleCloudSync();
    location.reload();
  });

  document.getElementById("expandAllBtn").addEventListener("click", () => {
    document.querySelectorAll("details").forEach((d) => { d.open = true; });
  });

  document.getElementById("collapseAllBtn").addEventListener("click", () => {
    document.querySelectorAll("details").forEach((d) => { d.open = false; });
  });

  const heatmapToggleBtn = document.getElementById("sidebarHeatmapToggleBtn") || document.getElementById("heatmapToggleBtn");
  const heatmapContent = document.getElementById("sidebarHeatmapContent") || document.getElementById("heatmapContent");
  if (heatmapToggleBtn && heatmapContent) {
    heatmapToggleBtn.addEventListener("click", () => {
      const isVisible = heatmapContent.style.display !== "none";
      heatmapContent.style.display = isVisible ? "none" : "block";
      heatmapToggleBtn.textContent = isVisible ? "+" : "−";
    });
  }

  const addQuestionForm = document.getElementById("addQuestionForm");
  if (addQuestionForm) {
    addQuestionForm.addEventListener("submit", addQuestionFromForm);
  }

  const syncBtn = document.getElementById("syncLeetCodeBtn");
  if (syncBtn) {
    syncBtn.addEventListener("click", async () => {
      syncBtn.disabled = true;
      try {
        await syncLeetCodeDifficulties();
      } finally {
        syncBtn.disabled = false;
      }
    });
  }
}

mergeQuestions();
initTheme();
render();
wireActions();
initFirebaseAuth();
