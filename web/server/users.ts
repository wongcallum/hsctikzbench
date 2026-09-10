import { readFile, stat } from "node:fs/promises";
import * as z from "zod";
import type { Me, UserRole } from "../shared/types.ts";
import { config, SINGLE_USER_LOGIN } from "./env.ts";

export type User = Me;

/** GitHub logins: letters, digits and dashes. Dots and underscores are tolerated. */
export const LOGIN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Logins are case-insensitive; this is the form used for file names and lookups. */
export const loginKey = (login: string) => login.toLowerCase();

const UsersSchema = z.record(
  z.string().regex(LOGIN),
  z.strictObject({ role: z.enum(["owner", "judge"]) })
);

const builtinUsers = () =>
  new Map<string, UserRole>(config.singleUser ? [[loginKey(SINGLE_USER_LOGIN), "owner"]] : []);

let cached: { mtimeMs: number; size: number; users: Map<string, UserRole> } | null = null;

export async function loadUsers(): Promise<Map<string, UserRole>> {
  let info;
  try {
    info = await stat(config.usersFile);
  } catch {
    cached = null;
    return builtinUsers();
  }
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.users;
  const users = builtinUsers();
  try {
    const parsed = UsersSchema.parse(JSON.parse(await readFile(config.usersFile, "utf8")));
    for (const [login, { role }] of Object.entries(parsed)) users.set(loginKey(login), role);
  } catch (e) {
    console.error(`ignoring ${config.usersFile}: ${e instanceof Error ? e.message : String(e)}`);
  }
  cached = { mtimeMs: info.mtimeMs, size: info.size, users };
  return users;
}

export async function findUser(login: string): Promise<User | null> {
  const role = (await loadUsers()).get(loginKey(login));
  return role ? { login, role } : null;
}

export async function usersProblems(): Promise<string[]> {
  const users = await loadUsers();
  if (users.size === 0) return [`no users in ${config.usersFile}; nobody can sign in`];
  if (![...users.values()].includes("owner")) return [`${config.usersFile} names no owner`];
  return [];
}
