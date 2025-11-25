import { serve } from "bun";
import index from "./index.html";
import { openEpub } from "@epub-parser";
import {
  buildSetCookie,
  createAuthToken,
  generateOAuthState,
  getTokenFromRequest,
  parseCookies,
} from "./server/auth";
import { getUserSnapshot, setUserSnapshot } from "./server/stateStore";
import type { StateSnapshot } from "@state-store";

const GITHUB_CLIENT_ID = Bun.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = Bun.env.GITHUB_CLIENT_SECRET;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function unauthorized(message = "Unauthorized") {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": "Bearer",
    },
  });
}

function badRequest(message: string) {
  return json({ error: message }, 400);
}

function serverError(message: string) {
  return json({ error: message }, 500);
}

function getOrigin(req: Request) {
  const url = new URL(req.url);
  const protocol = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? url.host;
  return `${protocol}://${host}`;
}

async function handleGitHubLogin(req: Request) {
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    return serverError("GitHub OAuth is not configured");
  }

  const state = generateOAuthState();
  const origin = getOrigin(req);
  const redirectUri = `${origin}/auth/github/callback`;

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", GITHUB_CLIENT_ID);
  authorizeUrl.searchParams.set("scope", "read:user");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);

  const headers = new Headers({ Location: authorizeUrl.toString() });
  headers.append(
    "Set-Cookie",
    buildSetCookie("oauth_state", state, { maxAge: 5 * 60, httpOnly: true, sameSite: "Lax" }),
  );

  return new Response(null, { status: 302, headers });
}

async function handleGitHubCallback(req: Request) {
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    return serverError("GitHub OAuth is not configured");
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return badRequest("Missing OAuth parameters");
  }

  const cookies = parseCookies(req);
  if (!cookies.oauth_state || cookies.oauth_state !== state) {
    return badRequest("Invalid OAuth state");
  }

  const origin = getOrigin(req);

  try {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${origin}/auth/github/callback`,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(`GitHub token exchange failed (${tokenResponse.status})`);
    }

    const tokenJson = await tokenResponse.json();
    if (!tokenJson.access_token) {
      throw new Error(tokenJson.error_description ?? "No access token returned");
    }

    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${tokenJson.access_token}`,
      },
    });

    if (!userResponse.ok) {
      throw new Error(`GitHub user fetch failed (${userResponse.status})`);
    }

    const userJson = await userResponse.json();
    const token = createAuthToken({
      userId: String(userJson.id),
      login: userJson.login,
      name: userJson.name ?? undefined,
      avatarUrl: userJson.avatar_url ?? undefined,
    });

    const redirectTarget = new URL(origin);
    redirectTarget.searchParams.set("auth_token", token);

    const headers = new Headers({ Location: redirectTarget.toString() });
    headers.append(
      "Set-Cookie",
      buildSetCookie("oauth_state", "", { maxAge: 0, httpOnly: true, sameSite: "Lax" }),
    );

    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error("GitHub OAuth callback failed", error);
    const redirectTarget = new URL(origin);
    redirectTarget.searchParams.set("auth_error", encodeURIComponent((error as Error).message));
    const headers = new Headers({ Location: redirectTarget.toString() });
    headers.append(
      "Set-Cookie",
      buildSetCookie("oauth_state", "", { maxAge: 0, httpOnly: true, sameSite: "Lax" }),
    );
    return new Response(null, { status: 302, headers });
  }
}

function requireAuth(req: Request) {
  const payload = getTokenFromRequest(req);
  if (!payload) {
    return { payload: null, response: unauthorized() };
  }
  return { payload, response: null };
}

async function handleGetReadingState(req: Request) {
  const { payload, response } = requireAuth(req);
  if (!payload) return response!;

  const snapshot = (await getUserSnapshot(payload.userId)) ?? {};
  return json(snapshot);
}

async function handlePutReadingState(req: Request) {
  const { payload, response } = requireAuth(req);
  if (!payload) return response!;

  let snapshot: StateSnapshot;
  try {
    snapshot = (await req.json()) as StateSnapshot;
    if (!snapshot || typeof snapshot !== "object") {
      return badRequest("Invalid snapshot payload");
    }
  } catch (error) {
    return badRequest("Unable to parse snapshot");
  }

  await setUserSnapshot(payload.userId, snapshot);
  return json({ ok: true });
}

async function handleAuthMe(req: Request) {
  const { payload, response } = requireAuth(req);
  if (!payload) return response!;
  return json({ login: payload.login, name: payload.name, avatarUrl: payload.avatarUrl });
}

async function handleEpubUpload(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof Blob)) {
      return badRequest("缺少电子书文件");
    }

    const buffer = await file.arrayBuffer();
    const book = await openEpub(buffer);

    const cssResources = await Promise.all(
      Object.values(book.manifest)
        .filter(resource => resource.mediaType.includes("css"))
        .map(async resource => {
          const content = await book.resources.getContent(resource.href);
          if (content == null) return null;
          const css = typeof content === "string" ? content : new TextDecoder("utf-8").decode(content);
          return {
            id: resource.id,
            href: resource.href,
            css,
          };
        }),
    );

    const cssList = cssResources.filter((entry): entry is { id: string; href: string; css: string } => entry !== null);

    const chapters = await Promise.all(
      book.spine.map(async (item, index) => {
        const manifestItem = book.manifest[item.idref];
        if (!manifestItem) return null;

        if (
          !manifestItem.mediaType.includes("html") &&
          !manifestItem.mediaType.includes("xml") &&
          !manifestItem.mediaType.startsWith("text/")
        ) {
          return null;
        }

        const content = await book.resources.getContent(manifestItem.href);
        if (content == null) return null;

        const text =
          typeof content === "string" ? content : new TextDecoder("utf-8").decode(content);

        return {
          index,
          idref: item.idref,
          href: manifestItem.href,
          mediaType: manifestItem.mediaType,
          content: text,
          styles: cssList,
        };
      }),
    );

    const payload = {
      id: book.id,
      metadata: book.metadata,
      toc: book.toc,
      spine: book.spine,
      manifest: book.manifest,
      chapters: chapters
        .filter((chapter): chapter is NonNullable<typeof chapter> => chapter !== null)
        .map(chapter => ({
          ...chapter,
          styles: chapter.styles.map(style => style.css),
        })),
    };

    return json(payload);
  } catch (error) {
    console.error("Failed to parse EPUB:", error);
    return serverError("解析失败，请确认文件是否正确。");
  }
}

const server = serve({
  routes: {
    "/auth/github/login": handleGitHubLogin,
    "/auth/github/callback": handleGitHubCallback,

    "/api/auth/me": handleAuthMe,

    "/api/reading-state": {
      GET: handleGetReadingState,
      PUT: handlePutReadingState,
    },

    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async req => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },

    "/api/epub": {
      POST: handleEpubUpload,
    },

    // Serve index.html for all unmatched routes.
    "/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
