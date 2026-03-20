import { buildWeeklySlots, getTeacherSchedules, getWaitingCasesByCenter, getWaitingDetailReport } from "@/lib/google-sheet";
import { NextResponse } from "next/server";

export const revalidate = 0; // always fetch fresh data

export async function GET() {
  try {
    const [rows, waitingCasesByCenter] = await Promise.all([getTeacherSchedules(), getWaitingCasesByCenter()]);
    const waitingDetailReport = await getWaitingDetailReport(waitingCasesByCenter);
    const slots = buildWeeklySlots();
    return NextResponse.json({ rows, slots, waitingCasesByCenter, waitingDetailReport });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
