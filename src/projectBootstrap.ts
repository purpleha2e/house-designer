/** Keep the portable default house as a separate, byte-preserved asset instead
 * of JavaScript in every startup bundle. Normal project files still use Load. */
export async function fetchDefaultProject(signal: AbortSignal, request: typeof fetch = fetch): Promise<unknown> {
  const response = await request(new URL('../colin_house_v2.json', import.meta.url), { signal })
  if (!response.ok) throw new Error(`Default project request failed (${response.status})`)
  const project: unknown = await response.json()
  signal.throwIfAborted()
  return project
}
