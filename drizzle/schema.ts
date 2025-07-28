import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
  id: text().primaryKey().notNull(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at"),
  refreshTokenExpiresAt: integer("refresh_token_expires_at"),
  scope: text(),
  password: text(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const globalSettings = sqliteTable("global_settings", {
  userId: text("user_id").primaryKey().notNull(),
  settings: text().default("{}").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const knowledge = sqliteTable(
  "knowledge",
  {
    id: text().primaryKey().notNull(),
    name: text().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text().notNull(),
    documents: integer().notNull(),
    chunks: integer().notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("knowledge_name_unique").on(table.name)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text().primaryKey().notNull(),
    expiresAt: integer("expires_at").notNull(),
    token: text().notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [uniqueIndex("sessions_token_unique").on(table.token)],
);

export const userSettings = sqliteTable(
  "user_settings",
  {
    userId: text("user_id").primaryKey().notNull(),
    settings: text().default("{}").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("user_settings_user_id_unique").on(table.userId)],
);

export const users = sqliteTable(
  "users",
  {
    id: text().primaryKey().notNull(),
    name: text().notNull(),
    email: text().notNull(),
    emailVerified: integer("email_verified").notNull(),
    image: text(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    role: text().notNull(),
    banned: integer(),
    banReason: text("ban_reason"),
    banExpires: integer("ban_expires"),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const verifications = sqliteTable("verifications", {
  id: text().primaryKey().notNull(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at"),
  updatedAt: integer("updated_at"),
});

export const courses = sqliteTable("courses", {
  id: text().primaryKey().notNull(),
  name: text().notNull(),
  description: text(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  originalFileName: text("original_file_name").notNull(),
  originalFileContent: text("original_file_content").notNull(),
  fileType: text("file_type").notNull(),
  geojsonData: text("geojson_data").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  totalDistance: integer("total_distance"),
  elevationGain: integer("elevation_gain"),
  elevationLoss: integer("elevation_loss"),
  raceDate: integer("race_date"),
});

export const waypoints = sqliteTable("waypoints", {
  id: text().primaryKey().notNull(),
  courseId: text("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  name: text().notNull(),
  description: text(),
  lat: text().notNull(),
  lng: text().notNull(),
  elevation: integer(),
  distance: integer().notNull(),
  order: integer().notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  tags: text().default("[]").notNull(),
});
