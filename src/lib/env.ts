export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}. Copy .env.example to .env.local and fill it in.`);
  return v;
}
