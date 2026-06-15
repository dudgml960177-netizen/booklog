/**
 * admin-payments Edge Function
 *
 * action:'list'         → 전체 결제 신청 목록 반환
 * action:'confirm'      → 입금 확인 처리: 초대코드 생성 → invite_codes 저장 → 고객 이메일 발송
 * action:'resend_email' → 이미 confirm된 결제의 코드 이메일 재발송
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret",
  "Content-Type": "application/json",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // 관리자 인증
  const adminSecret = Deno.env.get("ADMIN_SECRET");
  const reqSecret = req.headers.get("x-admin-secret");
  if (!adminSecret || reqSecret !== adminSecret) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    const { action, payment_id } = await req.json();

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── 목록 조회
    if (action === "list") {
      const { data, error } = await sb
        .from("pending_payments")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) return json({ error: "db_error", detail: error.message }, 500);
      return json({ payments: data });
    }

    // ── 입금 확인
    if (action === "confirm") {
      if (!payment_id) return json({ error: "missing_payment_id" }, 400);

      const { data: payment, error: fetchErr } = await sb
        .from("pending_payments")
        .select("*")
        .eq("id", payment_id)
        .single();

      if (fetchErr || !payment) return json({ error: "payment_not_found" }, 404);
      if (payment.status !== "pending") return json({ error: "already_processed" }, 409);

      // 코드 생성: 가입권은 BK 입금코드 재사용, 초대장은 랜덤 생성
      const codes: string[] = [payment.transfer_code];
      for (let i = 0; i < payment.invite_count; i++) {
        const code =
          Math.random().toString(36).slice(2, 8).toUpperCase() +
          "-" +
          Math.random().toString(36).slice(2, 5).toUpperCase();
        codes.push(code);
      }

      // invite_codes 테이블 저장
      const { error: codesErr } = await sb.from("invite_codes").insert(
        codes.map((code) => ({
          code,
          owner_id: null,
          created_at: new Date().toISOString(),
        }))
      );
      if (codesErr) return json({ error: "codes_insert_failed", detail: codesErr.message }, 500);

      // pending_payments 상태 업데이트
      const { error: updateErr } = await sb
        .from("pending_payments")
        .update({ status: "confirmed", confirmed_at: new Date().toISOString(), codes })
        .eq("id", payment_id);
      if (updateErr) return json({ error: "update_failed", detail: updateErr.message }, 500);

      // 고객 이메일 발송
      const resendKey = Deno.env.get("RESEND_API_KEY");
      const resendFrom = Deno.env.get("RESEND_FROM") || "북로그 <noreply@booklog.app>";
      if (resendKey) {
        const codeListHtml = codes
          .map(
            (c, i) =>
              `<tr>
                <td style="padding:6px 12px;font-size:12px;color:#a08c72;">${i === 0 ? "내 가입 코드" : `초대 코드 ${i}`}</td>
                <td style="padding:6px 12px;font-family:monospace;font-weight:700;font-size:15px;color:#b07030;letter-spacing:2px;">${c}</td>
              </tr>`
          )
          .join("");

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({
            from: resendFrom,
            to: payment.email,
            subject: "북로그 초대코드가 도착했습니다 📬",
            html: `
<!DOCTYPE html>
<html lang="ko">
<body style="margin:0;padding:20px;background:#f2ece0;font-family:'Apple SD Gothic Neo',sans-serif;">
  <div style="max-width:420px;margin:0 auto;background:#faf6ef;border-radius:12px;padding:28px 24px;border:1px solid #ddd0b8;">
    <h2 style="margin:0 0 6px;font-size:20px;color:#2e1f0e;">북로그 초대코드</h2>
    <p style="margin:0 0 20px;font-size:13px;color:#a08c72;">입금이 확인되었습니다. 아래 코드로 북로그에 가입하세요.</p>
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
    }

    // ── 이메일 재발송
    if (action === "resend_email") {
      if (!payment_id) return json({ error: "missing_payment_id" }, 400);

      const { data: payment, error: fetchErr } = await sb
        .from("pending_payments")
        .select("*")
        .eq("id", payment_id)
        .single();

      if (fetchErr || !payment) return json({ error: "payment_not_found" }, 404);
      if (!payment.codes?.length) return json({ error: "no_codes" }, 400);

      const resendKey = Deno.env.get("RESEND_API_KEY");
      const resendFrom = Deno.env.get("RESEND_FROM") || "북로그 <noreply@booklog-app.com>";
      if (!resendKey) return json({ error: "no_resend_key" }, 500);

      const codes: string[] = payment.codes;
      const codeListHtml = codes
        .map(
          (c: string, i: number) =>
            `<tr>
              <td style="padding:6px 12px;font-size:12px;color:#a08c72;">${i === 0 ? "내 가입 코드" : `초대 코드 ${i}`}</td>
              <td style="padding:6px 12px;font-family:monospace;font-weight:700;font-size:15px;color:#b07030;letter-spacing:2px;">${c}</td>
            </tr>`
        )
        .join("");

      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: resendFrom,
          to: payment.email,
          subject: "북로그 초대코드가 도착했습니다 📬",
          html: `
<!DOCTYPE html>
<html lang="ko">
<body style="margin:0;padding:20px;background:#f2ece0;font-family:'Apple SD Gothic Neo',sans-serif;">
  <div style="max-width:420px;margin:0 auto;background:#faf6ef;border-radius:12px;padding:28px 24px;border:1px solid #ddd0b8;">
    <h2 style="margin:0 0 6px;font-size:20px;color:#2e1f0e;">북로그 초대코드</h2>
    <p style="margin:0 0 20px;font-size:13px;color:#a08c72;">아래 코드로 북로그에 가입하세요.</p>
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

      if (!emailRes.ok) {
        const errBody = await emailRes.text();
        return json({ error: "email_send_failed", detail: errBody }, 500);
      }

      return json({ success: true });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("[admin-payments]", e);
    return json({ error: "internal_error", detail: String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
