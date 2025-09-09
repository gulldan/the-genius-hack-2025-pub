import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";

export const db = new Database("volunteer.db");

// Ensure schema exists before preparing statements
const ddl = readFileSync("src/sql/ddl.sql", "utf8");
db.exec(ddl);

export const insertUser = db.prepare(
	`INSERT INTO users (name,email,phone,roles) VALUES (?1,?2,?3,?4)`,
);

export const getUserById = db.prepare(`SELECT * FROM users WHERE id=?1`);

export const updateUserSkills = db.prepare(
	`UPDATE users SET skills=?2 WHERE id=?1`,
);

export const updateUserNotifications = db.prepare(
	`UPDATE users SET notifications_telegram=?2, notifications_email=?3, notifications_sms=?4, interests=?5 WHERE id=?1`,
);

export const insertEvent = db.prepare(
	`INSERT INTO events (org_id,slug,title,short_description,long_description,location_type,address,city,latitude,longitude,timezone,schedule_type,start_date,end_date,category,tags,visibility,status) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)`,
);

export const updateEvent = db.prepare(
	`UPDATE events SET title=?2, short_description=?3, long_description=?4, location_type=?5, address=?6, city=?7, latitude=?8, longitude=?9, timezone=?10, schedule_type=?11, start_date=?12, end_date=?13, category=?14, tags=?15, updated_at=datetime('now') WHERE id=?1`,
);

export const insertRole = db.prepare(
	`INSERT INTO roles (event_id,title,description,required_skills,min_age,required_documents) VALUES (?1,?2,?3,?4,?5,?6)`,
);

export const insertShift = db.prepare(
        `INSERT INTO shifts (role_id,start_time,end_time,capacity,qr_id) VALUES (?1,?2,?3,?4,?5)`,
);

export const updateEventTelegramLink = db.prepare(
        `UPDATE events SET telegram_event_link=?2 WHERE id=?1`,
);

export const updateShiftTelegramLink = db.prepare(
        `UPDATE shifts SET telegram_shift_link=?2 WHERE id=?1`,
);

export const updateShiftCheckinLink = db.prepare(
        `UPDATE shifts SET telegram_checkin_link=?2 WHERE id=?1`,
);

export const upcomingEvents = db.query(
	`SELECT e.*, o.name as org_name FROM events e JOIN organizations o ON e.org_id = o.id WHERE e.start_date >= date('now') AND e.status = 'published' AND e.visibility IN ('public','unlisted') ORDER BY e.start_date`,
);

export const eventsByOrg = db.prepare(
	`SELECT e.*, o.name as org_name FROM events e JOIN organizations o ON e.org_id = o.id WHERE o.id = ?1 ORDER BY e.start_date DESC`,
);

export const eventById = db.prepare(
	`SELECT e.*, o.name as org_name FROM events e JOIN organizations o ON e.org_id = o.id WHERE e.id = ?1`,
);

export const rolesByEvent = db.prepare(
	`SELECT r.* FROM roles r WHERE r.event_id = ?1`,
);

export const shiftsByRole = db.prepare(
	`SELECT s.*, 
         (s.capacity - COALESCE(a.approved_count,0)) as slots_available,
         COALESCE(a.waitlist_count,0) as waitlist_count
         FROM shifts s LEFT JOIN (
           SELECT shift_id, 
             SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_count,
             SUM(CASE WHEN status = 'waitlisted' THEN 1 ELSE 0 END) as waitlist_count
           FROM applications 
           WHERE status IN ('approved','waitlisted')
           GROUP BY shift_id
         ) a ON s.id = a.shift_id 
         WHERE s.role_id = ?1 ORDER BY s.start_time`,
);

export const roleById = db.prepare(`SELECT * FROM roles WHERE id = ?1`);

// Application management
export const createApplication = db.prepare(
	`INSERT INTO applications (user_id, event_id, role_id, shift_id, status, answers, uploaded_files) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
);

export const updateApplicationStatusQuery = db.prepare(
	`UPDATE applications SET status=?2, decided_at=datetime('now') WHERE id=?1`,
);

export const applicationByUserShift = db.prepare(
	`SELECT * FROM applications WHERE user_id=?1 AND shift_id=?2`,
);

export const applicationsForEvent = db.prepare(
	`SELECT a.*, u.name as user_name, u.email, u.phone, r.title as role_title, s.start_time, s.end_time
   FROM applications a
   JOIN users u ON a.user_id = u.id
   JOIN roles r ON a.role_id = r.id
   JOIN shifts s ON a.shift_id = s.id
   WHERE a.event_id = ?1`,
);

export const applicationsWithAttendanceByEvent = db.prepare(
	`SELECT a.id as application_id,
                a.shift_id,
                u.name as user_name,
                u.email,
                u.phone,
                r.title as role_title,
                strftime('%H:%M', s.start_time) as shift_start,
                strftime('%H:%M', s.end_time) as shift_end,
                COALESCE(att.status, 'registered') as status,
                strftime('%H:%M', att.checkin_at) as checkin_time,
                strftime('%H:%M', att.checkout_at) as checkout_time
   FROM applications a
   JOIN users u ON a.user_id = u.id
   JOIN roles r ON a.role_id = r.id
   JOIN shifts s ON a.shift_id = s.id
   LEFT JOIN attendance att ON att.application_id = a.id
   WHERE a.event_id = ?1`,
);

export const applicationById = db.prepare(
	`SELECT a.*, u.name as user_name, u.telegram_user_id,
   r.title as role_title, s.start_time, s.end_time,
   s.geofence_lat, s.geofence_lon, s.geofence_radius
   FROM applications a
   JOIN users u ON a.user_id = u.id
   JOIN roles r ON a.role_id = r.id
   JOIN shifts s ON a.shift_id = s.id
   WHERE a.id = ?1`,
);

// Attendance management
export const createAttendance = db.prepare(
	`INSERT INTO attendance (application_id, shift_id, status, checkin_source, checkin_location) VALUES (?1, ?2, ?3, ?4, ?5)`,
);

export const updateAttendance = db.prepare(
	`UPDATE attendance SET status=?2, checkin_at=?3, checkin_source=?4, checkin_location=?5 WHERE application_id=?1`,
);

export const checkoutAttendance = db.prepare(
	`UPDATE attendance SET status='checked_out', checkout_at=datetime('now'), hours_worked=?2 WHERE application_id=?1`,
);

export const createCheckoutAttendance = db.prepare(
	`INSERT INTO attendance (application_id, shift_id, status, checkout_at, hours_worked, checkin_source, checkin_location) VALUES (?1, ?2, 'checked_out', datetime('now'), ?3, 'manual', NULL)`,
);

export const verifyAttendance = db.prepare(
	`UPDATE attendance SET hours_worked=?2, hours_verified=1, verified_by=?3 WHERE application_id=?1`,
);

export const addUserHours = db.prepare(
	`UPDATE users SET hours_total = hours_total + ?2 WHERE id=?1`,
);

export const attendanceByApplication = db.prepare(
	`SELECT * FROM attendance WHERE application_id = ?1`,
);

export const approvedApplicationsByUser = db.prepare(
	`SELECT a.id, a.shift_id, e.title as event_title,
   r.title as role_title, e.address, s.start_time, s.end_time, s.qr_id
   FROM applications a
   JOIN events e ON a.event_id = e.id
   JOIN roles r ON a.role_id = r.id
   JOIN shifts s ON a.shift_id = s.id
   WHERE a.user_id = ?1 AND a.status = 'approved' AND s.start_time >= datetime('now')
   ORDER BY s.start_time`,
);

// Telegram integration
export const linkTelegramUser = db.prepare(
	`UPDATE users SET telegram_user_id=?2, telegram_username=?3, telegram_linked_at=datetime('now') WHERE id=?1`,
);

export const getUserByTelegramId = db.prepare(
	`SELECT * FROM users WHERE telegram_user_id=?1`,
);

// Search and filtering
export const searchEvents = db.prepare(
	`SELECT e.*, o.name as org_name,
   slot.slots_available, slot.application_count, slot.min_role_age, slot.role_skills
   FROM events e
   JOIN organizations o ON e.org_id = o.id
   LEFT JOIN (
     SELECT r.event_id,
       SUM(s.capacity - COALESCE(a.approved_count,0)) as slots_available,
       SUM(COALESCE(a.approved_count,0)) as application_count,
       MIN(r.min_age) as min_role_age,
       GROUP_CONCAT(r.required_skills, ',') as role_skills,
       MIN((julianday(s.end_time) - julianday(s.start_time)) * 24 * 60) as min_duration
     FROM roles r
     JOIN shifts s ON s.role_id = r.id
     LEFT JOIN (
       SELECT shift_id, COUNT(*) as approved_count
       FROM applications
       WHERE status = 'approved'
       GROUP BY shift_id
     ) a ON a.shift_id = s.id
     GROUP BY r.event_id
   ) slot ON slot.event_id = e.id
   WHERE e.status = 'published' AND e.visibility IN ('public','unlisted')
   AND (e.title LIKE ?1 OR e.short_description LIKE ?1 OR e.category LIKE ?1)
   AND (?2 IS NULL OR e.start_date >= ?2)
   AND (?3 IS NULL OR e.start_date <= ?3)
   AND (?4 IS NULL OR e.category = ?4)
   AND (?5 IS NULL OR e.address LIKE ?5)
   AND (?6 IS NULL OR e.location_type = ?6)
   AND (?7 IS NULL OR slot.min_role_age IS NULL OR slot.min_role_age <= ?7)
   AND (?8 IS NULL OR slot.role_skills LIKE ?8)
   AND (?9 IS NULL OR e.tags LIKE ?9)
   AND (?10 IS NULL OR slot.min_duration <= ?10)
   ORDER BY e.start_date`,
);

export const eventsByIds = (ids: number[]) => {
	if (ids.length === 0) return [] as unknown[];
	const placeholders = ids.map(() => "?").join(",");
	return db
		.query(
			`SELECT e.*, o.name as org_name FROM events e
           JOIN organizations o ON e.org_id = o.id
           WHERE e.id IN (${placeholders})`,
		)
		.all(...ids);
};

// Incidents
export const insertIncident = db.prepare(
	`INSERT INTO incidents (event_id, shift_id, user_id, type, note, photo_urls, created_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
);

export const incidentsByOrg = db.prepare(
	`SELECT i.*, u.name as user_name, e.title as event_title
         FROM incidents i
         JOIN events e ON i.event_id = e.id
         LEFT JOIN users u ON i.user_id = u.id
         WHERE e.org_id = ?1 AND (?2 IS NULL OR i.type = ?2)
         ORDER BY i.created_at DESC`,
);
