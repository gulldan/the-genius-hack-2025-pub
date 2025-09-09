import type { Elysia } from "elysia";
import { render } from "../lib/template.ts";
import {
        getOrganizationStats,
        getAnalyticsCharts,
        getTopVolunteers,
        exportEventReport,
        logEvent,
        getIncidentsForOrg,
} from "../lib/analytics.ts";
import { db } from "../sql/queries.ts";

export const analyticsRoutes = (app: Elysia) =>
	app
		// Отчёты организации
                .get("/org/:orgId/reports", ({ params, query }) => {
                        const orgId = Number(params.orgId);
                        const period = (query as any)?.period || "month";
                        const incidentType = (query as any)?.incident_type || "";

                        const stats = getOrganizationStats(orgId);
                        const charts = getAnalyticsCharts(orgId, period as any);
                        const topVolunteers = getTopVolunteers(orgId, 10);
                        const incidents = getIncidentsForOrg(orgId, incidentType);

                        return render("org/reports", {
                                orgId,
                                stats,
                                charts,
                                topVolunteers,
                                period,
                                incidents,
                                incidentType,
                        });
                })

		// Экспорт отчёта по событию
		.get("/org/:orgId/events/:eventId/export", ({ params }) => {
			const eventId = Number(params.eventId);
			const csv = exportEventReport(eventId);

			// Логируем экспорт
			logEvent({
				event_type: "report_exported",
				event_data: {
					event_id: eventId,
					org_id: params.orgId,
					format: "csv",
				},
			});

			return new Response(csv, {
				headers: {
					"Content-Type": "text/csv; charset=utf-8",
					"Content-Disposition": `attachment; filename="event-${eventId}-report.csv"`,
				},
			});
		})

		// API для отправки событий аналитики с фронтенда
		.post("/api/analytics", ({ body, headers }) => {
			const { event_type, event_data, user_id } = body as any;

			logEvent({
				user_id,
				event_type,
				event_data,
				session_id: extractSessionId(headers.cookie),
				user_agent: headers["user-agent"],
				ip_address:
					headers["x-forwarded-for"] || headers["x-real-ip"] || "unknown",
			});

			return { success: true };
		})

		// Получить аналитику для виджетов
		.get("/api/analytics/widget/:type", ({ params, query }) => {
			const type = params.type;
			const orgId = (query as any)?.org_id;

			switch (type) {
				case "recent-activity":
					return getRecentActivity(orgId);

				case "conversion-funnel":
					return getConversionFunnel(orgId);

				case "volunteer-retention":
					return getVolunteerRetention(orgId);

				default:
					return { error: "Unknown widget type" };
			}
		});

// Вспомогательные функции
function extractSessionId(cookie?: string): string | null {
	if (!cookie) return null;
	const match = cookie.match(/session_id=([^;]+)/);
	return match ? match[1] : null;
}

function getRecentActivity(orgId?: number) {
	const whereClause = orgId ? "WHERE e.org_id = ?" : "";
	const params = orgId ? [orgId] : [];

	const activities = db
		.query(`
    SELECT 
      ae.event_type,
      ae.created_at,
      u.name as user_name,
      ae.event_data
    FROM analytics_events ae
    LEFT JOIN users u ON ae.user_id = u.id
    LEFT JOIN applications a ON JSON_EXTRACT(ae.event_data, '$.application_id') = a.id
    LEFT JOIN events e ON a.event_id = e.id OR JSON_EXTRACT(ae.event_data, '$.event_id') = e.id
    ${whereClause}
    ORDER BY ae.created_at DESC
    LIMIT 20
  `)
		.all(...params);

	return { activities };
}

function getConversionFunnel(orgId?: number) {
	const whereClause = orgId ? "WHERE e.org_id = ?" : "";
	const params = orgId ? [orgId] : [];

	const funnel = db
		.query(`
    SELECT 
      COUNT(CASE WHEN ae.event_type = 'event_viewed' THEN 1 END) as views,
      COUNT(CASE WHEN ae.event_type = 'signup_opened' THEN 1 END) as signup_opens,
      COUNT(CASE WHEN ae.event_type = 'signup_submitted' THEN 1 END) as signups,
      COUNT(CASE WHEN a.status = 'approved' THEN 1 END) as approvals,
      COUNT(CASE WHEN att.status = 'checked_in' THEN 1 END) as checkins
    FROM analytics_events ae
    LEFT JOIN applications a ON JSON_EXTRACT(ae.event_data, '$.application_id') = a.id
    LEFT JOIN events e ON a.event_id = e.id OR JSON_EXTRACT(ae.event_data, '$.event_id') = e.id
    LEFT JOIN attendance att ON att.application_id = a.id
    ${whereClause}
  `)
		.get(...params);

	return { funnel };
}

function getVolunteerRetention(orgId?: number) {
	const whereClause = orgId ? "WHERE e.org_id = ?" : "";
	const params = orgId ? [orgId] : [];

	const retention = db
		.query(`
    SELECT 
      COUNT(DISTINCT u.id) as total_volunteers,
      COUNT(DISTINCT CASE WHEN repeat_volunteers.user_id IS NOT NULL THEN u.id END) as returning_volunteers
    FROM users u
    JOIN applications a ON u.id = a.user_id
    JOIN events e ON a.event_id = e.id
    LEFT JOIN (
      SELECT user_id, COUNT(*) as event_count
      FROM applications a2
      JOIN events e2 ON a2.event_id = e2.id
      ${whereClause.replace("WHERE", "WHERE")}
      GROUP BY user_id
      HAVING event_count > 1
    ) repeat_volunteers ON u.id = repeat_volunteers.user_id
    ${whereClause}
  `)
		.get(...params);

	return { retention };
}
