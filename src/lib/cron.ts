/**
 * Vercel Cron calls our routes with "Authorization: Bearer <CRON_SECRET>".
 * Without CRON_SECRET configured, cron routes refuse every request (fail closed).
 */
export function isAuthorizedCron(authorization: string | null, secret: string | undefined = process.env.CRON_SECRET): boolean {
  if (!secret || !authorization) return false;
  const expected = `Bearer ${secret}`;
  if (authorization.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= authorization.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
