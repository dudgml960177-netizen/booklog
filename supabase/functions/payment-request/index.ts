/**
 * payment-request Edge Function
 *
 * 계좌이체 신청 접수: 유니크 입금코드 발급 → pending_payments 저장 → 관리자 이메일 알림
 *
 * 필요한 Supabase Edge Function secrets:
 *   RESEND_API_KEY        Resend API 키
 *   RESEND_FROM           발신 이메일 (예: "북로그 <noreply@booklog.app>")
 *   ADMIN_EMAIL           관리자 알림 수신 이메일
 *   SUPABASE_URL          자동 주입
 *   SUPABASE_SERVICE_ROLE_KEY  자동 주입
 *
 * 필요한 DB 테이블 (최초 1회 실행):
 *   CREATE TABLE pending_payments (
 *     id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *     email text NOT NULL,
 *     plan text NOT NULL,
 *     amount integer NOT NULL,
 *     invite_count integer NOT NULL,
 *     transfer_code text UNIQUE NOT NULL,
 *     status text NOT NULL DEFAULT 'pending',
 *     created_at timestamptz DEFAULT now(),
 *     confirmed_at timestamptz,
 *     codes text[]
 *   );
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

function generateTransferCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "BK-";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { email, plan } = await req.json();

    if (!email || !plan || !PLANS[plan]) {
      return json({ error: "invalid_params" }, 400);
    }

    const planInfo = PLANS[plan];

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 중복 신청 방지 (동일 이메일 + 플랜 + pending 상태)
    const { data: dup } = await sb
      .from("pending_payments")
      .select("transfer_code, created_at")
      .eq("email", email)
      .eq("plan", plan)
      .eq("status", "pending")
      .maybeSingle();

    if (dup) {
      // 이미 신청된 경우 기존 코드 반환
      return json({ transfer_code: dup.transfer_code, amount: planInfo.amount });
    }

    // 유니크 입금코드 생성 (충돌 시 재시도)
    let transfer_code = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generateTransferCode();
      const { data: existing } = await sb
        .from("pending_payments")
        .select("id")
        .eq("transfer_code", candidate)
        .maybeSingle();
      if (!existing) { transfer_code = candidate; break; }
    }
    if (!transfer_code) return json({ error: "code_generation_failed" }, 500);

    // DB 저장
    const { error: insertErr } = await sb.from("pending_payments").insert({
      email,
      plan,
      amount: planInfo.amount,
      invite_count: planInfo.invites,
      transfer_code,
      status: "pending",
    });
    if (insertErr) return json({ error: "db_error", detail: insertErr.message }, 500);

    // 관리자 알림 이메일
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const resendFrom = Deno.env.get("RESEND_FROM") || "북로그 <noreply@booklog.app>";
    const adminEmail = Deno.env.get("ADMIN_EMAIL");
    if (resendKey && adminEmail) {
      const planNames: Record<string, string> = {
        plan_a: "가입권 + 초대장 1장",
        plan_b: "가입권 + 초대장 2장",
        plan_c: "가입권 + 초대장 3장",
      };
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: resendFrom,
          to: adminEmail,
          subject: `[북로그] 새 결제 신청 — ${transfer_code}`,
          html: `
<div style="font-family:sans-serif;max-width:480px;">
  <h3 style="margin:0 0 12px;">새 결제 신청이 접수되었습니다</h3>
  <table style="border-collapse:collapse;width:100%;">
    <tr><td style="padding:4px 8px;color:#888;">이메일</td><td style="padding:4px 8px;">${email}</td></tr>
    <tr><td style="padding:4px 8px;color:#888;">플랜</td><td style="padding:4px 8px;">${planNames[plan] || plan}</td></tr>
    <tr><td style="padding:4px 8px;color:#888;">금액</td><td style="padding:4px 8px;font-weight:700;">${planInfo.amount.toLocaleString()}원</td></tr>
    <tr><td style="padding:4px 8px;color:#888;">입금코드</td><td style="padding:4px 8px;font-weight:700;letter-spacing:2px;">${transfer_code}</td></tr>
  </table>
  <p style="margin-top:16px;font-size:13px;color:#666;">
    입금 확인 후 관리자 페이지에서 ✓ 버튼을 눌러 확인 처리해주세요.
  </p>
</div>`,
        }),
      });
    }

    return json({ transfer_code, amount: planInfo.amount });
  } catch (e) {
    console.error("[payment-request]", e);
    return json({ error: "internal_error", detail: String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
