import Papa from "papaparse";
import { BASE_WEEKLY_SLOTS, TeacherScheduleRow, WEEKDAYS, WeekdayLabel, WeeklySlot } from "@/types/schedule";

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

function inferTeacherInfo(rawValue: string): { teacherName: string; teacherCode: string } {
  const source = rawValue.trim();
  if (!source) {
    return { teacherName: "", teacherCode: "" };
  }

  // Example: "Do Truong Vu - vudt (Lecturer)"
  const match = source.match(/^(.*?)\s*-\s*([^(]+?)(?:\s*\(|$)/);
  if (match) {
    return {
      teacherName: match[1].trim(),
      teacherCode: match[2].trim().toLowerCase(),
    };
  }

  return { teacherName: source, teacherCode: "" };
}

function extractTeacherEntries(rawValue: string): Array<{ teacherName: string; teacherCode: string }> {
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
  ...groups: Array<Array<{ teacherName: string; teacherCode: string }>>
): Array<{ teacherName: string; teacherCode: string }> {
  const merged: Array<{ teacherName: string; teacherCode: string }> = [];
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
    // gviz endpoint supports selecting a worksheet by visible tab name.
    return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  }

  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

export async function getTeacherSchedules(): Promise<TeacherScheduleRow[]> {
  const csvUrl = getGoogleSheetCsvUrl();
  const response = await fetch(csvUrl, {
    next: { revalidate: 300 },
  });

  if (!response.ok) {
    throw new Error(`Unable to fetch Google Sheet CSV: ${response.status}`);
  }

  const csvContent = await response.text();
  const rawRows = parseCsvRows(csvContent);

  const expandedRows: TeacherScheduleRow[] = [];

  for (const row of rawRows) {
    const className = pickValue(row, ["class", "lop", "class_name"]);
    const centerName = pickValue(row, ["centre name", "centre_name", "co so", "campus", "branch"]);
    const weekdayRaw = pickValue(row, ["date", "thu", "weekday", "day", "ngay trong tuan"]);
    // "Time" holds the display slot; "Ngay bat dau" / "Ngay ket thuc" hold dd/MM/yyyy dates.
    const slotValue = pickValue(row, ["time", "ca", "slot", "time_slot"]);
    // Prefer dd/MM/yyyy cols (Ngay bat dau) over ISO cols (Date Start) to avoid UTC-offset issues.
    const startDateRaw = pickValueOrdered(row, ["ngay bat dau", "ngay_bat_dau", "date start", "start_date"]);
    const endDateRaw = pickValueOrdered(row, ["ngay ket thuc", "ngay_ket_thuc", "date end", "end_date"]);
    // LEC = clean primary lecturer; keep Mentor for complete teacher list.
    const lecRaw = pickValueOrdered(row, ["lec", "teacher", "mentor"]);
    const mentorRaw = pickValue(row, ["mentor"]);
    const taRaw = pickValue(row, ["ta"]);
    const course = pickValue(row, ["course-f", "course"]);
    const status = pickValue(row, ["status"]);
    const studentCountRaw = pickValue(row, [
      "so luong hoc vien",
      "si so",
      "student count",
      "students",
      "student_number",
    ]);

    const weekday = normalizeWeekday(weekdayRaw);
    const slotLabel = resolveSlotLabel(slotValue, "", "");
    const fixedSlotLabel = resolveFixedSlotLabel(slotLabel);
    const termStartDate = parseDateValue(startDateRaw);
    const termEndDate = parseDateValue(endDateRaw);
    const lecEntries = extractTeacherEntries(lecRaw);
    const mentorEntries = extractTeacherEntries(mentorRaw);
    const taEntries = extractTeacherEntries(taRaw);
    const teacherEntries = mergeTeacherEntries(lecEntries, mentorEntries, taEntries);
    const teacherInfo = lecEntries[0] ?? mentorEntries[0] ?? { teacherName: "", teacherCode: "" };
    const taInfo = taEntries[0] ?? { teacherName: "", teacherCode: "" };
    const slotTime = splitSlot(slotLabel);
    const studentCount = parseStudentCount(studentCountRaw);

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
