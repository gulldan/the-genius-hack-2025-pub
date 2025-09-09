import type { Elysia } from "elysia";
import { getCurrentUser, withAuth } from "../lib/auth.ts";
import { render } from "../lib/template.ts";
import { db } from "../sql/queries.ts";
import { GeofencingJS } from "../lib/geofencing.ts";

export const pagesRoutes = (app: Elysia) =>
	app
		// Organizations catalog
		.get("/organizations", () => {
			const organizations = db
				.query(`
        SELECT 
          o.*,
          COUNT(e.id) as events_count,
          COUNT(CASE WHEN e.status = 'published' AND e.start_date >= date('now') THEN 1 END) as upcoming_events
        FROM organizations o
        LEFT JOIN events e ON o.id = e.org_id
        GROUP BY o.id
        ORDER BY o.name
      `)
				.all();

			return render("organizations", { organizations });
		})

		// Organization registration
		.get("/org/register", () => {
			return render("org/register", {});
		})

		.post("/org/register", ({ body }) => {
			const { name, city, description, website, email, phone } = body as Record<
				string,
				string
			>;

			try {
				const orgId = db
					.query(`
          INSERT INTO organizations (name, city, description, website, email, phone)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
					.run(
						name,
						city,
						description,
						website || null,
						email,
						phone || null,
					).lastInsertRowid;

				// В реальном приложении здесь была бы отправка email для верификации
				console.log(
					`🏢 Новая организация зарегистрирована: ${name} (ID: ${orgId})`,
				);

				return new Response(null, {
					status: 302,
					headers: { Location: `/org/register/success?orgId=${orgId}` },
				});
			} catch (_error) {
				return render("org/register", {
					error:
						"Ошибка регистрации. Возможно, организация с таким именем уже существует.",
				});
			}
		})

		.get("/org/register/success", ({ query }) => {
			const orgId = (query as Record<string, string>)?.orgId;
			return render("org/register-success", { orgId });
		})

		// Help page
		.get("/help", () => {
			return render("help", {});
		})

		// Terms and Privacy (referenced in registration)
		.get("/terms", () => {
			return render("legal/terms", {});
		})

		.get("/privacy", () => {
			return render("legal/privacy", {});
		})

		// My QR code page
		.get("/my-qr", ({ headers }) => {
			const user = getCurrentUser(headers);

			if (!user) {
				return new Response(null, {
					status: 302,
					headers: { Location: "/login" },
				});
			}

			// Получаем предстоящие заявки пользователя (для демо показываем все)
			const upcomingApplications = db
				.query(`
        SELECT 
          a.id,
          e.title as event_title,
          r.title as role_title,
          s.start_time,
          s.end_time,
          e.address,
          s.qr_id
        FROM applications a
        JOIN events e ON a.event_id = e.id
        JOIN roles r ON a.role_id = r.id
        JOIN shifts s ON a.shift_id = s.id
        WHERE a.user_id = ? AND a.status = 'approved'
        ORDER BY e.start_date, s.start_time
        LIMIT 5
      `)
				.all(user.id);

			return render(
				"my-qr",
				withAuth({ applications: upcomingApplications }, headers),
			);
		})

		// Certificates page
		.get("/certificates", () => {
			// В реальном приложении получаем user_id из сессии
			const user = db.query("SELECT * FROM users WHERE id = 1").get();

			if (!user) {
				return new Response(null, {
					status: 302,
					headers: { Location: "/login" },
				});
			}

			// Получаем завершённые события для сертификатов
			const completedEvents = db
				.query(`
        SELECT 
          e.title as event_title,
          r.title as role_title,
          att.hours_worked,
          att.checkout_at,
          o.name as org_name
        FROM applications a
        JOIN events e ON a.event_id = e.id
        JOIN organizations o ON e.org_id = o.id
        JOIN roles r ON a.role_id = r.id
        JOIN attendance att ON att.application_id = a.id
        WHERE a.user_id = ? AND att.status = 'checked_out' AND att.hours_verified = 1
        ORDER BY att.checkout_at DESC
      `)
				.all(user.id);

			return render("certificates", { user, completedEvents });
		})
		// Download certificate
		.get("/certificates/:id/download", ({ params }) => {
			const content = createCertificatePDF(
				`Certificate for application ${params.id}`,
			);
			return new Response(content, {
				headers: {
					"Content-Type": "application/pdf",
					"Content-Disposition": `attachment; filename=certificate-${params.id}.pdf`,
				},
			});
		})
		// Open Badges endpoint
		.get("/badges/:id", ({ params }) => {
			const badge = {
				id: params.id,
				type: "BadgeClass",
				name: `Badge ${params.id}`,
				description: "Demo badge",
				image: `https://example.com/badges/${params.id}.png`,
			};
			return new Response(JSON.stringify(badge), {
				headers: { "Content-Type": "application/json" },
			});
		})

		// Geofencing demo page
		.get("/demo/geofencing", ({ headers }) => {
			return render("geofencing-demo", withAuth({ 
				geofencingJS: GeofencingJS 
			}, headers));
		});

function createCertificatePDF(_text: string) {
	const pdf = `%PDF-1.1\n1 0 obj<<>>endobj\n2 0 obj<<>>endobj\n3 0 obj<<>>endobj\ntrailer<<>>\n%%EOF`;
	return new TextEncoder().encode(pdf);
}
