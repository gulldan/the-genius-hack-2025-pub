import { db, updateApplicationStatusQuery } from "../sql/queries.ts";
import { sendTelegramMessage } from "./telegram.ts";
import { sendNotification, scheduleShiftReminders } from "./notifications.ts";

interface ApplicationRow {
	id: number;
	user_id: number;
	event_id: number;
	role_id: number;
	shift_id: number;
	status: string;
	telegram_user_id?: number;
	event_title?: string;
	role_title?: string;
}

const statusMessages: Record<string, string> = {
	approved: "✅ Ваша заявка одобрена!",
	waitlisted: "⏳ Ваша заявка помещена в лист ожидания.",
	declined: "❌ Ваша заявка отклонена.",
};

export async function updateApplicationStatus(
	applicationId: number,
	newStatus: string,
): Promise<void> {
	const application = db
		.query<ApplicationRow>(
			`SELECT a.*, u.telegram_user_id, e.title as event_title, r.title as role_title
       FROM applications a
       JOIN users u ON a.user_id = u.id
       JOIN events e ON a.event_id = e.id
       JOIN roles r ON a.role_id = r.id
       WHERE a.id = ?`,
		)
		.get(applicationId);

	if (!application) return;
	const oldStatus = application.status;

	updateApplicationStatusQuery.run(applicationId, newStatus);

	// Отправляем полноценное уведомление при одобрении
	if (newStatus === "approved" && oldStatus !== "approved") {
		await sendNotification({
			user_id: application.user_id,
			event_id: application.event_id,
			application_id: applicationId,
			shift_id: application.shift_id,
			type: "application_confirmed",
		});
		
		// Планируем напоминания о смене
		await scheduleShiftReminders(applicationId);
	} else if (application.telegram_user_id) {
		// Для остальных статусов отправляем простое уведомление
		const baseMessage = statusMessages[newStatus];
		if (baseMessage) {
			const text = `${baseMessage}\n\n${application.event_title} — ${application.role_title}`;
			await sendTelegramMessage(application.telegram_user_id, { text });
		}
	}

	if (oldStatus === "approved" && newStatus !== "approved") {
		await promoteWaitlisted(application.shift_id);
	}
}

async function promoteWaitlisted(shiftId: number): Promise<void> {
	const shift = db
		.query<{ capacity: number }>("SELECT capacity FROM shifts WHERE id = ?")
		.get(shiftId);
	if (!shift) return;

	const approved = db
		.query<{ count: number }>(
			"SELECT COUNT(*) as count FROM applications WHERE shift_id = ? AND status = 'approved'",
		)
		.get(shiftId);
	if (approved.count >= shift.capacity) return;

	const next = db
		.query<{ id: number }>(
			`SELECT id FROM applications WHERE shift_id = ? AND status = 'waitlisted' ORDER BY applied_at LIMIT 1`,
		)
		.get(shiftId);
	if (next) {
		await updateApplicationStatus(next.id, "approved");
	}
}
