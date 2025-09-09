import type { Elysia } from "elysia";
import QRCode from "qrcode";
import {
        notifyCheckinSuccess,
        notifyShiftCompleted,
        scheduleCheckoutReminder,
        notifyHoursVerified,
} from "../lib/notifications.ts";
import {
        generateCheckinQRData,
        pendingCheckins,
        sendTelegramMessage,
        verifyCheckinQRData,
        TelegramMiniApp,
        generateTelegramDeepLink,
} from "../lib/telegram.ts";
import { render } from "../lib/template.ts";
import {
	applicationById,
	applicationsWithAttendanceByEvent,
	approvedApplicationsByUser,
        attendanceByApplication,
        checkoutAttendance,
        createAttendance,
        createCheckoutAttendance,
        verifyAttendance,
        addUserHours,
        eventById,
        updateAttendance,
        updateShiftCheckinLink,
} from "../sql/queries.ts";
import { logEvent, AnalyticsEvents } from "../lib/analytics.ts";

export const checkinRoutes = (app: Elysia) =>
	app
		// Coordinator live panel
		.get("/events/:id/live", ({ params }) => {
			const event = eventById.get(params.id);
			
			// Получаем всех волонтеров для события (включая waitlisted)
			const rows = db.query(`
				SELECT 
					a.id as application_id,
					a.status as application_status,
					u.name as user_name,
					u.email,
					u.phone,
					r.title as role_title,
					s.start_time as shift_start,
					s.end_time as shift_end,
					att.status as attendance_status,
					att.checkin_at as checkin_time,
					att.checkout_at as checkout_time
				FROM applications a
				JOIN users u ON a.user_id = u.id
				JOIN roles r ON a.role_id = r.id
				JOIN shifts s ON a.shift_id = s.id
				LEFT JOIN attendance att ON att.application_id = a.id
				WHERE a.event_id = ?
				ORDER BY 
					CASE a.status 
						WHEN 'approved' THEN 1 
						WHEN 'waitlisted' THEN 2 
						WHEN 'pending' THEN 3 
						ELSE 4 
					END,
					a.applied_at ASC
			`).all(params.id);
			
			const volunteers = rows.map((r) => ({
				id: r.application_id,
				name: r.user_name,
				email: r.email,
				phone: r.phone,
				role: r.role_title,
				shift: `${r.shift_start}-${r.shift_end}`,
				application_status: r.application_status,
				status: r.attendance_status || 'registered',
				checkin_time: r.checkin_time,
				checkout_time: r.checkout_time,
			}));
			
			return render("checkin/coordinator", { event, volunteers });
		})
		.post("/events/:id/live/checkin", ({ body }) => {
			const { application_id } = body as { application_id: number };
			const application = applicationById.get(application_id);
			if (!application) return { success: false };
			const existing = attendanceByApplication.get(application_id);
			if (existing) {
				updateAttendance.run(
					application_id,
					"checked_in",
					new Date().toISOString(),
					"manual",
					null,
				);
			} else {
				createAttendance.run(
					application_id,
					application.shift_id,
					"checked_in",
					"manual",
					null,
				);
			}
			return { success: true };
		})
		.post("/events/:id/live/checkout", ({ body }) => {
			const { application_id, hours_worked } = body as {
				application_id: number;
				hours_worked?: number;
			};
			const application = applicationById.get(application_id);
			if (!application) return { success: false };

			const attendance = attendanceByApplication.get(application_id);
			let hours = typeof hours_worked === "number" ? Number(hours_worked) : 0;
			if (!hours && attendance?.checkin_at) {
				hours =
					(Date.now() - new Date(attendance.checkin_at).getTime()) / 3_600_000;
			}

			if (attendance) {
				checkoutAttendance.run(application_id, hours);
			} else {
				createCheckoutAttendance.run(
					application_id,
					application.shift_id,
					hours,
				);
			}
			return { success: true };
		})
		// Kiosk mode for events
		.get("/events/:id/kiosk", ({ params }) => {
			const event = eventById.get(params.id);
			return render("checkin/kiosk", { event });
		})

		// Process QR checkin
		.post("/checkin/process", async ({ body }) => {
			const { qr_data } = body as { qr_data: string };

			try {
				// Verify QR code
				const qrInfo = verifyCheckinQRData(qr_data);
				if (!qrInfo) {
					return { success: false, error: "Недействительный QR-код" };
				}

				const { applicationId, shiftId } = qrInfo;

				// Get application details
				const application = applicationById.get(applicationId);
				if (!application) {
					return { success: false, error: "Заявка не найдена" };
				}

				// Check if already checked in
				const existingAttendance = await checkExistingAttendance(applicationId);
				if (existingAttendance?.status === "checked_in") {
					return {
						success: false,
						error: `${application.user_name} уже зарегистрирован`,
					};
				}

				// Create or update attendance record
				if (existingAttendance) {
					updateAttendance.run(
						applicationId,
						"checked_in",
						new Date().toISOString(),
						"kiosk",
						null, // location could be added later
					);
				} else {
					createAttendance.run(
						applicationId,
						shiftId,
						"checked_in",
						"kiosk",
						null,
					);
				}

				await notifyCheckinSuccess(Number(applicationId));
				await scheduleCheckoutReminder(Number(applicationId));

				return {
					success: true,
					volunteer_name: application.user_name,
					role_title: application.role_title,
					shift_time: `${application.start_time} - ${application.end_time}`,
				};
			} catch (error) {
				console.error("Checkin processing error:", error);
				return { success: false, error: "Ошибка обработки чекина" };
			}
		})

		// Generate QR code for volunteer
                .get("/checkin/qr/:applicationId/:shiftId", async ({ params }) => {
                        try {
                                const qrData = generateCheckinQRData(
                                        params.applicationId,
                                        params.shiftId,
                                );

                                const deepLink = generateTelegramDeepLink(
                                        "start",
                                        `CHECKIN_${encodeURIComponent(qrData)}`,
                                );
                                updateShiftCheckinLink.run(params.shiftId, deepLink);

				const qrCodeUrl = await QRCode.toDataURL(qrData, {
					width: 256,
					margin: 2,
					color: {
						dark: "#1f2937",
						light: "#ffffff",
					},
				});

				const base64Data = qrCodeUrl.split(",")[1];
				const buffer = Buffer.from(base64Data, "base64");

				return new Response(buffer, {
					headers: {
						"Content-Type": "image/png",
						"Content-Disposition": 'inline; filename="checkin-qr.png"',
					},
				});
			} catch (error) {
				console.error("QR generation error:", error);
				return new Response("Error generating QR code", { status: 500 });
			}
		})
		// Deep link checkin via token
		.get("/checkin/token/:token", async ({ params }) => {
			try {
				const qrInfo = verifyCheckinQRData(params.token);
				if (!qrInfo) {
					return {
						success: false,
						error: "Недействительный токен",
					};
				}

				const { applicationId, shiftId } = qrInfo;
				const application = applicationById.get(applicationId);
				if (!application) {
					return {
						success: false,
						error: "Заявка не найдена",
					};
				}

				// If shift has geofence, request location
				if (
					application.geofence_lat &&
					application.geofence_lon &&
					application.geofence_radius &&
					application.telegram_user_id
				) {
					pendingCheckins.set(application.telegram_user_id, {
						applicationId,
						shiftId,
						geofence: {
							lat: application.geofence_lat,
							lon: application.geofence_lon,
							radius: application.geofence_radius,
						},
					});
					await sendTelegramMessage(application.telegram_user_id, {
						text: "Пожалуйста, отправьте свою геолокацию",
						reply_markup: {
							keyboard: [
								[
									{
										text: "📍 Отправить геолокацию",
										request_location: true,
									},
								],
							],
							one_time_keyboard: true,
							resize_keyboard: true,
						},
					});
					return { success: true, message: "location_requested" };
				}

				const existingAttendance = await checkExistingAttendance(applicationId);
				if (existingAttendance?.status === "checked_in") {
					return {
						success: false,
						error: "Уже зарегистрированы",
					};
				}

				if (existingAttendance) {
					updateAttendance.run(
						applicationId,
						"checked_in",
						new Date().toISOString(),
						"telegram",
						null,
					);
				} else {
					createAttendance.run(
						applicationId,
						shiftId,
						"checked_in",
						"telegram",
						null,
					);
				}

				await notifyCheckinSuccess(Number(applicationId));
				await scheduleCheckoutReminder(Number(applicationId));

				return { success: true };
			} catch (error) {
				console.error("Token checkin error:", error);
				return { success: false, error: "Ошибка чекина" };
			}
		})

		// Volunteer's personal QR code page
                .get("/my-qr", ({ headers }) => {
                        // In a real app, get user from session
                        const userId = getUserFromSession(headers.cookie);
                        if (!userId) {
                                return new Response(null, {
                                        status: 302,
                                        headers: { Location: "/login" },
                                });
                        }

                        // Get user's upcoming applications
                        const applications = getUserUpcomingApplications(userId);
                        const tgLink = TelegramMiniApp.generateLink("myday");
                        return render("checkin/my-qr", { applications, tgLink });
                })

		// Manual checkin interface for coordinators
		.get("/events/:id/checkin", ({ params }) => {
			const event = eventById.get(params.id);
			// Get all applications for this event
			const applications = getEventApplications(params.id);
			return render("checkin/coordinator", { event, applications });
		})

		// Bulk checkin/checkout operations
		.post("/checkin/bulk", async ({ body }) => {
			const { action, application_ids } = body as {
				action: "checkin" | "checkout";
				application_ids: string[];
			};

			const results: { id: string; success: boolean; error?: string }[] = [];
			for (const appId of application_ids) {
				try {
					if (action === "checkin") {
						updateAttendance.run(
							appId,
							"checked_in",
							new Date().toISOString(),
							"manual",
							null,
						);
					} else {
						const application = applicationById.get(appId);
						const start = new Date(application.start_time);
						const hours = (Date.now() - start.getTime()) / 3_600_000;
						checkoutAttendance.run(appId, hours);
						await notifyShiftCompleted(Number(appId), hours);
					}
					results.push({ id: appId, success: true });
				} catch (error) {
					results.push({ id: appId, success: false, error: error.message });
				}
			}

			return { results };
		})
		.post("/attendance/:id/verify", async ({ params, body }) => {
			const applicationId = Number(params.id);
			const { hours_worked } = body as { hours_worked?: number };
			const application = applicationById.get(applicationId);
			const attendance = attendanceByApplication.get(applicationId);
			if (
				!application ||
				!attendance ||
				attendance.status !== "checked_out" ||
				attendance.hours_verified
			) {
				return { success: false };
			}

			const hours =
				typeof hours_worked === "number"
					? Number(hours_worked)
					: attendance.hours_worked || 0;

			verifyAttendance.run(applicationId, hours, null);
			addUserHours.run(application.user_id, Math.round(hours));

			logEvent({
				user_id: application.user_id,
				event_type: AnalyticsEvents.HOURS_VERIFIED,
				event_data: { application_id: applicationId, hours_worked: hours },
			});

			await notifyHoursVerified(applicationId, hours);

			return { success: true };
		});

// Helper functions
async function checkExistingAttendance(applicationId: string) {
	return attendanceByApplication.get(applicationId);
}

function getUserFromSession(cookie: string): string | null {
	// Extract user_id from cookie
	const match = cookie?.match(/user_id=(\d+)/);
	return match ? match[1] : null;
}

function getUserUpcomingApplications(userId: string) {
	return approvedApplicationsByUser.all(userId);
}

function getEventApplications(_eventId: string) {
	// Get all applications for an event with attendance status
	return [];
}
