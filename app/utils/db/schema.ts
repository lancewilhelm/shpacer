import {
  sqliteTable,
  text,
  integer,
  primaryKey,
} from "drizzle-orm/sqlite-core";
import { v4 as uuidv4 } from "uuid";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";

// Users table for better-auth
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  role: text("role").notNull(),
  banned: integer("banned", { mode: "boolean" }),
  banReason: text("ban_reason"),
  banExpires: integer("ban_expires", { mode: "timestamp" }),
});

// Session table for better-auth
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  impersonatedBy: text("impersonated_by"),
});

// Accounts table for better-auth
export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp",
  }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// Verifications table for better-auth
export const verifications = sqliteTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

// USER SETTINGS TABLE
export const userSettings = sqliteTable("user_settings", {
  userId: text("user_id").primaryKey().unique(),
  settings: text("settings", { mode: "json" }).notNull().default("{}"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// GLOBAL SETTINGS TABLE
export const globalSettings = sqliteTable("global_settings", {
  id: text("user_id").primaryKey(),
  settings: text("settings", { mode: "json" }).notNull().default("{}"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// KNOWLEDGE TABLE
export const knowledge = sqliteTable("knowledge", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => uuidv4()),
  name: text("name").notNull().unique(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  documents: integer("documents").notNull(),
  chunks: integer("chunks").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// COURSES TABLE
export const courses = sqliteTable("courses", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => uuidv4()),
  name: text("name").notNull(),
  description: text("description"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  // File storage fields
  originalFileName: text("original_file_name").notNull(),
  originalFileContent: text("original_file_content").notNull(),
  fileType: text("file_type").notNull(), // 'gpx' or 'tcx'
  geoJsonData: text("geojson_data", { mode: "json" }).notNull(),

  // Course metrics
  totalDistance: integer("total_distance"), // in meters
  elevationGain: integer("elevation_gain"), // in meters
  elevationLoss: integer("elevation_loss"), // in meters
  raceDate: integer("race_date", { mode: "timestamp" }), // optional race date
  public: integer("public", { mode: "boolean" }).notNull().default(false), // visibility (false = private)
  shareEnabled: integer("share_enabled", { mode: "boolean" })
    .notNull()
    .default(false), // public share link (read-only) enabled
  forkedFromCourseId: text("forked_from_course_id"), // nullable; provenance pointer to original course

  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// WAYPOINTS TABLE
export const waypoints = sqliteTable("waypoints", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => uuidv4()),
  courseId: text("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  lat: text("lat").notNull(), // Store as text for precision
  lng: text("lng").notNull(), // Store as text for precision
  elevation: integer("elevation"), // in meters
  distance: integer("distance").notNull(), // distance along route in meters
  tags: text("tags", { mode: "json" }).notNull().default("[]"), // Array of tag IDs
  icon: text("icon"),
  order: integer("order").notNull(), // order along the route

  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// PLANS TABLE
export const plans = sqliteTable("plans", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => uuidv4()),
  courseId: text("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  pace: integer("pace"), // target average pace in seconds per kilometer or mile (grade-adjusted)
  paceUnit: text("pace_unit").notNull().default("min_per_km"), // 'min_per_km' or 'min_per_mi'
  // Mode in which pacing is defined: 'pace' | 'time' | 'normalized'
  paceMode: text("pace_mode").notNull().default("pace"),
  // If paceMode is 'time', the target finish time for the course, in seconds
  targetTimeSeconds: integer("target_time_seconds"),
  defaultStoppageTime: integer("default_stoppage_time").default(0), // default stoppage time in seconds
  // Enable grade-adjusted calculations for this plan
  useGradeAdjustment: integer("use_grade_adjustment", { mode: "boolean" })
    .notNull()
    .default(true),
  // Pacing strategy: 'flat' (uniform) or 'linear' (linearly varying factor along the course)
  pacingStrategy: text("pacing_strategy").notNull().default("flat"),
  // For linear pacing, total percent change from start to end.
  // Example: 10 => factor varies from -5% at start (0.95x) to +5% at end (1.05x).
  // Negative values produce negative splits (faster at end).
  pacingLinearPercent: integer("pacing_linear_percent").default(0),
  shareEnabled: integer("share_enabled", { mode: "boolean" })
    .notNull()
    .default(false), // public share link (read-only) enabled

  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// WAYPOINT NOTES TABLE
export const waypointNotes = sqliteTable("waypoint_notes", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => uuidv4()),
  planId: text("plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),
  waypointId: text("waypoint_id")
    .notNull()
    .references(() => waypoints.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  notes: text("notes").notNull(),

  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// WAYPOINT STOPPAGE TIMES TABLE
export const waypointStoppageTimes = sqliteTable("waypoint_stoppage_times", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => uuidv4()),
  planId: text("plan_id")
    .notNull()
    .references(() => plans.id, { onDelete: "cascade" }),
  waypointId: text("waypoint_id")
    .notNull()
    .references(() => waypoints.id, { onDelete: "cascade" }),
  stoppageTime: integer("stoppage_time").notNull(), // stoppage time in seconds

  // Timestamps
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// USER_COURSES TABLE (tracks ownership and added/public saves)
export const userCourses = sqliteTable(
  "user_courses",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("starred"), // 'owner' | 'starred'
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.courseId] }),
  }),
);

// TYPE
export type InsertUserSettings = InferInsertModel<typeof userSettings>;
export type InsertGlobalSettings = InferInsertModel<typeof globalSettings>;
export type InsertCourse = InferInsertModel<typeof courses>;
export type InsertWaypoint = InferInsertModel<typeof waypoints>;
export type InsertPlan = InferInsertModel<typeof plans>;
export type InsertWaypointNote = InferInsertModel<typeof waypointNotes>;
export type InsertWaypointStoppageTime = InferInsertModel<
  typeof waypointStoppageTimes
>;
export type InsertUserCourse = InferInsertModel<typeof userCourses>;

export type SelectUserSettings = InferSelectModel<typeof userSettings>;
export type SelectGlobalSettings = InferSelectModel<typeof globalSettings>;
export type SelectKnowledge = InferSelectModel<typeof knowledge>;
export type SelectCourse = InferSelectModel<typeof courses>;
export type SelectWaypoint = InferSelectModel<typeof waypoints>;
export type SelectPlan = InferSelectModel<typeof plans>;
export type SelectWaypointNote = InferSelectModel<typeof waypointNotes>;
export type SelectWaypointStoppageTime = InferSelectModel<
  typeof waypointStoppageTimes
>;
export type SelectUserCourse = InferSelectModel<typeof userCourses>;
