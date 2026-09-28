import { z } from "zod";
import { createMcpHandler } from "mcp-handler";

const PUBLER_BASE = "https://app.publer.com/api/v1";

function headers() {
  const key = process.env.PUBLER_API_KEY;
  const workspace = process.env.PUBLER_WORKSPACE_ID;
  if (!key || !workspace) {
    throw new Error(
      "PUBLER_API_KEY and PUBLER_WORKSPACE_ID environment variables must be set",
    );
  }
  return {
    Authorization: `Bearer-API ${key}`,
    "Publer-Workspace-Id": workspace,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function publerFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${PUBLER_BASE}${path}`, {
    ...options,
    headers: { ...headers(), ...(options.headers ?? {}) },
  });
  if (res.status === 204) return { success: true };

  const contentType = res.headers.get("content-type") ?? "";
  const rawText = await res.text();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any;
  if (contentType.includes("application/json")) {
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      throw new Error(
        `Publer API said it returned JSON (status ${res.status}) but the body didn't parse. Body starts with: ${rawText.slice(0, 300)}`,
      );
    }
  } else {
    // Publer sent something other than JSON (commonly an HTML error/login page).
    // This is almost always a wrong endpoint path, an expired/invalid API key or
    // workspace ID, or Publer redirecting an unauthenticated request to a login
    // page. Surface the real status + a body snippet instead of crashing on
    // res.json() with an opaque "Unexpected token '<'" parse error.
    throw new Error(
      `Publer API returned a non-JSON response (status ${res.status}, content-type: ${contentType || "unknown"}). ` +
        `This usually means the request path is wrong, PUBLER_API_KEY/PUBLER_WORKSPACE_ID is invalid or expired, ` +
        `or Publer is redirecting to a login page. Body starts with: ${rawText.slice(0, 300)}`,
    );
  }

  if (!res.ok) {
    throw new Error(
      `Publer API error ${res.status}: ${JSON.stringify(data?.errors ?? data)}`,
    );
  }
  return data;
}

// Builds the "posts[]" entry for a Publer bulk request. When imageUrl is
// supplied we assume Pinterest and build the structured networks.pinterest
// payload Publer's API actually requires. Otherwise we fall back to a flat
// { text, accounts } shape for other platforms - unverified against Publer's
// real per-network shape, but preserves prior behaviour.
function buildPost({
  accountIds,
  text,
  scheduledAt,
  title,
  linkUrl,
  imageUrl,
  boardId,
}: {
  accountIds: string[];
  text: string;
  scheduledAt?: string;
  title?: string;
  linkUrl?: string;
  imageUrl?: string;
  boardId?: string;
}) {
  const accounts = accountIds.map((id) => ({
    id,
    ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
    ...(boardId ? { album_id: boardId } : {}),
  }));

  if (imageUrl) {
    return {
      networks: {
        pinterest: {
          type: "photo",
          text,
          ...(title ? { title } : {}),
          ...(linkUrl ? { url: linkUrl } : {}),
          media: [{ id: "external-0", type: "photo", path: imageUrl }],
        },
      },
      accounts,
    };
  }

  return { text, accounts };
}

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "list_accounts",
      "List all social media accounts connected to Publer (LinkedIn, YouTube, TikTok, Instagram, X/Twitter, etc.) with their IDs and platform names. Always call this first before scheduling a post so you know the correct account IDs.",
      {},
      async () => {
        const data = await publerFetch("/accounts");
        const accounts = (data?.accounts ?? data ?? []).map(
          (a: Record<string, unknown>) => ({
            id: a.id,
            name: a.name,
            platform: a.type ?? a.network ?? a.provider,
            username: a.username ?? a.handle,
          }),
        );
        return {
          content: [
            {
              type: "text",
              text:
                accounts.length === 0
                  ? "No accounts found. Make sure accounts are connected in Publer."
                  : `Found ${accounts.length} account(s):\n\n` +
                    accounts
                      .map(
                        (a: Record<string, unknown>) =>
                          `• ${a.platform} — ${a.name ?? a.username} (ID: ${a.id})`,
                      )
                      .join("\n") +
                    "\n\nUse the ID when calling schedule_post.",
            },
          ],
        };
      },
    );

    server.tool(
      "list_posts",
      "List upcoming scheduled posts, drafts, or recently published posts in Publer.",
      {
        state: z
          .enum(["scheduled", "draft", "published"])
          .optional()
          .default("scheduled")
          .describe("Filter by post state"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .default(20)
          .describe("Number of posts to return (max 50)"),
      },
      async ({ state, limit }) => {
        const data = await publerFetch(`/posts?state=${state}&per_page=${limit}`);
        const posts = data?.posts ?? data ?? [];
        if (posts.length === 0) {
          return { content: [{ type: "text", text: `No ${state} posts found.` }] };
        }
        const summary = posts
          .map(
            (p: Record<string, unknown>) =>
              `• ID: ${p.id}\n  Text: ${String(p.text ?? "").slice(0, 100)}\n  Scheduled: ${p.scheduled_at ?? "auto"}`,
          )
          .join("\n\n");
        return {
          content: [
            { type: "text", text: `${posts.length} ${state} post(s):\n\n${summary}` },
          ],
        };
      },
    );

    server.tool(
      "schedule_post",
      'Schedule a social media post via Publer to one or more connected accounts. Use list_accounts first to get the correct account IDs. scheduled_at must be ISO 8601 format with timezone offset, e.g. "2026-06-01T09:00:00+10:00" for 9am AEST. For Pinterest, also pass image_url and board_id - Pinterest pins cannot be created without a destination board.',
      {
        account_ids: z
          .array(z.string())
          .min(1)
          .describe(
            "One or more Publer account IDs to post to. Get these from list_accounts.",
          ),
        text: z.string().min(1).describe("The post text / caption"),
        scheduled_at: z
          .string()
          .describe(
            'ISO 8601 datetime with timezone, e.g. "2026-06-01T09:00:00+10:00". Use +10:00 for AEST, +11:00 for AEDT.',
          ),
        state: z
          .enum(["scheduled", "draft"])
          .optional()
          .default("scheduled")
          .describe(
            'Use "draft" to save without scheduling, "scheduled" to queue for publishing',
          ),
        title: z
          .string()
          .optional()
          .describe("Pinterest pin title (ignored for other platforms)"),
        link_url: z
          .string()
          .optional()
          .describe("Destination URL the pin/post should link to. Pinterest only."),
        image_url: z
          .string()
          .optional()
          .describe(
            "Publicly accessible image URL for the pin. REQUIRED for Pinterest - without it this will not build a valid Pinterest post.",
          ),
        board_id: z
          .string()
          .optional()
          .describe(
            "Pinterest board ID (Publer calls this album_id) to pin to. REQUIRED for Pinterest - a pin cannot be created without a destination board.",
          ),
      },
      async ({ account_ids, text, scheduled_at, state, title, link_url, image_url, board_id }) => {
        const post = buildPost({
          accountIds: account_ids,
          text,
          scheduledAt: scheduled_at,
          title,
          linkUrl: link_url,
          imageUrl: image_url,
          boardId: board_id,
        });

        const data = await publerFetch("/posts/schedule", {
          method: "POST",
          body: JSON.stringify({ bulk: { state, posts: [post] } }),
        });

        const jobId = data?.job_id;
        if (jobId) {
          return {
            content: [
              {
                type: "text",
                text: `Post submitted successfully. Job ID: ${jobId}\n\nPubler is processing it asynchronously. Check Publer or use list_posts to confirm it appears in the schedule.`,
              },
            ],
          };
        }

        return {
          content: [
            { type: "text", text: `Post created:\n${JSON.stringify(data, null, 2)}` },
          ],
        };
      },
    );

    server.tool(
      "delete_post",
      "Delete a scheduled or draft post from Publer by its post ID. Use list_posts to find post IDs.",
      { post_id: z.string().describe("The Publer post ID to delete") },
      async ({ post_id }) => {
        // Publer's real delete endpoint is a bulk DELETE /posts with a
        // post_ids[] query array - NOT DELETE /posts/{id}. The old path
        // 404'd on every call because that resource path doesn't exist.
        // See: https://publer.com/docs/posting/delete-posts
        await publerFetch(`/posts?post_ids[]=${encodeURIComponent(post_id)}`, {
          method: "DELETE",
        });
        return {
          content: [{ type: "text", text: `Post ${post_id} deleted successfully.` }],
        };
      },
    );
  },
  {},
  { basePath: "/api" },
);

export { handler as GET, handler as POST, handler as DELETE };
