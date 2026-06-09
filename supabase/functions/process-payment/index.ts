/**
 * process-payment Edge Function
 *
 * 포트원 결제 검증 → 초대코드 생성 → DB 저장 → Resend 이메일 발송
 *
 * 필요한 Supabase Edge Function secrets (supabase secrets set --env-file .env):
 *   PORTONE_API_KEY       포트원 REST API 키
 *   PORTONE_API_SECRET    포트원 REST API 시크릿
 *   RESEND_API_KEY        Resend API 키
 *   RESEND_FROM           발신 이메일 (예: "북로그 <noreply@yourdomain.com>")
 *   SUPABASE_URL          자동 주입
 *   SUPABASE_SERVICE_ROLE_KEY  자동 주입
 *
 * 필요한 DB 테이블 (최초 1회 실행):
 *   CREATE TABLE payments (
 *     id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *     email text NOT NULL,
 *     plan text NOT NULL,
 *     amount integer NOT NULL,
 *     invite_count integer NOT NULL,
 *     imp_uid text UNIQUE NOT NULL,
 *     status text NOT NULL DEFAULT 'completed',
 *     codes text[],
 *     created_at timestamptz DEFAULT now()
 *   );
 *
 *   ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS source text DEFAULT 'quest';
 *   ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS purchase_id uuid REFERENCES payments(id);
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const PLANS: Record<string, { amount: number; invites: number }> = {
  plan_a: { amount: 15000, invites: 1 },
  plan_b: { amount: 28000, invites: 2 },
  plan_c: { amount: 38000, invites: 3 },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { imp_uid, email, plan } = await req.json();

    if (!imp_uid || !email || !plan || !PLANS[plan]) {
      return json({ error: "invalid_params" }, 400);
    }

    const planInfo = PLANS[plan];

    // ── 1. 포트원 액세스 토큰 발급
    const tokenRes = await fetch("https://api.iamport.kr/users/getToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imp_key: Deno.env.get("PORTONE_API_KEY"),
        imp_secret: Deno.env.get("PORTONE_API_SECRET"),
      }),
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData?.response?.access_token;
    if (!accessToken) return json({ error: "portone_auth_failed" }, 500);

    // ── 2. 결제 조회 및 검증
    const payRes = await fetch(`https://api.iamport.kr/payments/${imp_uid}`, {
      headers: { Authorization: accessToken },
    });
    const payment = (await payRes.json())?.response;
    if (!payment || payment.status !== "paid" || payment.amount !== planInfo.amount) {
      return json({ error: "payment_invalid" }, 400);
    }

    // ── 3. Supabase 클라이언트
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── 4. 중복 결제 방지
    const { data: dup } = await sb.from("payments").select("id").eq("imp_uid", imp_uid).maybeSingle();
    if (dup) return json({ error: "duplicate_payment" }, 409);

    // ── 5. 초대코드 생성 (가입권 1개 + 초대장 N개 = 총 N+1개)
    const totalCodes = planInfo.invites + 1;
    const codes: string[] = [];
    for (let i = 0; i < totalCodes; i++) {
      const code =
        Math.random().toString(36).slice(2, 8).toUpperCase() +
        "-" +
        Math.random().toString(36).slice(2, 5).toUpperCase();
      codes.push(code);
    }

    // ── 6. 결제 기록 저장
    const { data: payRecord, error: payErr } = await sb
      .from("payments")
      .insert({ imp_uid, email, plan, amount: payment.amount, invite_count: planInfo.invites, codes, status: "completed" })
      .select()
      .single();
    if (payErr) return json({ error: "db_payment_failed", detail: payErr.message }, 500);

    // ── 7. 초대코드 DB 저장
    await sb.from("invite_codes").insert(
      codes.map((code) => ({
        code,
        owner_id: null,
        quest_reward: false,
        source: "purchase",
        purchase_id: payRecord.id,
        created_at: new Date().toISOString(),
      }))
    );

    // ── 8. 이메일 발송 (Resend)
    const codeListHtml = codes
      .map(
        (c, i) =>
          `<tr>
            <td style="padding:6px 12px;font-size:12px;color:#a08c72;">${i === 0 ? "내 가입 코드" : `초대 코드 ${i}`}</td>
            <td style="padding:6px 12px;font-family:monospace;font-weight:700;font-size:15px;color:#b07030;letter-spacing:2px;">${c}</td>
          </tr>`
      )
      .join("");

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const resendFrom = Deno.env.get("RESEND_FROM") || "북로그 <noreply@booklog.app>";
    if (resendKey) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: resendFrom,
          to: email,
          subject: "북로그 초대코드가 도착했습니다 📬",
          html: `
<!DOCTYPE html>
<html lang="ko">
<body style="margin:0;padding:20px;background:#f2ece0;font-family:'Apple SD Gothic Neo',sans-serif;">
  <div style="max-width:420px;margin:0 auto;background:#faf6ef;border-radius:12px;padding:28px 24px;border:1px solid #ddd0b8;">
    <h2 style="margin:0 0 6px;font-size:20px;color:#2e1f0e;">북로그 초대코드</h2>
    <p style="margin:0 0 20px;font-size:13px;color:#a08c72;">사전 결제가 완료되었습니다. 아래 코드로 북로그에 가입하세요.</p>
    <table style="width:100%;border-collapse:collapse;background:#f2ece0;border-radius:8px;overflow:hidden;">
      ${codeListHtml}
    </table>
    <p style="margin:20px 0 0;font-size:12px;color:#a08c72;line-height:1.7;">
      • 첫 번째 코드는 본인 가입용입니다.<br>
      • 나머지 코드는 친구에게 전달하여 초대할 수 있습니다.<br>
      • 코드는 1회만 사용 가능합니다.
    </p>
    <hr style="margin:18px 0;border:none;border-top:1px solid #ddd0b8;">
    <p style="margin:0;font-size:11px;color:#c0a880;">결제 문의: 북로그 관리자에게 연락해주세요.</p>
  </div>
</body>
</html>`,
        }),
      });
    }

    return json({ success: true, codes });
  } catch (e) {
    console.error("[process-payment]", e);
    return json({ error: "internal_error", detail: String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
