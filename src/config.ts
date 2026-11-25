// Central runtime configuration. Defaults are the evaluator's "modo padrão".
const num = (v: string | undefined, d: number) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  port: num(process.env.PORT, 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://catraca:catraca@localhost:5432/catraca',
  partnerApiKey: process.env.PARTNER_API_KEY ?? 'catraca-partner-key-dev',
  // Payment gateway: only "simulated" exists. No real keys are ever needed.
  gatewayMode: process.env.GATEWAY_MODE ?? 'simulated',
  // Multiplies simulated gateway delays. 1 = brief timings (default). Tests use a small value.
  gatewayDelayScale: num(process.env.GATEWAY_DELAY_SCALE, 1),
  // Offset used to interpret/display dates typed in forms (Brazil, no DST).
  tzOffset: '-03:00',
};
