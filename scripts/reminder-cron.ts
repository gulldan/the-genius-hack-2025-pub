#!/usr/bin/env bun
/**
 * Cron-скрипт для отправки автоматических напоминаний о мероприятиях
 * Запускается каждые 15 минут
 */

import { Database } from "bun:sqlite";
import { sendNotification } from "../src/lib/notifications.ts";

const db = new Database("volunteer.db");

/**
 * Отправляем напоминания за 24 часа до начала смены
 */
async function send24HourReminders(): Promise<void> {
  console.log("🔄 Проверка напоминаний за 24 часа...");

  const now = new Date();
  const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in24HoursPlus15Min = new Date(in24Hours.getTime() + 15 * 60 * 1000);

  // Находим смены, которые начинаются через 24 часа (±15 минут)
  const applications = db.query(`
    SELECT a.id, a.user_id, a.event_id, a.shift_id,
           u.telegram_user_id, u.notifications_telegram,
           e.title as event_title,
           s.start_time
    FROM applications a
    JOIN users u ON a.user_id = u.id
    JOIN events e ON a.event_id = e.id
    JOIN shifts s ON a.shift_id = s.id
    WHERE a.status = 'approved'
      AND u.telegram_user_id IS NOT NULL
      AND u.notifications_telegram = 1
      AND s.start_time BETWEEN datetime(?, 'unixepoch') AND datetime(?, 'unixepoch')
      AND NOT EXISTS (
        SELECT 1 FROM analytics_events ae 
        WHERE ae.event_type = 'reminder_24h_sent' 
          AND json_extract(ae.event_data, '$.application_id') = a.id
      )
  `).all(
    Math.floor(in24Hours.getTime() / 1000),
    Math.floor(in24HoursPlus15Min.getTime() / 1000)
  );

  console.log(`📱 Найдено ${applications.length} напоминаний за 24ч для отправки`);

  for (const app of applications) {
    try {
      await sendNotification({
        user_id: app.user_id,
        event_id: app.event_id,
        application_id: app.id,
        shift_id: app.shift_id,
        type: "shift_reminder",
      });

      // Помечаем, что напоминание отправлено
      db.query(`
        INSERT INTO analytics_events (user_id, event_type, event_data, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(
        app.user_id,
        "reminder_24h_sent",
        JSON.stringify({ application_id: app.id, event_title: app.event_title })
      );

      console.log(`✅ Отправлено 24ч напоминание для заявки ${app.id}`);
    } catch (error) {
      console.error(`❌ Ошибка отправки 24ч напоминания для заявки ${app.id}:`, error);
    }
  }
}

/**
 * Отправляем напоминания за 2 часа до начала смены
 */
async function send2HourReminders(): Promise<void> {
  console.log("🔄 Проверка напоминаний за 2 часа...");

  const now = new Date();
  const in2Hours = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const in2HoursPlus15Min = new Date(in2Hours.getTime() + 15 * 60 * 1000);

  const applications = db.query(`
    SELECT a.id, a.user_id, a.event_id, a.shift_id,
           u.telegram_user_id, u.notifications_telegram,
           e.title as event_title,
           s.start_time
    FROM applications a
    JOIN users u ON a.user_id = u.id
    JOIN events e ON a.event_id = e.id
    JOIN shifts s ON a.shift_id = s.id
    WHERE a.status = 'approved'
      AND u.telegram_user_id IS NOT NULL
      AND u.notifications_telegram = 1
      AND s.start_time BETWEEN datetime(?, 'unixepoch') AND datetime(?, 'unixepoch')
      AND NOT EXISTS (
        SELECT 1 FROM analytics_events ae 
        WHERE ae.event_type = 'reminder_2h_sent' 
          AND json_extract(ae.event_data, '$.application_id') = a.id
      )
  `).all(
    Math.floor(in2Hours.getTime() / 1000),
    Math.floor(in2HoursPlus15Min.getTime() / 1000)
  );

  console.log(`📱 Найдено ${applications.length} напоминаний за 2ч для отправки`);

  for (const app of applications) {
    try {
      await sendNotification({
        user_id: app.user_id,
        event_id: app.event_id,
        application_id: app.id,
        shift_id: app.shift_id,
        type: "shift_reminder",
      });

      // Помечаем, что напоминание отправлено
      db.query(`
        INSERT INTO analytics_events (user_id, event_type, event_data, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(
        app.user_id,
        "reminder_2h_sent",
        JSON.stringify({ application_id: app.id, event_title: app.event_title })
      );

      console.log(`✅ Отправлено 2ч напоминание для заявки ${app.id}`);
    } catch (error) {
      console.error(`❌ Ошибка отправки 2ч напоминания для заявки ${app.id}:`, error);
    }
  }
}

/**
 * Автоматический чекаут для завершившихся смен
 */
async function autoCheckoutFinishedShifts(): Promise<void> {
  console.log("🔄 Проверка завершившихся смен для автоматического чекаута...");

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  // Находим смены, которые закончились час назад, но волонтеры не сделали чекаут
  const applications = db.query(`
    SELECT a.id, a.user_id, a.event_id,
           att.id as attendance_id,
           s.end_time,
           s.start_time,
           e.title as event_title
    FROM applications a
    JOIN attendance att ON a.id = att.application_id
    JOIN shifts s ON a.shift_id = s.id
    JOIN events e ON a.event_id = e.id
    WHERE a.status = 'approved'
      AND att.status = 'checked_in'
      AND s.end_time < datetime(?, 'unixepoch')
      AND NOT EXISTS (
        SELECT 1 FROM analytics_events ae 
        WHERE ae.event_type = 'auto_checkout' 
          AND json_extract(ae.event_data, '$.application_id') = a.id
      )
  `).all(Math.floor(oneHourAgo.getTime() / 1000));

  console.log(`⏰ Найдено ${applications.length} смен для автоматического чекаута`);

  for (const app of applications) {
    try {
      const startTime = new Date(app.start_time);
      const endTime = new Date(app.end_time);
      const hoursWorked = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);

      // Выполняем автоматический чекаут
      db.query(`
        UPDATE attendance 
        SET status = 'checked_out', 
            checkout_at = datetime('now'),
            hours_worked = ?
        WHERE id = ?
      `).run(hoursWorked, app.attendance_id);

      // Отправляем уведомление о завершении смены
      await sendNotification({
        user_id: app.user_id,
        event_id: app.event_id,
        application_id: app.id,
        type: "shift_completed",
        data: {
          event_title: app.event_title,
          hours_worked: hoursWorked,
        },
      });

      // Помечаем, что автоматический чекаут выполнен
      db.query(`
        INSERT INTO analytics_events (user_id, event_type, event_data, created_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(
        app.user_id,
        "auto_checkout",
        JSON.stringify({ 
          application_id: app.id, 
          event_title: app.event_title,
          hours_worked: hoursWorked 
        })
      );

      console.log(`✅ Автоматический чекаут для заявки ${app.id}, часов: ${hoursWorked}`);
    } catch (error) {
      console.error(`❌ Ошибка автоматического чекаута для заявки ${app.id}:`, error);
    }
  }
}

/**
 * Основная функция cron-задачи
 */
async function runReminderCron(): Promise<void> {
  console.log(`🚀 Запуск cron-задач в ${new Date().toLocaleString("ru-RU")}`);

  try {
    await send24HourReminders();
    await send2HourReminders();
    await autoCheckoutFinishedShifts();
    
    console.log(`✅ Все cron-задачи завершены в ${new Date().toLocaleString("ru-RU")}`);
  } catch (error) {
    console.error("❌ Ошибка выполнения cron-задач:", error);
  }
}

// Запускаем если скрипт вызван напрямую
if (import.meta.main) {
  await runReminderCron();
}

export { runReminderCron };
