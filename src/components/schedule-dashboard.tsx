"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TeacherScheduleRow,
  WaitingCaseByCenter,
  WaitingCaseByCourseLineSummary,
  WaitingDetailReport,
  WEEKDAYS,
  WeeklySlot,
} from "@/types/schedule";
import { buildWeeklyMatrix } from "@/lib/google-sheet";

type ActiveModule = "weekly" | "classes" | "report" | "waiting";

type ScheduleDashboardProps = {
  rows: TeacherScheduleRow[];
  slots: WeeklySlot[];
  waitingCasesByCenter: WaitingCaseByCenter[];
  waitingCasesByCourseLineSummary: WaitingCaseByCourseLineSummary[];
  waitingDetailReport: WaitingDetailReport;
};

const WEEKDAY_OFFSET: Record<(typeof WEEKDAYS)[number], number> = {
  T2: 0,
  T3: 1,
  T4: 2,
  T5: 3,
  T6: 4,
  T7: 5,
  CN: 6,
};

const INTENSITY_RANK: Record<string, number> = { Thấp: 1, "Trung bình": 2, Cao: 3 };
const DISPATCH_RANK: Record<string, number> = { "Tập trung": 1, "Trung bình": 2, Rộng: 3 };
const WORKLOAD_RANK: Record<string, number> = { Nhẹ: 1, Vừa: 2, Nặng: 3 };
const CLASS_SIZE_RANK: Record<string, number> = { "Lớp nhỏ": 1, "Lớp trung bình": 2, "Lớp đông": 3 };

type ClassDomain = "coding" | "robotics" | "art" | "default";
type BlockFilter = "coding" | "robotics" | "art";
type SlotFilter = string;

function getClassDomain(className: string): ClassDomain {
  const normalized = className.toUpperCase();

  if (normalized.includes("XART")) return "art";
  if (normalized.includes("ROB") || normalized.includes("KIND")) return "robotics";
  if (normalized.includes("C4K") || normalized.includes("C4T") || normalized.includes("JS") || normalized.includes("CS") || normalized.includes("PT")) {
    return "coding";
  }

  return "default";
}

function getBlocksFromCourseLineValue(courseLineValue: string): BlockFilter[] {
  const tokens = courseLineValue
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const hasArt = tokens.some((token) => token === "XART" || token === "ART");
  // Art is exclusive and does not share data with Coding/Robotics.
  if (hasArt) {
    return ["art"];
  }

  const blocks = new Set<BlockFilter>();
  for (const token of tokens) {
    if (token === "C4K" || token === "C4T" || token === "JS" || token === "CS" || token === "PT") {
      blocks.add("coding");
    }
    if (token === "ROB" || token === "KIND") {
      blocks.add("robotics");
    }
    if (token === "XART" || token === "ART") {
      blocks.add("art");
    }
  }

  return Array.from(blocks);
}

function getEffectiveWaitingBlocks(selectedBlocks: BlockFilter[]): Set<BlockFilter> {
  return new Set<BlockFilter>(selectedBlocks);
}

function normalizeSummaryCourseLineLabel(courseLineValue: string): string {
  const tokens = courseLineValue
    .toUpperCase()
    .split(/[;,]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) return "Khong ro";

  // Art rows like "XART" and "XART; XART" should be treated as one group.
  if (tokens.every((token) => token === "XART" || token === "ART")) {
    return "XART";
  }

  const uniqueTokens: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (!seen.has(token)) {
      seen.add(token);
      uniqueTokens.push(token);
    }
  }

  return uniqueTokens.join("; ");
}

function groupEntriesByCenter(entries: TeacherScheduleRow[]) {
  const grouped = new Map<string, TeacherScheduleRow[]>();

  entries.forEach((entry) => {
    const center = entry.centerName?.trim() || "Chưa rõ cơ sở";
    if (!grouped.has(center)) grouped.set(center, []);
    grouped.get(center)!.push(entry);
  });

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([centerName, rows]) => ({ centerName, rows }));
}

function toDisplayDateFromIso(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  const day = String(parsed.getUTCDate()).padStart(2, "0");
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const year = parsed.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function getWeekdayDateLabel(weekKey: string, weekday: (typeof WEEKDAYS)[number]): string {
  if (!weekKey) return weekday;
  const weekStart = new Date(`${weekKey}T00:00:00Z`);
  if (Number.isNaN(weekStart.getTime())) return weekday;
  const actualDate = new Date(weekStart.getTime() + WEEKDAY_OFFSET[weekday] * 24 * 60 * 60 * 1000);
  return toDisplayDateFromIso(actualDate.toISOString().slice(0, 10));
}

function getCurrentWeekKey(): string {
  const now = new Date();
  const utcDay = now.getUTCDay();
  const diffToMonday = utcDay === 0 ? -6 : 1 - utcDay;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diffToMonday));
  return monday.toISOString().slice(0, 10);
}

function percentText(numerator: number, denominator: number): string {
  if (denominator <= 0) return "-";
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

function dateKey(dateText: string): number {
  const match = dateText.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[3]) * 10000 + Number(match[2]) * 100 + Number(match[1]);
}

function parsePercentValue(rateText: string): number {
  const normalized = rateText.replace(/[^0-9.]/g, "");
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isUnknownLabel(value: string): boolean {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  return normalized.includes("khongro") || normalized.includes("unknown");
}

function waitingToneClass(value: number, maxValue: number): string {
  if (value <= 0 || maxValue <= 0) return "waiting-tone-0";
  const ratio = value / maxValue;
  if (ratio >= 0.75) return "waiting-tone-3";
  if (ratio >= 0.45) return "waiting-tone-2";
  return "waiting-tone-1";
}

function displayCount(value: number): string {
  return value === 0 ? "" : String(value);
}

export default function ScheduleDashboard({
  rows: initialRows,
  slots: initialSlots,
  waitingCasesByCenter: initialWaitingCasesByCenter,
  waitingCasesByCourseLineSummary: initialWaitingCasesByCourseLineSummary,
  waitingDetailReport: initialWaitingDetailReport,
}: ScheduleDashboardProps) {
  const [activeModule, setActiveModule] = useState<ActiveModule>("weekly");
  const [weeklyTeacherSearch, setWeeklyTeacherSearch] = useState("");
  const [selectedCenters, setSelectedCenters] = useState<string[]>([]);
  const [selectedBlocks, setSelectedBlocks] = useState<BlockFilter[]>([]);
  const [selectedSlots, setSelectedSlots] = useState<SlotFilter[]>([]);
  const [showRunningOnly, setShowRunningOnly] = useState(true);
  const [compactWeekView, setCompactWeekView] = useState(false);
  const [classSearch, setClassSearch] = useState("");
  const [classTeacherSearch, setClassTeacherSearch] = useState("");
  const [classDateFrom, setClassDateFrom] = useState("");
  const [classDateTo, setClassDateTo] = useState("");
  const [freeModal, setFreeModal] = useState<{ freeKey: string; domain: string; slot: string; day: string; centre: string } | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<TeacherScheduleRow | null>(null);

  // Live data state
  const [rows, setRows] = useState<TeacherScheduleRow[]>(initialRows);
  const [slots, setSlots] = useState<WeeklySlot[]>(initialSlots);
  const [waitingCasesByCenter, setWaitingCasesByCenter] = useState<WaitingCaseByCenter[]>(initialWaitingCasesByCenter);
  const [waitingCasesByCourseLineSummary, setWaitingCasesByCourseLineSummary] = useState<WaitingCaseByCourseLineSummary[]>(initialWaitingCasesByCourseLineSummary);
  const [waitingDetailReport, setWaitingDetailReport] = useState<WaitingDetailReport>(initialWaitingDetailReport);
  const [lastUpdated, setLastUpdated] = useState<Date>(() => new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");

  const fetchLatest = useCallback(async () => {
    setIsRefreshing(true);
    setRefreshError("");
    try {
      const res = await fetch("/api/schedule", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as {
        rows: TeacherScheduleRow[];
        slots: WeeklySlot[];
        waitingCasesByCenter: WaitingCaseByCenter[];
        waitingCasesByCourseLineSummary: WaitingCaseByCourseLineSummary[];
        waitingDetailReport: WaitingDetailReport;
      };
      setRows(data.rows);
      setSlots(data.slots);
      setWaitingCasesByCenter(data.waitingCasesByCenter ?? []);
      setWaitingCasesByCourseLineSummary(data.waitingCasesByCourseLineSummary ?? []);
      setWaitingDetailReport(data.waitingDetailReport ?? {
        totalCases: 0,
        totalWaitingCases: 0,
        overallWaitingRate: "-",
        centerCount: 0,
        cases: [],
        byCenter: [],
        byType: [],
        byCourseLine: [],
        byDate: [],
      });
      setLastUpdated(new Date());
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : "Lỗi kết nối");
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const centerOptions = useMemo(() => {
    return Array.from(new Set(rows.map((row) => row.centerName).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b),
    );
  }, [rows]);

  const filteredRows = useMemo(() => {
    let filtered = selectedCenters.length > 0
      ? rows.filter((row) => selectedCenters.includes(row.centerName || ""))
      : rows;

    if (selectedBlocks.length > 0) {
      filtered = filtered.filter((row) => selectedBlocks.includes(getClassDomain(row.className || "") as BlockFilter));
    }
    if (showRunningOnly) filtered = filtered.filter((row) => row.status === "RUNNING");
    return filtered;
  }, [rows, selectedCenters, selectedBlocks, showRunningOnly]);

  const weeklyRows = useMemo(() => {
    const keyword = weeklyTeacherSearch.trim().toLowerCase();
    if (!keyword) return filteredRows;

    return filteredRows.filter((row) => {
      const teacherPool = [
        row.teacherName,
        row.teacherCode,
        ...row.teacherNames,
        row.taName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return teacherPool.includes(keyword);
    });
  }, [filteredRows, weeklyTeacherSearch]);

  const toggleBlockSelection = (block: BlockFilter) => {
    setSelectedBlocks((prev) => (prev.includes(block) ? prev.filter((item) => item !== block) : [...prev, block]));
  };

  const toggleCenterSelection = (center: string) => {
    setSelectedCenters((prev) => (prev.includes(center) ? prev.filter((item) => item !== center) : [...prev, center]));
  };

  const toggleSlotSelection = (slotLabel: string) => {
    setSelectedSlots((prev) => (prev.includes(slotLabel) ? prev.filter((item) => item !== slotLabel) : [...prev, slotLabel]));
  };

  const weekOptions = useMemo(() => {
    const uniqueByKey = new Map<string, string>();
    filteredRows.forEach((row) => {
      if (row.weekKey && row.weekLabel) uniqueByKey.set(row.weekKey, row.weekLabel);
    });
    return Array.from(uniqueByKey.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, label]) => ({ key, label }));
  }, [filteredRows]);

  const [selectedWeekKey, setSelectedWeekKey] = useState(getCurrentWeekKey);

  const activeWeekKey = useMemo(() => {
    if (weekOptions.some((week) => week.key === selectedWeekKey)) return selectedWeekKey;
    const todayWeekKey = getCurrentWeekKey();
    const nearestFuture = weekOptions.find((week) => week.key >= todayWeekKey);
    if (nearestFuture) return nearestFuture.key;
    return weekOptions[weekOptions.length - 1]?.key ?? "";
  }, [weekOptions, selectedWeekKey]);

  const weeklyMatrix = useMemo(
    () => buildWeeklyMatrix(weeklyRows, slots, activeWeekKey),
    [weeklyRows, slots, activeWeekKey],
  );

  const visibleWeeklyMatrix = useMemo(() => {
    if (selectedSlots.length === 0) return weeklyMatrix;
    return weeklyMatrix.filter((line) => selectedSlots.includes(line.slot.label));
  }, [weeklyMatrix, selectedSlots]);

  type FreeTeacherEntry = { name: string; teacherKey: string; daysActive: Set<string>; centresActive: Set<string> };

  // For each (domain, fixedSlotLabel, weekday): list of teachers who have NO class in that slot+day.
  const freeTeachersBySlot = useMemo(() => {
    const weekRows = activeWeekKey ? filteredRows.filter((r) => r.weekKey === activeWeekKey) : filteredRows;

    const allTeachersByDomain = new Map<ClassDomain, Map<string, string>>(); // domain → Map<key, displayName>
    const busySet = new Map<string, Set<string>>(); // "domain|slot|day" → Set<teacherKey>
    const teacherActivity = new Map<string, { daysActive: Set<string>; centresActive: Set<string> }>();

    for (const row of weekRows) {
      const domain = getClassDomain(row.className || "");
      if (domain === "default") continue;
      const teacherKey = row.teacherCode || row.teacherName;
      if (!teacherKey) continue;
      const displayName = row.teacherName || row.teacherCode;

      if (!allTeachersByDomain.has(domain)) allTeachersByDomain.set(domain, new Map());
      allTeachersByDomain.get(domain)!.set(teacherKey, displayName);

      const slotDayKey = `${domain}|${row.fixedSlotLabel}|${row.weekday}`;
      if (!busySet.has(slotDayKey)) busySet.set(slotDayKey, new Set());
      busySet.get(slotDayKey)!.add(teacherKey);

      if (!teacherActivity.has(teacherKey)) teacherActivity.set(teacherKey, { daysActive: new Set(), centresActive: new Set() });
      const act = teacherActivity.get(teacherKey)!;
      act.daysActive.add(row.weekday);
      if (row.centerName) act.centresActive.add(row.centerName);
    }

    const result = new Map<string, FreeTeacherEntry[]>();
    allTeachersByDomain.forEach((teacherMap, domain) => {
      const slotLabels = new Set<string>();
      weekRows.forEach((r) => { if (getClassDomain(r.className || "") === domain) slotLabels.add(r.fixedSlotLabel); });
      WEEKDAYS.forEach((day) => {
        slotLabels.forEach((slot) => {
          const key = `${domain}|${slot}|${day}`;
          const busy = busySet.get(key) ?? new Set<string>();
          const free: FreeTeacherEntry[] = [];
          teacherMap.forEach((displayName, teacherKey) => {
            if (!busy.has(teacherKey)) {
              const act = teacherActivity.get(teacherKey);
              free.push({ name: displayName, teacherKey, daysActive: act?.daysActive ?? new Set(), centresActive: act?.centresActive ?? new Set() });
            }
          });
          free.sort((a, b) => a.name.localeCompare(b.name));
          if (free.length > 0) result.set(key, free);
        });
      });
    });

    return result;
  }, [filteredRows, activeWeekKey]);

  const sidebarKpiRows = useMemo(() => {
    if (selectedSlots.length === 0) return filteredRows;
    return filteredRows.filter((row) => selectedSlots.includes(row.fixedSlotLabel));
  }, [filteredRows, selectedSlots]);

  const sidebarKpis = useMemo(() => {
    const classCount = new Set(sidebarKpiRows.map((row) => row.className).filter(Boolean)).size;
    const teacherCount = new Set(
      sidebarKpiRows
        .map((row) => row.teacherCode || row.teacherName)
        .filter(Boolean),
    ).size;
    const buCount = new Set(sidebarKpiRows.map((row) => row.centerName).filter(Boolean)).size;

    return { classCount, teacherCount, buCount };
  }, [sidebarKpiRows]);

  type ClassSummaryRow = {
    className: string;
    teacherName: string;
    teacherCode: string;
    taName: string;
    centerName: string;
    weekday: string;
    slotLabel: string;
    status: string;
    course: string;
    termStartDate: string;
    termEndDate: string;
    sessionCount: number;
    sessionDateKeys: string[];
  };

  const classSummary = useMemo(() => {
    const map = new Map<string, ClassSummaryRow>();
    filteredRows.forEach((row) => {
      if (!map.has(row.className)) {
        map.set(row.className, {
          className: row.className,
          teacherName: row.teacherName,
          teacherCode: row.teacherCode,
          taName: row.taName,
          centerName: row.centerName,
          weekday: row.weekday,
          slotLabel: row.slotLabel,
          status: row.status,
          course: row.course,
          termStartDate: row.termStartDate,
          termEndDate: row.termEndDate,
          sessionCount: 1,
          sessionDateKeys: [row.sessionDateKey],
        });
      } else {
        const entry = map.get(row.className)!;
        entry.sessionCount++;
        entry.sessionDateKeys.push(row.sessionDateKey);
      }
    });
    const keyword = classSearch.trim().toLowerCase();
    const teacherKeyword = classTeacherSearch.trim().toLowerCase();
    return Array.from(map.values())
      .filter((c) => !keyword || c.className.toLowerCase().includes(keyword))
      .filter((c) => !teacherKeyword || [c.teacherName, c.teacherCode, c.taName].join(" ").toLowerCase().includes(teacherKeyword))
      .filter((c) => {
        if (!classDateFrom && !classDateTo) return true;
        return c.sessionDateKeys.some((d) => {
          if (classDateFrom && d < classDateFrom) return false;
          if (classDateTo && d > classDateTo) return false;
          return true;
        });
      })
      .sort((a, b) => a.className.localeCompare(b.className));
  }, [filteredRows, classSearch, classTeacherSearch, classDateFrom, classDateTo]);

  type TimeSlotSummaryRow = {
    slotLabel: string;
    period: string;
    classCount: number;
    teacherCount: number;
    classPerTeacher: number;
    intensityLevel: string;
    percent: number;
  };

  type TeacherDispatchRow = {
    teacherName: string;
    teacherCode: string;
    classCount: number;
    weeklyHours: number;
    totalStudents: number;
    avgStudentsPerClass: number;
    avgStudentsPerHour: number;
    centerCount: number;
    slotCount: number;
    conflictCount: number;
    dispatchScope: string;
    workloadLevel: string;
    classSizeLevel: string;
  };

  type SortDirection = "asc" | "desc";
  type TimeSlotSortKey = "slotLabel" | "classCount" | "teacherCount" | "classPerTeacher" | "intensityLevel" | "percent";
  type TeacherSortKey =
    | "teacherName"
    | "teacherCode"
    | "classCount"
    | "weeklyHours"
    | "totalStudents"
    | "avgStudentsPerClass"
    | "avgStudentsPerHour"
    | "centerCount"
    | "slotCount"
    | "conflictCount"
    | "dispatchScope"
    | "workloadLevel"
    | "classSizeLevel";

  const [timeSlotSort, setTimeSlotSort] = useState<{ key: TimeSlotSortKey; direction: SortDirection }>({
    key: "classCount",
    direction: "desc",
  });
  const [teacherSort, setTeacherSort] = useState<{ key: TeacherSortKey; direction: SortDirection }>({
    key: "weeklyHours",
    direction: "desc",
  });

  const [tableColumnWidths, setTableColumnWidths] = useState<Record<string, number[]>>({});
  const resizeSessionRef = useRef<{
    tableKey: string;
    colIndex: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  const handleTableMouseDown = useCallback((event: React.MouseEvent<HTMLTableElement>, tableKey: string) => {
    const target = event.target as HTMLElement;
    const th = target.closest("th") as HTMLTableCellElement | null;

    if (!th || !event.currentTarget.contains(th)) return;

    const bounds = th.getBoundingClientRect();
    const distanceToRightEdge = bounds.right - event.clientX;
    if (distanceToRightEdge > 10) return;

    const headerRow = th.parentElement;
    if (!headerRow) return;

    const colIndex = Array.from(headerRow.children).indexOf(th);
    if (colIndex < 0) return;

    // Keep weekly time-slot column compact and non-resizable.
    if (tableKey === "weekly" && colIndex === 0) return;

    const currentWidth = tableColumnWidths[tableKey]?.[colIndex] ?? bounds.width;
    resizeSessionRef.current = {
      tableKey,
      colIndex,
      startX: event.clientX,
      startWidth: currentWidth,
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    event.preventDefault();
  }, [tableColumnWidths]);

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const session = resizeSessionRef.current;
      if (!session) return;

      const deltaX = event.clientX - session.startX;
      const nextWidth = Math.max(90, Math.round(session.startWidth + deltaX));

      setTableColumnWidths((prev) => {
        const existing = prev[session.tableKey] ?? [];
        if (existing[session.colIndex] === nextWidth) return prev;

        const updated = [...existing];
        updated[session.colIndex] = nextWidth;
        return { ...prev, [session.tableKey]: updated };
      });
    };

    const onMouseUp = () => {
      if (!resizeSessionRef.current) return;
      resizeSessionRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const renderTableColGroup = (tableKey: string, columnCount: number) => (
    <colgroup>
      {Array.from({ length: columnCount }).map((_, index) => {
        const width = tableColumnWidths[tableKey]?.[index];
        return <col key={`${tableKey}-${index}`} style={width ? { width: `${width}px` } : undefined} />;
      })}
    </colgroup>
  );

  const sortIcon = (isActive: boolean, direction: SortDirection) => {
    if (!isActive) return "↕";
    return direction === "asc" ? "▲" : "▼";
  };

  const toggleTimeSlotSort = (key: TimeSlotSortKey) => {
    setTimeSlotSort((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
      }

      const defaultDirection: SortDirection = key === "slotLabel" || key === "intensityLevel" ? "asc" : "desc";
      return { key, direction: defaultDirection };
    });
  };

  const toggleTeacherSort = (key: TeacherSortKey) => {
    setTeacherSort((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
      }

      const defaultDirection: SortDirection = key === "teacherName" || key === "teacherCode" ? "asc" : "desc";
      return { key, direction: defaultDirection };
    });
  };

  const reportWeekLabel = useMemo(() => {
    const found = weekOptions.find((week) => week.key === activeWeekKey);
    return found?.label ?? "Toàn bộ dữ liệu";
  }, [weekOptions, activeWeekKey]);

  const reportData = useMemo(() => {
    const reportRows = activeWeekKey ? filteredRows.filter((row) => row.weekKey === activeWeekKey) : filteredRows;
    const totalClasses = new Set(reportRows.map((row) => row.className).filter(Boolean)).size;

    const timeSlotRows: TimeSlotSummaryRow[] = slots.map((slot) => {
      const slotRows = reportRows.filter((row) => row.fixedSlotLabel === slot.label);
      const classCount = new Set(slotRows.map((row) => row.className).filter(Boolean)).size;
      const teacherSet = new Set<string>();
      slotRows.forEach((row) => {
        const names = row.teacherNames.length > 0 ? row.teacherNames : [row.teacherName || "Chưa phân công"];
        names.forEach((name) => teacherSet.add(name));
      });
      const teacherCount = teacherSet.size;
      const classPerTeacher = teacherCount === 0 ? 0 : Number((classCount / teacherCount).toFixed(2));

      let intensityLevel = "Thấp";
      if (classPerTeacher >= 2.5) {
        intensityLevel = "Cao";
      } else if (classPerTeacher >= 1.5) {
        intensityLevel = "Trung bình";
      }

      return {
        slotLabel: slot.label,
        period: slot.period,
        classCount,
        teacherCount,
        classPerTeacher,
        intensityLevel,
        percent: totalClasses === 0 ? 0 : Math.round((classCount / totalClasses) * 100),
      };
    });

    const teacherMap = new Map<string, TeacherDispatchRow>();
    const classSetByTeacher = new Map<string, Set<string>>();
    const classStudentByTeacher = new Map<string, Map<string, number>>();
    const centerSetByTeacher = new Map<string, Set<string>>();
    const slotSetByTeacher = new Map<string, Set<string>>();
    const conflictCounter = new Map<string, number>();

    reportRows.forEach((row) => {
      const teacherKey = row.teacherCode || row.teacherName || "UNASSIGNED";
      const conflictKey = `${teacherKey}|${row.sessionDateKey}|${row.fixedSlotLabel}`;

      if (!teacherMap.has(teacherKey)) {
        teacherMap.set(teacherKey, {
          teacherName: row.teacherName || "Chưa phân công",
          teacherCode: row.teacherCode || "-",
          classCount: 0,
          weeklyHours: 0,
          totalStudents: 0,
          avgStudentsPerClass: 0,
          avgStudentsPerHour: 0,
          centerCount: 0,
          slotCount: 0,
          conflictCount: 0,
          dispatchScope: "",
          workloadLevel: "",
          classSizeLevel: "",
        });
      }

      if (!classSetByTeacher.has(teacherKey)) classSetByTeacher.set(teacherKey, new Set<string>());
      if (!classStudentByTeacher.has(teacherKey)) classStudentByTeacher.set(teacherKey, new Map<string, number>());
      if (!centerSetByTeacher.has(teacherKey)) centerSetByTeacher.set(teacherKey, new Set<string>());
      if (!slotSetByTeacher.has(teacherKey)) slotSetByTeacher.set(teacherKey, new Set<string>());

      classSetByTeacher.get(teacherKey)!.add(row.className || "-");
      classStudentByTeacher.get(teacherKey)!.set(row.className || "-", row.studentCount || 0);
      centerSetByTeacher.get(teacherKey)!.add(row.centerName || "-");
      slotSetByTeacher.get(teacherKey)!.add(row.fixedSlotLabel || row.slotLabel || "-");

      conflictCounter.set(conflictKey, (conflictCounter.get(conflictKey) ?? 0) + 1);
    });

    teacherMap.forEach((record, teacherKey) => {
      record.classCount = classSetByTeacher.get(teacherKey)?.size ?? 0;
      record.weeklyHours = record.classCount * 2;
      record.centerCount = centerSetByTeacher.get(teacherKey)?.size ?? 0;
      record.slotCount = slotSetByTeacher.get(teacherKey)?.size ?? 0;

      const studentMap = classStudentByTeacher.get(teacherKey);
      let totalStudents = 0;
      studentMap?.forEach((value) => {
        totalStudents += value;
      });
      record.totalStudents = totalStudents;
      record.avgStudentsPerClass = record.classCount === 0 ? 0 : Number((totalStudents / record.classCount).toFixed(1));
      record.avgStudentsPerHour = record.weeklyHours === 0 ? 0 : Number((totalStudents / record.weeklyHours).toFixed(2));

      let conflicts = 0;
      conflictCounter.forEach((value, key) => {
        if (key.startsWith(`${teacherKey}|`) && value > 1) {
          conflicts += value - 1;
        }
      });
      record.conflictCount = conflicts;

      if (record.centerCount >= 3 || record.slotCount >= 4) {
        record.dispatchScope = "Rộng";
      } else if (record.centerCount >= 2 || record.slotCount >= 3) {
        record.dispatchScope = "Trung bình";
      } else {
        record.dispatchScope = "Tập trung";
      }

      if (record.weeklyHours >= 16) {
        record.workloadLevel = "Nặng";
      } else if (record.weeklyHours >= 10) {
        record.workloadLevel = "Vừa";
      } else {
        record.workloadLevel = "Nhẹ";
      }

      if (record.avgStudentsPerClass >= 20) {
        record.classSizeLevel = "Lớp đông";
      } else if (record.avgStudentsPerClass >= 12) {
        record.classSizeLevel = "Lớp trung bình";
      } else {
        record.classSizeLevel = "Lớp nhỏ";
      }
    });

    const teacherRows = Array.from(teacherMap.values()).sort(
      (a, b) => b.weeklyHours - a.weeklyHours || b.classCount - a.classCount || a.teacherName.localeCompare(b.teacherName),
    );

    return {
      totalClasses,
      totalSessions: reportRows.length,
      totalTeachers: teacherRows.length,
      timeSlotRows,
      teacherRows,
    };
  }, [filteredRows, slots, activeWeekKey]);

  const sortedTimeSlotRows = useMemo(() => {
    const rows = [...reportData.timeSlotRows];
    rows.sort((a, b) => {
      const directionFactor = timeSlotSort.direction === "asc" ? 1 : -1;
      let compare = 0;

      if (timeSlotSort.key === "intensityLevel") {
        compare = (INTENSITY_RANK[a.intensityLevel] ?? 0) - (INTENSITY_RANK[b.intensityLevel] ?? 0);
      } else if (timeSlotSort.key === "slotLabel") {
        compare = a.slotLabel.localeCompare(b.slotLabel);
      } else {
        const aValue = a[timeSlotSort.key] as number;
        const bValue = b[timeSlotSort.key] as number;
        compare = aValue - bValue;
      }

      return compare * directionFactor;
    });
    return rows;
  }, [reportData.timeSlotRows, timeSlotSort]);

  const sortedTeacherRows = useMemo(() => {
    const rows = [...reportData.teacherRows];
    rows.sort((a, b) => {
      const directionFactor = teacherSort.direction === "asc" ? 1 : -1;
      let compare = 0;

      if (teacherSort.key === "dispatchScope") {
        compare = (DISPATCH_RANK[a.dispatchScope] ?? 0) - (DISPATCH_RANK[b.dispatchScope] ?? 0);
      } else if (teacherSort.key === "workloadLevel") {
        compare = (WORKLOAD_RANK[a.workloadLevel] ?? 0) - (WORKLOAD_RANK[b.workloadLevel] ?? 0);
      } else if (teacherSort.key === "classSizeLevel") {
        compare = (CLASS_SIZE_RANK[a.classSizeLevel] ?? 0) - (CLASS_SIZE_RANK[b.classSizeLevel] ?? 0);
      } else if (teacherSort.key === "teacherName" || teacherSort.key === "teacherCode") {
        compare = String(a[teacherSort.key]).localeCompare(String(b[teacherSort.key]));
      } else {
        const aValue = Number(a[teacherSort.key]);
        const bValue = Number(b[teacherSort.key]);
        compare = aValue - bValue;
      }

      return compare * directionFactor;
    });
    return rows;
  }, [reportData.teacherRows, teacherSort]);

  const waitingSummaryBaseRows = useMemo(() => {
    const effectiveSelectedBlocks = getEffectiveWaitingBlocks(selectedBlocks);
    if (effectiveSelectedBlocks.size === 0) {
      return waitingCasesByCenter;
    }
    const centerCounter = new Map<string, number>();

    for (const row of waitingCasesByCourseLineSummary) {
      const blocks = getBlocksFromCourseLineValue(row.courseLines);
      if (!blocks.some((block) => effectiveSelectedBlocks.has(block))) {
        continue;
      }

      for (const [centerName, count] of Object.entries(row.centerCounts)) {
        centerCounter.set(centerName, (centerCounter.get(centerName) ?? 0) + count);
      }
    }

    return Array.from(centerCounter.entries())
      .filter(([, waitingCaseCount]) => waitingCaseCount > 0)
      .map(([centerName, waitingCaseCount]) => ({
        centerName,
        waitingCaseCount,
        waitingRate: "-",
      }))
      .sort((a, b) => b.waitingCaseCount - a.waitingCaseCount || a.centerName.localeCompare(b.centerName));
  }, [waitingCasesByCenter, waitingCasesByCourseLineSummary, selectedBlocks]);

  const waitingSummaryRows = useMemo(() => {
    if (selectedCenters.length === 0) return waitingSummaryBaseRows;
    return waitingSummaryBaseRows.filter((row) => selectedCenters.includes(row.centerName));
  }, [waitingSummaryBaseRows, selectedCenters]);

  const waitingCasesFiltered = useMemo(() => {
    let rows = selectedCenters.length === 0
      ? waitingDetailReport.cases
      : waitingDetailReport.cases.filter((row) => selectedCenters.includes(row.centerName));

    const effectiveSelectedBlocks = getEffectiveWaitingBlocks(selectedBlocks);
    if (effectiveSelectedBlocks.size > 0) {
      rows = rows.filter((row) => {
        const rowBlocks = new Set<BlockFilter>();
        const courseLineValues = row.courseLines.length > 0 ? row.courseLines : ["Khong ro"];
        for (const value of courseLineValues) {
          for (const block of getBlocksFromCourseLineValue(value)) {
            rowBlocks.add(block);
          }
        }
        return Array.from(rowBlocks).some((block) => effectiveSelectedBlocks.has(block));
      });
    }

    return rows;
  }, [waitingDetailReport.cases, selectedCenters, selectedBlocks]);

  const waitingBlockTotals = useMemo(() => {
    const totals: Record<BlockFilter, number> = { coding: 0, robotics: 0, art: 0 };

    for (const row of waitingCasesByCourseLineSummary) {
      const blocks = getBlocksFromCourseLineValue(row.courseLines);
      if (blocks.length === 0) continue;

      const rowTotal = selectedCenters.length > 0
        ? selectedCenters.reduce((sum, centerName) => sum + (row.centerCounts[centerName] ?? 0), 0)
        : Object.values(row.centerCounts).reduce((sum, value) => sum + value, 0);

      if (rowTotal <= 0) continue;
      for (const block of blocks) {
        totals[block] += rowTotal;
      }
    }

    return totals;
  }, [waitingCasesByCourseLineSummary, selectedCenters]);

  const waitingTotalCases = useMemo(
    () => waitingSummaryRows.reduce((sum, item) => sum + item.waitingCaseCount, 0),
    [waitingSummaryRows],
  );

  const waitingByCenterRows = useMemo(() => {
    const detailCounter = new Map<string, { waiting: number; total: number }>();
    for (const item of waitingCasesFiltered) {
      if (!detailCounter.has(item.centerName)) {
        detailCounter.set(item.centerName, { waiting: 0, total: 0 });
      }
      detailCounter.get(item.centerName)!.total += 1;
      if (item.outcomeStatus === "WAITING") {
        detailCounter.get(item.centerName)!.waiting += 1;
      }
    }

    const summaryMap = new Map(waitingSummaryRows.map((item) => [item.centerName, item]));
    const centerNames = new Set<string>([
      ...Array.from(detailCounter.keys()),
      ...Array.from(summaryMap.keys()),
    ]);

    return Array.from(centerNames)
      .map((centerName) => {
        const detail = detailCounter.get(centerName) ?? { waiting: 0, total: 0 };
        const summary = summaryMap.get(centerName);
        const summaryWaiting = summary?.waitingCaseCount ?? 0;
        return {
          centerName,
          detailWaitingCases: detail.waiting,
          detailTotalCases: detail.total,
          detailWaitingRate: percentText(detail.waiting, detail.total),
          summaryWaitingCases: summaryWaiting,
          summaryWaitingRate: summary?.waitingRate ?? "-",
          deltaCases: detail.waiting - summaryWaiting,
        };
      })
      .sort((a, b) => b.detailWaitingCases - a.detailWaitingCases || a.centerName.localeCompare(b.centerName));
  }, [waitingCasesFiltered, waitingSummaryRows]);

  const waitingByTypeRows = useMemo(() => {
    const counter = new Map<string, { waiting: number; total: number }>();
    for (const item of waitingCasesFiltered) {
      const key = item.type || "Khong ro";
      if (!counter.has(key)) counter.set(key, { waiting: 0, total: 0 });
      counter.get(key)!.total += 1;
      if (item.outcomeStatus === "WAITING") counter.get(key)!.waiting += 1;
    }
    return Array.from(counter.entries())
      .map(([type, value]) => ({
        type,
        waitingCases: value.waiting,
        totalCases: value.total,
        waitingRate: percentText(value.waiting, value.total),
      }))
      .sort((a, b) => b.waitingCases - a.waitingCases || a.type.localeCompare(b.type));
  }, [waitingCasesFiltered]);

  const waitingCenterColumns = useMemo(() => {
    return waitingByCenterRows
      .filter((row) => row.detailWaitingCases > 0 || row.summaryWaitingCases > 0)
      .map((row) => row.centerName);
  }, [waitingByCenterRows]);

  const waitingCourseSummaryRows = useMemo(() => {
    const effectiveSelectedBlocks = getEffectiveWaitingBlocks(selectedBlocks);
    const merged = new Map<string, Record<string, number>>();

    for (const row of waitingCasesByCourseLineSummary) {
      if (effectiveSelectedBlocks.size > 0) {
        const blocks = getBlocksFromCourseLineValue(row.courseLines);
        if (!blocks.some((block) => effectiveSelectedBlocks.has(block))) {
          continue;
        }
      }

      const normalizedCourseLine = normalizeSummaryCourseLineLabel(row.courseLines);
      const currentCounts = merged.get(normalizedCourseLine) ?? {};

      const centerCounts = selectedCenters.length > 0
        ? Object.fromEntries(
          selectedCenters.map((centerName) => [centerName, row.centerCounts[centerName] ?? 0]),
        )
        : row.centerCounts;

      for (const [centerName, count] of Object.entries(centerCounts)) {
        currentCounts[centerName] = (currentCounts[centerName] ?? 0) + count;
      }

      merged.set(normalizedCourseLine, currentCounts);
    }

    return Array.from(merged.entries())
      .map(([courseLines, centerCounts]) => ({
        courseLines,
        centerCounts,
        totalCases: Object.values(centerCounts).reduce((sum, value) => sum + value, 0),
      }))
      .filter((row) => row.totalCases > 0)
      .sort((a, b) => b.totalCases - a.totalCases || a.courseLines.localeCompare(b.courseLines));
  }, [waitingCasesByCourseLineSummary, selectedBlocks, selectedCenters]);

  const waitingByCourseRows = useMemo(() => {
    return waitingCourseSummaryRows
      .map((row) => ({ courseLine: row.courseLines, waitingCases: row.totalCases }))
      .sort((a, b) => b.waitingCases - a.waitingCases || a.courseLine.localeCompare(b.courseLine));
  }, [waitingCourseSummaryRows]);

  const waitingCourseColumns = useMemo(() => {
    return waitingByCourseRows.map((row) => row.courseLine);
  }, [waitingByCourseRows]);

  const waitingByCenterCourseRows = useMemo(() => {
    const centerNames = selectedCenters.length > 0
      ? selectedCenters
      : waitingSummaryRows.map((row) => row.centerName);

    return Array.from(new Set(centerNames))
      .map((centerName) => {
        const counts: Record<string, number> = {};
        let total = 0;

        for (const courseLine of waitingCourseColumns) {
          const sourceRow = waitingCourseSummaryRows.find((row) => row.courseLines === courseLine);
          const value = sourceRow?.centerCounts[centerName] ?? 0;
          counts[courseLine] = value;
          total += value;
        }

        return { centerName, counts, total };
      })
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total || a.centerName.localeCompare(b.centerName));
  }, [selectedCenters, waitingSummaryRows, waitingCourseColumns, waitingCourseSummaryRows]);

  const waitingCourseCellMax = useMemo(() => {
    return Math.max(
      ...waitingByCenterCourseRows.flatMap((row) => waitingCourseColumns.map((courseLine) => row.counts[courseLine] ?? 0)),
      0,
    );
  }, [waitingByCenterCourseRows, waitingCourseColumns]);

  const waitingCourseHeatmapRows = useMemo(() => {
    const topCourses = waitingByCourseRows.slice(0, 12);
    return topCourses.map((course) => {
      const cells = waitingCenterColumns.map((centerName) => {
        const centerRow = waitingByCenterCourseRows.find((row) => row.centerName === centerName);
        const value = centerRow?.counts[course.courseLine] ?? 0;
        return { centerName, value };
      });

      return {
        courseLine: course.courseLine,
        total: course.waitingCases,
        cells,
      };
    });
  }, [waitingByCourseRows, waitingCenterColumns, waitingByCenterCourseRows]);

  const waitingHeatmapCenterTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const centerName of waitingCenterColumns) {
      totals[centerName] = waitingCourseHeatmapRows.reduce((sum, row) => {
        const cell = row.cells.find((item) => item.centerName === centerName);
        return sum + (cell?.value ?? 0);
      }, 0);
    }

    const grandTotal = Object.values(totals).reduce((sum, value) => sum + value, 0);
    return { totals, grandTotal };
  }, [waitingCenterColumns, waitingCourseHeatmapRows]);

  const waitingByDateRows = useMemo(() => {
    const counter = new Map<string, number>();
    for (const item of waitingCasesFiltered) {
      if (item.outcomeStatus !== "WAITING") continue;
      const day = item.date || "Khong ro";
      counter.set(day, (counter.get(day) ?? 0) + 1);
    }
    return Array.from(counter.entries())
      .map(([date, waitingCases]) => ({ date, waitingCases }))
      .sort((a, b) => dateKey(a.date) - dateKey(b.date));
  }, [waitingCasesFiltered]);

  const waitingByDateCenterRows = useMemo(() => {
    const matrix = new Map<string, Map<string, number>>();

    for (const item of waitingCasesFiltered) {
      if (item.outcomeStatus !== "WAITING") continue;
      const day = item.date || "Khong ro";
      const center = item.centerName || "Khong ro";
      if (!matrix.has(day)) matrix.set(day, new Map<string, number>());
      const dayMap = matrix.get(day)!;
      dayMap.set(center, (dayMap.get(center) ?? 0) + 1);
    }

    return Array.from(matrix.entries())
      .map(([date, centerMap]) => {
        const counts: Record<string, number> = {};
        let total = 0;
        for (const centerName of waitingCenterColumns) {
          const value = centerMap.get(centerName) ?? 0;
          counts[centerName] = value;
          total += value;
        }
        return { date, counts, total };
      })
      .sort((a, b) => dateKey(a.date) - dateKey(b.date));
  }, [waitingCasesFiltered, waitingCenterColumns]);

  const waitingDetailTotalCases = waitingCasesFiltered.length;
  const waitingDetailTotalWaitingCases = waitingCasesFiltered.filter((item) => item.outcomeStatus === "WAITING").length;
  const waitingOverallRate = percentText(waitingDetailTotalWaitingCases, waitingDetailTotalCases);
  const waitingCenterCount = waitingByCenterRows.filter((row) => row.detailWaitingCases > 0 || row.summaryWaitingCases > 0).length;
  const waitingCenterMax = Math.max(...waitingByCenterRows.map((row) => row.detailWaitingCases), 0);
  const waitingTypeMax = Math.max(...waitingByTypeRows.map((row) => row.waitingCases), 0);
  const waitingCourseMax = Math.max(...waitingByCourseRows.map((row) => row.waitingCases), 0);
  const waitingDayTotalMax = Math.max(...waitingByDateCenterRows.map((row) => row.total), 0);

  const waitingCenterChartRows = useMemo(() => {
    const rows = waitingByCenterRows
      .filter((row) => row.detailWaitingCases > 0 || row.summaryWaitingCases > 0)
      .slice(0, 8);
    const maxValue = Math.max(
      ...rows.map((row) => Math.max(row.detailWaitingCases, row.summaryWaitingCases)),
      0,
    );

    return rows.map((row) => ({
      ...row,
      detailPercent: maxValue > 0 ? (row.detailWaitingCases / maxValue) * 100 : 0,
      summaryPercent: maxValue > 0 ? (row.summaryWaitingCases / maxValue) * 100 : 0,
    }));
  }, [waitingByCenterRows]);

  const waitingDateChartRows = useMemo(() => {
    const rows = waitingByDateRows.filter((row) => row.waitingCases > 0);
    const maxValue = Math.max(...rows.map((row) => row.waitingCases), 0);

    return rows.map((row) => ({
      ...row,
      percent: maxValue > 0 ? (row.waitingCases / maxValue) * 100 : 0,
    }));
  }, [waitingByDateRows]);

  const waitingTypeSidebarRows = useMemo(() => {
    return waitingByTypeRows
      .filter((row) => row.waitingCases > 0)
      .slice(0, 5);
  }, [waitingByTypeRows]);

  return (
    <div className="app-shell">
      {/* ── SIDEBAR ── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-logo">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3z" fill="currentColor" />
              <path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82z" fill="currentColor" opacity="0.6" />
            </svg>
          </div>
          <div className="brand-text">
            <p className="brand-eyebrow">MindX Education</p>
            <h1 className="brand-title">Teaching Leader System</h1>
            <p className="brand-subtitle">HCM1&4</p>
          </div>
        </div>

        <div className="sidebar-scroll">

        <div className="sync-bar">
          <div className="sync-info">
            <span className={`sync-dot${isRefreshing ? " sync-dot--spinning" : ""}`} />
            <span className="sync-time">
              {isRefreshing
                ? "Đang cập nhật..."
                : `Cập nhật: ${lastUpdated.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}`}
            </span>
          </div>
          <button
            className="sync-btn"
            onClick={fetchLatest}
            disabled={isRefreshing}
            title="Tải mới dữ liệu từ Google Sheet"
          >
            <svg viewBox="0 0 24 24" fill="none" className={isRefreshing ? "spin" : ""}>
              <path
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {refreshError && <p className="sync-error">{refreshError}</p>}
        </div>

        <div className="sidebar-stats sidebar-stats--top sidebar-section">
          <div className="stat-card">
            <span className="stat-value">{sidebarKpis.classCount}</span>
            <span className="stat-label">Lớp</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{sidebarKpis.teacherCount}</span>
            <span className="stat-label">Giáo viên</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{sidebarKpis.buCount}</span>
            <span className="stat-label">BU</span>
          </div>
        </div>

        {activeModule === "waiting" && (
          <div className="sidebar-section waiting-type-sidebar">
            {waitingTypeSidebarRows.length === 0 ? (
              <p className="muted" style={{ margin: "0.2rem 0 0", fontSize: "0.75rem" }}>Không có dữ liệu</p>
            ) : (
              <div className="waiting-type-mini-list">
                {waitingTypeSidebarRows.map((row) => (
                  <article key={`waiting-type-mini-${row.type}`} className="waiting-type-mini-item">
                    <p className="waiting-type-mini-name">{row.type}</p>
                    <div className="waiting-type-mini-metrics">
                      <strong>{row.waitingCases}</strong>
                      <span>{row.waitingRate}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}

        <nav className="sidebar-nav sidebar-section">
          <p className="nav-section-label">Modules</p>
          <button
            className={`nav-item${activeModule === "weekly" ? " nav-item--active" : ""}`}
            onClick={() => setActiveModule("weekly")}
          >
            <svg className="nav-icon" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
              <path d="M3 10h18M8 2v4M16 2v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>Lịch theo tuần</span>
          </button>
          <button
            className={`nav-item${activeModule === "classes" ? " nav-item--active" : ""}`}
            onClick={() => setActiveModule("classes")}
          >
            <svg className="nav-icon" viewBox="0 0 24 24" fill="none">
              <path
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M12 12h.01M12 16h.01"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <span>Danh sách lớp</span>
          </button>
          <button
            className={`nav-item${activeModule === "report" ? " nav-item--active" : ""}`}
            onClick={() => setActiveModule("report")}
          >
            <svg className="nav-icon" viewBox="0 0 24 24" fill="none">
              <path d="M4 19h16M7 16V9m5 7V5m5 11v-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>Report phân tích</span>
          </button>
          <button
            className={`nav-item${activeModule === "waiting" ? " nav-item--active" : ""}`}
            onClick={() => setActiveModule("waiting")}
          >
            <svg className="nav-icon" viewBox="0 0 24 24" fill="none">
              <path d="M12 8v5l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
            </svg>
            <span>OH Report</span>
          </button>
        </nav>

        {activeModule === "weekly" && (
          <div className="sidebar-search sidebar-section">
            <p className="nav-section-label">Tìm kiếm</p>
            <div className="control-group control-group--search">
              <label htmlFor="teacherSearchInput">Tìm giáo viên</label>
              <input
                className="search-input"
                id="teacherSearchInput"
                value={weeklyTeacherSearch}
                onChange={(e) => setWeeklyTeacherSearch(e.target.value)}
                placeholder="Tên hoặc mã giáo viên"
              />
            </div>
          </div>
        )}

        {activeModule === "classes" && (
          <div className="sidebar-search sidebar-section">
            <p className="nav-section-label">Tìm kiếm</p>
            <div className="control-group control-group--search">
              <label htmlFor="classInput">Tìm lớp</label>
              <input
                className="search-input"
                id="classInput"
                value={classSearch}
                onChange={(e) => setClassSearch(e.target.value)}
                placeholder="Tên lớp..."
              />
            </div>
            <div className="control-group control-group--search">
              <label htmlFor="classTeacherInput">Tìm giáo viên</label>
              <input
                className="search-input"
                id="classTeacherInput"
                value={classTeacherSearch}
                onChange={(e) => setClassTeacherSearch(e.target.value)}
                placeholder="Tên GV / TA..."
              />
            </div>
            <div className="control-group">
              <label>Khoảng ngày diễn ra</label>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <input
                  type="date"
                  value={classDateFrom}
                  onChange={(e) => setClassDateFrom(e.target.value)}
                  title="Từ ngày"
                />
                <input
                  type="date"
                  value={classDateTo}
                  onChange={(e) => setClassDateTo(e.target.value)}
                  title="Đến ngày"
                />
              </div>
              {(classDateFrom || classDateTo) && (
                <button
                  style={{ marginTop: "4px", fontSize: "11px", cursor: "pointer" }}
                  onClick={() => { setClassDateFrom(""); setClassDateTo(""); }}
                >
                  Xóa bộ lọc ngày
                </button>
              )}
            </div>
          </div>
        )}

        <div className="sidebar-controls sidebar-section">
          <p className="nav-section-label">Bộ lọc</p>

          <div className="control-group">
            <label>Cơ sở</label>
            <div className="block-checklist">
              {centerOptions.map((center) => (
                <label key={center} className="block-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedCenters.includes(center)}
                    onChange={() => toggleCenterSelection(center)}
                  />
                  <span>{center}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="control-group">
            <label>Khối</label>
            <div className="block-checklist">
              <label className="block-checkbox">
                <input
                  type="checkbox"
                  checked={selectedBlocks.includes("coding")}
                  onChange={() => toggleBlockSelection("coding")}
                />
                <span>Coding (C4K, JS, CS, PT)</span>
              </label>
              <label className="block-checkbox">
                <input
                  type="checkbox"
                  checked={selectedBlocks.includes("robotics")}
                  onChange={() => toggleBlockSelection("robotics")}
                />
                <span>Robotics (ROB)</span>
              </label>
              <label className="block-checkbox">
                <input
                  type="checkbox"
                  checked={selectedBlocks.includes("art")}
                  onChange={() => toggleBlockSelection("art")}
                />
                <span>Art (XART)</span>
              </label>
            </div>
          </div>

          {(activeModule === "weekly" || activeModule === "report") && (
            <div className="control-group">
              <label>Khung giờ</label>
              <div className="block-checklist">
                {slots.map((slot) => (
                  <label key={slot.label} className="block-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedSlots.includes(slot.label)}
                      onChange={() => toggleSlotSelection(slot.label)}
                    />
                    <span>{slot.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {(activeModule === "weekly" || activeModule === "report") && (
            <>
              <div className="control-group">
                <label htmlFor="weekSelect">Tuần</label>
                <select id="weekSelect" value={activeWeekKey} onChange={(e) => setSelectedWeekKey(e.target.value)}>
                  <option value="">Tất cả tuần</option>
                  {weekOptions.map((week) => (
                    <option key={week.key} value={week.key}>
                      {week.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="control-group">
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={showRunningOnly}
                    onChange={(e) => setShowRunningOnly(e.target.checked)}
                  />
                  <span className="toggle-track">
                    <span className="toggle-thumb" />
                  </span>
                  Chỉ lớp <strong>RUNNING</strong>
                </label>
              </div>
              {activeModule === "weekly" && (
                <div className="control-group">
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={compactWeekView}
                      onChange={(e) => setCompactWeekView(e.target.checked)}
                    />
                    <span className="toggle-track">
                      <span className="toggle-thumb" />
                    </span>
                    Gom nhóm theo khung giờ
                  </label>
                </div>
              )}
            </>
          )}


        </div>

        <footer className="sidebar-footer">Copyright © HCM1&4. All rights reserved.</footer>
        </div>
      </aside>

      {/* ── CONTENT AREA ── */}
      <main className="content-area">
        {activeModule === "weekly" && (
          <section className="content-section">
            <div className="content-header">
              <div>
                <h2 className="content-title">Lịch biểu giảng dạy theo tuần</h2>
              </div>
            </div>

            <div className="table-wrap">
              <table className="week-table resizable-table" onMouseDown={(event) => handleTableMouseDown(event, "weekly")}> 
                {renderTableColGroup("weekly", WEEKDAYS.length + 1)}
                <thead>
                  <tr>
                    <th className="slot-col">Khung giờ</th>
                    {WEEKDAYS.map((day) => (
                      <th key={day}>{`${day} (${getWeekdayDateLabel(activeWeekKey, day)})`}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleWeeklyMatrix.map((line) => (
                    <tr key={line.slot.label}>
                      <td>
                        <div className="slot-cell">
                          <strong>{line.slot.label}</strong>
                          <small>{line.slot.period}</small>
                        </div>
                      </td>
                      {line.byDay.map((entries, index) => (
                        <td key={`${line.slot.label}-${WEEKDAYS[index]}`}>
                          {entries.length === 0 ? (
                            <span className="muted">–</span>
                          ) : compactWeekView ? (
                            <div className="calendar-cell">
                              {groupEntriesByCenter(entries).map((group) => (
                                <section key={group.centerName} className="center-group">
                                  <p className="center-group-title">{group.centerName}</p>
                                  <ul className="compact-list">
                                    {group.rows.map((entry, entryIndex) => {
                                      const domain = getClassDomain(entry.className || "");
                                      const freeKey = `${domain}|${entry.fixedSlotLabel}|${entry.weekday}`;
                                      const freeAll = domain !== "default" ? (freeTeachersBySlot.get(freeKey) ?? []) : [];
                                      const freePriority = freeAll.filter(t => t.daysActive.has(entry.weekday) && t.centresActive.has(entry.centerName));
                                      return (
                                      <li key={`${entry.className}-${entryIndex}`} className="compact-item" onClick={() => setSelectedEntry(entry)} style={{ cursor: "pointer" }}>
                                        <span className={`compact-dot status-dot--${entry.status.toLowerCase()}`} />
                                        <div className="compact-info">
                                          <strong>{entry.className}</strong>
                                          <span className="compact-teacher">
                                            {entry.teacherName || "Chưa phân công"}
                                          </span>
                                          {entry.taName && <span className="compact-ta">TA: {entry.taName}</span>}
                                          {freeAll.length > 0 && (
                                            <span
                                              className="free-teacher-tooltip"
                                              onClick={(e) => { e.stopPropagation(); setFreeModal({ freeKey, domain, slot: entry.fixedSlotLabel, day: entry.weekday, centre: entry.centerName }); }}
                                            >
                                              <span className="free-teacher-icon">&#128100; {freePriority.length > 0 ? `${freePriority.length} rảnh tại CS` : `GV rảnh`}</span>
                                              {freePriority.length > 0 && (
                                                <span className="free-teacher-popover">
                                                  <strong>Ưu tiên · có lớp hôm nay tại CS:</strong>
                                                  <ul>{freePriority.slice(0, 5).map(t => <li key={t.teacherKey}>{t.name}</li>)}</ul>
                                                  {freePriority.length > 5 && <p className="more-hint">+{freePriority.length - 5} người khác...</p>}
                                                  <p className="click-to-modal">↗ Click để xem toàn bộ</p>
                                                </span>
                                              )}
                                            </span>
                                          )}
                                        </div>
                                      </li>
                                      );
                                    })}
                                  </ul>
                                </section>
                              ))}
                            </div>
                          ) : (
                            <div className="calendar-cell">
                              {groupEntriesByCenter(entries).map((group) => (
                                <section key={group.centerName} className="center-group">
                                  <p className="center-group-title">{group.centerName}</p>
                                  <div className="center-group-cards">
                                    {group.rows.map((entry, entryIndex) => {
                                      const domain = getClassDomain(entry.className || "");
                                      const freeKey = `${domain}|${entry.fixedSlotLabel}|${entry.weekday}`;
                                      const freeAll = domain !== "default" ? (freeTeachersBySlot.get(freeKey) ?? []) : [];
                                      const freePriority = freeAll.filter(t => t.daysActive.has(entry.weekday) && t.centresActive.has(entry.centerName));
                                      return (
                                      <article
                                        className={`calendar-card calendar-card--compact status-${entry.status.toLowerCase()} class-domain-${getClassDomain(entry.className || "")}`}
                                        key={`${entry.teacherCode}-${entry.className}-${entryIndex}`}
                                        onClick={() => setSelectedEntry(entry)}
                                        style={{ cursor: "pointer" }}
                                      >
                                        <div className="card-header-row">
                                          <h4>{entry.className}</h4>
                                          <span
                                            className={`status-badge status-badge--${entry.status.toLowerCase()}`}
                                          >
                                            {entry.status}
                                          </span>
                                        </div>
                                        <p className="card-teacher">{entry.teacherName || "Chưa phân công"}</p>
                                        {entry.taName && <p className="card-ta">TA: {entry.taName}</p>}
                                        {entry.isSpecialSlot && (
                                          <span className="special-slot-badge">{entry.slotLabel}</span>
                                        )}
                                        {freeAll.length > 0 && (
                                          <span
                                            className="free-teacher-tooltip"
                                            onClick={(e) => { e.stopPropagation(); setFreeModal({ freeKey, domain, slot: entry.fixedSlotLabel, day: entry.weekday, centre: entry.centerName }); }}
                                          >
                                            <span className="free-teacher-icon">&#128100; {freePriority.length > 0 ? `${freePriority.length} rảnh tại CS` : `GV rảnh`}</span>
                                            {freePriority.length > 0 && (
                                              <span className="free-teacher-popover">
                                                <strong>Ưu tiên · có lớp hôm nay tại CS:</strong>
                                                <ul>{freePriority.slice(0, 5).map(t => <li key={t.teacherKey}>{t.name}</li>)}</ul>
                                                {freePriority.length > 5 && <p className="more-hint">+{freePriority.length - 5} người khác...</p>}
                                                <p className="click-to-modal">↗ Click để xem toàn bộ</p>
                                              </span>
                                            )}
                                          </span>
                                        )}
                                      </article>
                                      );
                                    })}
                                  </div>
                                </section>
                              ))}
                            </div>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {freeModal && (() => {
          const allFree = freeTeachersBySlot.get(freeModal.freeKey) ?? [];
          const priority = allFree.filter(t => t.daysActive.has(freeModal.day) && t.centresActive.has(freeModal.centre));
          const priorityKeys = new Set(priority.map(t => t.teacherKey));
          const others = allFree.filter(t => !priorityKeys.has(t.teacherKey));
          return (
            <div className="free-modal-overlay" onClick={() => setFreeModal(null)}>
              <div className="free-modal" onClick={(e) => e.stopPropagation()}>
                <div className="free-modal-header">
                  <h3>GV rảnh · {freeModal.domain} · {freeModal.slot} · {freeModal.day}</h3>
                  <button className="free-modal-close" onClick={() => setFreeModal(null)}>✕</button>
                </div>
                <div className="free-modal-body">
                  {priority.length > 0 && (
                    <section>
                      <h4>Ưu tiên — có lớp hôm nay tại {freeModal.centre}</h4>
                      <ul>{priority.map(t => <li key={t.teacherKey}>{t.name}</li>)}</ul>
                    </section>
                  )}
                  {others.length > 0 && (
                    <section>
                      <h4>Toàn bộ GV rảnh cùng khối</h4>
                      <ul>{others.map(t => <li key={t.teacherKey}>{t.name}</li>)}</ul>
                    </section>
                  )}
                  {allFree.length === 0 && <p>Không có GV rảnh.</p>}
                </div>
              </div>
            </div>
          );
        })()}

        {selectedEntry && (() => {
          const domain = getClassDomain(selectedEntry.className || "");
          return (
            <div className="free-modal-overlay" onClick={() => setSelectedEntry(null)}>
              <div className={`class-detail-modal class-detail-modal--${domain}`} onClick={(e) => e.stopPropagation()}>
                <div className="class-detail-header">
                  <div>
                    <p className="class-detail-eyebrow">{selectedEntry.centerName || ""} · {selectedEntry.weekday} · {selectedEntry.slotLabel}</p>
                    <h3 className="class-detail-title">{selectedEntry.className}</h3>
                  </div>
                  <button className="class-detail-close" onClick={() => setSelectedEntry(null)}>✕</button>
                </div>
                <div className="class-detail-body">
                  <div className="class-detail-grid">
                    <div className="class-detail-card">
                      <span className="class-detail-label">Giờ học</span>
                      <span className="class-detail-value">{selectedEntry.slotLabel}</span>
                    </div>
                    <div className="class-detail-card">
                      <span className="class-detail-label">Ngày trong tuần</span>
                      <span className="class-detail-value">{selectedEntry.weekday}</span>
                    </div>
                    <div className="class-detail-card">
                      <span className="class-detail-label">Trạng thái</span>
                      <span className={`status-badge status-badge--${selectedEntry.status.toLowerCase()}`}>{selectedEntry.status}</span>
                    </div>
                    <div className="class-detail-card">
                      <span className="class-detail-label">Số học sinh</span>
                      <span className="class-detail-value">{selectedEntry.studentCount > 0 ? selectedEntry.studentCount : "–"}</span>
                    </div>
                  </div>
                  <div className="class-detail-people">
                    <div className="class-detail-person">
                      <span className="class-detail-role class-detail-role--lec">LEC</span>
                      <span className="class-detail-name">{selectedEntry.teacherName || "–"}</span>
                    </div>
                    {selectedEntry.taName && (
                      <div className="class-detail-person">
                        <span className="class-detail-role class-detail-role--ta">TA</span>
                        <span className="class-detail-name">{selectedEntry.taName}</span>
                      </div>
                    )}
                    {selectedEntry.supplyName && (
                      <div className="class-detail-person">
                        <span className="class-detail-role class-detail-role--supply">Supply</span>
                        <span className="class-detail-name">{selectedEntry.supplyName}</span>
                      </div>
                    )}
                  </div>
                  <div className="class-detail-footer">
                    <span>Ngày học: <strong>{selectedEntry.sessionDate}</strong></span>
                    <span>Khóa: <strong>{selectedEntry.termStartDate} – {selectedEntry.termEndDate}</strong></span>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {activeModule === "classes" && (
          <section className="content-section">
            <div className="content-header">
              <div>
                
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <h2 className="content-title">Danh sách lớp học</h2>
                  {classSummary.length > 0 && (
                    <span className="result-badge">{classSummary.length} lớp</span>
                  )}
                </div>
              </div>
            </div>

            {classSummary.length === 0 ? (
              <div className="empty-state">
                <p>Không tìm thấy lớp học.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="resizable-table" onMouseDown={(event) => handleTableMouseDown(event, "classes")}> 
                  {renderTableColGroup("classes", 11)}
                  <thead>
                    <tr>
                      <th>Tên lớp</th>
                      <th>Giáo viên</th>
                      <th>TA</th>
                      <th>Cơ sở</th>
                      <th>Thư</th>
                      <th>Khung giờ</th>
                      <th>Khóa học</th>
                      <th>Từ ngày</th>
                      <th>Đến ngày</th>
                      <th>Trạng thái</th>
                      <th>Số buổi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classSummary.map((cls) => (
                      <tr key={cls.className}>
                        <td>
                          <strong>{cls.className}</strong>
                        </td>
                        <td>{cls.teacherName || "–"}</td>
                        <td>{cls.taName || "–"}</td>
                        <td>{cls.centerName || "–"}</td>
                        <td>{cls.weekday}</td>
                        <td>{cls.slotLabel}</td>
                        <td>{cls.course || "–"}</td>
                        <td>{cls.termStartDate || "–"}</td>
                        <td>{cls.termEndDate || "–"}</td>
                        <td>
                          <span className={`status-badge status-badge--${cls.status.toLowerCase()}`}>
                            {cls.status}
                          </span>
                        </td>
                        <td className="td-center">{cls.sessionCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {activeModule === "report" && (
          <section className="content-section">
            <div className="content-header">
              <div>
                
                <h2 className="content-title">Report thống kê và phân tích</h2>
                <p className="report-note">Phạm vi tuần: {reportWeekLabel} | Quy đổi: 1 lớp = 2 giờ/tuần</p>
              </div>
            </div>

            <div className="report-kpi-grid">
              <article className="report-kpi-card">
                <p>Tổng số lớp</p>
                <strong>{reportData.totalClasses}</strong>
              </article>
              <article className="report-kpi-card">
                <p>Tổng số buổi</p>
                <strong>{reportData.totalSessions}</strong>
              </article>
              <article className="report-kpi-card">
                <p>Tổng giáo viên điều phối</p>
                <strong>{reportData.totalTeachers}</strong>
              </article>
            </div>

            <section className="report-block">
              <h3>1) Phân tích thời gian lớp</h3>
              <div className="table-wrap">
                <table className="resizable-table" onMouseDown={(event) => handleTableMouseDown(event, "report-time")}> 
                  {renderTableColGroup("report-time", 7)}
                  <thead>
                    <tr>
                      <th>
                        <button className="sort-header-btn" onClick={() => toggleTimeSlotSort("slotLabel")}>
                          Khung giờ <span>{sortIcon(timeSlotSort.key === "slotLabel", timeSlotSort.direction)}</span>
                        </button>
                      </th>
                      <th>
                        <button className="sort-header-btn" onClick={() => toggleTimeSlotSort("classCount")}>
                          Số lớp dạy <span>{sortIcon(timeSlotSort.key === "classCount", timeSlotSort.direction)}</span>
                        </button>
                      </th>
                      <th>
                        <button className="sort-header-btn" onClick={() => toggleTimeSlotSort("teacherCount")}>
                          Số giáo viên <span>{sortIcon(timeSlotSort.key === "teacherCount", timeSlotSort.direction)}</span>
                        </button>
                      </th>
                      <th>
                        <button className="sort-header-btn" onClick={() => toggleTimeSlotSort("classPerTeacher")}>
                          Lớp / GV <span>{sortIcon(timeSlotSort.key === "classPerTeacher", timeSlotSort.direction)}</span>
                        </button>
                      </th>
                      <th>
                        <button className="sort-header-btn" onClick={() => toggleTimeSlotSort("intensityLevel")}>
                          Mức độ dạy <span>{sortIcon(timeSlotSort.key === "intensityLevel", timeSlotSort.direction)}</span>
                        </button>
                      </th>
                      <th>
                        <button className="sort-header-btn" onClick={() => toggleTimeSlotSort("percent")}>
                          Tỷ trọng lớp <span>{sortIcon(timeSlotSort.key === "percent", timeSlotSort.direction)}</span>
                        </button>
                      </th>
                      <th>Mật độ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTimeSlotRows.map((slot) => (
                      <tr key={`slot-${slot.slotLabel}`}>
                        <td>{slot.slotLabel}</td>
                        <td>{slot.classCount}</td>
                        <td>{slot.teacherCount}</td>
                        <td>{slot.classPerTeacher}</td>
                        <td>{slot.intensityLevel}</td>
                        <td>{slot.percent}%</td>
                        <td>
                          <div className="density-bar-wrap">
                            <span className="density-bar" style={{ width: `${slot.percent}%` }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="report-block">
              <h3>2) Phạm vi điều phối phân bổ giáo viên</h3>
              <div className="table-wrap">
                <table className="resizable-table" onMouseDown={(event) => handleTableMouseDown(event, "report-teacher")}> 
                  {renderTableColGroup("report-teacher", 13)}
                  <thead>
                    <tr>
                      <th><button className="sort-header-btn" onClick={() => toggleTeacherSort("teacherName")}>Giáo viên <span>{sortIcon(teacherSort.key === "teacherName", teacherSort.direction)}</span></button></th>
                      <th><button className="sort-header-btn" onClick={() => toggleTeacherSort("teacherCode")}>Mã GV <span>{sortIcon(teacherSort.key === "teacherCode", teacherSort.direction)}</span></button></th>
                      <th><button className="sort-header-btn" onClick={() => toggleTeacherSort("classCount")}>Số lớp / tuần <span>{sortIcon(teacherSort.key === "classCount", teacherSort.direction)}</span></button></th>
                      <th><button className="sort-header-btn" onClick={() => toggleTeacherSort("weeklyHours")}>Giờ dạy / tuần <span>{sortIcon(teacherSort.key === "weeklyHours", teacherSort.direction)}</span></button></th>
                      <th><button className="sort-header-btn" onClick={() => toggleTeacherSort("totalStudents")}>Tổng học viên <span>{sortIcon(teacherSort.key === "totalStudents", teacherSort.direction)}</span></button></th>
                      <th><button className="sort-header-btn" onClick={() => toggleTeacherSort("avgStudentsPerClass")}>TB học viên / lớp <span>{sortIcon(teacherSort.key === "avgStudentsPerClass", teacherSort.direction)}</span></button></th>
                      <th><button className="sort-header-btn" onClick={() => toggleTeacherSort("avgStudentsPerHour")}>Handle HV / giờ <span>{sortIcon(teacherSort.key === "avgStudentsPerHour", teacherSort.direction)}</span></button></th>
                      <th><button className="sort-header-btn" onClick={() => toggleTeacherSort("centerCount")}>Số cơ sở <span>{sortIcon(teacherSort.key === "centerCount", teacherSort.direction)}</span></button></th>
                      <th><button className="sort-header-btn" onClick={() => toggleTeacherSort("slotCount")}>Số khung giờ <span>{sortIcon(teacherSort.key === "slotCount", teacherSort.direction)}</span></button></th>
                      <th><button className="sort-header-btn" onClick={() => toggleTeacherSort("conflictCount")}>Xung đột lịch <span>{sortIcon(teacherSort.key === "conflictCount", teacherSort.direction)}</span></button></th>
                      <th><button className="sort-header-btn" onClick={() => toggleTeacherSort("dispatchScope")}>Phạm vi điều phối <span>{sortIcon(teacherSort.key === "dispatchScope", teacherSort.direction)}</span></button></th>
                      <th><button className="sort-header-btn" onClick={() => toggleTeacherSort("workloadLevel")}>Mức tải <span>{sortIcon(teacherSort.key === "workloadLevel", teacherSort.direction)}</span></button></th>
                      <th><button className="sort-header-btn" onClick={() => toggleTeacherSort("classSizeLevel")}>Quy mô lớp <span>{sortIcon(teacherSort.key === "classSizeLevel", teacherSort.direction)}</span></button></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTeacherRows.map((teacher) => (
                      <tr key={`dispatch-${teacher.teacherCode}-${teacher.teacherName}`}>
                        <td>{teacher.teacherName}</td>
                        <td>{teacher.teacherCode}</td>
                        <td>{teacher.classCount}</td>
                        <td>{teacher.weeklyHours}</td>
                        <td>{teacher.totalStudents}</td>
                        <td>{teacher.avgStudentsPerClass}</td>
                        <td>{teacher.avgStudentsPerHour}</td>
                        <td>{teacher.centerCount}</td>
                        <td>{teacher.slotCount}</td>
                        <td className={teacher.conflictCount > 0 ? "conflict-cell" : ""}>{teacher.conflictCount}</td>
                        <td>{teacher.dispatchScope}</td>
                        <td>{teacher.workloadLevel}</td>
                        <td>{teacher.classSizeLevel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </section>
        )}

        {/* Thống kê Waiting */}
        {activeModule === "waiting" && (
          <section className="content-section">
            <div className="content-header">
              <div>
                <h2 className="content-title">Report thống kê và phân tích OH</h2>
                <p className="report-note">Sheet tổng hợp: gid=1122383044 | Sheet chi tiết case: gid=1227175209</p>
                {/* <p className="report-note">
                  Bộ lọc cơ sở: {selectedCenters.length > 0 ? selectedCenters.join(", ") : "Tất cả cơ sở"}
                </p>
                <p className="report-note">
                  Bộ lọc khối: {selectedBlocks.length > 0 ? selectedBlocks.join(", ") : "Tất cả khối"}
                </p> */}
              </div>
            </div>

            <div className="report-kpi-grid">
              <article className="report-kpi-card">
                <p>Tổng waiting (sheet tổng hợp)</p>
                <strong>{waitingTotalCases}</strong>
              </article>
              <article className="report-kpi-card">
                <p>Tổng case (sheet chi tiết)</p>
                <strong>{waitingDetailTotalCases}</strong>
              </article>
              <article className="report-kpi-card">
                <p>Tổng waiting (sheet chi tiết)</p>
                <strong>{waitingDetailTotalWaitingCases}</strong>
              </article>
              <article className="report-kpi-card">
                <p>Waiting rate tổng (sheet chi tiết)</p>
                <strong>{waitingOverallRate}</strong>
              </article>
              <article className="report-kpi-card">
                <p>Số cơ sở có dữ liệu</p>
                <strong>{waitingCenterCount}</strong>
              </article>
            </div>

            {waitingSummaryRows.length === 0 && waitingByCenterRows.length === 0 ? (
              <div className="empty-state">
                <p>Không có dữ liệu waiting từ 2 sheet.</p>
              </div>
            ) : (
              <>
                <section className="report-block">
                  <h3>1) Biểu đồ nhanh</h3>
                  <div className="waiting-chart-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.8rem" }}>
                    <article className="waiting-chart-card">
                      <h4>Top cơ sở theo waiting</h4>
                      <p>So sánh số waiting giữa sheet tổng hợp và sheet chi tiết.</p>
                      <div className="waiting-chart-legend">
                        <span><i className="dot dot--detail" /> Chi tiết</span>
                        <span><i className="dot dot--summary" /> Tổng hợp</span>
                      </div>
                      <div className="waiting-chart-body" style={{ display: "grid", gap: "0.46rem" }}>
                        {waitingCenterChartRows.length === 0 ? (
                          <p className="muted">Không có dữ liệu để vẽ biểu đồ.</p>
                        ) : waitingCenterChartRows.map((row) => (
                          <div className="waiting-chart-row" style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1fr) 2fr auto", alignItems: "center", gap: "0.5rem" }} key={`chart-center-${row.centerName}`}>
                            <div className="waiting-chart-label" style={{ fontSize: "0.76rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.centerName}</div>
                            <div className="waiting-chart-tracks" style={{ display: "grid", gap: "0.2rem" }}>
                              <div className="waiting-chart-track" style={{ width: "100%", height: "8px", borderRadius: "999px", background: "#e6eff8", overflow: "hidden" }}>
                                <span className="waiting-chart-bar waiting-chart-bar--detail" style={{ width: `${row.detailPercent}%`, display: "block", height: "100%", minWidth: "3px", borderRadius: "999px" }} />
                              </div>
                              <div className="waiting-chart-track waiting-chart-track--summary" style={{ width: "100%", height: "7px", borderRadius: "999px", background: "#eef3f9", overflow: "hidden" }}>
                                <span className="waiting-chart-bar waiting-chart-bar--summary" style={{ width: `${row.summaryPercent}%`, display: "block", height: "100%", minWidth: "3px", borderRadius: "999px" }} />
                              </div>
                            </div>
                            <div className="waiting-chart-values" style={{ display: "grid", justifyItems: "end", minWidth: "34px" }}>
                              <strong>{row.detailWaitingCases}</strong>
                              <span>{row.summaryWaitingCases}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </article>

                    <article className="waiting-chart-card">
                      <h4>Xu hướng waiting theo ngày</h4>
                      <p>Hiển thị toàn bộ ngày có waiting case (theo dữ liệu chi tiết).</p>
                      <div style={{ overflowX: "auto", paddingBottom: "6px" }}>
                        <div
                          className="waiting-date-chart"
                          style={{
                            minHeight: "190px",
                            display: "grid",
                            gridTemplateColumns: waitingDateChartRows.length > 0
                              ? `repeat(${waitingDateChartRows.length}, minmax(42px, 1fr))`
                              : "1fr",
                            alignItems: "end",
                            gap: "0.35rem",
                            minWidth: waitingDateChartRows.length > 0 ? `${waitingDateChartRows.length * 46}px` : undefined,
                          }}
                        >
                          {waitingDateChartRows.length === 0 ? (
                            <p className="muted">Không có dữ liệu để vẽ biểu đồ.</p>
                          ) : waitingDateChartRows.map((row) => (
                            <div className="waiting-date-col" style={{ display: "grid", justifyItems: "center", gap: "0.2rem" }} key={`chart-date-${row.date}`}>
                              <div className="waiting-date-col-bar-wrap" style={{ width: "100%", height: "130px", borderRadius: "8px 8px 6px 6px", background: "#edf3fa", display: "flex", alignItems: "flex-end", justifyContent: "center", overflow: "hidden", padding: "0 2px" }}>
                                <span className="waiting-date-col-bar" style={{ height: `${Math.max(row.percent, 6)}%`, width: "100%", display: "block", borderRadius: "6px 6px 3px 3px" }} />
                              </div>
                              <strong>{displayCount(row.waitingCases)}</strong>
                              <span>{row.date}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </article>
                  </div>
                </section>

                <section className="report-block">
                  <h3>2) Đối soát theo cơ sở (sheet tổng hợp vs sheet chi tiết)</h3>
                  <div className="table-wrap">
                    <table className="resizable-table" onMouseDown={(event) => handleTableMouseDown(event, "waiting-center")}> 
                      {renderTableColGroup("waiting-center", 8)}
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Cơ sở</th>
                          <th>Waiting tổng hợp</th>
                          <th>Rate tổng hợp</th>
                          <th>Waiting chi tiết</th>
                          <th>Total chi tiết</th>
                          <th>Rate chi tiết</th>
                          <th>Chênh lệch (chi tiết - tổng hợp)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {waitingByCenterRows.map((row, index) => (
                          <tr key={`${row.centerName}-${index}`}>
                            <td>{index + 1}</td>
                            <td>{row.centerName}</td>
                            <td
                              className={row.summaryWaitingCases > 0
                                ? `${waitingToneClass(row.summaryWaitingCases, waitingCenterMax)} waiting-matrix-hit`
                                : waitingToneClass(row.summaryWaitingCases, waitingCenterMax)}
                            >
                              {row.summaryWaitingCases}
                            </td>
                            <td
                              className={parsePercentValue(row.summaryWaitingRate) > 0
                                ? `${waitingToneClass(parsePercentValue(row.summaryWaitingRate), 100)} waiting-matrix-hit`
                                : waitingToneClass(parsePercentValue(row.summaryWaitingRate), 100)}
                            >
                              {row.summaryWaitingRate}
                            </td>
                            <td
                              className={row.detailWaitingCases > 0
                                ? `${waitingToneClass(row.detailWaitingCases, waitingCenterMax)} waiting-matrix-hit`
                                : waitingToneClass(row.detailWaitingCases, waitingCenterMax)}
                            >
                              {row.detailWaitingCases}
                            </td>
                            <td>{row.detailTotalCases}</td>
                            <td
                              className={parsePercentValue(row.detailWaitingRate) > 0
                                ? `${waitingToneClass(parsePercentValue(row.detailWaitingRate), 100)} waiting-matrix-hit`
                                : waitingToneClass(parsePercentValue(row.detailWaitingRate), 100)}
                            >
                              {row.detailWaitingRate}
                            </td>
                            <td className={row.deltaCases !== 0 ? "conflict-cell waiting-delta-cell" : "waiting-delta-cell"}>{row.deltaCases}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="report-block">
                  <h3>3) Waiting theo course line</h3>
                  <div className="waiting-chart-grid" style={{ display: "grid", gridTemplateColumns: "1fr", gap: "0.8rem" }}>
                    <article className="waiting-chart-card">
                      <h4>Heatmap waiting theo course line x cơ sở</h4>
                      <p>Màu ô đậm hơn tương ứng số waiting cao hơn trong cùng cụm dữ liệu.</p>
                      <div className="table-wrap" style={{ marginTop: "0.4rem" }}>
                        {waitingCourseHeatmapRows.length === 0 ? (
                          <p className="muted">Không có dữ liệu course line để hiển thị heatmap.</p>
                        ) : (
                          <table className="resizable-table" onMouseDown={(event) => handleTableMouseDown(event, "waiting-heatmap")} style={{ minWidth: `${Math.max(860, waitingCenterColumns.length * 120 + 240)}px` }}>
                            {renderTableColGroup("waiting-heatmap", waitingCenterColumns.length + 2)}
                            <thead>
                              <tr>
                                <th>Course line</th>
                                {waitingCenterColumns.map((centerName) => (
                                  <th key={`waiting-heatmap-head-${centerName}`}>{centerName}</th>
                                ))}
                                <th>Tổng</th>
                              </tr>
                            </thead>
                            <tbody>
                              {waitingCourseHeatmapRows.map((row) => (
                                <tr key={`waiting-heatmap-row-${row.courseLine}`}>
                                  <td><strong>{row.courseLine}</strong></td>
                                  {row.cells.map((cell) => (
                                    <td
                                      key={`waiting-heatmap-cell-${row.courseLine}-${cell.centerName}`}
                                      className={[
                                        cell.value > 0 ? `${waitingToneClass(cell.value, waitingCourseCellMax)} waiting-matrix-hit` : waitingToneClass(cell.value, waitingCourseCellMax),
                                        cell.value > 0 && (isUnknownLabel(row.courseLine) || isUnknownLabel(cell.centerName)) ? "unknown-emphasis-soft" : "",
                                      ].filter(Boolean).join(" ")}
                                    >
                                      {displayCount(cell.value)}
                                    </td>
                                  ))}
                                  <td
                                    className={[
                                      waitingToneClass(row.total, waitingCourseMax),
                                      row.total > 0 && isUnknownLabel(row.courseLine) ? "unknown-emphasis-soft" : "",
                                    ].filter(Boolean).join(" ")}
                                  >
                                    <strong>{displayCount(row.total)}</strong>
                                  </td>
                                </tr>
                              ))}
                              <tr className="waiting-heatmap-total-row">
                                <td><strong>Tổng theo cơ sở</strong></td>
                                {waitingCenterColumns.map((centerName) => {
                                  const value = waitingHeatmapCenterTotals.totals[centerName] ?? 0;
                                  return (
                                    <td key={`waiting-heatmap-total-${centerName}`} className="waiting-heatmap-total-cell">
                                      <strong>{displayCount(value)}</strong>
                                    </td>
                                  );
                                })}
                                <td className="waiting-heatmap-total-cell">
                                  <strong>{displayCount(waitingHeatmapCenterTotals.grandTotal)}</strong>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        )}
                      </div>
                    </article>
                  </div>
                </section>

                <section className="report-block">
                  <h3>4) Waiting theo ngày</h3>
                  <div className="table-wrap">
                    <table className="resizable-table" onMouseDown={(event) => handleTableMouseDown(event, "waiting-date")}> 
                      {renderTableColGroup("waiting-date", waitingCenterColumns.length + 2)}
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Ngày</th>
                          {waitingCenterColumns.map((centerName) => (
                            <th key={`waiting-day-head-${centerName}`}>{centerName}</th>
                          ))}
                          <th>Tổng ngày</th>
                        </tr>
                      </thead>
                      <tbody>
                        {waitingByDateCenterRows.map((row, index) => (
                          <tr key={`${row.date}-${index}`}>
                            <td>{index + 1}</td>
                            <td>{row.date}</td>
                            {waitingCenterColumns.map((centerName) => (
                              (() => {
                                const value = row.counts[centerName] ?? 0;
                                const toneClass = waitingToneClass(value, waitingCenterMax);
                                return (
                                  <td
                                    key={`waiting-day-cell-${row.date}-${centerName}`}
                                    className={[
                                      value > 0 ? `${toneClass} waiting-matrix-hit` : toneClass,
                                      value > 0 && (isUnknownLabel(centerName) || isUnknownLabel(row.date)) ? "unknown-emphasis-soft" : "",
                                    ].filter(Boolean).join(" ")}
                                  >
                                    {displayCount(value)}
                                  </td>
                                );
                              })()
                            ))}
                            <td className={waitingToneClass(row.total, waitingDayTotalMax)}><strong>{displayCount(row.total)}</strong></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
