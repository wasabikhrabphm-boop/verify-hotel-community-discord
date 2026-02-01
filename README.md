# Verify Hotel community Discord
เว็บตัวอย่างสำหรับ "Verify Hotel community | ยืนยันอายุขั้นสูง" (พร้อมรัน)

## สิ่งที่ทำได้/ไม่ได้
- แสดงผลยืนยันอายุแบบ Session-based (กันปลอมได้ดีกว่า “ส่งรูป”)
- แสดงข้อมูลแบบจำกัด: DOB + อายุ + สถานะ (ไม่เก็บ/ไม่โชว์ภาพบัตรประชาชนหรือภาพหน้า)
- “ห้ามแคปหน้าจอ 100%” ทำไม่ได้บนเว็บเบราว์เซอร์ (เป็นข้อจำกัดของ OS) แต่มีจอดำเมื่อสลับแท็บเพื่อช่วยลดบางกรณี

## โหมดใช้งาน
- DEMO (ค่าเริ่มต้น): ไม่ต้องใช้คีย์ เหมาะทดสอบหน้าเว็บ/โฟลว์
- VERIFF: ต้องมี API key + webhook signature (สำหรับใช้งานจริง)

## รันในเครื่อง
1) ติดตั้ง Node.js 18+
2) ในโฟลเดอร์โปรเจกต์ รัน:
   npm install
3) คัดลอกไฟล์ .env.example เป็น .env แล้วแก้ค่า:
   - PROVIDER_MODE=demo (ทดสอบ) หรือ veriff (ใช้งานจริง)
   - ตั้ง ADMIN_PASSWORD ให้แข็งแรง
4) เริ่มรัน:
   npm start
5) เปิดเว็บ:
   http://localhost:3000

## Admin Panel
- เปิด: /admin.html
- ล็อกอินด้วย ADMIN_EMAIL + ADMIN_PASSWORD (ไม่ทำระบบเข้าอัตโนมัติ/แบ็คดอร์เพื่อความปลอดภัย)

## Deploy ให้ได้ “ลิงก์เว็บ”
คุณต้องนำโปรเจกต์นี้ไป deploy เอง (เช่น Render / Railway / Vercel+Serverless / VPS)
- แนะนำ Render: สร้าง Web Service
  - Build: npm install
  - Start: npm start
  - ตั้ง env ตามไฟล์ .env.example (PUBLIC_BASE_URL เป็นโดเมนที่ deploy แล้ว)
