import Database from "../../service/node_modules/better-sqlite3";
import { readFileSync } from "node:fs";
import type { SqlExecutor } from "../../service/budget";
export function database() {
  const db = new Database(":memory:");
  db.exec(
    readFileSync(
      new URL("../../service/migrations/0001.sql", import.meta.url),
      "utf8",
    ),
  );
  db.exec(readFileSync(new URL("../../service/migrations/0002.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../../service/migrations/0003.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../../service/migrations/0004.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../../service/migrations/0005.sql", import.meta.url), "utf8"));
  const sql: SqlExecutor = {
    async batch(statements) { db.transaction(() => { for (const s of statements) db.prepare(s.sql).run(...s.args); })(); },
    async all(sql, args = []) {
      return db.prepare(sql).all(...args) as any;
    },
    async run(sql, args = []) {
      return db.prepare(sql).run(...args).changes;
    },
  };
  return { db, sql };
}
export function jpeg(w = 480, h = 640) {
  return new Uint8Array([
    255,
    216,
    255,
    192,
    0,
    11,
    8,
    h >> 8,
    h & 255,
    w >> 8,
    w & 255,
    1,
    1,
    17,
    0,
    255,
    217,
  ]);
}
