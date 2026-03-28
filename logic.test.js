/**
 * Unit tests for Family To-Do pure logic functions.
 * Run with: npm test
 */

// ============================================================
// Inline the pure functions under test (no Firebase imports)
// ============================================================

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function timestampToLocalDate(ts) {
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function computeNextDue(dueDate, recurrence) {
  if (recurrence === "none" || !recurrence) return null;
  const base = dueDate || todayStr();
  const d = new Date(base + "T12:00:00");
  if (recurrence === "daily")    d.setDate(d.getDate() + 1);
  else if (recurrence === "weekly")   d.setDate(d.getDate() + 7);
  else if (recurrence === "biweekly") d.setDate(d.getDate() + 14);
  else if (recurrence === "monthly") {
    const originalDay = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(originalDay, daysInMonth));
  }
  else if (recurrence.startsWith("days:")) {
    const days = parseInt(recurrence.split(":")[1], 10);
    if (!isNaN(days) && days > 0) {
      d.setDate(d.getDate() + days);
    } else {
      return null;
    }
  }
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function sortTasks(tasks) {
  const today = todayStr();
  const incomplete = tasks.filter(t => !t.completed);
  const overdue   = incomplete.filter(t => t.dueDate && t.dueDate < today)
                              .sort((a,b) => a.dueDate.localeCompare(b.dueDate));
  const upcoming  = incomplete.filter(t => t.dueDate && t.dueDate >= today)
                              .sort((a,b) => a.dueDate.localeCompare(b.dueDate));
  const noDue     = incomplete.filter(t => !t.dueDate);
  return { overdue, upcoming, noDue };
}

function filterTasks(tasks, activeFilter) {
  if (activeFilter === "all") return tasks;
  if (activeFilter === "unassigned") return tasks.filter(t => !t.members || t.members.length === 0);
  return tasks.filter(t => t.members && t.members.includes(activeFilter));
}

// ============================================================
// Helpers
// ============================================================

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ============================================================
// todayStr
// ============================================================

describe("todayStr", () => {
  test("returns a string in YYYY-MM-DD format", () => {
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("matches the local date, not UTC", () => {
    const d = new Date();
    const expected = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    expect(todayStr()).toBe(expected);
  });
});

// ============================================================
// timestampToLocalDate
// ============================================================

describe("timestampToLocalDate", () => {
  test("converts a plain Date to local YYYY-MM-DD", () => {
    const d = new Date(2026, 2, 15, 20, 0, 0); // March 15 2026 8pm local
    expect(timestampToLocalDate(d)).toBe("2026-03-15");
  });

  test("converts a Firestore-style Timestamp object", () => {
    const fakeTimestamp = { toDate: () => new Date(2026, 2, 15, 20, 0, 0) };
    expect(timestampToLocalDate(fakeTimestamp)).toBe("2026-03-15");
  });

  test("does not bleed into the next day for evening completions", () => {
    // 11:30pm local should still be today, not tomorrow
    const d = new Date();
    d.setHours(23, 30, 0, 0);
    expect(timestampToLocalDate(d)).toBe(todayStr());
  });
});

// ============================================================
// computeNextDue
// ============================================================

describe("computeNextDue", () => {
  test("returns null for recurrence=none", () => {
    expect(computeNextDue("2026-03-14", "none")).toBeNull();
  });

  test("returns null for missing recurrence", () => {
    expect(computeNextDue("2026-03-14", null)).toBeNull();
    expect(computeNextDue("2026-03-14", undefined)).toBeNull();
  });

  test("daily: advances by 1 day", () => {
    expect(computeNextDue("2026-03-14", "daily")).toBe("2026-03-15");
  });

  test("weekly: advances by 7 days", () => {
    expect(computeNextDue("2026-03-14", "weekly")).toBe("2026-03-21");
  });

  test("biweekly: advances by 14 days", () => {
    expect(computeNextDue("2026-03-14", "biweekly")).toBe("2026-03-28");
  });

  test("monthly: advances by 1 month", () => {
    expect(computeNextDue("2026-03-14", "monthly")).toBe("2026-04-14");
  });

  test("monthly: handles month-end correctly (Mar 31 -> Apr 30)", () => {
    expect(computeNextDue("2026-03-31", "monthly")).toBe("2026-04-30");
  });

  test("daily: handles year rollover (Dec 31 -> Jan 1)", () => {
    expect(computeNextDue("2025-12-31", "daily")).toBe("2026-01-01");
  });

  test("uses today as base when dueDate is null", () => {
    const expected = dateOffset(1);
    expect(computeNextDue(null, "daily")).toBe(expected);
  });

  test("uses today as base when dueDate is undefined", () => {
    const expected = dateOffset(7);
    expect(computeNextDue(undefined, "weekly")).toBe(expected);
  });

  test("result is always a valid YYYY-MM-DD string", () => {
    const result = computeNextDue("2026-03-14", "weekly");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("days:3 advances by 3 days", () => {
    expect(computeNextDue("2026-03-14", "days:3")).toBe("2026-03-17");
  });

  test("days:1 advances by 1 day", () => {
    expect(computeNextDue("2026-03-14", "days:1")).toBe("2026-03-15");
  });

  test("days:7 advances by 7 days (same as weekly)", () => {
    expect(computeNextDue("2026-03-14", "days:7")).toBe("2026-03-21");
  });

  test("days:30 advances by 30 days", () => {
    expect(computeNextDue("2026-03-14", "days:30")).toBe("2026-04-13");
  });

  test("days:X handles year rollover correctly", () => {
    expect(computeNextDue("2025-12-20", "days:20")).toBe("2026-01-09");
  });

  test("days:X returns null for invalid format", () => {
    expect(computeNextDue("2026-03-14", "days:abc")).toBeNull();
    expect(computeNextDue("2026-03-14", "days:0")).toBeNull();
    expect(computeNextDue("2026-03-14", "days:-5")).toBeNull();
  });

  test("days:X uses today as base when dueDate is null", () => {
    const expected = dateOffset(5);
    expect(computeNextDue(null, "days:5")).toBe(expected);
  });
});

// ============================================================
// sortTasks
// ============================================================

describe("sortTasks", () => {
  const yesterday = dateOffset(-1);
  const today     = todayStr();
  const tomorrow  = dateOffset(1);
  const nextWeek  = dateOffset(7);

  const tasks = [
    { id: "1", title: "Next week",  dueDate: nextWeek,  completed: false },
    { id: "2", title: "Yesterday",  dueDate: yesterday, completed: false },
    { id: "3", title: "No due",     dueDate: null,      completed: false },
    { id: "4", title: "Today",      dueDate: today,     completed: false },
    { id: "5", title: "Tomorrow",   dueDate: tomorrow,  completed: false },
    { id: "6", title: "Completed",  dueDate: yesterday, completed: true  },
  ];

  test("overdue contains only past incomplete tasks", () => {
    const { overdue } = sortTasks(tasks);
    expect(overdue.map(t => t.id)).toEqual(["2"]);
  });

  test("upcoming contains today and future incomplete tasks, sorted earliest first", () => {
    const { upcoming } = sortTasks(tasks);
    expect(upcoming.map(t => t.id)).toEqual(["4", "5", "1"]);
  });

  test("noDue contains incomplete tasks with no due date", () => {
    const { noDue } = sortTasks(tasks);
    expect(noDue.map(t => t.id)).toEqual(["3"]);
  });

  test("completed tasks are excluded from all sections", () => {
    const { overdue, upcoming, noDue } = sortTasks(tasks);
    const allIds = [...overdue, ...upcoming, ...noDue].map(t => t.id);
    expect(allIds).not.toContain("6");
  });

  test("overdue sorted earliest first", () => {
    const twoDaysAgo = dateOffset(-2);
    const multi = [
      { id: "a", dueDate: yesterday,  completed: false },
      { id: "b", dueDate: twoDaysAgo, completed: false },
    ];
    const { overdue } = sortTasks(multi);
    expect(overdue.map(t => t.id)).toEqual(["b", "a"]);
  });
});

// ============================================================
// filterTasks
// ============================================================

describe("filterTasks", () => {
  const tasks = [
    { id: "1", title: "Alice only",    members: ["alice"] },
    { id: "2", title: "Bob only",      members: ["bob"] },
    { id: "3", title: "Alice and Bob", members: ["alice", "bob"] },
    { id: "4", title: "Unassigned",    members: [] },
    { id: "5", title: "Also unassigned", members: null },
  ];

  test("all: returns every task", () => {
    expect(filterTasks(tasks, "all").map(t => t.id)).toEqual(["1","2","3","4","5"]);
  });

  test("member filter: returns tasks assigned to that member", () => {
    expect(filterTasks(tasks, "alice").map(t => t.id)).toEqual(["1","3"]);
    expect(filterTasks(tasks, "bob").map(t => t.id)).toEqual(["2","3"]);
  });

  test("unassigned: returns tasks with empty or null members", () => {
    expect(filterTasks(tasks, "unassigned").map(t => t.id)).toEqual(["4","5"]);
  });

  test("member with no tasks returns empty array", () => {
    expect(filterTasks(tasks, "charlie")).toHaveLength(0);
  });
});
