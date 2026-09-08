import { readFile, stat } from "node:fs/promises";
import * as z from "zod";
import type { Me, UserRole } from "../shared/types.ts";
import { config } from "./env.ts";

export type User = Me;

const UsersSchema = z.record(
  z.string().min(1),
  z.strictObject({ role: z.enum(["owner", "judge"]) })
);

let cached: { mtimeMs: number; size: number; users: Map<string, UserRole> } | null = null;

export async function loadUsers(): Promise<Map<string, UserRole>> {
  let info;
  try {
    info = await stat(config.usersFile);
  } catch {
    cached = null;
    return new Map();
  }
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.users;
  const users = new Map<string, UserRole>();
  try {
    const parsed = UsersSchema.parse(JSON.parse(await readFile(config.usersFile, "utf8")));
    for (const [login, { role }] of Object.entries(parsed)) users.set(login.toLowerCase(), role);
  } catch (e) {
    console.error(`ignoring ${config.usersFile}: ${e instanceof Error ? e.message : String(e)}`);
  }
  cached = { mtimeMs: info.mtimeMs, size: info.size, users };
  return users;
}

export async function findUser(login: string): Promise<User | null> {
  const role = (await loadUsers()).get(login.toLowerCase());
  return role ? { login, role } : null;
}

export async function usersProblems(): Promise<string[]> {
  const users = await loadUsers();
  if (users.size === 0) return [`no users in ${config.usersFile}; nobody can sign in`];
  if (![...users.values()].includes("owner")) return [`${config.usersFile} names no owner`];
  return [];
}
