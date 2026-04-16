// supabase/functions/payments/index.ts
// Deploy: supabase functions deploy payments

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const url = new URL(req.url);
  const memberId = url.searchParams.get("member_id");

  try {
    // ── GET /payments  →  all payments (newest first)
    // ── GET /payments?member_id=uuid  →  payments for one member
    if (req.method === "GET") {
      let query = supabase
        .from("payments")
        .select(`
          *,
          members ( id, name, phone )
        `)
        .order("paid_date", { ascending: false });

      if (memberId) query = query.eq("member_id", memberId);

      const { data, error } = await query;
      if (error) throw error;
      return json({ payments: data }, corsHeaders);
    }

    // ── POST /payments  →  record payment + trigger receipt SMS
    if (req.method === "POST") {
      const body = await req.json();
      const { member_id, amount, paid_date, payment_mode, notes } = body;

      if (!member_id || !amount) {
        return json({ error: "member_id and amount required" }, corsHeaders, 400);
      }

      // Fetch member details for SMS
      const { data: member, error: mErr } = await supabase
        .from("member_fee_status")
        .select("*")
        .eq("id", member_id)
        .single();

      if (mErr || !member) return json({ error: "Member not found" }, corsHeaders, 404);

      // Insert payment (trigger will auto-update members.last_paid_date)
      const { data: payment, error: pErr } = await supabase
        .from("payments")
        .insert({
          member_id,
          amount: Math.round(amount * 100), // store in paise
          paid_date: paid_date || new Date().toISOString().split("T")[0],
          payment_mode: payment_mode || "Cash",
          notes: notes || null,
        })
        .select()
        .single();

      if (pErr) throw pErr;

      // Calculate next due date
      const nextDue = new Date(payment.paid_date);
      nextDue.setDate(nextDue.getDate() + 30);
      const nextDueStr = nextDue.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

      // Send receipt SMS via send-sms function
      const smsPayload = {
        phone: member.phone,
        message: `Hi ${member.name.split(" ")[0]}, payment of ₹${amount} received at Iron Pulse Gym on ${paid_date || "today"} via ${payment_mode || "Cash"}. Your next due date is ${nextDueStr}. Thank you! 💪`,
        type: "sms_receipt",
        member_id,
        title: `Receipt SMS sent to ${member.name}`,
        detail: `₹${amount} via ${payment_mode} · Next due: ${nextDueStr}`,
      };

      // Call send-sms function internally
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-sms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify(smsPayload),
      });

      return json({ payment, next_due_date: nextDue.toISOString().split("T")[0] }, corsHeaders, 201);
    }

    return json({ error: "Not found" }, corsHeaders, 404);
  } catch (err) {
    console.error(err);
    return json({ error: err.message }, corsHeaders, 500);
  }
});

function json(data: unknown, headers: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
