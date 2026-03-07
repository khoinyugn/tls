# Teaching Leader System

Hệ thống quản lý lịch giảng dạy dành cho đội ngũ vận hành/điều phối, xây dựng bằng **Next.js** và đọc dữ liệu trực tiếp từ **Google Sheet (CSV)**.

## Mục tiêu hệ thống

- Theo dõi lịch dạy theo tuần theo từng khung giờ.
- Quản lý danh sách lớp và trạng thái vận hành.
- Tổng hợp báo cáo nhanh theo lớp, giáo viên, khung giờ.
- Hỗ trợ bộ lọc linh hoạt theo cơ sở, khối, tuần, slot và trạng thái.

## Tính năng chính

- `Lịch theo tuần`: hiển thị timetable theo `T2 -> CN`, có nhóm theo cơ sở và hiển thị giáo viên/TA.
- `Danh sách lớp`: xem thông tin lớp theo bảng, tìm kiếm nhanh theo tên lớp.
- `Report phân tích`: thống kê tổng quan và phân tích tải dạy theo khung giờ/giáo viên.
- `Bộ lọc đa chiều`: cơ sở, khối, khung giờ, tuần, trạng thái `RUNNING`.
- `Đồng bộ dữ liệu`: nút làm mới dữ liệu từ nguồn Google Sheet.

## Công nghệ sử dụng

- `Next.js 16`
- `React 19`
- `TypeScript`
- `PapaParse` (parse CSV)
- `ESLint`

## Cài đặt và chạy local

1. Cài dependencies:

```bash
npm install
```

2. Tạo file môi trường từ mẫu:

```bash
cp .env.example .env.local
```

3. Cấu hình nguồn Google Sheet trong `.env.local` theo một trong ba cách:

- Cách 1: dùng link CSV trực tiếp
	- `GOOGLE_SHEET_CSV_URL`
- Cách 2: dùng `sheet id` + `gid`
	- `GOOGLE_SHEET_ID`
	- `GOOGLE_SHEET_GID`
- Cách 3: dùng `sheet id` + tên tab
	- `GOOGLE_SHEET_ID`
	- `GOOGLE_SHEET_NAME`

4. Chạy ứng dụng:

```bash
npm run dev
```

5. Truy cập:

- `http://localhost:3000`

## Scripts

- `npm run dev`: chạy môi trường phát triển.
- `npm run build`: build production.
- `npm run start`: chạy production server sau khi build.
- `npm run lint`: kiểm tra chuẩn code.

## Yêu cầu dữ liệu đầu vào (Google Sheet)

Hệ thống có cơ chế map cột linh hoạt (tên cột tiếng Việt hoặc tiếng Anh). Nên đảm bảo có các nhóm thông tin sau:

- Thông tin lớp: tên lớp, trạng thái, cơ sở, khóa học.
- Thời gian học: thứ trong tuần, khung giờ hoặc giờ bắt đầu/kết thúc.
- Thời hạn lớp: ngày bắt đầu, ngày kết thúc.
- Nhân sự: giáo viên chính, mã giáo viên, trợ giảng (nếu có).

Lưu ý:

- Mỗi dòng dữ liệu được xem là một lớp/buổi theo lịch nguồn.
- Hệ thống sẽ chuẩn hóa thứ trong tuần và mở rộng hiển thị theo từng tuần thực tế.
- Các slot ngoài khung chuẩn vẫn được nhận diện và hiển thị.

## Cấu trúc thư mục chính

```text
src/
	app/
		layout.tsx              # Metadata, font và layout gốc
		page.tsx                # Entry server component
		globals.css             # Toàn bộ style hệ thống
	components/
		schedule-dashboard.tsx  # Dashboard chính (sidebar + modules)
	lib/
		google-sheet.ts         # Parse CSV, chuẩn hóa dữ liệu lịch
	types/
		schedule.ts             # Kiểu dữ liệu lịch dạy
```

## Triển khai (Deploy)

- Có thể deploy lên Vercel hoặc nền tảng tương đương chạy Next.js.
- Bắt buộc cấu hình biến môi trường ở môi trường deploy tương tự `.env.local`.
- Nếu thiếu biến môi trường, ứng dụng sẽ không tải được dữ liệu lịch.

## Thông tin sản phẩm

- Tên hệ thống: `Teaching Leader System`
- Đơn vị vận hành: `HCM1&4`
