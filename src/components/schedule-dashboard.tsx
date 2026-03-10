"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TeacherScheduleRow, WEEKDAYS, WeeklySlot } from "@/types/schedule";
import { buildWeeklyMatrix } from "@/lib/google-sheet";

type ActiveModule = "weekly" | "classes" | "report";

type ScheduleDashboardProps = {
  rows: TeacherScheduleRow[];
  slots: WeeklySlot[];
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
  if (normalized.includes("ROB")) return "robotics";
  if (normalized.includes("C4K") || normalized.includes("JS") || normalized.includes("CS") || normalized.includes("PT")) {
    return "coding";
  }

  return "default";
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

export default function ScheduleDashboard({ rows: initialRows, slots: initialSlots }: ScheduleDashboardProps) {
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

  // Live data state
  const [rows, setRows] = useState<TeacherScheduleRow[]>(initialRows);
  const [slots, setSlots] = useState<WeeklySlot[]>(initialSlots);
  const [lastUpdated, setLastUpdated] = useState<Date>(() => new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");

  const fetchLatest = useCallback(async () => {
    setIsRefreshing(true);
    setRefreshError("");
    try {
      const res = await fetch("/api/schedule", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { rows: TeacherScheduleRow[]; slots: WeeklySlot[] };
      setRows(data.rows);
      setSlots(data.slots);
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
                <p className="content-eyebrow">Module 1</p>
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
                                      <li key={`${entry.className}-${entryIndex}`} className="compact-item">
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

        {activeModule === "classes" && (
          <section className="content-section">
            <div className="content-header">
              <div>
                <p className="content-eyebrow">Module 2</p>
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
                <p className="content-eyebrow">Module 3</p>
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
      </main>
    </div>
  );
}
