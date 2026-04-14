export interface HealthcheckPayload {
  status: "ok";
  service: "api";
  timestamp: string;
}

export function buildHealthcheckPayload(): HealthcheckPayload {
  return {
    status: "ok",
    service: "api",
    timestamp: new Date().toISOString(),
  };
}
