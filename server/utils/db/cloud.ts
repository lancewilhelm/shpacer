import { drizzle } from "drizzle-orm/libsql";

export const cloudDb = drizzle("file:./data/shpacer.db");
