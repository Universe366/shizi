import http from 'node:http';
import crypto from 'node:crypto';
import { shell, session } from 'electron';
import type { McpOAuth, McpServer } from '../shared/types';

interface AuthMetadata {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
}

async function fetchJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await session.defaultSession.fetch(url, {
    ...init,
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return (await response.json()) as Record<string, unknown>;
}

function wellKnown(origin: string, pathname: string, suffix: string): string[] {
  const base = pathname.replace(/\/$/, '');
  return [
    `${origin}/.well-known/${suffix}${base}`,
    `${origin}${base}/.well-known/${suffix}`,
    `${origin}/.well-known/${suffix}`
  ];
}

/** MCP OAuth 2.1：受保护资源发现 → 授权服务器发现 → 动态注册 → PKCE。 */
export async function authorizeMcpServer(server: McpServer): Promise<McpOAuth> {
  if (server.transport === 'stdio') throw new Error('本地 stdio 服务不需要 OAuth');
  if (!server.url.trim()) throw new Error('请先填写 MCP 服务地址');
  const target = new URL(server.url.trim());
  let metadata: AuthMetadata | null = null;

  // 1. 受保护资源元数据（RFC 9728），拿到授权服务器 issuer。
  let issuer = target.origin;
  for (const url of wellKnown(target.origin, target.pathname, 'oauth-protected-resource')) {
    try {
      const resource = await fetchJson(url);
      const servers = resource.authorization_servers;
      if (Array.isArray(servers) && typeof servers[0] === 'string') {
        issuer = servers[0];
        break;
      }
    } catch {
      // 尝试下一个地址
    }
  }

  // 2. 授权服务器元数据。
  const metadataUrls = [
    `${issuer.replace(/\/$/, '')}/.well-known/oauth-authorization-server`,
    `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
  ];
  for (const url of metadataUrls) {
    try {
      const value = (await fetchJson(url)) as AuthMetadata;
      if (value.authorization_endpoint && value.token_endpoint) {
        metadata = value;
        break;
      }
    } catch {
      // 尝试下一个地址
    }
  }
  if (!metadata?.authorization_endpoint || !metadata.token_endpoint) {
    throw new Error('该服务没有提供 OAuth 元数据，请手动填写 Token');
  }

  const callbackServer = http.createServer();
  await new Promise<void>((resolve, reject) => {
    callbackServer.once('error', reject);
    callbackServer.listen(0, '127.0.0.1', () => resolve());
  });
  const callbackAddress = callbackServer.address();
  const callbackPort =
    typeof callbackAddress === 'object' && callbackAddress ? callbackAddress.port : 0;
  const redirect = {
    url: `http://127.0.0.1:${callbackPort}/callback`,
    port: callbackPort
  };

  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');
  const scope =
    (Array.isArray(metadata.scopes_supported) ? metadata.scopes_supported.join(' ') : '') ||
    'mcp';

  let clientId = '';
  if (metadata.registration_endpoint) {
    try {
      const registration = await fetchJson(metadata.registration_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Shizi',
          redirect_uris: [redirect.url],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          scope
        })
      });
      clientId = String(registration.client_id || '');
    } catch {
      // 动态注册失败时继续，部分服务允许无 client_id
    }
  }

  const authorizationUrl = new URL(metadata.authorization_endpoint);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('client_id', clientId);
  authorizationUrl.searchParams.set('redirect_uri', redirect.url);
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('code_challenge', codeChallenge);
  authorizationUrl.searchParams.set('code_challenge_method', 'S256');
  if (scope) authorizationUrl.searchParams.set('scope', scope);

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      callbackServer.close();
      reject(new Error('OAuth 授权超时（2 分钟）'));
    }, 120000);
    timer.unref();
    callbackServer.on('request', (request, response) => {
      const requestUrl = new URL(request.url || '/', redirect.url);
      if (requestUrl.pathname !== '/callback') {
        response.writeHead(404).end('Not found');
        return;
      }
      const error = requestUrl.searchParams.get('error');
      const returnedState = requestUrl.searchParams.get('state');
      const code = requestUrl.searchParams.get('code');
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      if (error) {
        response.end(`<h3>授权失败：${error}</h3><p>可以关闭这个窗口。</p>`);
        clearTimeout(timer);
        callbackServer.close();
        reject(new Error(`授权失败：${error}`));
        return;
      }
      if (returnedState !== state || !code) {
        response.end('<h3>授权回调无效</h3><p>可以关闭这个窗口。</p>');
        clearTimeout(timer);
        callbackServer.close();
        reject(new Error('授权回调 state/code 无效'));
        return;
      }
      response.end('<h3>授权完成</h3><p>可以关闭这个窗口，回到拾字。</p>');
      clearTimeout(timer);
      callbackServer.close();
      resolve(code);
    });
    void shell.openExternal(authorizationUrl.toString()).catch((error) => {
      clearTimeout(timer);
      callbackServer.close();
      reject(error);
    });
  });

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: redirect.url,
    code_verifier: codeVerifier
  });
  const token = (await fetchJson(metadata.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!token.access_token) throw new Error('OAuth 没有返回 access_token');
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
    tokenEndpoint: metadata.token_endpoint,
    clientId,
    scope: token.scope || scope
  };
}

/** 用 refresh_token 换新 access_token；失败时返回原值。 */
export async function refreshMcpOAuth(oauth: McpOAuth): Promise<McpOAuth> {
  if (!oauth.refreshToken || !oauth.tokenEndpoint) return oauth;
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: oauth.refreshToken,
      client_id: oauth.clientId
    });
    const token = (await fetchJson(oauth.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    })) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
    if (!token.access_token) return oauth;
    return {
      ...oauth,
      accessToken: token.access_token,
      refreshToken: token.refresh_token || oauth.refreshToken,
      expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : oauth.expiresAt,
      scope: token.scope || oauth.scope
    };
  } catch {
    return oauth;
  }
}
