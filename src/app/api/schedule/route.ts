import { buildWeeklySlots, getTeacherSchedules } from "@/lib/google-sheet";
import { NextResponse } from "next/server";

export const revalidate = 0; // always fetch fresh data

export async function GET() {
  try {
    const rows = await getTeacherSchedules();
    const slots = buildWeeklySlots();
    return NextResponse.json({ rows, slots });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
