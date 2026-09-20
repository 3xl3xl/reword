import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";

export interface OAuthConfig {
  issuer: string;
  resource: string;
  jwksUrl: string;
}
function httpsUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error(
      "OAuth URLs must use HTTPS without credentials, query, or fragment.",
    );
  return url;
}
export function createOAuth(config: OAuthConfig, keys?: JWTVerifyGetKey) {
  httpsUrl(config.issuer);
  const resource = httpsUrl(config.resource);
  if (resource.pathname !== "/mcp")
    throw new Error("OAUTH_RESOURCE_URL must end in /mcp.");
  const jwksUrl = httpsUrl(config.jwksUrl);
  // Fetch only this operator-configured key set; never token-provided jku/x5u URLs.
  const keySet = keys ?? createRemoteJWKSet(jwksUrl, { timeoutDuration: 5000 });
  const verifier: OAuthTokenVerifier = {
    async verifyAccessToken(token) {
      try {
        const { payload } = await jwtVerify(token, keySet, {
          issuer: config.issuer,
          audience: config.resource,
          algorithms: ["RS256", "ES256"],
          typ: "at+jwt",
          requiredClaims: ["sub", "exp", "iat", "client_id", "jti"],
        });
        if (
          typeof payload.sub !== "string" ||
          !payload.sub.trim() ||
          typeof payload.client_id !== "string" ||
          !payload.client_id.trim() ||
          typeof payload.jti !== "string" ||
          !payload.jti.trim() ||
          typeof payload.scope !== "string" ||
          typeof payload.iat !== "number" ||
          payload.iat > Date.now() / 1000
        )
          throw new Error("Invalid access token claims");
        const owner =
          "oauth:" +
          createHash("sha256")
            .update(JSON.stringify([payload.iss, payload.sub]))
            .digest("hex");
        return {
          token,
          clientId: payload.client_id,
          scopes: payload.scope.split(/\s+/),
          expiresAt: payload.exp,
          resource,
          extra: { owner },
        };
      } catch {
        throw new InvalidTokenError("Invalid or expired access token");
      }
    },
  };
  return {
    verifier,
    metadataUrl: getOAuthProtectedResourceMetadataUrl(resource),
    metadata: {
      resource: config.resource,
      authorization_servers: [config.issuer],
      scopes_supported: ["reword"],
      bearer_methods_supported: ["header"],
      resource_name: "RE:WORD",
    },
  };
}
export type OAuth = ReturnType<typeof createOAuth>;
