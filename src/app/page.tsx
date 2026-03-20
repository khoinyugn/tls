import ScheduleDashboard from "@/components/schedule-dashboard";
import { buildWeeklySlots, getTeacherSchedules, getWaitingCasesByCenter, getWaitingDetailReport } from "@/lib/google-sheet";

export const dynamic = "force-dynamic";

async function loadScheduleData() {
  try {
    const [rows, waitingCasesByCenter] = await Promise.all([getTeacherSchedules(), getWaitingCasesByCenter()]);
    const waitingDetailReport = await getWaitingDetailReport(waitingCasesByCenter);
    const slots = buildWeeklySlots();

    return { rows, slots, waitingCasesByCenter, waitingDetailReport, error: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      rows: [],
      slots: [],
      waitingCasesByCenter: [],
      waitingDetailReport: {
        totalCases: 0,
        totalWaitingCases: 0,
        overallWaitingRate: "-",
        centerCount: 0,
        cases: [],
        byCenter: [],
        byType: [],
        byCourseLine: [],
        byDate: [],
      },
      error: message,
    };
  }
}

export default async function Home() {
  const { rows, slots, waitingCasesByCenter, waitingDetailReport, error } = await loadScheduleData();

  if (!error) {
    return (
      <ScheduleDashboard
        rows={rows}
        slots={slots}
        waitingCasesByCenter={waitingCasesByCenter}
        waitingDetailReport={waitingDetailReport}
      />
    );
  }

  return (
    <div className="app-shell">
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
        <footer className="sidebar-footer">Copyright © HCM1&4. All rights reserved.</footer>
      </aside>
      <main className="content-area">
        <section className="content-section">
          <div className="content-header">
            <div>
              <p className="content-eyebrow">Lỗi hệ thống</p>
              <h2 className="content-title">Không thể tải dữ liệu</h2>
            </div>
          </div>
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" className="empty-icon">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
              <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <p>{error}</p>
            <p>
              Kiểm tra file <code>.env.local</code> với biến <code>GOOGLE_SHEET_ID</code>.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
