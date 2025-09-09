/**
 * Generate ICS (iCalendar) file for event
 */
export function generateICS(eventData: {
	title: string;
	description: string;
	location: string;
	startTime: string;
	endTime: string;
	organizerName: string;
	organizerEmail?: string;
}): string {
	const now = new Date();
	const startDate = new Date(eventData.startTime);
	const endDate = new Date(eventData.endTime);

	// Format dates for ICS (YYYYMMDDTHHMMSSZ)
	const formatDate = (date: Date) => {
		return date
			.toISOString()
			.replace(/[-:]/g, "")
			.replace(/\.\d{3}/, "");
	};

	const uid = `event-${Date.now()}@volunteerhub.ru`;

	const ics = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//VolunteerHub//Event//RU",
		"CALSCALE:GREGORIAN",
		"METHOD:PUBLISH",
		"BEGIN:VEVENT",
		`UID:${uid}`,
		`DTSTAMP:${formatDate(now)}`,
		`DTSTART:${formatDate(startDate)}`,
		`DTEND:${formatDate(endDate)}`,
		`SUMMARY:${eventData.title}`,
		`DESCRIPTION:${eventData.description.replace(/\n/g, "\\n")}`,
		`LOCATION:${eventData.location}`,
		`ORGANIZER;CN=${eventData.organizerName}${eventData.organizerEmail ? `:MAILTO:${eventData.organizerEmail}` : ""}`,
		"STATUS:CONFIRMED",
		"TRANSP:OPAQUE",
		"CATEGORIES:VOLUNTEER,SOCIAL",
		"BEGIN:VALARM",
		"TRIGGER:-PT24H",
		"DESCRIPTION:Напоминание о волонтёрском мероприятии",
		"ACTION:DISPLAY",
		"END:VALARM",
		"BEGIN:VALARM",
		"TRIGGER:-PT2H",
		"DESCRIPTION:Мероприятие начинается через 2 часа",
		"ACTION:DISPLAY",
		"END:VALARM",
		"END:VEVENT",
		"END:VCALENDAR",
	].join("\r\n");

	return ics;
}

/**
 * Create download link for ICS file
 */
export function createICSDownloadLink(eventData: {
	title: string;
	description: string;
	location: string;
	startTime: string;
	endTime: string;
	organizerName: string;
	organizerEmail?: string;
}): string {
	const ics = generateICS(eventData);
	const blob = new Blob([ics], { type: "text/calendar" });
	const url = URL.createObjectURL(blob);

	return url;
}

/**
 * Generate ICS button HTML
 */
export function generateICSButton(
	eventData: {
		title: string;
		description: string;
		location: string;
		startTime: string;
		endTime: string;
		organizerName: string;
		organizerEmail?: string;
	},
	className: string = "",
): string {
	const icsData = generateICS(eventData);
	const dataUri = `data:text/calendar;charset=utf-8,${encodeURIComponent(icsData)}`;

	return `
    <a 
      href="${dataUri}" 
      download="event-${eventData.title.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}.ics"
      class="${className}"
      onclick="trackICSDownload()"
    >
      <i data-lucide="calendar-plus" class="w-4 h-4 mr-2"></i>
      Добавить в календарь
    </a>
  `;
}
