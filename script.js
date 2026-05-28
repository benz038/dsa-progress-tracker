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
const DELETED_QUESTIONS_KEY = "dsa-deleted-questions-v1";
const QUESTION_ORDER_KEY = "dsa-question-order-v1";
const CLOUD_COLLECTION = "dsaProgress";
const QUESTIONS_COLLECTION = "questions";
const DIFFICULTY_OPTIONS = ["Easy", "Medium", "Hard"];
const LEETCODE_GRAPHQL_URLS = ["https://leetcode.com/graphql", "https://leetcode.cn/graphql"];
const LEETCODE_FALLBACK_API = "https://alfa-leetcode-api.onrender.com/select";

let auth = null;
let db = null;
let currentUser = null;
let isApplyingCloud = false;
let cloudSyncTimeout = null;
let cloudQuestions = [];
let renderedQuestions = {};
let questionsUnsubscribe = null;
let isAdminUser = false;
let sidebarStatusTimeout = null;
let lastDeletedQuestion = null;
let topToastTimeout = null;
let draggedQuestionItem = null;

function canAdminManage() {
  return isAdminUser;
}

function canUseCloudQuestions() {
  return !!(db && currentUser);
}

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
  const deletedQuestions = loadDeletedQuestions();
  const map = {};
  for (const [category, questions] of Object.entries(DEFAULT_QUESTIONS)) {
    map[category] = questions
      .filter((title) => !deletedQuestions[normalizeKey(category, title)])
      .map((title) => makeQuestion(title));
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

  applyQuestionOrder(merged);
  renderedQuestions = merged;
}

function questionKey(category, question) {
  if (question.id) return `qid__${question.id}`;
  return normalizeKey(category, question.title);
}

function loadQuestionOrder() {
  try {
    return JSON.parse(localStorage.getItem(QUESTION_ORDER_KEY)) || {};
  } catch {
    return {};
  }
}

function saveQuestionOrder(order) {
  localStorage.setItem(QUESTION_ORDER_KEY, JSON.stringify(order));
}

function applyQuestionOrder(questionMap) {
  const savedOrder = loadQuestionOrder();
  for (const [category, questions] of Object.entries(questionMap)) {
    const orderedKeys = Array.isArray(savedOrder[category]) ? savedOrder[category] : [];
    if (!orderedKeys.length) continue;

    const rank = new Map(orderedKeys.map((key, index) => [key, index]));
    questions.sort((a, b) => {
      const aRank = rank.has(questionKey(category, a)) ? rank.get(questionKey(category, a)) : Number.MAX_SAFE_INTEGER;
      const bRank = rank.has(questionKey(category, b)) ? rank.get(questionKey(category, b)) : Number.MAX_SAFE_INTEGER;
      return aRank - bRank;
    });
  }
}

function saveCategoryQuestionOrder(category, keys) {
  const order = loadQuestionOrder();
  order[category] = keys;
  saveQuestionOrder(order);
}

function difficultyClass(difficulty) {
  return `difficulty-${(difficulty || "Medium").toLowerCase()}`;
}

function slugToTitle(slug) {
  if (!slug) return "";
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function titleFromLink(link) {
  if (!link) return "";

  const leetCodeSlug = parseLeetCodeSlug(link);
  if (leetCodeSlug) return slugToTitle(leetCodeSlug);

  try {
    const url = new URL(link);
    const lastPathPart = url.pathname.split("/").filter(Boolean).pop();
    return slugToTitle(lastPathPart || url.hostname.replace(/^www\./i, ""));
  } catch {
    return "";
  }
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

async function fetchLeetCodeMetaViaPublicApi(slug) {
  if (!slug) return { title: "", difficulty: "" };
  try {
    const url = `${LEETCODE_FALLBACK_API}?titleSlug=${encodeURIComponent(slug)}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return { title: "", difficulty: "" };

    const json = await res.json();
    const title = typeof json?.questionTitle === "string"
      ? json.questionTitle.trim()
      : (typeof json?.title === "string" ? json.title.trim() : "");
    const difficulty = DIFFICULTY_OPTIONS.includes(json?.difficulty) ? json.difficulty : "";
    return { title, difficulty };
  } catch {
    return { title: "", difficulty: "" };
  }
}

async function fetchLeetCodeMetaBySlug(slug) {
  if (!slug) return { title: "", difficulty: "" };

  const publicApiMeta = await fetchLeetCodeMetaViaPublicApi(slug);
  if (publicApiMeta.title || publicApiMeta.difficulty) {
    return publicApiMeta;
  }

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

  // Browser-to-LeetCode GraphQL can be blocked by CORS in some environments.
  // Fallback title from slug so add flow still works.
  return { title: slugToTitle(slug), difficulty: "" };
}

async function fetchLeetCodeMetaFromLink(link) {
  const slug = parseLeetCodeSlug(link);
  if (!slug) return { title: "", difficulty: "" };
  return fetchLeetCodeMetaBySlug(slug);
}

function refreshCategorySuggestions() {
  const datalist = document.getElementById("categorySuggestions");
  const categories = Object.keys(renderedQuestions).sort((a, b) => a.localeCompare(b));

  if (datalist) {
    datalist.innerHTML = "";
    categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      datalist.appendChild(option);
    });
  }
}

function resolveCategoryName(rawCategory) {
  const typed = String(rawCategory || "").trim();
  if (!typed) return "";

  const categories = Object.keys(renderedQuestions);
  const exact = categories.find((name) => name === typed);
  if (exact) return exact;

  const normalizedTyped = typed.toLowerCase();
  const caseInsensitive = categories.find((name) => name.toLowerCase() === normalizedTyped);
  if (caseInsensitive) return caseInsensitive;

  return typed;
}

function showSidebarStatus(statusId, message, type = "info") {
  const status = document.getElementById(statusId);
  if (!status) return;

  status.textContent = message;
  status.classList.remove("status-success", "status-error", "status-info", "show");
  status.classList.add(`status-${type}`, "show");

  if (sidebarStatusTimeout) clearTimeout(sidebarStatusTimeout);
  sidebarStatusTimeout = setTimeout(() => {
    status.classList.remove("show");
  }, 2400);
}

function showSidebarAddStatus(message, type = "info") {
  showSidebarStatus("sidebarAddStatus", message, type);
}

function showSidebarActionStatus(message, type = "info") {
  showSidebarStatus("sidebarDeleteStatus", message, type);
}

function showTopToast(message, type = "success") {
  const toast = document.getElementById("topToast");
  if (!toast) return;

  toast.textContent = message;
  toast.classList.remove("toast-success", "toast-error", "toast-info", "show");
  toast.classList.add(`toast-${type}`, "show");

  if (topToastTimeout) clearTimeout(topToastTimeout);
  topToastTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
}

function updateUndoButtonState() {
  const undoBtn = document.getElementById("sidebarUndoDeleteBtn");
  if (!undoBtn) return;
  undoBtn.disabled = !lastDeletedQuestion;
}

function rememberLastDeletedQuestion(payload) {
  lastDeletedQuestion = payload;
  updateUndoButtonState();
}

function updateAddQuestionUI() {
  const form = document.getElementById("addQuestionForm");
  const status = document.getElementById("addQuestionStatus");
  const submitBtn = document.getElementById("addQuestionBtn");
  const syncBtn = document.getElementById("syncLeetCodeBtn");
  const sidebarAddBtn = document.getElementById("sidebarAddQuestionBtn");
  const sidebarDeleteBtn = document.getElementById("sidebarDeleteQuestionBtn");
  const navAddBtn = document.getElementById("navAddBtn");
  const navDeleteBtn = document.getElementById("navDeleteBtn");
  const hasMainAddSection = !!(form && status && submitBtn);

  if (!firebaseConfigured()) {
    if (hasMainAddSection) {
      status.textContent = "Configure Firebase to add questions";
      submitBtn.disabled = true;
      form.style.display = "none";
    }
    if (syncBtn) syncBtn.disabled = true;
    if (sidebarAddBtn) sidebarAddBtn.disabled = true;
    if (sidebarDeleteBtn) sidebarDeleteBtn.disabled = true;
    if (navAddBtn) navAddBtn.style.display = "none";
    if (navDeleteBtn) navDeleteBtn.style.display = "none";
    updateUndoButtonState();
    return;
  }

  if (!currentUser) {
    if (hasMainAddSection) {
      status.textContent = "Only admin can add questions. Sign in as admin.";
      submitBtn.disabled = true;
      form.style.display = "none";
    }
    if (syncBtn) syncBtn.disabled = true;
    if (sidebarAddBtn) sidebarAddBtn.disabled = true;
    if (sidebarDeleteBtn) sidebarDeleteBtn.disabled = true;
    if (navAddBtn) navAddBtn.style.display = "none";
    if (navDeleteBtn) navDeleteBtn.style.display = "none";
    updateUndoButtonState();
    return;
  }

  if (!canAdminManage()) {
    if (hasMainAddSection) {
      status.textContent = "Only admin can add questions";
      submitBtn.disabled = true;
      form.style.display = "none";
    }
    if (syncBtn) syncBtn.disabled = true;
    if (sidebarAddBtn) sidebarAddBtn.disabled = true;
    if (sidebarDeleteBtn) sidebarDeleteBtn.disabled = true;
    if (navAddBtn) navAddBtn.style.display = "none";
    if (navDeleteBtn) navDeleteBtn.style.display = "none";
    updateUndoButtonState();
    return;
  }

  if (hasMainAddSection) {
    form.style.display = "block";
    status.textContent = "Admin mode: you can add questions for all users";
    submitBtn.disabled = false;
  }
  if (syncBtn) syncBtn.disabled = false;
  if (sidebarAddBtn) sidebarAddBtn.disabled = false;
  if (sidebarDeleteBtn) sidebarDeleteBtn.disabled = false;
  if (navAddBtn) navAddBtn.style.display = "inline-flex";
  if (navDeleteBtn) navDeleteBtn.style.display = "inline-flex";
  updateUndoButtonState();
}

async function addQuestionFromForm(event) {
  event.preventDefault();
  if (!canAdminManage()) {
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
    } else if (link && parseLeetCodeSlug(link)) {
      if (status) status.textContent = "LeetCode auto-fetch unavailable (CORS). Saving with entered values...";
    }

    if (!canUseCloudQuestions()) {
      throw new Error("Cloud questions are not available");
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
    if (status) {
      status.textContent = "Question added";
    }
    showTopToast("Question added successfully", "success");
  } catch (error) {
    console.error("Failed to add question:", error);
    if (error?.code === "permission-denied") {
      if (status) status.textContent = "Failed to add question: Firestore permission denied";
      return;
    }
    if (status) status.textContent = "Failed to add question";
    showTopToast("Failed to add question", "error");
  }
}

async function addQuestionFromSidebar(event) {
  event.preventDefault();
  if (!canAdminManage()) {
    showSidebarAddStatus("Only admin can add questions", "error");
    return;
  }

  const titleInput = document.getElementById("sidebarQTitleInput");
  const categoryInput = document.getElementById("sidebarQCategoryInput");
  const difficultyInput = document.getElementById("sidebarQDifficultyInput");
  const linkInput = document.getElementById("sidebarQLinkInput");

  let title = (titleInput?.value || "").trim();
  const category = (categoryInput?.value || "").trim() || "General";
  let difficulty = difficultyInput?.value || "Medium";
  const link = (linkInput?.value || "").trim();

  if (!DIFFICULTY_OPTIONS.includes(difficulty)) {
    showSidebarAddStatus("Invalid difficulty", "error");
    return;
  }

  if (link && !/^https?:\/\//i.test(link)) {
    showSidebarAddStatus("Link must start with http:// or https://", "error");
    return;
  }

  if (!title && !link) {
    showSidebarAddStatus("Enter a question title or problem link", "error");
    return;
  }

  try {
    showSidebarAddStatus("Adding question...", "info");

    const lcMeta = await fetchLeetCodeMetaFromLink(link);
    if (lcMeta.title) {
      title = lcMeta.title;
      if (titleInput) titleInput.value = lcMeta.title;
    }
    if (lcMeta.difficulty) {
      difficulty = lcMeta.difficulty;
      if (difficultyInput) difficultyInput.value = lcMeta.difficulty;
    }

    if (!title) {
      title = titleFromLink(link) || "Untitled Question";
      if (titleInput) titleInput.value = title;
    }

    if (!canUseCloudQuestions()) {
      throw new Error("Cloud questions are not available");
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
    if (difficultyInput) difficultyInput.value = "Medium";

    showSidebarAddStatus("Question added successfully", "success");
    showTopToast("Question added successfully", "success");
  } catch (error) {
    console.error("Failed to add question from sidebar:", error);
    showSidebarAddStatus("Failed to add question", "error");
    showTopToast("Failed to add question", "error");
  }
}

async function deleteQuestion(questionId, questionTitle, skipConfirm = false, meta = null) {
  if (!db || !currentUser) return;
  
  if (!skipConfirm && !confirm(`Are you sure you want to delete "${questionTitle}"?`)) {
    return;
  }
  
  try {
    await db.collection(QUESTIONS_COLLECTION).doc(questionId).delete();
    if (meta) {
      rememberLastDeletedQuestion({
        source: "cloud",
        category: meta.category,
        question: {
          id: questionId,
          title: questionTitle,
          difficulty: meta.difficulty || "Medium",
          link: meta.link || ""
        }
      });
    }
    showTopToast(`Deleted: ${questionTitle}`, "success");
  } catch (error) {
    console.error("Failed to delete question:", error);
    alert("Failed to delete question: " + error.message);
    showTopToast("Delete failed", "error");
  }
}

async function undoLastDeleteFromSidebar() {
  if (!canAdminManage()) {
    showSidebarActionStatus("Only admin can undo delete", "error");
    return;
  }

  if (!lastDeletedQuestion) {
    showSidebarActionStatus("No deleted question to undo", "info");
    return;
  }

  try {
    const snapshot = { ...lastDeletedQuestion };
    showSidebarActionStatus("Restoring question...", "info");

    if (snapshot.source === "default") {
      const deletedQuestions = loadDeletedQuestions();
      delete deletedQuestions[normalizeKey(snapshot.category, snapshot.question.title)];
      saveDeletedQuestions(deletedQuestions);
      mergeQuestions();
      render();
      scheduleCloudSync();
    } else if (snapshot.source === "cloud") {
      if (!db || !currentUser) {
        throw new Error("Cloud is not available");
      }

      const docRef = snapshot.question.id
        ? db.collection(QUESTIONS_COLLECTION).doc(snapshot.question.id)
        : db.collection(QUESTIONS_COLLECTION).doc();

      await docRef.set({
        title: snapshot.question.title,
        category: snapshot.category || "General",
        difficulty: snapshot.question.difficulty || "Medium",
        link: snapshot.question.link || "",
        isActive: true,
        restoredAt: firebase.firestore.FieldValue.serverTimestamp(),
        restoredBy: currentUser.uid,
        restoredByEmail: currentUser.email || ""
      }, { merge: true });
    }

    lastDeletedQuestion = null;
    updateUndoButtonState();
    showSidebarActionStatus("Undo successful", "success");
    showTopToast("Undo successful", "success");
  } catch (error) {
    console.error("Undo delete failed:", error);
    showSidebarActionStatus(error?.message || "Undo failed", "error");
    showTopToast("Undo failed", "error");
  }
}

async function deleteQuestionByNumber(category, questionNumber) {
  const list = renderedQuestions[category] || [];
  if (!list.length) {
    throw new Error(`No questions found in ${category}`);
  }

  if (!Number.isInteger(questionNumber) || questionNumber < 1 || questionNumber > list.length) {
    throw new Error(`Question number must be between 1 and ${list.length}`);
  }

  const target = list[questionNumber - 1];
  if (!target) {
    throw new Error("Question not found");
  }

  if (target.id && !String(target.id).startsWith("local__")) {
    await deleteQuestion(target.id, target.title, true, {
      category,
      difficulty: target.difficulty,
      link: target.link
    });
  } else {
    const deletedQuestions = loadDeletedQuestions();
    deletedQuestions[normalizeKey(category, target.title)] = true;
    saveDeletedQuestions(deletedQuestions);
    rememberLastDeletedQuestion({
      source: "default",
      category,
      question: {
        title: target.title,
        difficulty: target.difficulty || "Medium",
        link: target.link || ""
      }
    });
    mergeQuestions();
    render();
    scheduleCloudSync();
    showTopToast(`Deleted: ${target.title}`, "success");
  }

  return target.title;
}

async function deleteQuestionByNumberFromSidebar(event) {
  event.preventDefault();
  if (!canAdminManage()) {
    showSidebarActionStatus("Only admin can delete questions", "error");
    return;
  }

  const categoryEl = document.getElementById("sidebarDeleteCategory");
  const numberEl = document.getElementById("sidebarDeleteNumber");
  const categoryInput = (categoryEl?.value || "").trim();
  const category = resolveCategoryName(categoryInput);
  const questionNumber = Number(numberEl?.value || 0);

  if (!categoryInput) {
    showSidebarActionStatus("Enter a topic name first", "error");
    return;
  }

  if (!Number.isInteger(questionNumber) || questionNumber < 1) {
    showSidebarActionStatus("Enter a valid question number", "error");
    return;
  }

  const list = renderedQuestions[category] || [];
  if (!list.length) {
    showSidebarActionStatus(`No questions found in topic: ${categoryInput}`, "error");
    return;
  }

  if (questionNumber > list.length) {
    showSidebarActionStatus(`Max question number in ${category} is ${list.length}`, "error");
    return;
  }

  const target = list[questionNumber - 1];
  if (!target) {
    showSidebarActionStatus("Question not found", "error");
    return;
  }

  const yes = confirm(`Delete Q${questionNumber} in ${category}: \"${target.title}\" ?`);
  if (!yes) {
    showSidebarActionStatus("Delete cancelled", "info");
    return;
  }

  try {
    showSidebarActionStatus("Deleting question...", "info");
    const deletedTitle = await deleteQuestionByNumber(category, questionNumber);
    if (numberEl) numberEl.value = "";
    showSidebarActionStatus(`Deleted successfully: ${deletedTitle}`, "success");
  } catch (error) {
    console.error("Delete by number failed:", error);
    showSidebarActionStatus(error?.message || "Failed to delete question", "error");
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
    // Keep app functional with default bundled questions.
    cloudQuestions = [];
    mergeQuestions();
    render();
    updateProgress();
    const status = document.getElementById("addQuestionStatus");
    if (error?.code === "permission-denied") {
      if (status) status.textContent = "Failed to load cloud questions: permission denied";
    } else {
      if (status) status.textContent = "Failed to load cloud questions";
    }
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

function loadDeletedQuestions() {
  try {
    return JSON.parse(localStorage.getItem(DELETED_QUESTIONS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveDeletedQuestions(state) {
  localStorage.setItem(DELETED_QUESTIONS_KEY, JSON.stringify(state));
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

let currentEditingNoteKey = null;

function openNotesModal(key, questionTitle) {
  currentEditingNoteKey = key;
  const modal = document.getElementById("notesModal");
  const textarea = document.getElementById("notesTextarea");
  const title = document.getElementById("notesModalTitle");
  const existingNote = getNote(key);
  
  title.textContent = `Edit Notes - ${questionTitle}`;
  textarea.value = existingNote;
  modal.classList.add("active");
  updateNotesLineNumbers();
  textarea.focus();
}

function closeNotesModal() {
  const modal = document.getElementById("notesModal");
  modal.classList.remove("active");
  currentEditingNoteKey = null;
}

function saveNotesFromModal() {
  if (currentEditingNoteKey === null) return;
  
  const textarea = document.getElementById("notesTextarea");
  const newNote = textarea.value;
  setNote(currentEditingNoteKey, newNote);
  
  // Update the button to show if notes exist
  const notesBtn = document.querySelector(`.notes-btn[data-key="${currentEditingNoteKey}"]`);
  if (notesBtn) {
    notesBtn.classList.toggle("has-notes", !!newNote.trim());
  }
  
  closeNotesModal();
}

function updateNotesLineNumbers() {
  const textarea = document.getElementById("notesTextarea");
  const lineNumbers = document.getElementById("notesLineNumbers");
  if (!textarea || !lineNumbers) return;

  const lineCount = Math.max(1, textarea.value.split("\n").length);
  lineNumbers.innerHTML = Array.from({ length: lineCount }, (_, i) => `<span>${i + 1}</span>`).join("");
  lineNumbers.scrollTop = textarea.scrollTop;
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
    deletedQuestions: loadDeletedQuestions(),
    questionOrder: loadQuestionOrder(),
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
      if (data.deletedQuestions && typeof data.deletedQuestions === "object") saveDeletedQuestions(data.deletedQuestions);
      if (data.questionOrder && typeof data.questionOrder === "object") saveQuestionOrder(data.questionOrder);
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
    if (adminBadge) {
      adminBadge.textContent = "ADMIN";
      adminBadge.style.display = canAdminManage() ? "inline-flex" : "none";
    }
  } else {
    authUser.textContent = "Not signed in";
    loginBtn.style.display = "inline-block";
    logoutBtn.style.display = "none";
    if (adminBadge) {
      adminBadge.textContent = "ADMIN";
      adminBadge.style.display = "none";
    }
    setSyncStatus("Local only");
  }

  updateAddQuestionUI();
}

function initFirebaseAuth() {
  if (!firebaseConfigured()) {
    setSyncStatus("Configure Firebase");
    updateAuthUI(null);
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
      mergeQuestions();
      render();
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
          if (data.deletedQuestions && typeof data.deletedQuestions === "object") saveDeletedQuestions(data.deletedQuestions);
          if (data.questionOrder && typeof data.questionOrder === "object") saveQuestionOrder(data.questionOrder);
          if (data.theme === "dark" || data.theme === "light") {
            applyTheme(data.theme);
            saveLocalTheme(data.theme);
          }
          mergeQuestions();
          render();
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
  if (!circle) return;
  circle.classList.remove('local-only','syncing','synced');

  // Keep indicator simple: green = synced, red = otherwise
  if (status === 'Synced') {
    circle.classList.add('synced');
  } else {
    circle.classList.add('local-only');
  }

  if (label) label.textContent = status;
  circle.title = status;

  const container = circle.closest('.sync-indicator');
  if (container) {
    container.title = status;
    container.setAttribute('aria-label', status);
  }
}

function updateProgress() {
  const solvedState = loadState();
  const dateState = loadDateState();
  const allCheckboxes = [...document.querySelectorAll(".q-item input[type='checkbox']")];
  const total = allCheckboxes.length;
  const done = allCheckboxes.filter((x) => x.checked).length;
  const totalPct = total === 0 ? 0 : Math.round((done / total) * 100);

  const overallText = document.getElementById("overallText");
  const overallBar = document.getElementById("overallBar");
  const overallPercent = document.getElementById("overallPercent");
  if (overallText) overallText.textContent = `${done} / ${total}`;
  if (overallBar) overallBar.style.width = `${(done / Math.max(total, 1)) * 100}%`;
  if (overallPercent) overallPercent.textContent = `${totalPct}%`;

  const navTotalProgressBtn = document.getElementById("navTotalProgressBtn");
  if (navTotalProgressBtn) {
    navTotalProgressBtn.textContent = `${totalPct}%`;
    navTotalProgressBtn.title = `Total progress: ${done} / ${total}`;
    navTotalProgressBtn.setAttribute("aria-label", `Total progress: ${done} of ${total}`);
  }

  const diffTotals = { Easy: 0, Medium: 0, Hard: 0 };
  const diffDone = { Easy: 0, Medium: 0, Hard: 0 };
  Object.entries(renderedQuestions).forEach(([category, questions]) => {
    questions.forEach((question) => {
      const level = DIFFICULTY_OPTIONS.includes(question.difficulty) ? question.difficulty : "Medium";
      diffTotals[level] += 1;
      if (solvedState[questionKey(category, question)]) {
        diffDone[level] += 1;
      }
    });
  });

  const easyProgressText = document.getElementById("easyProgressText");
  const mediumProgressText = document.getElementById("mediumProgressText");
  const hardProgressText = document.getElementById("hardProgressText");
  if (easyProgressText) easyProgressText.textContent = `${diffDone.Easy} / ${diffTotals.Easy}`;
  if (mediumProgressText) mediumProgressText.textContent = `${diffDone.Medium} / ${diffTotals.Medium}`;
  if (hardProgressText) hardProgressText.textContent = `${diffDone.Hard} / ${diffTotals.Hard}`;

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
}

function renumberQuestionList(list) {
  list.querySelectorAll(".q-number").forEach((badge, index) => {
    badge.textContent = String(index + 1);
  });
}

function syncRenderedOrderFromList(category, list) {
  const keys = [...list.querySelectorAll(".q-item")]
    .map((item) => item.dataset.key)
    .filter(Boolean);
  const byKey = new Map((renderedQuestions[category] || []).map((question) => [questionKey(category, question), question]));
  renderedQuestions[category] = keys.map((key) => byKey.get(key)).filter(Boolean);
  saveCategoryQuestionOrder(category, keys);
}

function getDragAfterElement(list, y) {
  const draggableItems = [...list.querySelectorAll(".q-item:not(.dragging)")];
  return draggableItems.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

function persistDraggedQuestionOrder(category, list) {
  syncRenderedOrderFromList(category, list);
  renumberQuestionList(list);
  updateProgress();
  scheduleCloudSync();
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
    list.addEventListener("dragover", (event) => {
      if (!draggedQuestionItem || draggedQuestionItem.dataset.category !== category) return;
      event.preventDefault();
      const afterElement = getDragAfterElement(list, event.clientY);
      if (!afterElement) {
        list.appendChild(draggedQuestionItem);
      } else {
        list.insertBefore(draggedQuestionItem, afterElement);
      }
    });

    list.addEventListener("drop", (event) => {
      if (!draggedQuestionItem || draggedQuestionItem.dataset.category !== category) return;
      event.preventDefault();
      persistDraggedQuestionOrder(category, list);
    });

    questions.forEach((question, index) => {
      const key = questionKey(category, question);
      const checked = !!state[key];
      const qNumber = index + 1;

      const item = document.createElement("div");
      item.className = `q-item ${checked ? "done" : ""}`;
      item.draggable = true;
      item.dataset.key = key;
      item.dataset.category = category;

      const dragHandle = document.createElement("button");
      dragHandle.type = "button";
      dragHandle.className = "drag-handle";
      dragHandle.textContent = "⋮⋮";
      dragHandle.title = "Drag to rearrange";
      dragHandle.setAttribute("aria-label", `Rearrange ${question.title}`);

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = checked;
      checkbox.dataset.key = key;
      checkbox.dataset.category = category;

      // Question number badge
      const qNumBadge = document.createElement("span");
      qNumBadge.className = "q-number";
      qNumBadge.textContent = String(qNumber);

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
      notesBtn.textContent = "✎";
      notesBtn.title = "Add notes";
      notesBtn.dataset.key = key;
      notesBtn.addEventListener("click", () => {
        openNotesModal(key, question.title);
      });

      const currentNote = getNote(key);
      if (currentNote) {
        notesBtn.classList.add("has-notes");
      }

      item.addEventListener("dragstart", (event) => {
        draggedQuestionItem = item;
        item.classList.add("dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", key);
      });

      item.addEventListener("dragend", () => {
        item.classList.remove("dragging");
        draggedQuestionItem = null;
        persistDraggedQuestionOrder(category, list);
      });

      item.appendChild(dragHandle);
      item.appendChild(checkbox);
      item.appendChild(qNumBadge);
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

  // Vertical Navigation Setup
  const navPanel = document.getElementById("sidebarPanel");
  const navAccountBtn = document.getElementById("navAccountBtn");
  const navAddBtn = document.getElementById("navAddBtn");
  const navDeleteBtn = document.getElementById("navDeleteBtn");
  const navThemeBtn = document.getElementById("navThemeBtn");
  const panelAccount = document.getElementById("panelAccount");
  const panelAdd = document.getElementById("panelAdd");
  const panelDelete = document.getElementById("panelDelete");

  const allPanels = [panelAccount, panelAdd, panelDelete].filter(Boolean);
  const allPanelButtons = [navAccountBtn, navAddBtn, navDeleteBtn].filter(Boolean);

  // Helper function to close panel
  const closePanel = () => {
    if (!navPanel) return;
    navPanel.classList.remove("open");
    document.body.classList.remove("sidebar-open");
    allPanels.forEach((p) => p.classList.remove("active"));
    allPanelButtons.forEach((b) => b.classList.remove("nav-active"));
  };

  const openPanel = (panelEl, buttonEl) => {
    if (!navPanel || !panelEl || !buttonEl) return;
    const isOpen = navPanel.classList.contains("open") && panelEl.classList.contains("active");
    if (isOpen) {
      closePanel();
      return;
    }

    navPanel.classList.add("open");
    document.body.classList.add("sidebar-open");
    allPanels.forEach((p) => p.classList.remove("active"));
    allPanelButtons.forEach((b) => b.classList.remove("nav-active"));
    panelEl.classList.add("active");
    buttonEl.classList.add("nav-active");
  };

  if (navAccountBtn) {
    navAccountBtn.addEventListener("click", () => {
      openPanel(panelAccount, navAccountBtn);
    });
  }

  if (navAddBtn) {
    navAddBtn.addEventListener("click", () => {
      openPanel(panelAdd, navAddBtn);
    });
  }

  if (navDeleteBtn) {
    navDeleteBtn.addEventListener("click", () => {
      openPanel(panelDelete, navDeleteBtn);
    });
  }

  document.querySelectorAll("[data-close-panel='true']").forEach((btn) => {
    btn.addEventListener("click", closePanel);
  });

  // Theme button
  if (navThemeBtn) {
    navThemeBtn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "dark";
      const next = current === "dark" ? "light" : "dark";
      applyTheme(next);
      saveLocalTheme(next);
      scheduleCloudSync();
    });
  }

  const navTotalProgressBtn = document.getElementById("navTotalProgressBtn");
  if (navTotalProgressBtn) {
    navTotalProgressBtn.addEventListener("click", () => {
      const summaryCard = document.querySelector(".summary");
      if (summaryCard) {
        summaryCard.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  // Old theme toggle (kept for compatibility)
  const themeToggleBtn = document.getElementById("themeToggleBtn");
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "dark";
      const next = current === "dark" ? "light" : "dark";
      applyTheme(next);
      saveLocalTheme(next);
      scheduleCloudSync();
    });
  }

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

  const addQuestionForm = document.getElementById("addQuestionForm");
  if (addQuestionForm) {
    addQuestionForm.addEventListener("submit", addQuestionFromForm);
  }

  const sidebarAddQuestionForm = document.getElementById("sidebarAddQuestionForm");
  if (sidebarAddQuestionForm) {
    sidebarAddQuestionForm.addEventListener("submit", addQuestionFromSidebar);
  }

  const sidebarDeleteQuestionForm = document.getElementById("sidebarDeleteQuestionForm");
  if (sidebarDeleteQuestionForm) {
    sidebarDeleteQuestionForm.addEventListener("submit", deleteQuestionByNumberFromSidebar);
  }

  const sidebarUndoDeleteBtn = document.getElementById("sidebarUndoDeleteBtn");
  if (sidebarUndoDeleteBtn) {
    sidebarUndoDeleteBtn.addEventListener("click", undoLastDeleteFromSidebar);
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

  // Notes Modal Setup
  const notesModal = document.getElementById("notesModal");
  const notesModalCloseBtn = document.getElementById("notesModalCloseBtn");
  const notesModalCancelBtn = document.getElementById("notesModalCancelBtn");
  const notesModalSaveBtn = document.getElementById("notesModalSaveBtn");
  const notesTextarea = document.getElementById("notesTextarea");

  if (notesModalCloseBtn) {
    notesModalCloseBtn.addEventListener("click", closeNotesModal);
  }

  if (notesModalCancelBtn) {
    notesModalCancelBtn.addEventListener("click", closeNotesModal);
  }

  if (notesModalSaveBtn) {
    notesModalSaveBtn.addEventListener("click", saveNotesFromModal);
  }

  if (notesTextarea) {
    notesTextarea.addEventListener("input", updateNotesLineNumbers);
    notesTextarea.addEventListener("scroll", updateNotesLineNumbers);
    notesTextarea.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeNotesModal();
      } else if (e.ctrlKey && e.key === "s" || e.metaKey && e.key === "s") {
        e.preventDefault();
        saveNotesFromModal();
      }
    });
  }

  if (notesModal) {
    notesModal.addEventListener("click", (e) => {
      if (e.target === notesModal) {
        closeNotesModal();
      }
    });
  }

  updateNotesLineNumbers();
  updateUndoButtonState();
}

mergeQuestions();
initTheme();
render();
wireActions();
initFirebaseAuth();
