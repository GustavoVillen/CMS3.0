import { randomBytes } from "node:crypto";

export interface IssuedSessionTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
}

export function issueOpaqueSessionTokens(): IssuedSessionTokens {
  const accessToken = randomBytes(24).toString("hex");
  const refreshToken = randomBytes(48).toString("hex");
  const accessTokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt,
  };
}
