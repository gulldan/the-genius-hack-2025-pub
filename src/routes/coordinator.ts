import type { Elysia } from "elysia";
import { getCurrentUser, requireRoles, withAuth } from "../lib/auth.ts";
import { render } from "../lib/template";
import { db } from "../sql/queries.ts";

export const coordinatorRoutes = (app: Elysia) => {
	const coordinatorOnly = (handler: (ctx: unknown) => unknown) =>
		requireRoles(["coordinator"], handler);

	return app
		// Главная панель координатора
		.get("/coordinator", coordinatorOnly(({ headers }) => {
			const user = getCurrentUser(headers);
			
			// Получаем активные события, где пользователь координатор
			const activeEvents = db.query(`
				SELECT 
					e.*,
					o.name as org_name,
					COUNT(DISTINCT a.id) as total_applications,
					COUNT(DISTINCT CASE WHEN a.status = 'approved' THEN a.id END) as approved_applications,
					COUNT(DISTINCT CASE WHEN a.status = 'waitlisted' THEN a.id END) as waitlisted_applications,
					COUNT(DISTINCT CASE WHEN att.status = 'checked_in' THEN att.id END) as checked_in_count,
					COUNT(DISTINCT CASE WHEN att.status = 'checked_out' THEN att.id END) as completed_count
				FROM events e
				JOIN organizations o ON e.org_id = o.id
				LEFT JOIN applications a ON e.id = a.event_id
				LEFT JOIN attendance att ON a.id = att.application_id
				WHERE e.status = 'published' 
					AND e.start_date >= date('now', '-7 days')
					AND e.start_date <= date('now', '+30 days')
				GROUP BY e.id
				ORDER BY e.start_date ASC
				LIMIT 10
			`).all();

			// Получаем статистику координатора
			const stats = {
				active_events: activeEvents.length,
				total_volunteers: db.query(`
					SELECT COUNT(DISTINCT a.user_id) as count
					FROM applications a
					JOIN events e ON a.event_id = e.id
					WHERE e.start_date >= date('now', '-30 days')
						AND a.status = 'approved'
				`).get()?.count || 0,
				today_events: db.query(`
					SELECT COUNT(*) as count
					FROM events e
					WHERE e.status = 'published' 
						AND date(e.start_date) = date('now')
				`).get()?.count || 0,
				pending_checkins: db.query(`
					SELECT COUNT(DISTINCT a.id) as count
					FROM applications a
					JOIN events e ON a.event_id = e.id
					JOIN shifts s ON a.shift_id = s.id
					LEFT JOIN attendance att ON a.id = att.application_id
					WHERE a.status = 'approved'
						AND datetime(s.start_time) <= datetime('now', '+2 hours')
						AND datetime(s.start_time) >= datetime('now', '-1 hour')
						AND (att.status IS NULL OR att.status = 'registered')
				`).get()?.count || 0
			};

			// Недавние инциденты
			const recentIncidents = db.query(`
				SELECT 
					i.*,
					e.title as event_title,
					u.name as user_name
				FROM incidents i
				JOIN events e ON i.event_id = e.id
				LEFT JOIN users u ON i.user_id = u.id
				WHERE i.created_at >= datetime('now', '-7 days')
				ORDER BY i.created_at DESC
				LIMIT 5
			`).all();

			return render("coordinator/dashboard", withAuth({ 
				user,
				activeEvents, 
				stats, 
				recentIncidents 
			}, headers));
		}))

		// События координатора
		.get("/coordinator/events", coordinatorOnly(({ headers, query }) => {
			const user = getCurrentUser(headers);
			const filter = (query as Record<string, string>)?.filter || 'active';
			
			let whereClause = '';
			if (filter === 'today') {
				whereClause = "AND date(e.start_date) = date('now')";
			} else if (filter === 'upcoming') {
				whereClause = "AND e.start_date > date('now')";
			} else if (filter === 'past') {
				whereClause = "AND e.start_date < date('now')";
			} else {
				whereClause = "AND e.start_date >= date('now', '-1 day')";
			}

			const events = db.query(`
				SELECT 
					e.*,
					o.name as org_name,
					COUNT(DISTINCT a.id) as total_applications,
					COUNT(DISTINCT CASE WHEN a.status = 'approved' THEN a.id END) as approved_count,
					COUNT(DISTINCT CASE WHEN a.status = 'waitlisted' THEN a.id END) as waitlisted_count,
					COUNT(DISTINCT CASE WHEN att.status = 'checked_in' THEN att.id END) as checked_in_count,
					COUNT(DISTINCT CASE WHEN att.status = 'checked_out' THEN att.id END) as completed_count,
					COUNT(DISTINCT CASE WHEN att.status = 'no_show' THEN att.id END) as no_show_count
				FROM events e
				JOIN organizations o ON e.org_id = o.id
				LEFT JOIN applications a ON e.id = a.event_id
				LEFT JOIN attendance att ON a.id = att.application_id
				WHERE e.status = 'published' ${whereClause}
				GROUP BY e.id
				ORDER BY e.start_date DESC
			`).all();

			return render("coordinator/events", withAuth({ 
				user,
				events, 
				currentFilter: filter 
			}, headers));
		}))

		// Быстрые действия
		.post("/coordinator/events/:eventId/broadcast", coordinatorOnly(({ params, body }) => {
			const { message, target } = body as { message: string; target: string };
			
			// В реальном приложении здесь была бы отправка уведомлений
			console.log(`📢 Broadcast to ${target} for event ${params.eventId}: ${message}`);
			
			return { success: true, message: "Уведомления отправлены" };
		}))

		.post("/coordinator/events/:eventId/close", coordinatorOnly(({ params }) => {
			// Закрываем событие
			db.query("UPDATE events SET status = 'closed' WHERE id = ?").run(params.eventId);
			
			return { success: true, message: "Событие закрыто" };
		}))

		// API для получения quick stats
		.get("/coordinator/api/quick-stats", coordinatorOnly(() => {
			const stats = {
				active_volunteers: db.query(`
					SELECT COUNT(DISTINCT att.application_id) as count
					FROM attendance att
					JOIN applications a ON att.application_id = a.id
					JOIN events e ON a.event_id = e.id
					WHERE att.status = 'checked_in'
						AND date(e.start_date) = date('now')
				`).get()?.count || 0,
				todays_events: db.query(`
					SELECT COUNT(*) as count
					FROM events e
					WHERE e.status = 'published' 
						AND date(e.start_date) = date('now')
				`).get()?.count || 0,
				pending_approvals: db.query(`
					SELECT COUNT(*) as count
					FROM applications a
					JOIN events e ON a.event_id = e.id
					WHERE a.status = 'pending'
						AND e.start_date >= date('now')
				`).get()?.count || 0,
				recent_incidents: db.query(`
					SELECT COUNT(*) as count
					FROM incidents i
					WHERE i.created_at >= datetime('now', '-24 hours')
				`).get()?.count || 0
			};
			
			return stats;
		}));
};
