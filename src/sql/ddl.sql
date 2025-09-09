CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  roles TEXT DEFAULT '["volunteer"]', -- JSON array: ['volunteer','organizer','coordinator']
  hours_total INTEGER DEFAULT 0,
  -- Telegram integration
  telegram_user_id INTEGER UNIQUE,
  telegram_username TEXT,
  telegram_linked_at TEXT,
  -- Profile fields
  skills TEXT, -- JSON array
  interests TEXT, -- JSON array  
  languages TEXT, -- JSON array
  availability TEXT, -- JSON object
  bio TEXT, -- User biography
  -- Notification preferences
  notifications_telegram BOOLEAN DEFAULT 1,
  notifications_email BOOLEAN DEFAULT 1,
  notifications_sms BOOLEAN DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  city TEXT,
  description TEXT,
  -- Branding
  logo_url TEXT,
  brand_color TEXT,
  -- Contact info
  website TEXT,
  email TEXT,
  phone TEXT,
  social_links TEXT, -- JSON object
  -- Settings
  waiver_template TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  slug TEXT UNIQUE,
  title TEXT NOT NULL,
  short_description TEXT,
  long_description TEXT,
  cover_url TEXT,
  -- Location
  location_type TEXT CHECK (location_type IN ('onsite','online','hybrid')) DEFAULT 'onsite',
  address TEXT,
  city TEXT,
  latitude REAL,
  longitude REAL,
  timezone TEXT DEFAULT 'UTC',
  -- Schedule  
  schedule_type TEXT CHECK (schedule_type IN ('oneoff','series','recurring')) DEFAULT 'oneoff',
  start_date TEXT,
  end_date TEXT,
  -- Settings
  visibility TEXT CHECK (visibility IN ('public','private','unlisted')) DEFAULT 'public',
  status TEXT CHECK (status IN ('draft','published','closed','cancelled')) DEFAULT 'draft',
  auto_approve BOOLEAN DEFAULT 0,
  -- Categories and tags
  category TEXT,
  tags TEXT, -- JSON array
  -- Form configuration
  custom_questions TEXT, -- JSON array
  waiver_required BOOLEAN DEFAULT 0,
  -- Telegram settings
  telegram_notifications TEXT, -- JSON object with templates
  telegram_event_link TEXT,
  -- Timestamps
  published_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id),
  title TEXT NOT NULL,
  description TEXT,
  -- Requirements
  required_skills TEXT, -- JSON array
  min_age INTEGER,
  required_documents TEXT, -- JSON array
  -- Settings
  auto_approve BOOLEAN DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  -- Check-in settings
  qr_id TEXT UNIQUE,
  geofence_lat REAL,
  geofence_lon REAL,
  geofence_radius INTEGER, -- meters
  -- Telegram deep links
  telegram_event_link TEXT,
  telegram_shift_link TEXT,
  telegram_checkin_link TEXT,
  -- Status
  status TEXT CHECK (status IN ('scheduled','live','finished','cancelled')) DEFAULT 'scheduled',
  auto_approve BOOLEAN DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  role_id INTEGER NOT NULL REFERENCES roles(id),
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  status TEXT CHECK (status IN ('new','pending','approved','waitlisted','declined','cancelled')) DEFAULT 'new',
  -- Form responses
  answers TEXT, -- JSON object
  uploaded_files TEXT, -- JSON array of file paths
  waiver_signed_at TEXT,
  -- Timestamps
  applied_at TEXT DEFAULT (datetime('now')),
  decided_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications(id),
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  status TEXT CHECK (status IN ('registered','checked_in','checked_out','no_show')) DEFAULT 'registered',
  -- Check-in/out details
  checkin_at TEXT,
  checkout_at TEXT,
  checkin_source TEXT CHECK (checkin_source IN ('qr','kiosk','telegram','manual')),
  checkin_location TEXT, -- lat,lon if available
  -- Hours tracking
  hours_worked REAL,
  hours_verified BOOLEAN DEFAULT 0,
  verified_by INTEGER REFERENCES users(id),
  -- Timestamps
  created_at TEXT DEFAULT (datetime('now'))
);

-- Add incidents table for day-of-event issues
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id),
  shift_id INTEGER REFERENCES shifts(id),
  user_id INTEGER REFERENCES users(id),
  type TEXT CHECK (type IN ('late','injury','equipment','conflict','other')) NOT NULL,
  note TEXT,
  photo_urls TEXT, -- JSON array
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Add analytics events table
CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  event_type TEXT NOT NULL,
  event_data TEXT, -- JSON object
  session_id TEXT,
  user_agent TEXT,
  ip_address TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Updated indexes for new schema
CREATE INDEX IF NOT EXISTS idx_events_start_date ON events(start_date);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_visibility ON events(visibility);
CREATE INDEX IF NOT EXISTS idx_events_location ON events(address);
CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);
CREATE INDEX IF NOT EXISTS idx_roles_event ON roles(event_id);
CREATE INDEX IF NOT EXISTS idx_shifts_role ON shifts(role_id);
CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts(status);
CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id);
CREATE INDEX IF NOT EXISTS idx_applications_event ON applications(event_id);
CREATE INDEX IF NOT EXISTS idx_applications_role ON applications(role_id);
CREATE INDEX IF NOT EXISTS idx_applications_shift ON applications(shift_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_attendance_application ON attendance(application_id);
CREATE INDEX IF NOT EXISTS idx_attendance_shift ON attendance(shift_id);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance(status);
CREATE INDEX IF NOT EXISTS idx_incidents_event ON incidents(event_id);
CREATE INDEX IF NOT EXISTS idx_incidents_type ON incidents(type);
CREATE INDEX IF NOT EXISTS idx_analytics_user ON analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_users_roles ON users(roles);
