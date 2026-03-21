import {
  buildWeeklySlots,
  getTeacherSchedules,
  getWaitingCasesByCenter,
  getWaitingCasesByCourseLineSummary,
  getWaitingDetailReport,
} from "@/lib/google-sheet";
import { NextResponse } from "next/server";

export const revalidate = 0; // always fetch fresh data

export async function GET() {
  try {
    const [rows, waitingCasesByCenter, waitingCasesByCourseLineSummary] = await Promise.all([
      getTeacherSchedules(),
      getWaitingCasesByCenter(),
      getWaitingCasesByCourseLineSummary(),
    ]);
    const waitingDetailReport = await getWaitingDetailReport(waitingCasesByCenter);
    const slots = buildWeeklySlots();
    return NextResponse.json({ rows, slots, waitingCasesByCenter, waitingCasesByCourseLineSummary, waitingDetailReport });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
