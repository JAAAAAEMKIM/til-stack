import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const DB_PATH = process.env.DATABASE_PATH || "./data/local.db";

const sqlite = new Database(DB_PATH);
const db = drizzle(sqlite);

console.log("Running migrations...");
migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrations complete!");

sqlite.close();
