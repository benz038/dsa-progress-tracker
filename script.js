const QUESTIONS = {
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

let auth = null;
let db = null;
let currentUser = null;
let isApplyingCloud = false;
let cloudSyncTimeout = null;

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

  if (user) {
    authUser.textContent = user.email || "Signed in";
    loginBtn.style.display = "none";
    logoutBtn.style.display = "inline-block";
  } else {
    authUser.textContent = "Not signed in";
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    setSyncStatus("Local only");
  }
}

function initFirebaseAuth() {
  if (!firebaseConfigured()) {
    setSyncStatus("Configure Firebase");
    return;
  }

  firebase.initializeApp(window.FIREBASE_CONFIG);
  auth = firebase.auth();
  db = firebase.firestore();

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
    updateAuthUI(user);
    if (!user) return;

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
  const grid = document.getElementById("heatmapGrid");
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

function updateProgress() {
  const solvedState = loadState();
  const dateState = loadDateState();
  const allCheckboxes = [...document.querySelectorAll(".q-item input[type='checkbox']")];
  const total = allCheckboxes.length;
  const done = allCheckboxes.filter((x) => x.checked).length;

  document.getElementById("overallText").textContent = `${done} / ${total}`;
  document.getElementById("overallBar").style.width = `${(done / Math.max(total, 1)) * 100}%`;

  for (const category of Object.keys(QUESTIONS)) {
    const catBoxes = [...document.querySelectorAll(`input[data-category="${CSS.escape(category)}"]`)];
    const catDone = catBoxes.filter((x) => x.checked).length;
    const textEl = document.querySelector(`[data-category-progress="${CSS.escape(category)}"]`);
    const barEl = document.querySelector(`[data-category-bar="${CSS.escape(category)}"]`);

    textEl.textContent = `${catDone} / ${catBoxes.length}`;
    barEl.style.width = `${(catDone / Math.max(catBoxes.length, 1)) * 100}%`;
  }

  const countsByDate = {};
  Object.entries(dateState).forEach(([key, date]) => {
    if (solvedState[key] && typeof date === "string") {
      countsByDate[date] = (countsByDate[date] || 0) + 1;
    }
  });

  const todayCount = countsByDate[todayISO()] || 0;
  document.getElementById("solvedTodayText").textContent = String(todayCount);

  const dateWiseList = document.getElementById("dateWiseList");
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

  for (const [category, questions] of Object.entries(QUESTIONS)) {
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
      const key = normalizeKey(category, question);
      const checked = !!state[key];

      const item = document.createElement("div");
      item.className = `q-item ${checked ? "done" : ""}`;

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = checked;
      checkbox.dataset.key = key;
      checkbox.dataset.category = category;

      const label = document.createElement("label");
      label.textContent = question;

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
      item.appendChild(notesBtn);
      list.appendChild(item);
    });

    details.appendChild(summary);
    details.appendChild(list);
    root.appendChild(details);
  }

  updateProgress();
}

function wireActions() {
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

  const heatmapToggleBtn = document.getElementById("heatmapToggleBtn");
  const heatmapContent = document.getElementById("heatmapContent");
  if (heatmapToggleBtn && heatmapContent) {
    heatmapToggleBtn.addEventListener("click", () => {
      const isVisible = heatmapContent.style.display !== "none";
      heatmapContent.style.display = isVisible ? "none" : "block";
      heatmapToggleBtn.textContent = isVisible ? "+" : "−";
    });
  }
}

initTheme();
render();
wireActions();
initFirebaseAuth();
