// ============================================================
// FIREBASE CONFIG — Replace this block with your own config
// from the Firebase Console (Project Settings > Your apps)
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAY1wt3GqTak2oKkXuoMo0ruItv9fA09ac",
  authDomain: "family-to-do-stage.firebaseapp.com",
  projectId: "family-to-do-stage",
  storageBucket: "family-to-do-stage.firebasestorage.app",
  messagingSenderId: "918652640486",
  appId: "1:918652640486:web:46db8be779929e8aeeaf27"
};

// ============================================================

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// ---- State ----
let currentUser = null;
let familyId = null;
let members = [];
let tasks = [];
let activeFilter = "all";
let editingTaskId = null;
let tasksUnsubscribe = null;
let currentUserMemberId = null;  // member doc ID linked to this login
let familyName = null;           // cached family display name
let migrationChecked = false;    // run user-member link migration at most once
let pendingJoinFamily = null;    // { id, name } stored during join flow
let pendingMemberId = null;      // member doc ID to link on invite join (new flow)
let pendingMemberCode = null;    // invite code used during join, cleared after redemption

// ============================================================
// AUTH
// ============================================================

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    console.log("[Auth] Signed in as:", user.uid, user.email);

    let userDoc = null;
    try {
      userDoc = await getDoc(doc(db, "users", user.uid));
      console.log("[Auth] users doc exists:", userDoc.exists());
    } catch (e) {
      console.error("[Auth] Failed to read users doc:", e.code, e.message);
    }

    if (userDoc && userDoc.exists()) {
      // Returning user — load their family
      familyId = userDoc.data().familyId;
      currentUserMemberId = userDoc.data().memberId || null;
      localStorage.setItem("familyId_" + user.uid, familyId);
      console.log("[Auth] familyId from users doc:", familyId);
      try {
        const familyDoc = await getDoc(doc(db, "families", familyId));
        if (familyDoc.exists()) {
          familyName = familyDoc.data().name;
          document.getElementById("header-family-name").textContent = familyName;
          console.log("[Auth] Family loaded:", familyDoc.data().name);
        } else {
          console.warn("[Auth] Family doc not found for id:", familyId);
        }
      } catch (e) {
        console.error("[Auth] Failed to read family doc:", e.code, e.message);
      }
      showApp();
      subscribeToData();
    } else {
      // No users doc — either new user or partial setup
      console.log("[Auth] No users doc found, entering setup/recovery");
      showFamilySetup();
    }
  } else {
    currentUser = null;
    familyId = null;
    members = [];
    tasks = [];
    currentUserMemberId = null;
    migrationChecked = false;
    pendingJoinFamily = null;
    pendingMemberId = null;
    pendingMemberCode = null;
    familyName = null;
    if (tasksUnsubscribe) tasksUnsubscribe();
    showAuth();
  }
});

function showApp() {
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("family-setup-screen").classList.add("hidden");
  document.getElementById("app-screen").classList.remove("hidden");
}

function showAuth() {
  document.getElementById("app-screen").classList.add("hidden");
  document.getElementById("family-setup-screen").classList.add("hidden");
  document.getElementById("auth-screen").classList.remove("hidden");
}

async function showFamilySetup() {
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app-screen").classList.add("hidden");

  // Recovery: if we have a cached familyId hint in localStorage, try to load
  // that family directly (avoids a collection query which rules don't permit).
  const cachedFamilyId = localStorage.getItem("familyId_" + currentUser.uid);
  console.log("[Setup] cached familyId:", cachedFamilyId);

  if (cachedFamilyId) {
    try {
      console.log("[Setup] Attempting recovery with cached familyId...");
      const famDoc = await getDoc(doc(db, "families", cachedFamilyId));
      console.log("[Setup] family doc exists:", famDoc.exists());
      if (famDoc.exists()) {
        console.log("[Setup] family ownerId:", famDoc.data().ownerId, "current uid:", currentUser.uid);
      }
      if (famDoc.exists() && famDoc.data().ownerId === currentUser.uid) {
        console.log("[Setup] Recovery successful, writing users doc...");
        await setDoc(doc(db, "users", currentUser.uid), {
          name: currentUser.displayName || "Family Member",
          email: currentUser.email || "",
          familyId: cachedFamilyId,
          createdAt: serverTimestamp(),
        });
        familyId = cachedFamilyId;
        familyName = famDoc.data().name;
        document.getElementById("header-family-name").textContent = familyName;
        showApp();
        subscribeToData();
        return;
      }
    } catch (e) {
      console.error("[Setup] Recovery failed:", e.code, e.message);
    }
  }

  // Check for invite link
  const inviteCode = new URLSearchParams(window.location.search).get("invite");
  if (inviteCode) {
    console.log("[Setup] Invite code detected:", inviteCode);
    showJoinFamily(inviteCode);
    return;
  }

  // Truly new user — show the setup form
  console.log("[Setup] Showing family setup form");
  if (currentUser?.displayName) {
    document.getElementById("setup-member-name").value = currentUser.displayName.split(" ")[0];
  }
  document.getElementById("family-setup-screen").classList.remove("hidden");
}

async function showJoinFamily(code) {
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app-screen").classList.add("hidden");
  document.getElementById("family-setup-screen").classList.remove("hidden");
  document.getElementById("setup-create-state").classList.add("hidden");
  document.getElementById("setup-join-state").classList.remove("hidden");
  document.getElementById("setup-error").classList.add("hidden");

  if (code.includes(":")) {
    // New format: FAMILYID:MEMBERCODE
    // Read from top-level invites collection — readable by any authenticated user,
    // no family membership required.
    const [, memberCode] = code.split(":");
    try {
      const inviteSnap = await getDoc(doc(db, "invites", memberCode));
      if (!inviteSnap.exists()) {
        showSetupError("This invite link is invalid or has been regenerated.");
        document.getElementById("setup-join-state").classList.add("hidden");
        return;
      }
      const invite = inviteSnap.data();
      pendingJoinFamily = { id: invite.familyId, name: invite.familyName };
      pendingMemberId = invite.memberId;
      pendingMemberCode = memberCode;
      document.getElementById("join-family-display-name").textContent = invite.familyName;
      document.getElementById("join-sub-text").textContent = `You're joining as ${invite.memberName}.`;
      document.getElementById("join-name-input-row").classList.add("hidden");
      document.getElementById("join-name-display-row").classList.remove("hidden");
      document.getElementById("join-preset-name").textContent = invite.memberName;
    } catch (e) {
      console.error("[Join] Failed to look up invite:", e.code, e.message);
      showSetupError("Failed to look up invite link. Please try again.");
      document.getElementById("setup-join-state").classList.add("hidden");
    }
  } else {
    // Old format: family-level invite code (backward compat)
    pendingMemberId = null;
    if (currentUser?.displayName) {
      document.getElementById("join-member-name").value = currentUser.displayName.split(" ")[0];
    }
    document.getElementById("join-sub-text").textContent = "Enter your name to join the family.";
    document.getElementById("join-name-input-row").classList.remove("hidden");
    document.getElementById("join-name-display-row").classList.add("hidden");
    try {
      const snap = await getDocs(query(collection(db, "families"), where("inviteCode", "==", code)));
      if (snap.empty) {
        showSetupError("This invite link is invalid or has been regenerated.");
        document.getElementById("setup-join-state").classList.add("hidden");
        return;
      }
      const fam = snap.docs[0];
      pendingJoinFamily = { id: fam.id, name: fam.data().name };
      document.getElementById("join-family-display-name").textContent = fam.data().name;
    } catch (e) {
      console.error("[Join] Failed to look up invite code:", e.code, e.message);
      showSetupError("Failed to look up invite link. Please try again.");
      document.getElementById("setup-join-state").classList.add("hidden");
    }
  }
}

window.joinFamily = async function () {
  clearSetupError();
  if (!pendingJoinFamily) return showSetupError("Something went wrong. Please try the link again.");

  const { id: fid, name: joinFamilyName } = pendingJoinFamily;
  const uid = currentUser.uid;

  try {
    if (pendingMemberId) {
      // New flow: link Google account to an existing pending member
      const memberName = document.getElementById("join-preset-name").textContent;
      // Write users doc first — establishes familyId so rules allow the member update
      await setDoc(doc(db, "users", uid), {
        name: memberName,
        email: currentUser.email || "",
        familyId: fid,
        memberId: pendingMemberId,
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "families", fid, "members", pendingMemberId), {
        status: "active",
        userId: uid,
        inviteCode: null,
      });
      if (pendingMemberCode) {
        await deleteDoc(doc(db, "invites", pendingMemberCode));
      }
      currentUserMemberId = pendingMemberId;
    } else {
      // Old flow: create a new member (backward compat with family-level invite links)
      const name = document.getElementById("join-member-name").value.trim();
      if (!name) return showSetupError("Please enter your name.");

      await setDoc(doc(db, "users", uid), {
        name,
        email: currentUser.email || "",
        familyId: fid,
        createdAt: serverTimestamp(),
      });
      const memberRef = await addDoc(collection(db, "families", fid, "members"), {
        name,
        color: randomColor(),
        userId: uid,
        status: "active",
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "users", uid), { memberId: memberRef.id });
      currentUserMemberId = memberRef.id;
    }

    familyId = fid;
    familyName = joinFamilyName;
    localStorage.setItem("familyId_" + uid, fid);
    document.getElementById("header-family-name").textContent = familyName;
    history.replaceState({}, "", window.location.pathname);
    showApp();
    subscribeToData();
  } catch (e) {
    showSetupError("Failed to join family. Please try again.");
    console.error("[Join] Error:", e);
  }
};

window.signInWithGoogle = async function () {
  clearAuthError();
  try {
    const isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform());

    if (isCapacitor) {
      // Native Android: use Capacitor Firebase Auth plugin
      const { FirebaseAuthentication } = window.Capacitor.Plugins;
      const result = await FirebaseAuthentication.signInWithGoogle();
      const credential = GoogleAuthProvider.credential(
        result.credential.idToken,
        result.credential.accessToken ?? null
      );
      await signInWithCredential(auth, credential);
    } else {
      // Web: existing popup flow unchanged
      await signInWithPopup(auth, googleProvider);
    }
  } catch (e) {
    const cancelCodes = ["auth/popup-closed-by-user", "auth/cancelled-popup-request"];
    if (!cancelCodes.includes(e.code)) {
      showAuthError("Sign-in failed. Please try again.");
    }
  }
};

window.createFamily = async function () {
  const inputFamilyName = document.getElementById("setup-family-name").value.trim();
  const memberName = document.getElementById("setup-member-name").value.trim();
  clearSetupError();

  if (!inputFamilyName || !memberName) {
    return showSetupError("Please fill in both fields.");
  }

  try {
    const uid = currentUser.uid;

    const inviteCode = generateInviteCode();

    // Create family document
    const familyRef = doc(collection(db, "families"));
    await setDoc(familyRef, {
      name: inputFamilyName,
      ownerId: uid,
      inviteCode,
      createdAt: serverTimestamp(),
    });

    // Create user document first — the members rule requires get(users/uid).data.familyId
    // to equal this familyId, so the users doc must exist before writing to members.
    // memberId gets filled in below once we have it.
    await setDoc(doc(db, "users", uid), {
      name: memberName,
      email: currentUser.email,
      familyId: familyRef.id,
      createdAt: serverTimestamp(),
    });

    // Now add the registering user as the first family member
    const memberRef = await addDoc(collection(db, "families", familyRef.id, "members"), {
      name: memberName,
      color: randomColor(),
      userId: uid,
      status: "active",
      createdAt: serverTimestamp(),
    });

    // Update user doc with the member ID now that we have it
    await updateDoc(doc(db, "users", uid), { memberId: memberRef.id });

    familyId = familyRef.id;
    familyName = inputFamilyName;
    currentUserMemberId = memberRef.id;
    localStorage.setItem("familyId_" + currentUser.uid, familyRef.id);
    document.getElementById("header-family-name").textContent = familyName;
    showApp();
    subscribeToData();
  } catch (e) {
    showSetupError("Failed to create family. Please try again.");
    console.error(e);
  }
};

window.logoutUser = async function () {
  await signOut(auth);
};

function showAuthError(msg) {
  const el = document.getElementById("auth-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}
function clearAuthError() {
  document.getElementById("auth-error").classList.add("hidden");
}
function showSetupError(msg) {
  const el = document.getElementById("setup-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}
function clearSetupError() {
  document.getElementById("setup-error").classList.add("hidden");
}

// ============================================================
// REALTIME DATA SUBSCRIPTIONS
// ============================================================

function subscribeToData() {
  console.log("[Sub] Subscribing with familyId:", familyId);
  if (currentUserMemberId) activeFilter = currentUserMemberId;

  // Members
  onSnapshot(
    collection(db, "families", familyId, "members"),
    (snap) => {
      console.log("[Sub] Members snapshot received, count:", snap.docs.length);
      members = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderMemberChips();
      renderMemberCheckboxes();
      renderMembersList();
      if (!migrationChecked) {
        migrationChecked = true;
        maybeMigrateUserMemberLink();
      }
    },
    (err) => console.error("[Sub] Members permission error:", err.code, err.message)
  );

  // Tasks
  if (tasksUnsubscribe) tasksUnsubscribe();
  tasksUnsubscribe = onSnapshot(
    collection(db, "families", familyId, "tasks"),
    (snap) => {
      console.log("[Sub] Tasks snapshot received, count:", snap.docs.length);
      tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      processDueRecurringTasks().then(() => renderTasks());
    },
    (err) => console.error("[Sub] Tasks permission error:", err.code, err.message)
  );
}

async function maybeMigrateUserMemberLink() {
  if (!currentUser || !familyId || currentUserMemberId) return;
  const unlinked = members.filter((m) => !m.userId);
  if (unlinked.length !== 1) return;
  const member = unlinked[0];
  try {
    await updateDoc(doc(db, "users", currentUser.uid), { memberId: member.id });
    await updateDoc(doc(db, "families", familyId, "members", member.id), { userId: currentUser.uid });
    currentUserMemberId = member.id;
  } catch (e) {
    console.error("[Migration] Failed:", e);
  }
}

// ============================================================
// RECURRING TASK LOGIC
// ============================================================

async function processDueRecurringTasks() {
  const today = todayStr();
  for (const task of tasks) {
    if (task.recurrence === "none" || !task.recurrence) continue;
    if (!task.completed) continue;

    // Reopen if nextDue has arrived
    if (task.nextDue && task.nextDue <= today) {
      await updateDoc(doc(db, "families", familyId, "tasks", task.id), {
        completed: false,
        completedAt: null,
        dueDate: task.nextDue,
        nextDue: null,
      });
      continue;
    }

    // Safety net: recurring task is completed but has no nextDue set
    // (can happen for tasks completed before this fix was deployed)
    if (!task.nextDue) {
      const nextDue = computeNextDue(task.dueDate || null, task.recurrence);
      // If nextDue is today or already past, reopen immediately
      if (nextDue && nextDue <= today) {
        await updateDoc(doc(db, "families", familyId, "tasks", task.id), {
          completed: false,
          completedAt: null,
          dueDate: nextDue,
          nextDue: null,
        });
      } else if (nextDue) {
        // Store the computed nextDue so it reopens on the right day
        await updateDoc(doc(db, "families", familyId, "tasks", task.id), { nextDue });
      }
    }
  }
}

// Quick test helper: open browser console and run testRecurring('task title')
// to backdate a recurring task's due date to yesterday so it re-opens immediately.
window.testRecurring = async function(titleSubstring) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  const task = tasks.find(t => t.title.toLowerCase().includes(titleSubstring.toLowerCase()) && t.completed);
  if (!task) { console.log("No completed task found matching:", titleSubstring); return; }
  await updateDoc(doc(db, "families", familyId, "tasks", task.id), { nextDue: yesterdayStr });
  console.log("Set nextDue to yesterday for:", task.title, "— refresh the page to trigger re-open.");
};

function computeNextDue(dueDate, recurrence) {
  if (recurrence === "none" || !recurrence) return null;
  // If no due date, base recurrence off today
  const base = dueDate || todayStr();
  const d = new Date(base + "T12:00:00");

  if (recurrence === "daily") d.setDate(d.getDate() + 1);
  else if (recurrence === "weekdays") {
    // Advance to next weekday: skip Saturday and Sunday
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
  }
  else if (recurrence === "weekly") d.setDate(d.getDate() + 7);
  else if (recurrence === "biweekly") d.setDate(d.getDate() + 14);
  else if (recurrence === "monthly") {
    const originalDay = d.getDate();
    d.setDate(1); // Anchor to 1st to avoid month-end rollover
    d.setMonth(d.getMonth() + 1);
    // Cap to last valid day of the target month
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(originalDay, daysInMonth));
  }
  else if (recurrence.startsWith("days:")) {
    const days = parseInt(recurrence.split(":")[1], 10);
    if (!isNaN(days) && days > 0) {
      d.setDate(d.getDate() + days);
    } else {
      return null; // Invalid format
    }
  }
  // Use local date string to avoid UTC timezone shifting
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function todayStr() {
  const d = new Date();
  // Use local date, not UTC — avoids off-by-one errors in non-UTC timezones
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function timestampToLocalDate(ts) {
  // Converts a Firestore Timestamp or ISO string to a local YYYY-MM-DD string
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ============================================================
// RENDER TASKS
// ============================================================

function renderTasks() {
  const container = document.getElementById("task-list");
  const today = todayStr();

  let incomplete = tasks.filter((t) => !t.completed);

  // Apply member filter
  if (activeFilter === "unassigned") {
    incomplete = incomplete.filter((t) => !t.members || t.members.length === 0);
  } else if (activeFilter !== "all") {
    incomplete = incomplete.filter(
      (t) => t.members && t.members.includes(activeFilter)
    );
  }

  const overdue = incomplete
    .filter((t) => t.dueDate && t.dueDate < today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const dueToday = incomplete
    .filter((t) => t.dueDate && t.dueDate === today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const later = incomplete
    .filter((t) => t.dueDate && t.dueDate > today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const noDue = incomplete.filter((t) => !t.dueDate);

  // Completed today only — apply same member filter
  let completedToday = tasks.filter((t) => {
    if (!t.completed) return false;
    if (!t.completedAt) return false;
    return timestampToLocalDate(t.completedAt) === today;
  });
  if (activeFilter === "unassigned") {
    completedToday = completedToday.filter((t) => !t.members || t.members.length === 0);
  } else if (activeFilter !== "all") {
    completedToday = completedToday.filter((t) => t.members && t.members.includes(activeFilter));
  }

  // Completed recurring tasks waiting for their next occurrence
  let upcomingRecurring = tasks.filter((t) => {
    if (!t.completed) return false;
    if (!t.recurrence || t.recurrence === "none") return false;
    return t.nextDue && t.nextDue > today;
  });
  if (activeFilter === "unassigned") {
    upcomingRecurring = upcomingRecurring.filter((t) => !t.members || t.members.length === 0);
  } else if (activeFilter !== "all") {
    upcomingRecurring = upcomingRecurring.filter((t) => t.members && t.members.includes(activeFilter));
  }

  if (incomplete.length === 0 && completedToday.length === 0 && upcomingRecurring.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">✅</div>
      <p>${activeFilter === "all" ? "No tasks yet! Add one above." : "No tasks for this filter."}</p>
    </div>`;
    return;
  }

  let html = "";

  if (overdue.length) {
    html += `<div class="section-label">⚠️ Overdue</div>`;
    overdue.forEach((t) => (html += taskCard(t, true, false)));
  }

  const completedDueToday = completedToday.filter((t) => t.dueDate === today);

  if (dueToday.length) {
    html += `<div class="section-label">📅 Today</div>`;
    dueToday.forEach((t) => (html += taskCard(t, false, false)));
  } else if (completedDueToday.length) {
    html += `<div class="section-label">📅 Today</div>
    <div class="all-done-today">All done for today! 🎉</div>`;
  }

  const laterCombined = [
    ...later.map((t) => ({ task: t, sortDate: t.dueDate, upcoming: false })),
    ...upcomingRecurring.map((t) => ({ task: t, sortDate: t.nextDue, upcoming: true })),
  ].sort((a, b) => a.sortDate.localeCompare(b.sortDate));

  if (laterCombined.length) {
    html += `<div class="section-label section-label-collapsible" onclick="toggleSection(this)">
      <span>🗓 Later</span><span class="collapse-arrow">▶</span>
    </div>
    <div class="collapsible-section">`;
    laterCombined.forEach(({ task, upcoming }) => (html += taskCard(task, false, false, upcoming)));
    html += `</div>`;
  }

  if (noDue.length) {
    html += `<div class="section-label section-label-collapsible" onclick="toggleSection(this)">
      <span>🗂 No Due Date</span><span class="collapse-arrow collapsed">▶</span>
    </div>
    <div class="collapsible-section">`;
    noDue.forEach((t) => (html += taskCard(t, false, false)));
    html += `</div>`;
  }

  if (completedToday.length) {
    html += `<div class="section-label">✅ Completed Today</div>`;
    completedToday.forEach((t) => (html += taskCard(t, false, true)));
  }

  container.innerHTML = html;
}

function taskCard(task, isOverdue, isCompleted, isUpcomingRecurring = false) {
  const memberAvatars = (task.members || [])
    .map((mid) => {
      const m = members.find((x) => x.id === mid);
      if (!m) return "";
      const initials = m.name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
      return `<div class="avatar" style="background:${m.color || "#888"}" title="${m.name}">${initials}</div>`;
    })
    .join("");

  const dateStr = task.dueDate ? formatDate(task.dueDate) : "";
  const dateClass = isOverdue ? "task-date overdue-text" : "task-date";

  const recurLabel = task.recurrence && task.recurrence !== "none"
    ? `<span class="task-recur">↻ ${recurringLabel(task.recurrence)}</span>`
    : "";

  const deleteTitle = task.recurrence && task.recurrence !== "none"
    ? "Delete (stop recurring)"
    : "Delete task";

  if (isUpcomingRecurring) {
    const nextDueStr = task.nextDue ? formatDate(task.nextDue) : "";
    return `<div class="task-card task-card-upcoming-recurring">
      <div class="task-check task-check-upcoming" title="Completed — next occurrence upcoming"></div>
      <div class="task-main">
        <div class="task-title task-title-upcoming">${escHtml(task.title)}</div>
        <div class="task-meta">
          ${nextDueStr ? `<span class="task-date">📅 ${nextDueStr}</span>` : ""}
          ${recurLabel}
          <div class="member-avatars">${memberAvatars}</div>
        </div>
      </div>
      <div class="task-actions">
        <button class="task-action-btn delete" onclick="deleteTask('${task.id}')" title="${deleteTitle}">🗑</button>
      </div>
    </div>`;
  }

  if (isCompleted) {
    return `<div class="task-card task-card-completed">
      <div class="task-check checked" title="Completed"></div>
      <div class="task-main">
        <div class="task-title task-title-completed">${escHtml(task.title)}</div>
        <div class="task-meta">
          ${recurLabel}
          <div class="member-avatars">${memberAvatars}</div>
        </div>
      </div>
      <div class="task-actions">
        <button class="task-action-btn delete" onclick="deleteTask('${task.id}')" title="${deleteTitle}">🗑</button>
      </div>
    </div>`;
  }

  return `<div class="task-card${isOverdue ? " overdue" : ""}">
    <div class="task-check" onclick="toggleComplete('${task.id}', this)" title="Mark complete"></div>
    <div class="task-main">
      <div class="task-title">${escHtml(task.title)}</div>
      <div class="task-meta">
        ${dateStr ? `<span class="${dateClass}">📅 ${dateStr}</span>` : ""}
        ${recurLabel}
        <div class="member-avatars">${memberAvatars}</div>
      </div>
    </div>
    <div class="task-actions">
      <button class="task-action-btn" onclick="openEditTask('${task.id}')" title="Edit">✏️</button>
      <button class="task-action-btn delete" onclick="deleteTask('${task.id}')" title="${deleteTitle}">🗑</button>
    </div>
  </div>`;
}

function recurringLabel(r) {
  if (r.startsWith("days:")) {
    const days = parseInt(r.split(":")[1], 10);
    return `Every ${days} day${days === 1 ? "" : "s"}`;
  }
  return { daily: "Daily", weekdays: "Weekdays", weekly: "Weekly", biweekly: "Every 2 wks", monthly: "Monthly" }[r] || r;
}

function formatDate(str) {
  const d = new Date(str + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ============================================================
// MEMBER CHIPS (filter)
// ============================================================

function renderMemberChips() {
  const row = document.getElementById("member-filter-chips");
  let html = `<button class="chip${activeFilter === "all" ? " chip-active" : ""}" onclick="setFilter('all')">All</button>`;
  members.forEach((m) => {
    const active = activeFilter === m.id ? " chip-active" : "";
    html += `<button class="chip${active}" onclick="setFilter('${m.id}')" style="${active ? `background:${m.color};border-color:${m.color}` : ""}">${escHtml(m.name)}</button>`;
  });
  const unassignedActive = activeFilter === "unassigned" ? " chip-active" : "";
  html += `<button class="chip${unassignedActive}" onclick="setFilter('unassigned')" style="${unassignedActive ? "background:#9e9892;border-color:#9e9892" : ""}">Unassigned</button>`;
  row.innerHTML = html;
}

window.toggleSection = function (header) {
  const section = header.nextElementSibling;
  const arrow = header.querySelector(".collapse-arrow");
  const isCollapsed = section.style.display === "none";
  section.style.display = isCollapsed ? "" : "none";
  arrow.classList.toggle("collapsed", !isCollapsed);
};

window.setFilter = function (memberId) {
  activeFilter = memberId;
  renderMemberChips();
  renderTasks();
};

// Exposed for color swatch selection
window.selectMemberColor = function (color) {
  document.querySelectorAll(".color-swatch").forEach(s => s.classList.remove("selected"));
  const swatch = document.querySelector(`.color-swatch[data-color="${color}"]`);
  if (swatch) swatch.classList.add("selected");
  document.getElementById("selected-member-color").value = color;
};

// ============================================================
// TASK MODAL
// ============================================================

window.openTaskModal = function () {
  editingTaskId = null;
  document.getElementById("task-modal-title").textContent = "Add Task";
  document.getElementById("task-title").value = "";
  document.getElementById("task-due").value = todayStr();
  document.getElementById("task-recurrence").value = "none";
  document.getElementById("task-recurrence-days").value = "";
  clearTaskError();
  toggleRecurrenceDaysInput();
  // Pre-select the currently filtered member (if any)
  const preselect = (activeFilter !== "all" && activeFilter !== "unassigned") ? [activeFilter] : [];
  renderMemberCheckboxes(preselect);
  document.getElementById("task-modal").classList.remove("hidden");
};

window.openEditTask = function (taskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  editingTaskId = taskId;
  document.getElementById("task-modal-title").textContent = "Edit Task";
  document.getElementById("task-title").value = task.title;
  document.getElementById("task-due").value = task.dueDate || "";

  // Handle custom days recurrence
  if (task.recurrence && task.recurrence.startsWith("days:")) {
    const days = parseInt(task.recurrence.split(":")[1], 10);
    document.getElementById("task-recurrence").value = "days";
    document.getElementById("task-recurrence-days").value = days;
  } else {
    document.getElementById("task-recurrence").value = task.recurrence || "none";
    document.getElementById("task-recurrence-days").value = "";
  }

  clearTaskError();
  toggleRecurrenceDaysInput();
  renderMemberCheckboxes(task.members || []);
  document.getElementById("task-modal").classList.remove("hidden");
};

window.closeTaskModal = function (e) {
  if (e && e.target !== document.getElementById("task-modal")) return;
  document.getElementById("task-modal").classList.add("hidden");
};

window.toggleRecurrenceDaysInput = function () {
  const recurrence = document.getElementById("task-recurrence").value;
  const daysInput = document.getElementById("task-recurrence-days");
  if (recurrence === "days") {
    daysInput.style.display = "block";
    daysInput.focus();
  } else {
    daysInput.style.display = "none";
  }
};

window.saveTask = async function () {
  const title = document.getElementById("task-title").value.trim();
  if (!title) return showTaskError("Please enter a task title.");

  const dueDate = document.getElementById("task-due").value || null;
  let recurrence = document.getElementById("task-recurrence").value;

  // Handle custom days recurrence
  if (recurrence === "days") {
    const days = document.getElementById("task-recurrence-days").value.trim();
    if (!days) return showTaskError("Please enter the number of days for custom recurrence.");
    const daysNum = parseInt(days, 10);
    if (isNaN(daysNum) || daysNum < 1 || daysNum > 30) {
      return showTaskError("Number of days must be between 1 and 30.");
    }
    recurrence = `days:${daysNum}`;
  }

  if (recurrence !== "none" && !dueDate) {
    return showTaskError("A due date is required for recurring tasks.");
  }

  const selectedMembers = Array.from(
    document.querySelectorAll(".member-checkbox-item.selected")
  ).map((el) => el.dataset.memberId);

  const data = {
    title,
    dueDate,
    recurrence,
    members: selectedMembers,
    completed: false,
    updatedAt: serverTimestamp(),
  };

  try {
    if (editingTaskId) {
      await updateDoc(
        doc(db, "families", familyId, "tasks", editingTaskId),
        data
      );
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, "families", familyId, "tasks"), data);
    }
    document.getElementById("task-modal").classList.add("hidden");
  } catch (e) {
    showTaskError("Failed to save task. Please try again.");
    console.error(e);
  }
};

function renderMemberCheckboxes(selected = []) {
  const container = document.getElementById("member-checkboxes");
  if (!members.length) {
    container.innerHTML = `<p style="font-size:13px;color:var(--text3)">No members yet — add some in the Members panel.</p>`;
    return;
  }
  container.innerHTML = members
    .map((m) => {
      const isSelected = selected.includes(m.id);
      const initials = m.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
      return `<div class="member-checkbox-item${isSelected ? " selected" : ""}" 
        data-member-id="${m.id}" 
        onclick="toggleMemberCheckbox(this)">
        <div class="avatar" style="background:${m.color || "#888"}">${initials}</div>
        <span>${escHtml(m.name)}</span>
        <input type="checkbox" ${isSelected ? "checked" : ""} style="margin-left:auto" tabindex="-1" />
      </div>`;
    })
    .join("");
}

window.toggleMemberCheckbox = function (el) {
  el.classList.toggle("selected");
  el.querySelector("input[type=checkbox]").checked = el.classList.contains("selected");
};

function showTaskError(msg) {
  const el = document.getElementById("task-modal-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}
function clearTaskError() {
  document.getElementById("task-modal-error").classList.add("hidden");
}

// ============================================================
// COMPLETE / DELETE TASKS
// ============================================================

window.toggleComplete = async function (taskId, el) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;

  triggerSparkBurst(el);

  const isRecurring = task.recurrence && task.recurrence !== "none";

  if (isRecurring) {
    // computeNextDue handles null dueDate by using today as the base
    const nextDue = computeNextDue(task.dueDate || null, task.recurrence);
    await updateDoc(doc(db, "families", familyId, "tasks", taskId), {
      completed: true,
      completedAt: serverTimestamp(),
      nextDue,
    });
  } else {
    await updateDoc(doc(db, "families", familyId, "tasks", taskId), {
      completed: true,
      completedAt: serverTimestamp(),
    });
  }
};

function triggerSparkBurst(el) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const colors = ["#FFD700", "#FF6B6B", "#4ECDC4", "#45B7D1", "#FFA07A", "#BB8FCE", "#F7DC6F", "#98D8C8"];
  const count = 8;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * 360 + (Math.random() * 20 - 10);
    const distance = 55 + Math.random() * 35;
    const size = 5 + Math.random() * 4;
    const spark = document.createElement("div");
    spark.className = "spark";
    spark.style.cssText = `
      left:${cx}px; top:${cy}px;
      width:${size}px; height:${size}px;
      background:${colors[i % colors.length]};
      --dx:${Math.cos((angle * Math.PI) / 180) * distance}px;
      --dy:${Math.sin((angle * Math.PI) / 180) * distance}px;
    `;
    document.body.appendChild(spark);
    spark.addEventListener("animationend", () => spark.remove());
  }
}

window.deleteTask = async function (taskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  const msg =
    task.recurrence && task.recurrence !== "none"
      ? "Delete this recurring task permanently (it will stop repeating)?"
      : "Delete this task?";
  if (!confirm(msg)) return;
  await deleteDoc(doc(db, "families", familyId, "tasks", taskId));
};

// ============================================================
// MEMBERS MODAL
// ============================================================

window.openMembersModal = function () {
  renderMembersList();
  document.getElementById("new-member-name").value = "";
  document.getElementById("new-invite-link-panel").classList.add("hidden");
  document.getElementById("members-modal-error").classList.add("hidden");
  window.selectMemberColor("#4f86f7");
  document.getElementById("members-modal").classList.remove("hidden");
};

window.copyInviteLink = async function () {
  const link = document.getElementById("invite-link-input").value;
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
    const btn = document.getElementById("copy-invite-btn");
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = "Copy"; }, 2000);
  } catch (e) {
    console.error("[Invite] Clipboard write failed:", e);
  }
};


window.closeMembersModal = function (e) {
  if (e && e.target !== document.getElementById("members-modal")) return;
  document.getElementById("members-modal").classList.add("hidden");
};

window.renderMembersList = function(editingId = null) {
  const container = document.getElementById("members-list");
  if (!members.length) {
    container.innerHTML = `<p style="font-size:13px;color:var(--text3);margin-bottom:8px">No members yet.</p>`;
    return;
  }
  container.innerHTML = members.map((m) => {
    const initials = m.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
    if (m.id === editingId) {
      // Inline edit row
      const swatches = MEMBER_COLORS.map(({color, label}) => {
        const sel = color === (m.color || "#4f86f7") ? " selected" : "";
        return `<div class="color-swatch${sel}" data-color="${color}" style="background:${color}"
          onclick="document.getElementById('edit-member-color').value='${color}';document.querySelectorAll('#member-edit-swatches .color-swatch').forEach(s=>s.classList.remove('selected'));this.classList.add('selected')"
          title="${label}"></div>`;
      }).join("");
      return `<div class="member-row member-row-editing">
        <div class="member-edit-fields">
          <input type="text" id="edit-member-name" class="input" value="${escHtml(m.name)}" placeholder="Name" style="margin-bottom:8px" />
          <div class="color-swatches" style="margin-top:0">
            <span class="swatch-label">Color:</span>
            <div id="member-edit-swatches" class="swatch-row">${swatches}</div>
            <input type="hidden" id="edit-member-color" value="${m.color || '#4f86f7'}" />
          </div>
        </div>
        <div class="member-edit-actions">
          <button class="btn btn-primary btn-sm" onclick="saveMemberEdit('${m.id}')">Save</button>
          <button class="btn btn-ghost btn-sm" onclick="renderMembersList()">Cancel</button>
        </div>
      </div>`;
    }
    // Normal row — status badge + action buttons
    const status = m.status || "active";
    const statusBadge = {
      active:      `<span class="member-status member-status-active">Joined</span>`,
      pending:     `<span class="member-status member-status-pending">Not yet joined</span>`,
      "name-only": `<span class="member-status member-status-name-only">No account</span>`,
    }[status] || `<span class="member-status member-status-active">Joined</span>`;

    const inviteBtn = status === "name-only"
      ? `<button class="member-action-btn" data-invite-btn="${m.id}" onclick="sendMemberInvite('${m.id}')" title="Generate and copy invite link">🔗</button>`
      : status === "pending"
      ? `<button class="member-action-btn" data-copy-btn="${m.id}" onclick="copyMemberInviteLink('${m.id}')" title="Copy invite link">🔗</button>`
      : "";

    const inviteNote = status === "pending"
      ? `<span class="member-invite-note">Copy 🔗 and send to this member</span>`
      : status === "name-only"
      ? `<span class="member-invite-note">Generate a 🔗 invite link to let them join</span>`
      : "";

    return `<div class="member-row">
      <div class="avatar" style="background:${m.color || "#888"}">${initials}</div>
      <div class="member-info">
        <span class="member-name">${escHtml(m.name)}</span>
        ${statusBadge}
        ${inviteNote}
      </div>
      <div style="display:flex;gap:4px;margin-left:auto">
        ${inviteBtn}
        <button class="member-action-btn" onclick="renderMembersList('${m.id}')" title="Edit member">✏️</button>
        <button class="member-action-btn" onclick="deleteMember('${m.id}')" title="Remove member">✕</button>
      </div>
    </div>`;
  }).join("");
};

const MEMBER_COLORS = [
  {color:"#4f86f7",label:"Blue"},{color:"#2d6a4f",label:"Green"},
  {color:"#f4845f",label:"Coral"},{color:"#9b59b6",label:"Purple"},
  {color:"#e67e22",label:"Orange"},{color:"#e91e8c",label:"Pink"},
  {color:"#1abc9c",label:"Teal"},{color:"#c0392b",label:"Red"},
];

window.saveMemberEdit = async function(memberId) {
  const name = document.getElementById("edit-member-name").value.trim();
  const color = document.getElementById("edit-member-color").value;
  if (!name) return;
  try {
    await updateDoc(doc(db, "families", familyId, "members", memberId), { name, color });
    // renderMembersList will be called automatically via onSnapshot
  } catch (e) {
    console.error("Failed to update member:", e);
    const el = document.getElementById("members-modal-error");
    el.textContent = "Failed to save changes.";
    el.classList.remove("hidden");
  }
};

window.addMember = async function (withInvite = false) {
  const nameEl = document.getElementById("new-member-name");
  const colorEl = document.getElementById("selected-member-color");
  const name = nameEl.value.trim();
  const errorEl = document.getElementById("members-modal-error");
  errorEl.classList.add("hidden");
  if (!name) return;

  const inviteCode = withInvite ? generateInviteCode() : null;

  try {
    const memberRef = await addDoc(collection(db, "families", familyId, "members"), {
      name,
      color: colorEl.value || randomColor(),
      status: withInvite ? "pending" : "name-only",
      ...(inviteCode ? { inviteCode } : {}),
      createdAt: serverTimestamp(),
    });

    if (withInvite) {
      await setDoc(doc(db, "invites", inviteCode), {
        familyId,
        familyName: familyName || "",
        memberId: memberRef.id,
        memberName: name,
      });
      const link = memberInviteLink(familyId, inviteCode);
      document.getElementById("new-invite-link-input").value = link;
      document.getElementById("new-invite-link-panel").classList.remove("hidden");
    } else {
      document.getElementById("new-invite-link-panel").classList.add("hidden");
    }
    nameEl.value = "";
    window.selectMemberColor("#4f86f7");
  } catch (e) {
    console.error("[Member] Failed to add member:", e.code, e.message);
    errorEl.textContent = `Failed to add member: ${e.message}`;
    errorEl.classList.remove("hidden");
  }
};

function memberInviteLink(fid, code) {
  return `https://stevenkopp82.github.io/family-to-do/?invite=${fid}:${code}`;
}

window.sendMemberInvite = async function (memberId) {
  const member = members.find((m) => m.id === memberId);
  if (!member) return;
  const oldCode = member.inviteCode || null;
  const newCode = generateInviteCode();
  try {
    await updateDoc(doc(db, "families", familyId, "members", memberId), {
      status: "pending",
      inviteCode: newCode,
    });
    await setDoc(doc(db, "invites", newCode), {
      familyId,
      familyName: familyName || "",
      memberId,
      memberName: member.name,
    });
    if (oldCode) await deleteDoc(doc(db, "invites", oldCode)).catch(() => {});
    const link = memberInviteLink(familyId, newCode);
    await navigator.clipboard.writeText(link);
    const btn = document.querySelector(`[data-invite-btn="${memberId}"]`);
    if (btn) { btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = "Copy link"; }, 2000); }
  } catch (e) {
    console.error("[Invite] Failed to generate invite:", e);
  }
};

window.copyMemberInviteLink = async function (memberId) {
  const member = members.find((m) => m.id === memberId);
  if (!member || !member.inviteCode) return;
  const link = memberInviteLink(familyId, member.inviteCode);
  try {
    await navigator.clipboard.writeText(link);
    const btn = document.querySelector(`[data-copy-btn="${memberId}"]`);
    if (btn) { btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = "Copy link"; }, 2000); }
  } catch (e) {
    console.error("[Invite] Failed to copy link:", e);
  }
};

window.copyNewInviteLink = async function () {
  const val = document.getElementById("new-invite-link-input").value;
  try {
    await navigator.clipboard.writeText(val);
    const btn = document.querySelector('[onclick="copyNewInviteLink()"]');
    if (btn) { btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = "Copy"; }, 2000); }
  } catch (e) {
    console.error("[Invite] Failed to copy new invite link:", e);
  }
};

window.deleteMember = async function (memberId) {
  if (!confirm("Remove this family member? They will be removed from any tasks they're assigned to.")) return;
  await deleteDoc(doc(db, "families", familyId, "members", memberId));

  // Remove from tasks
  const tasksWithMember = tasks.filter(
    (t) => t.members && t.members.includes(memberId)
  );
  for (const task of tasksWithMember) {
    const newMembers = task.members.filter((m) => m !== memberId);
    await updateDoc(doc(db, "families", familyId, "tasks", task.id), {
      members: newMembers,
    });
  }
};

// ============================================================
// UTILS
// ============================================================

function generateInviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function randomColor() {
  const colors = [
    "#2d6a4f", "#f4845f", "#4f86f7", "#9b59b6",
    "#e67e22", "#1abc9c", "#e91e8c", "#34495e",
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
