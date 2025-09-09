import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";

const db = new Database("volunteer.db");

// Ensure schema exists
const ddl = readFileSync("src/sql/ddl.sql", "utf8");
db.exec(ddl);

console.log("Seeding database with test data...");

// Clear existing data
db.exec("DELETE FROM attendance");
db.exec("DELETE FROM applications");
db.exec("DELETE FROM shifts");
db.exec("DELETE FROM roles");
db.exec("DELETE FROM events");
db.exec("DELETE FROM organizations");
db.exec("DELETE FROM users");

// Organizations
const insertOrg = db.prepare(`
  INSERT INTO organizations (name, city, description, logo_url, website, email) 
  VALUES (?, ?, ?, ?, ?, ?)
`);

const org1 = insertOrg.run(
	"Психиатрическая больница №1 им. Кащенко",
	"Санкт-Петербург",
	"Ведущее медицинское учреждение в области психиатрии. Организуем программы социальной адаптации и реабилитации пациентов с участием волонтёров.",
	null,
	"https://pb1-spb.ru",
	"volunteers@pb1-spb.ru",
).lastInsertRowid;

const org2 = insertOrg.run(
	"НКО 'Путь к свободе' - помощь зависимым",
	"Пермь",
	"Некоммерческая организация, специализирующаяся на реабилитации людей с химическими зависимостями. Проводим программы восстановления и социальной адаптации.",
	null,
	"https://put-k-svobode.org",
	"help@put-k-svobode.org",
).lastInsertRowid;

const org3 = insertOrg.run(
	"НКО 'Детские мечты' - центр развития",
	"Покачи",
	"Организация детского досуга и развития. Проводим образовательные программы, творческие мастерские и семейные мероприятия для детей и их родителей.",
	null,
	"https://detskie-mechty.ru",
	"info@detskie-mechty.ru",
).lastInsertRowid;

const org4 = insertOrg.run(
	"Фонд 'Добрые сердца' - Елены Организаторши",
	"Москва",
	"Благотворительный фонд, организующий разнообразные социальные программы и мероприятия. Специализируемся на поддержке семей, пожилых людей и развитии волонтерского движения.",
	null,
	"https://dobryeserdca.org",
	"elena@dobryeserdca.org",
).lastInsertRowid;

// Users (автоматически залогиненный пользователь + волонтёры)
const insertUser = db.prepare(`
  INSERT INTO users (name, email, phone, roles, skills, interests, notifications_telegram, telegram_user_id, telegram_username) 
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Главный пользователь (автоматически залогинен) - чистый волонтер
const _mainUser = insertUser.run(
	"Алексей Волонтёров",
	"alex@example.com",
	"+7 999 123 45 67",
	'["volunteer"]',
	'["Психология", "Работа с людьми", "Первая помощь", "Общение"]',
	'["Помощь людям", "Психическое здоровье", "Социальная работа"]',
	1,
	12345,
	"alex_volunteer",
).lastInsertRowid;

// Демо-организатор
const _organizerUser = insertUser.run(
	"Елена Организаторша",
	"elena.organizer@example.com",
	"+7 999 456 78 90",
	'["organizer"]',
	'["Планирование мероприятий", "Работа с НКО", "Управление проектами", "Фандрайзинг"]',
	'["Социальная работа", "Детское развитие", "Семейные программы"]',
	1,
	54321,
	"elena_organizer",
).lastInsertRowid;

// Супер-администратор с всеми ролями (для разработки)
const _superAdminUser = insertUser.run(
	"Дмитрий Разработчик",
	"admin@example.com",
	"+7 999 000 00 00",
	'["volunteer", "organizer", "coordinator"]',
	'["Разработка", "Системное администрирование", "Управление проектами"]',
	'["Технологии", "Open Source", "Волонтерство"]',
	1,
	99999,
	"admin_user",
).lastInsertRowid;

// Дополнительные волонтёры (избегаем дублирования основных пользователей)
const volunteers = [
	[
		"Мария Психологова",
		"maria.volunteer@example.com",
		"+7 999 234 56 78",
		"Психология, Консультирование",
		"Психическое здоровье, Реабилитация",
	],
	[
		"Дмитрий Помощников",
		"dmitry.helper@example.com",
		"+7 999 345 67 89",
		"Социальная работа, Группы поддержки",
		"Зависимости, Реабилитация",
	],
	[
		"Ольга Творческая",
		"olga.creative@example.com",
		"+7 999 678 90 12",
		"Арт-терапия, Музыка",
		"Творчество, Детское развитие",
	],
	[
		"Николай Спортивный",
		"nikolay.sport@example.com",
		"+7 999 789 01 23",
		"Физкультура, Реабилитация",
		"Спорт, Здоровый образ жизни",
	],
	[
		"Татьяна Семейная",
		"tatyana.family@example.com",
		"+7 999 890 12 34",
		"Семейное консультирование",
		"Семейные отношения, Дети",
	],
	[
		"Владимир Наставник",
		"vladimir.mentor@example.com",
		"+7 999 901 23 45",
		"Наставничество, Группы поддержки",
		"Зависимости, Социальная адаптация",
	],
];

volunteers.forEach((vol, index) => {
	// Все дополнительные волонтеры - просто волонтеры
	const roles = '["volunteer"]';
	
	insertUser.run(
		vol[0],
		vol[1],
		vol[2],
		roles,
		`["${vol[3]}"]`,
		`["${vol[4]}"]`,
		1,
		20000 + index,
		vol[1].split("@")[0],
	);
});

// Events
const insertEvent = db.prepare(`
  INSERT INTO events (org_id, slug, title, short_description, long_description,
    location_type, address, city, latitude, longitude, timezone, schedule_type,
    start_date, end_date, category, tags, visibility, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// События для психбольницы (Санкт-Петербург)
const spbEvents = [
	{
		slug: "art-therapy-session-spb",
		title: "Арт-терапия для пациентов с депрессией",
		short: "Творческие занятия для поддержки пациентов в процессе лечения",
		long: "Еженедельные занятия арт-терапией для пациентов психиатрического отделения. Волонтёры помогают проводить творческие мастерские: рисование, лепка, музыкальная терапия. Требуется базовое понимание психологии и терпение.",
		address:
			"Психиатрическая больница №1, Арсенальная наб., 9, Санкт-Петербург",
		category: "health",
		tags: '["психология", "арт-терапия", "творчество", "реабилитация"]',
	},
	{
		slug: "social-adaptation-spb",
		title: "Программа социальной адаптации",
		short: "Помощь пациентам в возвращении к обычной жизни",
		long: "Индивидуальная работа с пациентами, готовящимися к выписке. Обучение бытовым навыкам, помощь в поиске работы, восстановление социальных связей. Требуется опыт социальной работы.",
		address:
			"Психиатрическая больница №1, Арсенальная наб., 9, Санкт-Петербург",
		category: "social",
		tags: '["адаптация", "социальная работа", "реинтеграция"]',
	},
	{
		slug: "group-therapy-support-spb",
		title: "Поддержка групповой терапии",
		short: "Ассистирование психологам в проведении групповых сессий",
		long: "Помощь в организации и проведении групповых терапевтических сессий. Волонтёры помогают создать комфортную атмосферу, ведут заметки, организуют пространство.",
		address:
			"Психиатрическая больница №1, Арсенальная наб., 9, Санкт-Петербург",
		category: "health",
		tags: '["групповая терапия", "психология", "поддержка"]',
	},
];

// События для НКО помощи зависимым (Пермь)
const permEvents = [
	{
		slug: "addiction-support-group-perm",
		title: "Группы поддержки для зависимых",
		short: "Ведение групп взаимопомощи для людей в процессе реабилитации",
		long: "Еженедельные встречи групп поддержки по программе 12 шагов. Волонтёры помогают модерировать обсуждения, делятся опытом выздоровления, поддерживают участников группы.",
		address: "Центр 'Путь к свободе', ул. Революции, 13, Пермь",
		category: "health",
		tags: '["зависимость", "реабилитация", "группы поддержки", "12 шагов"]',
	},
	{
		slug: "family-therapy-perm",
		title: "Семейная терапия созависимых",
		short: "Работа с семьями людей, страдающих зависимостями",
		long: "Программа помощи семьям зависимых. Волонтёры с опытом семейного консультирования помогают родственникам справиться с созависимостью, учат здоровому общению.",
		address: "Центр 'Путь к свободе', ул. Революции, 13, Пермь",
		category: "social",
		tags: '["семейная терапия", "созависимость", "консультирование"]',
	},
	{
		slug: "rehabilitation-activities-perm",
		title: "Реабилитационные мероприятия",
		short: "Спортивные и творческие активности для людей в реабилитации",
		long: "Организация досуговых мероприятий для людей, проходящих реабилитацию от зависимости. Спорт, творчество, экскурсии, мастер-классы - всё для здорового образа жизни.",
		address: "Центр 'Путь к свободе', ул. Революции, 13, Пермь",
		category: "sports",
		tags: '["реабилитация", "досуг", "спорт", "творчество"]',
	},
];

// События для детского центра (Покачи)
const pokachiEvents = [
	{
		slug: "children-festival-pokachi",
		title: "Семейный фестиваль 'Дружная семья'",
		short: "Большой семейный праздник с играми, конкурсами и мастер-классами",
		long: "Ежегодный фестиваль для семей с детьми. Игровые зоны, творческие мастерские, спортивные соревнования, концерт детской самодеятельности. Нужны аниматоры, ведущие мастер-классов, помощники по организации.",
		address: "Городской парк культуры и отдыха, Покачи",
		category: "culture",
		tags: '["семейный праздник", "дети", "творчество", "игры"]',
	},
	{
		slug: "educational-workshops-pokachi",
		title: "Образовательные мастерские для детей",
		short: "Развивающие занятия по науке, технологиям и творчеству",
		long: "Еженедельные мастер-классы для детей 6-14 лет. Эксперименты, робототехника, рисование, музыка. Волонтёры помогают преподавателям, готовят материалы, работают с небольшими группами детей.",
		address: "Центр 'Детские мечты', ул. Молодёжная, 15, Покачи",
		category: "education",
		tags: '["образование", "наука", "технологии", "развитие детей"]',
	},
	{
		slug: "family-support-pokachi",
		title: "Программа поддержки молодых семей",
		short: "Консультации и мероприятия для молодых родителей",
		long: "Программа поддержки семей с маленькими детьми. Консультации по воспитанию, группы для мам, детские праздники. Волонтёры помогают в организации, присматривают за детьми во время консультаций.",
		address: "Центр 'Детские мечты', ул. Молодёжная, 15, Покачи",
		category: "social",
		tags: '["молодые семьи", "воспитание", "поддержка родителей"]',
	},
];

// Создаём события
const allEvents = [];

// СПб события
spbEvents.forEach((eventData, index) => {
	const date = new Date();
	date.setDate(date.getDate() + index * 7 + 5); // Раз в неделю, начиная через 5 дней

	const eventId = insertEvent.run(
		org1,
		eventData.slug,
		eventData.title,
		eventData.short,
		eventData.long,
		"onsite",
		eventData.address,
		"Санкт-Петербург",
		null,
		null,
		"Europe/Moscow",
		"oneoff",
		date.toISOString().split("T")[0],
		date.toISOString().split("T")[0],
		eventData.category,
		eventData.tags,
		"public",
		"published",
	).lastInsertRowid;

	allEvents.push({ id: eventId, org: org1, type: "spb" });
});

// Пермь события
permEvents.forEach((eventData, index) => {
	const date = new Date();
	date.setDate(date.getDate() + index * 10 + 8); // Каждые 10 дней, начиная через 8 дней

	const eventId = insertEvent.run(
		org2,
		eventData.slug,
		eventData.title,
		eventData.short,
		eventData.long,
		"onsite",
		eventData.address,
		"Пермь",
		null,
		null,
		"Europe/Moscow",
		"oneoff",
		date.toISOString().split("T")[0],
		date.toISOString().split("T")[0],
		eventData.category,
		eventData.tags,
		"public",
		"published",
	).lastInsertRowid;

	allEvents.push({ id: eventId, org: org2, type: "perm" });
});

// Покачи события
pokachiEvents.forEach((eventData, index) => {
	const date = new Date();
	date.setDate(date.getDate() + index * 14 + 12); // Каждые 2 недели, начиная через 12 дней

	const eventId = insertEvent.run(
		org3,
		eventData.slug,
		eventData.title,
		eventData.short,
		eventData.long,
		"onsite",
		eventData.address,
		"Покачи",
		null,
		null,
		"Europe/Moscow",
		"oneoff",
		date.toISOString().split("T")[0],
		date.toISOString().split("T")[0],
		eventData.category,
		eventData.tags,
		"public",
		"published",
	).lastInsertRowid;

	allEvents.push({ id: eventId, org: org3, type: "pokachi" });
});

// Дополнительные события для разнообразия
const additionalEvents = [
	// Больше СПб событий
	{
		org: org1,
		slug: "mental-health-workshop-spb",
		title: "Мастерская ментального здоровья",
		short: "Обучающие семинары по поддержке психического благополучия",
		long: "Образовательные семинары для пациентов и их родственников о методах поддержания ментального здоровья, техниках релаксации, важности приёма лекарств.",
		address:
			"Психиатрическая больница №1, Арсенальная наб., 9, Санкт-Петербург",
		category: "education",
		tags: '["ментальное здоровье", "образование", "семинары"]',
	},
	// Больше Пермь событий
	{
		org: org2,
		slug: "detox-support-perm",
		title: "Поддержка в период детоксикации",
		short: "Помощь людям в первые дни отказа от зависимости",
		long: "Круглосуточная поддержка людей, проходящих детоксикацию. Волонтёры помогают справиться с физическим и эмоциональным дискомфортом, обеспечивают моральную поддержку.",
		address: "Центр 'Путь к свободе', ул. Революции, 13, Пермь",
		category: "health",
		tags: '["детоксикация", "поддержка", "реабилитация"]',
	},
	// Больше Покачи событий
	{
		org: org3,
		slug: "children-summer-camp-pokachi",
		title: "Летний лагерь для детей 'Солнечное лето'",
		short: "Организация летнего отдыха для детей из многодетных семей",
		long: "Двухнедельный летний лагерь дневного пребывания. Образовательные и развлекательные программы, спорт, творчество, экскурсии. Нужны вожатые, преподаватели, медработники.",
		address: "База отдыха 'Таёжная', Покачи",
		category: "education",
		tags: '["летний лагерь", "дети", "отдых", "образование"]',
	},
	
	// События организации Елены (Фонд "Добрые сердца")
	{
		org: org4,
		slug: "senior-care-program-moscow",
		title: "Программа заботы о пожилых 'Мудрые годы'",
		short: "Социальная поддержка и общение с одинокими пожилыми людьми",
		long: "Еженедельные визиты к одиноким пожилым людям. Помощь с покупками, общение, сопровождение к врачу. Волонтёры также организуют групповые мероприятия и праздники.",
		address: "Центр социального обслуживания, ул. Тверская, 15, Москва",
		category: "social",
		tags: '["пожилые люди", "социальная поддержка", "общение"]',
	},
	{
		org: org4,
		slug: "homeless-shelter-help-moscow",
		title: "Помощь в приюте для бездомных 'Новый путь'",
		short: "Организация питания и поддержки для людей без жилья",
		long: "Ежедневная работа в приюте: приготовление и раздача еды, организация гигиенических процедур, помощь в получении документов, поиск работы для постояльцев.",
		address: "Приют 'Новый путь', ул. Садовая, 42, Москва",
		category: "social",
		tags: '["бездомные", "питание", "социальная адаптация"]',
	},
	{
		org: org4,
		slug: "family-support-center-moscow",
		title: "Центр поддержки семей в кризисе 'Крепкая семья'",
		short: "Психологическая и материальная помощь семьям в трудной ситуации",
		long: "Комплексная поддержка семей, оказавшихся в кризисной ситуации. Психологическое консультирование, помощь с детьми, организация досуга, помощь с трудоустройством.",
		address: "Семейный центр 'Крепкая семья', ул. Мира, 89, Москва",
		category: "social",
		tags: '["семьи", "кризисная поддержка", "психология"]',
	},
	{
		org: org4,
		slug: "volunteer-training-moscow",
		title: "Школа волонтеров 'Первые шаги'",
		short: "Обучение новых волонтеров основам социальной работы",
		long: "Образовательная программа для начинающих волонтеров. Основы психологии, работа с уязвимыми группами, техники активного слушания, профилактика выгорания.",
		address: "Учебный центр 'Добрые сердца', ул. Новокузнецкая, 12, Москва",
		category: "education",
		tags: '["обучение волонтеров", "социальная работа", "психология"]',
	},
	{
		org: org4,
		slug: "charity-fundraising-gala-moscow",
		title: "Благотворительный гала-вечер 'Вместе мы сильнее'",
		short: "Фандрайзинговое мероприятие для поддержки социальных программ",
		long: "Торжественный гала-вечер с концертной программой, аукционом и презентацией проектов фонда. Сбор средств на развитие социальных программ и поддержку нуждающихся.",
		address: "Отель 'Метрополь', Театральный проезд, 2, Москва",
		category: "community",
		tags: '["фандрайзинг", "гала", "благотворительность", "концерт"]',
	},
];

additionalEvents.forEach((eventData, index) => {
	const date = new Date();
	date.setDate(date.getDate() + index * 5 + 20); // Каждые 5 дней, начиная через 20 дней

	const eventId = insertEvent.run(
		eventData.org,
		eventData.slug,
		eventData.title,
		eventData.short,
		eventData.long,
		"onsite",
		eventData.address,
		eventData.org === org1
			? "Санкт-Петербург"
			: eventData.org === org2
				? "Пермь"
				: eventData.org === org3
					? "Покачи"
					: "Москва",
		null,
		null,
		"Europe/Moscow",
		"oneoff",
		date.toISOString().split("T")[0],
		date.toISOString().split("T")[0],
		eventData.category,
		eventData.tags,
		"public",
		"published",
	).lastInsertRowid;

	allEvents.push({ id: eventId, org: eventData.org, type: "additional" });
});

// Roles and Shifts
const insertRole = db.prepare(`
  INSERT INTO roles (event_id, title, description, required_skills, min_age, auto_approve) 
  VALUES (?, ?, ?, ?, ?, ?)
`);

const insertShift = db.prepare(`
  INSERT INTO shifts (role_id, start_time, end_time, capacity, qr_id, status) 
  VALUES (?, ?, ?, ?, ?, ?)
`);

// Создаём роли и смены для каждого события
allEvents.forEach((eventInfo, eventIndex) => {
	const eventId = eventInfo.id;

	// Разные наборы ролей в зависимости от типа события
	let roles = [];

	if (eventInfo.type === "spb") {
		// Роли для психбольницы
		roles = [
			{
				title: "Арт-терапевт",
				description: "Проведение творческих занятий с пациентами",
				skills: '["Арт-терапия", "Психология", "Творчество"]',
				minAge: 21,
			},
			{
				title: "Помощник психолога",
				description: "Ассистирование в групповых сессиях",
				skills: '["Психология", "Коммуникация"]',
				minAge: 18,
			},
			{
				title: "Социальный работник",
				description: "Помощь в социальной адаптации пациентов",
				skills: '["Социальная работа", "Терпение"]',
				minAge: 20,
			},
		];
	} else if (eventInfo.type === "perm") {
		// Роли для центра помощи зависимым
		roles = [
			{
				title: "Консультант по зависимости",
				description: "Ведение групп поддержки и индивидуальные консультации",
				skills: '["Работа с зависимостями", "Групповая работа"]',
				minAge: 25,
			},
			{
				title: "Семейный консультант",
				description: "Работа с созависимыми родственниками",
				skills: '["Семейная терапия", "Психология"]',
				minAge: 23,
			},
		];
	} else if (eventInfo.type === "pokachi") {
		// Роли для детского центра
		roles = [
			{
				title: "Аниматор",
				description: "Проведение игр и развлекательных программ",
				skills: '["Работа с детьми", "Творчество", "Энергичность"]',
				minAge: 18,
			},
			{
				title: "Преподаватель",
				description: "Ведение образовательных мастер-классов",
				skills: '["Преподавание", "Терпение"]',
				minAge: 20,
			},
			{
				title: "Организатор",
				description: "Координация мероприятий и помощь родителям",
				skills: '["Организация", "Коммуникация"]',
				minAge: 21,
			},
		];
	} else {
		// Универсальные роли
		roles = [
			{
				title: "Волонтёр-помощник",
				description: "Общая помощь в организации мероприятия",
				skills: '["Желание помочь"]',
				minAge: 16,
			},
		];
	}

	// Создаём роли
	roles.forEach((roleData) => {
		const roleId = insertRole.run(
			eventId,
			roleData.title,
			roleData.description,
			roleData.skills,
			roleData.minAge,
			1,
		).lastInsertRowid;

		// Создаём смены для каждой роли
		const shifts = [
			{ start: "09:00:00", end: "13:00:00", capacity: 8 },
			{ start: "13:00:00", end: "17:00:00", capacity: 6 },
			{ start: "17:00:00", end: "21:00:00", capacity: 4 },
		];

		shifts.forEach((shift, shiftIndex) => {
			const qrId = `QR_${roleId}_${shiftIndex}_${Date.now()}`;

			insertShift.run(
				roleId,
				`2025-02-${String(15 + eventIndex).padStart(2, "0")}T${shift.start}`,
				`2025-02-${String(15 + eventIndex).padStart(2, "0")}T${shift.end}`,
				shift.capacity,
				qrId,
				"scheduled",
			);
		});
	});
});

// Создаём тестовые заявки и посещаемость
const insertApplication = db.prepare(`
  INSERT INTO applications (user_id, event_id, role_id, shift_id, status, answers, applied_at) 
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const insertAttendance = db.prepare(`
  INSERT INTO attendance (application_id, shift_id, status, checkin_at, checkout_at, hours_worked, checkin_source) 
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

// Получаем все смены для создания заявок
const allShifts = db
	.query(
		"SELECT s.*, r.event_id FROM shifts s JOIN roles r ON s.role_id = r.id",
	)
	.all();
const allUsers = db.query("SELECT id FROM users WHERE id > 10").all(); // Исключаем главного пользователя

// Создаём заявки (70% одобренных, 20% в ожидании, 10% отклонённых)
let _applicationId = 1;
allShifts.forEach((shift, _shiftIndex) => {
	const numApplications = Math.floor(Math.random() * 5) + 2; // 2-6 заявок на смену

	for (let i = 0; i < numApplications && i < allUsers.length; i++) {
		const user = allUsers[i % allUsers.length];
		const rand = Math.random();
		let status: string | null = null,
			attendanceStatus: string | null = null,
			hours: number | null = null;

		if (rand < 0.7) {
			status = "approved";
			// 80% одобренных действительно пришли
			if (Math.random() < 0.8) {
				attendanceStatus = Math.random() < 0.9 ? "checked_out" : "checked_in";
				hours =
					attendanceStatus === "checked_out"
						? Math.floor(Math.random() * 6) + 2
						: null;
			} else {
				attendanceStatus = "no_show";
			}
		} else if (rand < 0.9) {
			status = "pending";
		} else {
			status = "declined";
		}

		const appId = insertApplication.run(
			user.id,
			shift.event_id,
			shift.role_id,
			shift.id,
			status,
			'{"comment": "Хочу помочь!"}',
			new Date(
				Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000,
			).toISOString(), // Последние 30 дней
		).lastInsertRowid;

		// Создаём посещаемость если заявка одобрена
		if (attendanceStatus) {
			const checkinTime = new Date(shift.start_time);
			checkinTime.setMinutes(
				checkinTime.getMinutes() + Math.floor(Math.random() * 30),
			); // Опоздание до 30 мин

			const checkoutTime =
				attendanceStatus === "checked_out" ? new Date(shift.end_time) : null;
			if (checkoutTime) {
				checkoutTime.setMinutes(
					checkoutTime.getMinutes() + Math.floor(Math.random() * 60) - 30,
				); // ±30 мин от конца
			}

			insertAttendance.run(
				appId,
				shift.id,
				attendanceStatus,
				attendanceStatus !== "no_show" ? checkinTime.toISOString() : null,
				checkoutTime?.toISOString() || null,
				hours,
				["qr", "kiosk", "telegram", "manual"][Math.floor(Math.random() * 4)],
			);
		}

		_applicationId++;
	}
});

// Создаём тестовые инциденты
const insertIncident = db.prepare(`
  INSERT INTO incidents (event_id, shift_id, user_id, type, note, created_by) 
  VALUES (?, ?, ?, ?, ?, ?)
`);

const incidentTypes = ["late", "equipment", "other"];
const incidentNotes = [
	"Волонтёр опоздал на 15 минут из-за пробок",
	"Сломался проектор в аудитории",
	"Потребовалась дополнительная помощь с организацией",
];

// Создаём 5-10 инцидентов
for (let i = 0; i < 7 && allUsers.length > 0 && allShifts.length > 0; i++) {
	const randomShift = allShifts[Math.floor(Math.random() * allShifts.length)];
	const randomUser = allUsers[Math.floor(Math.random() * allUsers.length)];
	const typeIndex = Math.floor(Math.random() * incidentTypes.length);

	if (randomShift && randomUser) {
		insertIncident.run(
			randomShift.event_id,
			randomShift.id,
			randomUser.id,
			incidentTypes[typeIndex],
			incidentNotes[typeIndex],
			10, // Главный пользователь как создатель
		);
	}
}

// Обновляем счётчики часов у пользователей
const userHours = db
	.query(`
  SELECT a.user_id, SUM(att.hours_worked) as total_hours
  FROM attendance att
  JOIN applications a ON att.application_id = a.id
  WHERE att.hours_worked > 0
  GROUP BY a.user_id
`)
	.all();

userHours.forEach((uh) => {
	db.query("UPDATE users SET hours_total = ? WHERE id = ?").run(
		Math.round(uh.total_hours),
		uh.user_id,
	);
});

console.log("✅ Database seeded successfully!");
console.log(`Created:`);
console.log(
	`- ${db.prepare("SELECT COUNT(*) as count FROM organizations").get().count} organizations`,
);
console.log(
	`- ${db.prepare("SELECT COUNT(*) as count FROM users").get().count} users`,
);
console.log(
	`- ${db.prepare("SELECT COUNT(*) as count FROM events").get().count} events`,
);
console.log(
	`- ${db.prepare("SELECT COUNT(*) as count FROM roles").get().count} roles`,
);
console.log(
	`- ${db.prepare("SELECT COUNT(*) as count FROM shifts").get().count} shifts`,
);
console.log(
	`- ${db.prepare("SELECT COUNT(*) as count FROM applications").get().count} applications`,
);
console.log(
	`- ${db.prepare("SELECT COUNT(*) as count FROM attendance").get().count} attendance records`,
);
console.log(
	`- ${db.prepare("SELECT COUNT(*) as count FROM incidents").get().count} incidents`,
);

db.close();
