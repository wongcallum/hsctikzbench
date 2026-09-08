export const SIGNED_OUT_EVENT = "hsctikzbench:signed-out";

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (res.status === 401) window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as T;
}

export const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
