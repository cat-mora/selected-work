import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const LOOPS_TRANSACTIONAL = {
  purchaseConfirmation: "[loops-transactional-id-1]",
  bumpGuideDelivery: "[loops-transactional-id-2]",
  otoGuideDelivery: "[loops-transactional-id-3]",
};

const GUIDES = {
  drift: {
    title: "When You Feel the Drift",
    url: "https://[project-ref].supabase.co/storage/v1/object/public/Guides/drift.pdf",
  },
  grace: {
    title: "Say It With Grace",
    url: "https://[project-ref].supabase.co/storage/v1/object/public/Guides/grace.pdf",
  },
  conversations: {
    title: "10 Conversations To Feel Close Again",
    url: "https://[project-ref].supabase.co/storage/v1/object/public/Guides/conversations.pdf",
  },
  cherished: {
    title: "Cherished Again",
    url: "https://[project-ref].supabase.co/storage/v1/object/public/Guides/cherished.pdf",
  },
};

export const config = { api: { bodyParser: false } };

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Claim a Stripe event id so it is only ever fulfilled once.
 *
 * Stripe retries webhooks, so checkout.session.completed can arrive more than
 * once for the same session. The insert is the lock: the first delivery takes
 * the row, a duplicate hits the primary key with 23505 and is skipped. Doing
 * this as a read-then-write check instead would leave a race between the two.
 *
 * Returns true if this delivery owns the event and should do the work.
 */
async function claimEvent(eventId, eventType) {
  const { error } = await supabase
    .from("processed_stripe_events")
    .insert({ event_id: eventId, event_type: eventType });

  if (!error) return true;

  if (error.code === "23505") {
    console.log(`Event ${eventId} already processed, skipping.`);
    return false;
  }

  // Could not reach the ledger. Better to fail and let Stripe retry than to
  // fulfil without a guard and risk sending everything twice.
  throw new Error(`Could not claim event ${eventId}: ${error.message}`);
}

/** Release a claim so a genuine failure can be retried by Stripe. */
async function releaseEvent(eventId) {
  const { error } = await supabase
    .from("processed_stripe_events")
    .delete()
    .eq("event_id", eventId);

  if (error) {
    console.error(
      `Failed to release claim on ${eventId}. Stripe's retry will be skipped and this purchase needs manual fulfilment: ${error.message}`,
    );
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const sig = req.headers["stripe-signature"];
  const buf = await buffer(req);
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  if (event.type !== "checkout.session.completed") {
    return res.status(200).json({ received: true });
  }

  let claimed = false;
  try {
    claimed = await claimEvent(event.id, event.type);
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ error: "Could not verify event uniqueness" });
  }

  if (!claimed) {
    return res.status(200).json({ received: true, duplicate: true });
  }

  try {
    await fulfil(event);
  } catch (err) {
    console.error(`Fulfilment failed for ${event.id}:`, err.message);
    await releaseEvent(event.id);
    return res.status(500).json({ error: "Fulfilment failed" });
  }

  return res.status(200).json({ received: true });
}

async function fulfil(event) {
  const session = event.data.object;
  const email = session.customer_details?.email;
  const firstName = session.customer_details?.name?.split(" ")[0] || "";

  if (!email) throw new Error("No email in session");

  const bumps = session.metadata?.bumps || "none";
  const otos = session.metadata?.otos || "none";
  const inviteCode = session.metadata?.invite_code || "";
  const isOTOOnly = !session.metadata?.tier;

  if (inviteCode && !isOTOOnly) {
    const tierMonths = parseInt(session.metadata?.tier_months || "12", 10);
    const saved = await saveInviteCodeToSupabase(inviteCode, email, tierMonths);
    if (!saved) {
      // The customer has paid and is about to be emailed this code. Sending it
      // when it was never stored gives them a code that cannot be redeemed, so
      // fail and let Stripe retry instead.
      throw new Error(
        `Invite code ${inviteCode} was not saved for ${email}. Not sending fulfilment email with an unusable code.`,
      );
    }
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL || "https://cultivatingthefruit.com";
  const appBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL || "https://app.cultivatingthefruit.com";

  const appSignupUrl = new URL("/auth/sign-up", appBaseUrl);
  appSignupUrl.searchParams.set("email", email);
  if (inviteCode) appSignupUrl.searchParams.set("code", inviteCode);

  const getAppUrl = new URL("/strengthen-wives/get-the-app", baseUrl);
  getAppUrl.searchParams.set("email", email);
  if (inviteCode) getAppUrl.searchParams.set("code", inviteCode);

  const tierMonths = session.metadata?.tier_months;
  const tierLabel =
    tierMonths === "1" ? "1 month" : tierMonths === "6" ? "6 months" : "12 months";
  const TIER_PRICES = {
    app_1month: "AU$19",
    app_6month: "AU$45",
    app_12month: "AU$79",
  };
  const tierPrice = TIER_PRICES[session.metadata?.tier] || "AU$79";

  const extraProps = {
    ...(bumps === "drift" || bumps === "bumpBundle" ? { purchasedDrift: true } : {}),
    ...(bumps === "grace" || bumps === "bumpBundle" ? { purchasedGrace: true } : {}),
    ...(otos === "conversations" || otos === "otoBundle"
      ? { purchasedConversations: true }
      : {}),
    ...(otos === "cherished" || otos === "otoBundle"
      ? { purchasedCherished: true }
      : {}),
  };

  if (!isOTOOnly) {
    await loopsUpsertContact({
      email,
      firstName,
      inviteCode,
      getAppUrl: getAppUrl.toString(),
      appSignupUrl: appSignupUrl.toString(),
      ...extraProps,
    });

    await loopsFetch("/events/send", {
      eventName: "purchase_completed",
      email,
      eventProperties: { tier: session.metadata?.tier, tierLabel, tierPrice, inviteCode },
    });

    await loopsFetch("/transactional", {
      transactionalId: LOOPS_TRANSACTIONAL.purchaseConfirmation,
      email,
      dataVariables: {
        firstName,
        inviteCode,
        appSignupUrl: appSignupUrl.toString(),
        tierLabel,
        tierPrice,
      },
    });

    const hasBumps = extraProps.purchasedDrift || extraProps.purchasedGrace;
    if (hasBumps) {
      const bumpGuides = [];
      if (extraProps.purchasedDrift) bumpGuides.push(GUIDES.drift);
      if (extraProps.purchasedGrace) bumpGuides.push(GUIDES.grace);
      await loopsFetch("/transactional", {
        transactionalId: LOOPS_TRANSACTIONAL.bumpGuideDelivery,
        email,
        dataVariables: { firstName, guides: bumpGuides },
      });
    }
  }

  const hasOTOs =
    extraProps.purchasedConversations || extraProps.purchasedCherished;
  if (hasOTOs) {
    const otoGuides = [];
    if (extraProps.purchasedConversations) otoGuides.push(GUIDES.conversations);
    if (extraProps.purchasedCherished) otoGuides.push(GUIDES.cherished);
    await loopsFetch("/transactional", {
      transactionalId: LOOPS_TRANSACTIONAL.otoGuideDelivery,
      email,
      dataVariables: { firstName, guides: otoGuides },
    });
  }

  console.log(
    `Processed purchase for ${email} — bumps: ${bumps}, otos: ${otos}, tier: ${isOTOOnly ? "OTO-only" : tierLabel}`,
  );
}

async function saveInviteCodeToSupabase(inviteCode, email, tierMonths = 12) {
  if (!inviteCode) {
    console.error("No invite code provided to save");
    return false;
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("SUPABASE_SERVICE_ROLE_KEY not set - invite code NOT saved!");
    return false;
  }

  try {
    // Real month arithmetic. This previously used tierMonths * 30, which made a
    // twelve month tier expire after 360 days.
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + tierMonths);

    const { error } = await supabase
      .from("signup_invites")
      .insert({
        invite_code: inviteCode.toUpperCase(),
        created_by: null,
        expires_at: expiresAt.toISOString(),
        status: "pending",
      })
      .select()
      .single();

    if (error) {
      // Duplicate code. It already exists and is still redeemable, so this is a
      // success from the customer's point of view.
      if (error.code === "23505") {
        console.warn(`Invite code ${inviteCode} already exists. Still usable.`);
        return true;
      }
      console.error("Error saving invite code to Supabase:", error);
      return false;
    }

    return true;
  } catch (err) {
    console.error("Exception saving invite code to Supabase:", err);
    return false;
  }
}

async function loopsUpsertContact(props) {
  const createResponse = await fetch(
    "https://app.loops.so/api/v1/contacts/create",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LOOPS_API_KEY}`,
      },
      body: JSON.stringify(props),
    },
  );

  // Loops returns 409 for an existing contact rather than upserting, so the
  // create has to fall back to an update or every repeat customer fails.
  if (createResponse.status === 409) {
    const updateResponse = await fetch(
      "https://app.loops.so/api/v1/contacts/update",
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.LOOPS_API_KEY}`,
        },
        body: JSON.stringify(props),
      },
    );
    if (!updateResponse.ok) {
      const text = await updateResponse.text();
      throw new Error(`Loops update error: ${updateResponse.status} ${text}`);
    }
    return updateResponse.json();
  }

  if (!createResponse.ok) {
    const text = await createResponse.text();
    throw new Error(`Loops create error: ${createResponse.status} ${text}`);
  }

  return createResponse.json();
}

async function loopsFetch(path, body) {
  const response = await fetch(`https://app.loops.so/api/v1${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LOOPS_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Loops API error: ${response.status} ${text}`);
  }
  return response.json();
}
