# Teacher Schedule Manager (Next.js + Google Sheet)

Ung dung quan ly thong tin lich giao vien tu Google Sheet voi 2 module:

- Module 1: Xem lich day ca nhan theo ma giao vien.
- Module 2: Xem lich day theo tuan voi cac khung gio co ban va khung gio dac biet.

## 1. Cai dat

```bash
npm install
cp .env.example .env.local
```

Cap nhat `.env.local` theo 1 trong 3 cach:

- Cach 1: `GOOGLE_SHEET_CSV_URL` (link CSV direct sau khi Publish to web).
- Cach 2: `GOOGLE_SHEET_ID` + `GOOGLE_SHEET_GID`.
- Cach 3: `GOOGLE_SHEET_ID` + `GOOGLE_SHEET_NAME` (doc theo ten tab, vi du `f_data`).

Chay local:

```bash
npm run dev
```

Mo `http://localhost:3000`.

## 2. Dinh dang cot du lieu Google Sheet

Ung dung tu map ten cot, ban co the dung cot tieng Viet hoac tieng Anh.
Nen co cac cot sau:

- `ma_giao_vien` hoac `teacher_code`
- `ten_giao_vien` hoac `teacher_name`
- `Date` hoac `thu` hoac `weekday` (gia tri thu trong tuan, vi du `Saturday`)
- `Time` hoac `ca` hoac `slot` (vi du `14:00 - 16:00`)
- `gio_bat_dau` / `gio_ket_thuc` (khong bat buoc neu da co `ca`)
- `lop` hoac `class_name`
- `phong` hoac `room`
- `tuan` hoac `week` (de loc theo tuan)
- `ghi_chu` hoac `note`

Luu y quan trong:

- Moi dong du lieu duoc xem la 1 lop.
- `Ngay bat dau` va `Ngay ket thuc` duoc dung de tao lich theo tung tuan thuc te.
- `Date` duoc hieu la thu trong tuan cua lop, he thong se sinh ra cac ngay hoc cu the trong khoang thoi gian lop chay.

## 3. Khung gio mac dinh Module 2

- Sang: `08:00 - 10:00`, `10:00 - 12:00`
- Chieu: `14:00 - 16:00`, `16:00 - 18:00`
- Toi: `18:00 - 20:00`, `19:00 - 21:00`

Moi khung gio khac co trong Sheet se duoc hien thi tu dong la khung gio dac biet.
