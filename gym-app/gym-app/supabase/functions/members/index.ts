// supabase/functions/members/index.ts
// Deploy: supabase functions deploy members

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const url = new URL(req.url);
  const id  = url.searchParams.get("id");

  try {
    // ── GET /members  →  list all with fee status
    if (req.method === "GET" && !id) {
      const { data, error } = await supabase
        .from("member_fee_status")
        .select("*")
        .order("days_until_due", { ascending: true });

      if (error) throw error;
      return json({ members: data }, corsHeaders);
    }

    // ── GET /members?id=uuid  →  single member + payment history
    if (req.method === "GET" && id) {
      const [{ data: member }, { data: payments }] = await Promise.all([
        supabase.from("member_fee_status").select("*").eq("id", id).single(),
        supabase.from("payments").select("*").eq("member_id", id).order("paid_date", { ascending: false }),
      ]);
      return json({ member, payments }, corsHeaders);
    }

    // ── POST /members  →  create member
    if (req.method === "POST") {
      const body = await req.json();
      const { name, phone, email, plan_name, join_date, notes } = body;

      if (!name || !phone || !plan_name) {
        return json({ error: "name, phone, plan_name are required" }, corsHeaders, 400);
      }

      // resolve plan id
      const { data: plan, error: planErr } = await supabase
        .from("plans")
        .select("id, fee")
        .eq("name", plan_name)
        .single();

      if (planErr || !plan) return json({ error: "Invalid plan" }, corsHeaders, 400);

      const { data: member, error } = await supabase
        .from("members")
        .insert({
          name,
          phone,
          email: email || null,
          plan_id: plan.id,
          join_date: join_date || new Date().toISOString().split("T")[0],
          last_paid_date: join_date || new Date().toISOString().split("T")[0],
          notes: notes || null,
        })
        .select()
        .single();

      if (error) throw error;

      // Log welcome notification
      await supabase.from("notifications").insert({
        member_id: member.id,
        type: "sms_welcome",
        title: `Welcome SMS sent to ${name}`,
        detail: `Phone: ${phone} · Plan: ${plan_name} · ₹${plan.fee / 100}/month`,
        phone,
        status: "queued", // actual SMS sent by send-sms function
      });

      return json({ member }, corsHeaders, 201);
    }

    // ── PUT /members?id=uuid  →  update member
    if (req.method === "PUT" && id) {
      const body = await req.json();
      const updates: Record<string, unknown> = {};

      if (body.name)       updates.name       = body.name;
      if (body.phone)      updates.phone      = body.phone;
      if (body.email)      updates.email      = body.email;
      if (body.notes)      updates.notes      = body.notes;
      if (body.is_active !== undefined) updates.is_active = body.is_active;

      if (body.plan_name) {
        const { data: plan } = await supabase.from("plans").select("id").eq("name", body.plan_name).single();
        if (plan) updates.plan_id = plan.id;
      }

      const { data, error } = await supabase
        .from("members")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return json({ member: data }, corsHeaders);
    }

    // ── DELETE /members?id=uuid  →  soft delete (set inactive)
    if (req.method === "DELETE" && id) {
      const { error } = await supabase
        .from("members")
        .update({ is_active: false })
        .eq("id", id);

      if (error) throw error;
      return json({ success: true }, corsHeaders);
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
