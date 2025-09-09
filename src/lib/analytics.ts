import { db, incidentsByOrg } from "../sql/queries.ts";

export interface AnalyticsEvent {
	user_id?: number;
	event_type: string;
	event_data?: Record<string, any>;
	session_id?: string;
	user_agent?: string;
	ip_address?: string;
}

/**
 * Логирование события аналитики
 */
export function logEvent(event: AnalyticsEvent): void {
	try {
		db.query(`
      INSERT INTO analytics_events (user_id, event_type, event_data, session_id, user_agent, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
			event.user_id || null,
			event.event_type,
			event.event_data ? JSON.stringify(event.event_data) : null,
			event.session_id || null,
			event.user_agent || null,
			event.ip_address || null,
		);
	} catch (error) {
		console.error("Analytics logging error:", error);
	}
}

/**
 * Получить статистику для дашборда организации
 */
export function getOrganizationStats(orgId: number) {
	// Общая статистика событий
	const eventStats = db
		.query(`
    SELECT 
      COUNT(*) as total_events,
      COUNT(CASE WHEN status = 'published' THEN 1 END) as published_events,
      COUNT(CASE WHEN status = 'draft' THEN 1 END) as draft_events,
      COUNT(CASE WHEN start_date >= date('now') AND status = 'published' THEN 1 END) as upcoming_events
    FROM events 
    WHERE org_id = ?
  `)
		.get(orgId);

	// Статистика заявок
	const applicationStats = db
		.query(`
    SELECT 
      COUNT(*) as total_applications,
      COUNT(CASE WHEN a.status = 'approved' THEN 1 END) as approved_applications,
      COUNT(CASE WHEN a.status = 'pending' THEN 1 END) as pending_applications,
      COUNT(CASE WHEN a.status = 'waitlisted' THEN 1 END) as waitlisted_applications
    FROM applications a
    JOIN events e ON a.event_id = e.id
    WHERE e.org_id = ?
  `)
		.get(orgId);

	// Статистика посещаемости
	const attendanceStats = db
		.query(`
    SELECT 
      COUNT(*) as total_attendance,
      COUNT(CASE WHEN att.status = 'checked_in' THEN 1 END) as checked_in,
      COUNT(CASE WHEN att.status = 'checked_out' THEN 1 END) as checked_out,
      COUNT(CASE WHEN att.status = 'no_show' THEN 1 END) as no_shows,
      AVG(CASE WHEN att.hours_worked > 0 THEN att.hours_worked END) as avg_hours
    FROM attendance att
    JOIN applications a ON att.application_id = a.id
    JOIN events e ON a.event_id = e.id
    WHERE e.org_id = ?
  `)
		.get(orgId);

	return {
		events: eventStats,
		applications: applicationStats,
		attendance: attendanceStats,
	};
}

/**
 * Получить данные для графиков
 */
export function getAnalyticsCharts(
	orgId: number,
	period: "week" | "month" | "year" = "month",
) {
	const dateFormat =
		period === "week" ? "%Y-%m-%d" : period === "month" ? "%Y-%m-%d" : "%Y-%m";

	// График заявок по времени
	const applicationsOverTime = db
		.query(`
    SELECT 
      strftime('${dateFormat}', a.applied_at) as date,
      COUNT(*) as count
    FROM applications a
    JOIN events e ON a.event_id = e.id
    WHERE e.org_id = ? 
    AND a.applied_at >= datetime('now', '-${period === "week" ? "7 days" : period === "month" ? "30 days" : "1 year"}')
    GROUP BY strftime('${dateFormat}', a.applied_at)
    ORDER BY date
  `)
		.all(orgId);

	// График по категориям событий
	const eventsByCategory = db
		.query(`
    SELECT 
      category,
      COUNT(*) as count
    FROM events
    WHERE org_id = ? AND status = 'published'
    GROUP BY category
    ORDER BY count DESC
  `)
		.all(orgId);

	// График посещаемости
	const attendanceByDay = db
		.query(`
    SELECT 
      strftime('%w', s.start_time) as day_of_week,
      COUNT(CASE WHEN att.status = 'checked_in' THEN 1 END) as checked_in,
      COUNT(CASE WHEN att.status = 'no_show' THEN 1 END) as no_shows
    FROM attendance att
    JOIN applications a ON att.application_id = a.id
    JOIN shifts s ON a.shift_id = s.id
    JOIN events e ON a.event_id = e.id
    WHERE e.org_id = ?
    GROUP BY strftime('%w', s.start_time)
    ORDER BY day_of_week
  `)
		.all(orgId);

	return {
		applications_over_time: applicationsOverTime,
		events_by_category: eventsByCategory,
		attendance_by_day: attendanceByDay,
	};
}

/**
 * Получить топ волонтёров для организации
 */
export function getTopVolunteers(orgId: number, limit: number = 10) {
        return db
                .query(`
    SELECT 
      u.name,
      u.email,
      COUNT(a.id) as events_count,
      SUM(CASE WHEN att.hours_worked > 0 THEN att.hours_worked ELSE 0 END) as total_hours,
      AVG(CASE WHEN att.status = 'checked_in' THEN 1.0 ELSE 0.0 END) as attendance_rate
    FROM users u
    JOIN applications a ON u.id = a.user_id
    JOIN events e ON a.event_id = e.id
    LEFT JOIN attendance att ON att.application_id = a.id
    WHERE e.org_id = ? AND a.status = 'approved'
    GROUP BY u.id
    HAVING events_count > 0
    ORDER BY total_hours DESC, events_count DESC
    LIMIT ?
  `)
		.all(orgId, limit);
}

/**
 * Получить инциденты по организации с фильтрацией по типу
 */
export function getIncidentsForOrg(orgId: number, type?: string) {
        return incidentsByOrg.all(orgId, type || null);
}

/**
 * Экспорт данных в CSV формат
 */
export function exportEventReport(eventId: number): string {
	const data = db
		.query(`
    SELECT 
      u.name as volunteer_name,
      u.email,
      u.phone,
      r.title as role_title,
      s.start_time,
      s.end_time,
      a.status as application_status,
      att.status as attendance_status,
      att.checkin_at,
      att.checkout_at,
      att.hours_worked,
      att.checkin_source
    FROM applications a
    JOIN users u ON a.user_id = u.id
    JOIN roles r ON a.role_id = r.id
    JOIN shifts s ON a.shift_id = s.id
    LEFT JOIN attendance att ON att.application_id = a.id
    WHERE a.event_id = ?
    ORDER BY r.title, s.start_time, u.name
  `)
		.all(eventId);

	// Формируем CSV
	const headers = [
		"Имя волонтёра",
		"Email",
		"Телефон",
		"Роль",
		"Время начала",
		"Время окончания",
		"Статус заявки",
		"Статус посещения",
		"Время чекина",
		"Время чекаута",
		"Отработанные часы",
		"Способ чекина",
	];

        let csv = `${headers.join(",")}\n`;

	data.forEach((row) => {
		const values = [
			row.volunteer_name,
			row.email,
			row.phone || "",
			row.role_title,
			row.start_time,
			row.end_time,
			row.application_status,
			row.attendance_status || "",
			row.checkin_at || "",
			row.checkout_at || "",
			row.hours_worked || "",
			row.checkin_source || "",
		];

                csv += `${values
                        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
                        .join(",")}\n`;
	});

	return csv;
}

/**
 * Предустановленные события аналитики для фронтенда
 */
export const AnalyticsEvents = {
	// Навигация и поиск
	SEARCH_FACET_CHANGED: "search_facet_changed",
	EVENT_VIEWED: "event_viewed",
	ROLE_VIEWED: "role_viewed",

	// Регистрация
	SIGNUP_OPENED: "signup_opened",
	SIGNUP_SUBMITTED: "signup_submitted",
	SIGNUP_WAITLISTED: "signup_waitlisted",
	WAIVER_SIGNED: "waiver_signed",

	// Telegram
	TG_LOGIN_SUCCESS: "tg_login_success",
	TG_LINKED: "tg_linked",
	TG_DEEPLINK_OPENED: "tg_deeplink_opened",
	TG_INLINE_CLICK: "tg_inline_click",
	TG_REMINDER_OPENED: "tg_reminder_opened",
	TG_CHECKIN_FROM_TG: "tg_checkin_from_tg",

	// Чекин и часы
	QR_SCANNED: "qr_scanned",
	KIOSK_STARTED: "kiosk_started",
	MANUAL_CHECKIN: "manual_checkin",
	CHECKOUT_SUCCESS: "checkout_success",
	HOURS_VERIFIED: "hours_verified",

	// Организатор
	ROLE_ADDED: "role_added",
	SHIFT_PUBLISHED: "shift_published",
	APPLICATION_APPROVED: "application_approved",
	WAITLIST_PROMOTED: "waitlist_promoted",
	REPORT_EXPORTED: "report_exported",
} as const;
