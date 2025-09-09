import { Elysia } from "elysia";
import { accountRoutes } from "./routes/account.ts";
import { analyticsRoutes } from "./routes/analytics.ts";
import { authRoutes } from "./routes/auth.ts";
import { checkinRoutes } from "./routes/checkin.ts";
import { coordinatorRoutes } from "./routes/coordinator.ts";
import { eventsRoutes } from "./routes/events.ts";
import { incidentRoutes } from "./routes/incidents.ts";
import { organizerRoutes } from "./routes/organizer.ts";
import { pagesRoutes } from "./routes/pages.ts";
import { telegramRoutes } from "./routes/telegram.ts";
import { runReminderCron } from "../scripts/reminder-cron.ts";

const port = Number(process.env.PORT) || 3000;

new Elysia()
	.use(eventsRoutes)
	.use(accountRoutes)
	.use(organizerRoutes)
	.use(coordinatorRoutes)
	.use(authRoutes)
	.use(checkinRoutes)
	.use(telegramRoutes)
	.use(analyticsRoutes)
	.use(incidentRoutes)
	.use(pagesRoutes)
	.get(
		"/style.css",
		() =>
			new Response(Bun.file("public/style.css"), {
				headers: { "Content-Type": "text/css; charset=utf-8" },
			}),
	)
	.get(
		"/manifest.json",
		() =>
			new Response(Bun.file("public/manifest.json"), {
				headers: { "Content-Type": "application/json" },
			}),
	)
	.get(
		"/uploads/:file",
		({ params }) => new Response(Bun.file(`public/uploads/${params.file}`)),
	)
	.listen(port);

console.log(`Server running on http://localhost:${port}`);

// Запускаем планировщик задач каждые 15 минут для напоминаний
if (process.env.NODE_ENV !== "test") {
	console.log("🚀 Инициализация планировщика уведомлений...");
	
	// Сразу запускаем один раз
	setTimeout(() => runReminderCron(), 5000); // Через 5 секунд после старта
	
	// Затем каждые 15 минут
	setInterval(() => {
		runReminderCron().catch(error => {
			console.error("❌ Ошибка в планировщике уведомлений:", error);
		});
	}, 15 * 60 * 1000); // 15 минут
	
	console.log("✅ Планировщик уведомлений запущен (интервал: 15 минут)");
}
