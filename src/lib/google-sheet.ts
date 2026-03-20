import Papa from "papaparse";
import {
  BASE_WEEKLY_SLOTS,
  TeacherScheduleRow,
  WaitingCaseByCenter,
  WaitingDetailCase,
  WaitingDetailByCourseLine,
  WaitingDetailByDate,
  WaitingDetailByType,
  WaitingDetailCenterRow,
  WaitingDetailReport,
  WEEKDAYS,
  WeekdayLabel,
  WeeklySlot,
} from "@/types/schedule";

type RawRow = Record<string, string | number | null | undefined>;

const WEEKDAY_BY_TOKEN: Record<string, WeekdayLabel> = {
  "2": "T2",
  "3": "T3",
  "4": "T4",
  "5": "T5",
  "6": "T6",
  "7": "T7",
  cn: "CN",
  sunday: "CN",
  sun: "CN",
  mon: "T2",
  monday: "T2",
  tue: "T3",
  tuesday: "T3",
  wed: "T4",
  wednesday: "T4",
  thu: "T5",
  thursday: "T5",
  fri: "T6",
  friday: "T6",
  sat: "T7",
  saturday: "T7",
  saturdays: "T7",
  t2: "T2",
  t3: "T3",
  t4: "T4",
  t5: "T5",
  t6: "T6",
  t7: "T7",
  "chu nhat": "CN",
};

const WEEKDAY_INDEX: Record<WeekdayLabel, number> = {
  T2: 1,
  T3: 2,
  T4: 3,
  T5: 4,
  T6: 5,
  T7: 6,
  CN: 0,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC+7

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeKey(key: string): string {
  return key
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function pickValue(row: RawRow, aliases: string[]): string {
  const normalizedAliasSet = new Set(aliases.map((alias) => normalizeKey(alias)));

  for (const [rawKey, rawValue] of Object.entries(row)) {
    if (normalizedAliasSet.has(normalizeKey(rawKey))) {
      return normalizeText(rawValue);
    }
  }

  return "";
}

// Try each alias in priority order; return first non-empty match.
function pickValueOrdered(row: RawRow, aliases: string[]): string {
  for (const alias of aliases) {
    const normalizedAlias = normalizeKey(alias);
    for (const [rawKey, rawValue] of Object.entries(row)) {
      if (normalizeKey(rawKey) === normalizedAlias) {
        const value = normalizeText(rawValue);
        if (value) return value;
      }
    }
  }

  return "";
}

function normalizeWeekday(rawValue: string): WeekdayLabel {
  const lower = rawValue
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  return WEEKDAY_BY_TOKEN[lower] ?? "T2";
}

// Parses an ISO UTC datetime string and returns the VN-local (UTC+7) hour and minute.
function parseIsoToVnTime(rawValue: string): { hour: number; minute: number } | null {
  const trimmed = rawValue.trim();
  if (!trimmed || !trimmed.includes("T")) return null;
  const utcDate = new Date(trimmed);
  if (Number.isNaN(utcDate.getTime())) return null;
  const vnDate = new Date(utcDate.getTime() + VN_OFFSET_MS);
  return { hour: vnDate.getUTCHours(), minute: vnDate.getUTCMinutes() };
}

// Derives weekday label (T2–CN) from an ISO UTC datetime using VN timezone (UTC+7).
function deriveWeekdayFromIso(rawValue: string): WeekdayLabel | null {
  const trimmed = rawValue.trim();
  if (!trimmed || !trimmed.includes("T")) return null;
  const utcDate = new Date(trimmed);
  if (Number.isNaN(utcDate.getTime())) return null;
  const vnDate = new Date(utcDate.getTime() + VN_OFFSET_MS);
  const DAY_LABELS: WeekdayLabel[] = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
  return DAY_LABELS[vnDate.getUTCDay()];
}

// Derives slot label (e.g., "08:00 - 10:00") from two ISO UTC datetime strings using VN timezone.
function deriveSlotFromIso(startRaw: string, endRaw: string): string {
  const startTime = parseIsoToVnTime(startRaw);
  const endTime = parseIsoToVnTime(endRaw);
  if (!startTime || !endTime) return "";
  const sH = String(startTime.hour).padStart(2, "0");
  const sM = String(startTime.minute).padStart(2, "0");
  const eH = String(endTime.hour).padStart(2, "0");
  const eM = String(endTime.minute).padStart(2, "0");
  return `${sH}:${sM} - ${eH}:${eM}`;
}

function parseDateValue(rawValue: string): Date | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  const ddmmyyyy = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toDisplayDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function startOfWeekMonday(date: Date): Date {
  const day = date.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  return new Date(date.getTime() + diffToMonday * DAY_MS);
}

function endOfWeekSunday(mondayDate: Date): Date {
  return new Date(mondayDate.getTime() + 6 * DAY_MS);
}

function formatWeekLabel(weekStart: Date, weekEnd: Date): string {
  return `${toDisplayDate(weekStart)} - ${toDisplayDate(weekEnd)}`;
}

function getFirstSessionDate(rangeStart: Date, weekday: WeekdayLabel): Date {
  const targetIndex = WEEKDAY_INDEX[weekday];
  const currentIndex = rangeStart.getUTCDay();
  const offset = (targetIndex - currentIndex + 7) % 7;
  return new Date(rangeStart.getTime() + offset * DAY_MS);
}

function inferTeacherInfo(rawValue: string): { teacherName: string; teacherCode: string; role: string } {
  const source = rawValue.trim();
  if (!source) {
    return { teacherName: "", teacherCode: "", role: "" };
  }

  // Example: "Do Truong Vu - vudt (Lecturer)" or "Nguyen Van A - abc (Teacher Assistant)"
  const match = source.match(/^(.*?)\s*-\s*([^(]+?)(?:\s*\(([^)]*)\))?\s*$/);
  if (match) {
    return {
      teacherName: match[1].trim(),
      teacherCode: match[2].trim().toLowerCase(),
      role: (match[3] ?? "").trim(),
    };
  }

  return { teacherName: source, teacherCode: "", role: "" };
}

function extractTeacherEntries(rawValue: string): Array<{ teacherName: string; teacherCode: string; role: string }> {
  const source = rawValue.trim();
  if (!source) {
    return [];
  }

  return source
    .split(/[;\n,]+/)
    .map((token) => inferTeacherInfo(token))
    .filter((entry) => entry.teacherName);
}

function mergeTeacherEntries(
  ...groups: Array<Array<{ teacherName: string; teacherCode: string; role: string }>>
): Array<{ teacherName: string; teacherCode: string; role: string }> {
  const merged: Array<{ teacherName: string; teacherCode: string; role: string }> = [];
  const seen = new Set<string>();

  for (const group of groups) {
    for (const entry of group) {
      const key = `${entry.teacherCode.toLowerCase()}|${entry.teacherName.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(entry);
      }
    }
  }

  return merged;
}

function splitSlot(slotValue: string): { startTime: string; endTime: string } {
  const match = slotValue.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  if (!match) {
    return { startTime: "", endTime: "" };
  }

  return {
    startTime: match[1],
    endTime: match[2],
  };
}

function parseTimeToMinutes(rawValue: string): number | null {
  const match = rawValue.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return null;
  }

  return hour * 60 + minute;
}

function resolveFixedSlotLabel(slotLabel: string): string {
  if (BASE_WEEKLY_SLOTS.some((slot) => slot.label === slotLabel)) {
    return slotLabel;
  }

  const slotTime = splitSlot(slotLabel);
  const startMinute = parseTimeToMinutes(slotTime.startTime);

  if (startMinute === null) {
    return "18:00 - 20:00";
  }

  if (startMinute < 10 * 60) {
    return "08:00 - 10:00";
  }

  if (startMinute < 12 * 60) {
    return "10:00 - 12:00";
  }

  if (startMinute < 16 * 60) {
    return "14:00 - 16:00";
  }

  if (startMinute < 18 * 60) {
    return "16:00 - 18:00";
  }

  if (startMinute < 19 * 60) {
    return "18:00 - 20:00";
  }

  return "19:00 - 21:00";
}

function resolveSlotLabel(slotValue: string, startTime: string, endTime: string): string {
  if (slotValue) {
    return slotValue;
  }

  if (startTime && endTime) {
    return `${startTime} - ${endTime}`;
  }

  return "Khung gio chua xac dinh";
}

function parseStudentCount(rawValue: string): number {
  const normalized = rawValue.replace(/[^0-9]/g, "");
  if (!normalized) {
    return 0;
  }

  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseCsvRows(csvContent: string): RawRow[] {
  const parsed = Papa.parse<RawRow>(csvContent, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    throw new Error(`CSV parse error: ${parsed.errors[0].message}`);
  }

  return parsed.data;
}

function parseCsvTable(csvContent: string): string[][] {
  const parsed = Papa.parse<string[]>(csvContent, {
    header: false,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    throw new Error(`CSV parse error: ${parsed.errors[0].message}`);
  }

  return parsed.data.map((row) => row.map((cell) => normalizeText(cell)));
}

function buildWaitingSheetCsvUrl(): string {
  const directCsvUrl = process.env.WAITING_CASES_SHEET_CSV_URL;
  if (directCsvUrl) {
    return directCsvUrl;
  }

  const defaultSheetId = "172bbDGAsMswfTOPuPDEeUFuXcOhWPxAf8XjRVWDaz5k";
  const sheetId = process.env.WAITING_CASES_SHEET_ID ?? defaultSheetId;
  const gid = process.env.WAITING_CASES_SHEET_GID ?? "1122383044";
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

function isWaitingStatus(rawStatus: string): boolean {
  const statusToken = normalizeKey(rawStatus);
  return statusToken === "wating" || statusToken === "waiting";
}

function normalizeWaitingRate(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed || trimmed === "#DIV/0!") {
    return "-";
  }

  const numericOnly = trimmed.replace(/[^0-9.]/g, "");
  if (!numericOnly) {
    return "-";
  }

  const parsed = Number(numericOnly);
  if (Number.isNaN(parsed)) {
    return "-";
  }

  return `${parsed.toFixed(2)}%`;
}

function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) {
    return "-";
  }

  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

function buildWaitingDetailSheetCsvUrl(): string {
  const directCsvUrl = process.env.WAITING_CASES_DETAIL_SHEET_CSV_URL;
  if (directCsvUrl) {
    return directCsvUrl;
  }

  const defaultSheetId = "1MZMHXsmP4v8GBwBKpb0Hj-DYzonSBWA1iG5KXkVYBB4";
  const sheetId = process.env.WAITING_CASES_DETAIL_SHEET_ID ?? defaultSheetId;
  const gid = process.env.WAITING_CASES_DETAIL_SHEET_GID ?? "1227175209";
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

function normalizeOutcomeStatus(rawValue: string): string {
  const token = normalizeKey(rawValue).toUpperCase();
  if (token === "WATING" || token === "WAITING") return "WAITING";
  if (token === "PASSED") return "PASSED";
  if (token === "CANCELED") return "CANCELED";
  if (token === "ABANDONED") return "ABANDONED";
  return "";
}

function extractOutcomeStatus(row: RawRow): string {
  // Source sheet can contain both ABANDONED/PASSED in one column and WAITING in another.
  // For waiting analytics, prioritize WAITING when it appears anywhere in the row.
  for (const value of Object.values(row)) {
    const normalized = normalizeOutcomeStatus(normalizeText(value));
    if (normalized === "WAITING") {
      return "WAITING";
    }
  }

  const direct = pickValueOrdered(row, [
    "appointment_result",
    "appointment_status",
    "waiting_status",
    "appointment_note",
    "result",
  ]);
  const directNormalized = normalizeOutcomeStatus(direct);
  if (directNormalized) {
    return directNormalized;
  }

  for (const value of Object.values(row)) {
    const normalized = normalizeOutcomeStatus(normalizeText(value));
    if (normalized && normalized !== "WAITING") {
      return normalized;
    }
  }

  return "";
}

function dateSortKey(dateText: string): number {
  const trimmed = dateText.trim();
  const match = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return Number.MAX_SAFE_INTEGER;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  return year * 10000 + month * 100 + day;
}

export async function getWaitingDetailReport(summaryByCenter: WaitingCaseByCenter[]): Promise<WaitingDetailReport> {
  const response = await fetch(buildWaitingDetailSheetCsvUrl(), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to fetch waiting detail CSV: ${response.status}`);
  }

  const rows = parseCsvRows(await response.text());
  const centerCounter = new Map<string, { waiting: number; total: number }>();
  const typeCounter = new Map<string, { waiting: number; total: number }>();
  const courseLineCounter = new Map<string, number>();
  const dateCounter = new Map<string, number>();
  const cases: WaitingDetailCase[] = [];

  let totalCases = 0;
  let totalWaitingCases = 0;

  for (const row of rows) {
    const statusesInRow = Object.values(row)
      .map((value) => normalizeOutcomeStatus(normalizeText(value)))
      .filter(Boolean);

    // ABANDONED is explicitly excluded from all waiting analytics.
    if (statusesInRow.includes("ABANDONED")) {
      continue;
    }

    const centerName = pickValueOrdered(row, ["centre_name", "centre", "center_name", "campus", "branch", "co so"]);
    if (!centerName) {
      continue;
    }

    const type = pickValueOrdered(row, ["type"]) || "Khong ro";
    const courseLineRaw = pickValueOrdered(row, ["courseLines", "course_line", "course_lines"]) || "Khong ro";
    const courseLines = courseLineRaw
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean);
    const date = pickValueOrdered(row, ["date", "session_date", "ngay"]) || "Khong ro";
    const outcomeStatus = extractOutcomeStatus(row);

    cases.push({
      centerName,
      type,
      courseLines,
      date,
      outcomeStatus,
    });

    totalCases += 1;

    if (!centerCounter.has(centerName)) centerCounter.set(centerName, { waiting: 0, total: 0 });
    if (!typeCounter.has(type)) typeCounter.set(type, { waiting: 0, total: 0 });

    centerCounter.get(centerName)!.total += 1;
    typeCounter.get(type)!.total += 1;

    if (outcomeStatus === "WAITING") {
      totalWaitingCases += 1;
      centerCounter.get(centerName)!.waiting += 1;
      typeCounter.get(type)!.waiting += 1;
      dateCounter.set(date, (dateCounter.get(date) ?? 0) + 1);

      if (courseLines.length === 0) {
        courseLineCounter.set("Khong ro", (courseLineCounter.get("Khong ro") ?? 0) + 1);
      } else {
        for (const courseLine of courseLines) {
          courseLineCounter.set(courseLine, (courseLineCounter.get(courseLine) ?? 0) + 1);
        }
      }
    }
  }

  const summaryByCenterMap = new Map(summaryByCenter.map((item) => [item.centerName, item]));
  const centerNames = new Set<string>([
    ...Array.from(centerCounter.keys()),
    ...Array.from(summaryByCenterMap.keys()),
  ]);

  const byCenter: WaitingDetailCenterRow[] = Array.from(centerNames).map((centerName) => {
    const detail = centerCounter.get(centerName) ?? { waiting: 0, total: 0 };
    const summary = summaryByCenterMap.get(centerName);
    const summaryWaitingCases = summary?.waitingCaseCount ?? 0;
    return {
      centerName,
      detailWaitingCases: detail.waiting,
      detailTotalCases: detail.total,
      detailWaitingRate: formatPercent(detail.waiting, detail.total),
      summaryWaitingCases,
      summaryWaitingRate: summary?.waitingRate ?? "-",
      deltaCases: detail.waiting - summaryWaitingCases,
    };
  }).sort((a, b) => b.detailWaitingCases - a.detailWaitingCases || a.centerName.localeCompare(b.centerName));

  const byType: WaitingDetailByType[] = Array.from(typeCounter.entries())
    .map(([type, counter]) => ({
      type,
      waitingCases: counter.waiting,
      totalCases: counter.total,
      waitingRate: formatPercent(counter.waiting, counter.total),
    }))
    .sort((a, b) => b.waitingCases - a.waitingCases || a.type.localeCompare(b.type));

  const byCourseLine: WaitingDetailByCourseLine[] = Array.from(courseLineCounter.entries())
    .map(([courseLine, waitingCases]) => ({ courseLine, waitingCases }))
    .sort((a, b) => b.waitingCases - a.waitingCases || a.courseLine.localeCompare(b.courseLine));

  const byDate: WaitingDetailByDate[] = Array.from(dateCounter.entries())
    .map(([date, waitingCases]) => ({ date, waitingCases }))
    .sort((a, b) => dateSortKey(a.date) - dateSortKey(b.date));

  return {
    totalCases,
    totalWaitingCases,
    overallWaitingRate: formatPercent(totalWaitingCases, totalCases),
    centerCount: byCenter.filter((row) => row.detailWaitingCases > 0 || row.summaryWaitingCases > 0).length,
    cases,
    byCenter,
    byType,
    byCourseLine,
    byDate,
  };
}

export async function getWaitingCasesByCenter(): Promise<WaitingCaseByCenter[]> {
  const response = await fetch(buildWaitingSheetCsvUrl(), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to fetch waiting cases CSV: ${response.status}`);
  }

  const csvContent = await response.text();
  const rows = parseCsvRows(csvContent);
  const caseCountByCenter = new Map<string, number>();
  const waitingRateByCenter = new Map<string, string>();

  // Format A: detailed rows, each row has status and center.
  for (const row of rows) {
    const status = pickValue(row, ["status", "trang thai", "state", "tinh trang"]);
    if (!isWaitingStatus(status)) {
      continue;
    }

    const centerName =
      pickValueOrdered(row, ["centre", "centre name", "centre_name", "co so", "campus", "branch", "bu"]) ||
      "Chưa rõ cơ sở";
    caseCountByCenter.set(centerName, (caseCountByCenter.get(centerName) ?? 0) + 1);
    if (!waitingRateByCenter.has(centerName)) {
      waitingRateByCenter.set(centerName, "-");
    }
  }

  // Format B: aggregated rows with columns like centre_name + WAITING Cases.
  if (caseCountByCenter.size === 0) {
    const table = parseCsvTable(csvContent);
    const headerIndex = table.findIndex((row) => {
      const normalizedCells = row.map((cell) => normalizeKey(cell));
      return normalizedCells.includes("centrename") && normalizedCells.includes("waitingcases");
    });

    if (headerIndex >= 0) {
      const headerRow = table[headerIndex].map((cell) => normalizeKey(cell));
      const centerColIndex = headerRow.findIndex((key) => key === "centrename" || key === "centre");
      const waitingColIndex = headerRow.findIndex((key) => key === "waitingcases" || key === "waiting");
      const waitingRateColIndex = headerRow.findIndex((key) => key === "waitingrate");

      if (centerColIndex >= 0 && waitingColIndex >= 0) {
        for (let i = headerIndex + 1; i < table.length; i += 1) {
          const currentRow = table[i];
          const centerName = normalizeText(currentRow[centerColIndex]);
          const waitingCasesRaw = normalizeText(currentRow[waitingColIndex]);
          const waitingRateRaw = waitingRateColIndex >= 0 ? normalizeText(currentRow[waitingRateColIndex]) : "";

          if (!centerName) {
            continue;
          }

          if (normalizeKey(centerName).includes("grandtotal")) {
            break;
          }

          const waitingCount = parseStudentCount(waitingCasesRaw);
          caseCountByCenter.set(centerName, waitingCount);
          waitingRateByCenter.set(centerName, normalizeWaitingRate(waitingRateRaw));
        }
      }
    }
  }

  // Final fallback: read whatever shape has recognizable columns.
  if (caseCountByCenter.size === 0) {
    for (const row of rows) {
      const centerName = pickValueOrdered(row, ["centre_name", "centre", "center_name", "co so", "campus", "branch", "bu"]);
      if (!centerName || normalizeKey(centerName).includes("grandtotal")) {
        continue;
      }
      const waitingCasesRaw = pickValueOrdered(row, ["waiting cases", "waiting_case", "waiting cases total", "waiting"]);
      const waitingRateRaw = pickValueOrdered(row, ["waiting rate", "waiting_rate", "rate"]);
      const waitingCount = parseStudentCount(waitingCasesRaw);
      caseCountByCenter.set(centerName, waitingCount);
      waitingRateByCenter.set(centerName, normalizeWaitingRate(waitingRateRaw));
    }
  }

  return Array.from(caseCountByCenter.entries())
    .filter(([, waitingCaseCount]) => waitingCaseCount > 0)
    .map(([centerName, waitingCaseCount]) => ({
      centerName,
      waitingCaseCount,
      waitingRate: waitingRateByCenter.get(centerName) ?? "-",
    }))
    .sort((a, b) => b.waitingCaseCount - a.waitingCaseCount || a.centerName.localeCompare(b.centerName));
}

async function fetchStudentCountMap(): Promise<Map<string, number>> {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) return new Map();

  // Read from gid=0 (main sheet) which has the student_count column at col S.
  // An optional override sheet name can be set via GOOGLE_SHEET_CLASSES_NAME.
  const classesSheetName = process.env.GOOGLE_SHEET_CLASSES_NAME;
  const url = classesSheetName
    ? `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&sheet=${encodeURIComponent(classesSheetName)}`
    : `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return new Map();
    const rows = parseCsvRows(await res.text());
    const map = new Map<string, number>();
    for (const row of rows) {
      const cn = pickValue(row, ["class", "lop", "class_name"]);
      const countRaw = pickValue(row, ["student_count", "students", "student_number", "so luong hoc vien"]);
      const count = parseStudentCount(countRaw);
      if (cn && count > 0) map.set(cn, count);
    }
    return map;
  } catch {
    return new Map();
  }
}

function getGoogleSheetCsvUrl(): string {
  const directCsvUrl = process.env.GOOGLE_SHEET_CSV_URL;
  if (directCsvUrl) {
    return directCsvUrl;
  }

  const sheetId = process.env.GOOGLE_SHEET_ID;
  const sheetName = process.env.GOOGLE_SHEET_NAME;
  const gid = process.env.GOOGLE_SHEET_GID ?? "0";

  if (!sheetId) {
    throw new Error("Missing GOOGLE_SHEET_CSV_URL or GOOGLE_SHEET_ID in environment");
  }

  if (sheetName) {
    // export endpoint returns ALL rows regardless of active filters on the sheet.
    // gviz/tq was previously used here but it respects sheet filter views, causing rows to be hidden.
    return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&sheet=${encodeURIComponent(sheetName)}`;
  }

  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

export async function getTeacherSchedules(): Promise<TeacherScheduleRow[]> {
  const csvUrl = getGoogleSheetCsvUrl();
  const [response, studentCountMap] = await Promise.all([
    fetch(csvUrl, { cache: "no-store" }),
    fetchStudentCountMap(),
  ]);

  if (!response.ok) {
    throw new Error(`Unable to fetch Google Sheet CSV: ${response.status}`);
  }

  const csvContent = await response.text();
  const rawRows = parseCsvRows(csvContent);

  const expandedRows: TeacherScheduleRow[] = [];

  for (const row of rawRows) {
    const className = pickValue(row, ["class", "lop", "class_name"]);
    // "centre" is the actual column name; keep legacy aliases for backward compatibility.
    const centerName = pickValue(row, ["centre", "centre name", "centre_name", "co so", "campus", "branch"]);
    const weekdayRaw = pickValue(row, ["date", "thu", "weekday", "day", "ngay trong tuan"]);
    const slotValue = pickValue(row, ["time", "ca", "slot", "time_slot"]);
    const startDateRaw = pickValueOrdered(row, ["ngay bat dau", "ngay_bat_dau", "date start", "start_date"]);
    const endDateRaw = pickValueOrdered(row, ["ngay ket thuc", "ngay_ket_thuc", "date end", "end_date"]);
    // Read all teachers from the teachers/lec column; role is embedded as "(Lecturer)" or "(Teacher Assistant)".
    const allTeachersRaw = pickValueOrdered(row, ["lec", "teachers", "teacher"]);
    const taColumnRaw = pickValue(row, ["ta"]);
    const course = pickValue(row, ["course-f", "course"]);
    const status = pickValue(row, ["status"]);
    const studentCountRaw = pickValue(row, [
      "student_count",
      "students",
      "student_number"
    ]);

    // Derive weekday from start_date ISO datetime (UTC+7) when no dedicated weekday column exists.
    const derivedWeekday = deriveWeekdayFromIso(startDateRaw);
    const weekday: WeekdayLabel = weekdayRaw ? normalizeWeekday(weekdayRaw) : (derivedWeekday ?? "T2");
    // Derive slot from start_date/end_date ISO datetimes (UTC+7) when no dedicated slot column exists.
    const derivedSlot = deriveSlotFromIso(startDateRaw, endDateRaw);
    const effectiveSlot = slotValue || derivedSlot;
    const slotLabel = resolveSlotLabel(effectiveSlot, "", "");
    const fixedSlotLabel = resolveFixedSlotLabel(slotLabel);
    const termStartDate = parseDateValue(startDateRaw);
    const termEndDate = parseDateValue(endDateRaw);
    const allEntries = extractTeacherEntries(allTeachersRaw);
    // Entries tagged (Lecturer) → main teacher; if multiple, use the last one.
    const lecEntries = allEntries.filter((e) => /lecturer/i.test(e.role));
    // Entries tagged (Teacher Assistant) → TA; fall back to dedicated TA column.
    const taEntriesFromRole = allEntries.filter((e) => /assistant/i.test(e.role));
    const taEntriesFromColumn = extractTeacherEntries(taColumnRaw);
    const taEntries = taEntriesFromRole.length > 0 ? taEntriesFromRole : taEntriesFromColumn;
    // Entries not tagged as Lecturer or TA → Supply.
    const supplyEntries = allEntries.filter((e) => !/lecturer/i.test(e.role) && !/assistant/i.test(e.role));
    const teacherEntries = mergeTeacherEntries(lecEntries, taEntries, supplyEntries);
    // If no (Lecturer) tag found, fall back to last entry in all entries.
    const teacherInfo = lecEntries.at(-1) ?? allEntries.at(-1) ?? { teacherName: "", teacherCode: "", role: "" };
    const taInfo = taEntries[0] ?? { teacherName: "", teacherCode: "", role: "" };
    const supplyInfo = supplyEntries[0] ?? { teacherName: "", teacherCode: "", role: "" };
    const supplyNameFull = supplyEntries.map((e) => e.teacherName).filter(Boolean).join(", ");
    const slotTime = splitSlot(slotLabel);
    const studentCount = parseStudentCount(studentCountRaw) || studentCountMap.get(className) || 0;

    if (!className || !termStartDate || !termEndDate) {
      continue;
    }

    let sessionDate = getFirstSessionDate(termStartDate, weekday);
    while (sessionDate.getTime() <= termEndDate.getTime()) {
      const weekStart = startOfWeekMonday(sessionDate);
      const weekEnd = endOfWeekSunday(weekStart);

      expandedRows.push({
        teacherCode: teacherInfo.teacherCode,
        teacherName: teacherInfo.teacherName,
        taName: taInfo.teacherName,
        supplyName: supplyNameFull,
        teacherNames: teacherEntries.map((entry) => entry.teacherName).filter(Boolean),
        weekday,
        slotLabel,
        fixedSlotLabel,
        isSpecialSlot: slotLabel !== fixedSlotLabel,
        startTime: slotTime.startTime,
        endTime: slotTime.endTime,
        className,
        studentCount,
        centerName,
        room: "",
        status,
        course,
        termStartDate: toDisplayDate(termStartDate),
        termEndDate: toDisplayDate(termEndDate),
        sessionDate: toDisplayDate(sessionDate),
        sessionDateKey: toIsoDate(sessionDate),
        weekKey: toIsoDate(weekStart),
        weekLabel: formatWeekLabel(weekStart, weekEnd),
        note: "",
      });

      sessionDate = new Date(sessionDate.getTime() + 7 * DAY_MS);
    }
  }

  return expandedRows;
}

export function buildWeeklySlots(): WeeklySlot[] {
  return [...BASE_WEEKLY_SLOTS].sort((a, b) => {
    const firstA = Number(a.label.split(":")[0]);
    const firstB = Number(b.label.split(":")[0]);

    if (!Number.isNaN(firstA) && !Number.isNaN(firstB)) {
      return firstA - firstB;
    }

    return a.label.localeCompare(b.label);
  });
}

export function buildWeeklyMatrix(rows: TeacherScheduleRow[], slots: WeeklySlot[], selectedWeekKey: string) {
  const filteredRows = selectedWeekKey ? rows.filter((row) => row.weekKey === selectedWeekKey) : rows;

  return slots.map((slot) => {
    const byDay = WEEKDAYS.map((day) => {
      return filteredRows.filter((row) => row.weekday === day && row.fixedSlotLabel === slot.label);
    });

    return {
      slot,
      byDay,
    };
  });
}
