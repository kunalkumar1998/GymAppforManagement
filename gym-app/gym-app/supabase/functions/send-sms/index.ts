// supabase/functions/send-sms/index.ts
// Handles all outbound SMS via MSG91 (India) or Twilio (international)
// Deploy: supabase functions deploy send-sms

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── MSG91 sender (recommended for India) ──────────────────────
async function sendViaMSG91(phone: string, message: string): Promise<{ success: boolean; response: unknown }> {
  const authKey = Deno.env.get("MSG91_AUTH_KEY")!;
  const senderId = Deno.env.get("MSG91_SENDER_ID") || "IRPULS"; // 6-char sender ID

  // Normalize phone: strip +, ensure 91 prefix
  const normalized = phone.replace(/\D/g, "").replace(/^0/, "91").replace(/^(?!91)/, "91");

  const payload = {
    sender: senderId,
    route: "4", // transactional route
    country: "91",
    sms: [
      {
        message,
        to: [normalized],
      },
    ],
  };

  const res = await fetch("https://api.msg91.com/api/v2/sendsms", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authkey: authKey,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  return { success: data.type === "success", response: data };
}

// ── Twilio sender (fallback / international) ───────────────────
async function sendViaTwilio(phone: string, message: string): Promise<{ success: boolean; response: unknown }> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const authToken  = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  const fromNumber = Deno.env.get("TWILIO_FROM_NUMBER")!;

  const credentials = btoa(`${accountSid}:${authToken}`);
  const body = new URLSearchParams({
    From: fromNumber,
    To: phone,
    Body: message,
  });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    }
  );

  const data = await res.json();
  return { success: !data.error_code, response: data };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, corsHeaders, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();
    const { phone, message, type, member_id, title, detail } = body;

    if (!phone || !message) {
      return json({ error: "phone and message required" }, corsHeaders, 400);
    }

    // Choose provider based on env config
    const provider = Deno.env.get("SMS_PROVIDER") || "msg91"; // "msg91" | "twilio"
    let result: { success: boolean; response: unknown };

    if (provider === "twilio") {
      result = await sendViaTwilio(phone, message);
    } else {
      result = await sendViaMSG91(phone, message);
    }

    // Log to notifications table
    await supabase.from("notifications").insert({
      member_id: member_id || null,
      type: type || "sms",
      title: title || `SMS sent to ${phone}`,
      detail: detail || message.slice(0, 100),
      phone,
      status: result.success ? "sent" : "failed",
    });

    return json({ success: result.success, provider, response: result.response }, corsHeaders);
  } catch (err) {
    console.error("SMS error:", err);
    return json({ error: err.message }, corsHeaders, 500);
  }
});

function json(data: unknown, headers: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
