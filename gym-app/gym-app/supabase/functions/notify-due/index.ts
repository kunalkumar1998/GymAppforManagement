// supabase/functions/notify-due/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// DAILY CRON JOB — runs at 9:00 AM IST every day
//
// Schedule via Supabase Dashboard:
//   Database → Extensions → pg_cron  →  enable
//   SQL Editor:
//     select cron.schedule(
//       'notify-due-daily',
//       '30 3 * * *',   -- 03:30 UTC = 09:00 IST
//       $$
//         select net.http_post(
//           url := 'https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/notify-due',
//           headers := '{"Authorization": "Bearer <SERVICE_ROLE_KEY>"}'::jsonb
//         );
//       $$
//     );
//
// OR use cron-job.org (free) to hit this URL daily.
// ─────────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const results = { overdue: 0, due_soon: 0, errors: [] as string[] };

  try {
    // ── 1. Fetch all members who are overdue OR due within 5 days ─────────────
    const { data: members, error } = await supabase
      .from("member_fee_status")
      .select("*")
      .in("fee_status", ["overdue", "due_soon", "never_paid"])
      .eq("is_active", true);

    if (error) throw error;
    if (!members?.length) {
      return json({ message: "No dues found today", results }, corsHeaders);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ── 2. Send SMS to each member ────────────────────────────────────────────
    for (const member of members) {
      try {
        const firstName  = member.name.split(" ")[0];
        const fee        = (member.plan_fee / 100).toLocaleString("en-IN");
        const daysOverdue = Math.abs(member.days_until_due);

        let message: string;
        let notifType: string;
        let notifTitle: string;

        if (member.fee_status === "overdue") {
          message = `Hi ${firstName}, your Iron Pulse Gym fee of ₹${fee} is OVERDUE by ${daysOverdue} day(s). Please pay immediately to avoid membership suspension. Contact us at your earliest.`;
          notifType  = "sms_overdue";
          notifTitle = `Overdue alert sent to ${member.name}`;
          results.overdue++;
        } else if (member.fee_status === "due_soon") {
          const daysLeft = member.days_until_due;
          const dueDate  = new Date(member.last_paid_date);
          dueDate.setDate(dueDate.getDate() + 30);
          const dueDateStr = dueDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });

          message = `Hi ${firstName}, your Iron Pulse Gym fee of ₹${fee} is due on ${dueDateStr} (${daysLeft} day${daysLeft !== 1 ? "s" : ""} left). Please pay on time. Thank you! 💪`;
          notifType  = "sms_due";
          notifTitle = `Due reminder sent to ${member.name}`;
          results.due_soon++;
        } else {
          // never_paid
          message = `Hi ${firstName}, welcome to Iron Pulse Gym! Please pay your first month fee of ₹${fee} to activate your ${member.plan_name} membership.`;
          notifType  = "sms_due";
          notifTitle = `First payment reminder sent to ${member.name}`;
        }

        // Call send-sms function
        const smsRes = await fetch(`${SUPABASE_URL}/functions/v1/send-sms`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({
            phone: member.phone,
            message,
            type: notifType,
            member_id: member.id,
            title: notifTitle,
            detail: `Status: ${member.fee_status} · Plan: ${member.plan_name} · ₹${fee}`,
          }),
        });

        if (!smsRes.ok) {
          throw new Error(`SMS HTTP error ${smsRes.status}`);
        }
      } catch (memberErr) {
        const errMsg = `Failed for ${member.name}: ${memberErr.message}`;
        console.error(errMsg);
        results.errors.push(errMsg);
      }
    }

    console.log(`notify-due complete:`, results);
    return json({
      message: `Processed ${members.length} members`,
      results,
      timestamp: new Date().toISOString(),
    }, corsHeaders);

  } catch (err) {
    console.error("notify-due fatal:", err);
    return json({ error: err.message, results }, corsHeaders, 500);
  }
});

function json(data: unknown, headers: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
