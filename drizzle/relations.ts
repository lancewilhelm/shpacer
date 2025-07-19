import { relations } from "drizzle-orm/relations";
import { users, accounts, knowledge, sessions, courses, waypoints } from "./schema";

export const accountsRelations = relations(accounts, ({one}) => ({
	user: one(users, {
		fields: [accounts.userId],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	accounts: many(accounts),
	knowledges: many(knowledge),
	sessions: many(sessions),
	courses: many(courses),
}));

export const knowledgeRelations = relations(knowledge, ({one}) => ({
	user: one(users, {
		fields: [knowledge.userId],
		references: [users.id]
	}),
}));

export const sessionsRelations = relations(sessions, ({one}) => ({
	user: one(users, {
		fields: [sessions.userId],
		references: [users.id]
	}),
}));

export const coursesRelations = relations(courses, ({one, many}) => ({
	user: one(users, {
		fields: [courses.userId],
		references: [users.id]
	}),
	waypoints: many(waypoints),
}));

export const waypointsRelations = relations(waypoints, ({one}) => ({
	course: one(courses, {
		fields: [waypoints.courseId],
		references: [courses.id]
	}),
}));