export type WeekdayLabel = "T2" | "T3" | "T4" | "T5" | "T6" | "T7" | "CN";

export type TeacherScheduleRow = {
  teacherCode: string;
  teacherName: string;
  taName: string;
  supplyName: string;
  teacherNames: string[];
  weekday: WeekdayLabel;
  slotLabel: string;
  fixedSlotLabel: string;
  isSpecialSlot: boolean;
  startTime: string;
  endTime: string;
  className: string;
  studentCount: number;
  centerName: string;
  room: string;
  status: string;
  course: string;
  termStartDate: string;
  termEndDate: string;
  sessionDate: string;
  sessionDateKey: string;
  weekKey: string;
  weekLabel: string;
  note: string;
};

export type WeeklySlot = {
  label: string;
  period: "Sang" | "Chieu" | "Toi" | "Dac biet";
};

export type WaitingCaseByCenter = {
  centerName: string;
  waitingCaseCount: number;
  waitingRate: string;
};

export type WaitingDetailCenterRow = {
  centerName: string;
  detailWaitingCases: number;
  detailTotalCases: number;
  detailWaitingRate: string;
  summaryWaitingCases: number;
  summaryWaitingRate: string;
  deltaCases: number;
};

export type WaitingDetailByType = {
  type: string;
  waitingCases: number;
  totalCases: number;
  waitingRate: string;
};

export type WaitingDetailByCourseLine = {
  courseLine: string;
  waitingCases: number;
};

export type WaitingDetailByDate = {
  date: string;
  waitingCases: number;
};

export type WaitingDetailCase = {
  centerName: string;
  type: string;
  courseLines: string[];
  date: string;
  outcomeStatus: string;
};

export type WaitingDetailReport = {
  totalCases: number;
  totalWaitingCases: number;
  overallWaitingRate: string;
  centerCount: number;
  cases: WaitingDetailCase[];
  byCenter: WaitingDetailCenterRow[];
  byType: WaitingDetailByType[];
  byCourseLine: WaitingDetailByCourseLine[];
  byDate: WaitingDetailByDate[];
};

export const BASE_WEEKLY_SLOTS: WeeklySlot[] = [
  { label: "08:00 - 10:00", period: "Sang" },
  { label: "10:00 - 12:00", period: "Sang" },
  { label: "14:00 - 16:00", period: "Chieu" },
  { label: "16:00 - 18:00", period: "Chieu" },
  { label: "18:00 - 20:00", period: "Toi" },
  { label: "19:00 - 21:00", period: "Toi" },
];

export const WEEKDAYS: WeekdayLabel[] = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
