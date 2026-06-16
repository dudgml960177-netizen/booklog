/**
 * admin-users Edge Function
 *
 * action:'list'          → 전체 회원 목록 (auth + profiles 조인)
 * action:'delete'        → 회원 삭제 (auth user + profile)
 * action:'send_pw_reset' → 비밀번호 재설정 링크 이메일 발송
 * action:'send_dm'       → 관리자 쪽지 발송 (notifications 삽입)
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
    const body = await req.json();
    const { action } = body;

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── 회원 목록
    if (action === "list") {
      const [authRes, profRes] = await Promise.all([
        sb.auth.admin.listUsers({ perPage: 1000 }),
        sb.from("profiles").select("id, display_name, role, avatar_url"),
      ]);
      if (authRes.error) return json({ error: "auth_list_failed", detail: authRes.error.message }, 500);

      const profMap = new Map((profRes.data || []).map((p) => [p.id, p]));
      const users = (authRes.data.users || [])
        .map((u) => ({
          id: u.id,
          email: u.email ?? "",
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at ?? null,
          email_confirmed: !!u.email_confirmed_at,
          display_name: profMap.get(u.id)?.display_name || u.email?.split("@")[0] || "—",
          role: profMap.get(u.id)?.role || "user",
        }))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      return json({ users });
    }

    // ── 회원 삭제
    if (action === "delete") {
      const { user_id } = body;
      if (!user_id) return json({ error: "missing_user_id" }, 400);

      // profile, notifications 삭제 (books 등은 CASCADE 또는 user_id nullable)
      await sb.from("notifications").delete().eq("user_id", user_id);
      await sb.from("profiles").delete().eq("id", user_id);

      const { error } = await sb.auth.admin.deleteUser(user_id);
      if (error) return json({ error: "delete_failed", detail: error.message }, 500);

      return json({ success: true });
    }

    // ── 비밀번호 재설정 링크 발송
    if (action === "send_pw_reset") {
      const { email } = body;
      if (!email) return json({ error: "missing_email" }, 400);

      const redirectTo = "https://booklog-neon.vercel.app/";
      const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo },
      });
      if (linkErr) return json({ error: "generate_failed", detail: linkErr.message }, 500);

      const actionLink = (linkData as any)?.properties?.action_link || (linkData as any)?.action_link;
      if (!actionLink) return json({ error: "no_action_link" }, 500);

      const resendKey = Deno.env.get("RESEND_API_KEY");
      const resendFrom = Deno.env.get("RESEND_FROM") || "북로그 <noreply@booklog-app.com>";
      if (!resendKey) return json({ error: "no_resend_key" }, 500);

      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: resendFrom,
          to: email,
          subject: "북로그 비밀번호 재설정",
          html: `
<!DOCTYPE html>
<html lang="ko">
<body style="margin:0;padding:20px;background:#f2ece0;font-family:'Apple SD Gothic Neo',sans-serif;">
  <div style="max-width:420px;margin:0 auto;background:#faf6ef;border-radius:12px;padding:28px 24px;border:1px solid #ddd0b8;">
    <h2 style="margin:0 0 6px;font-size:20px;color:#2e1f0e;">비밀번호 재설정</h2>
    <p style="margin:0 0 20px;font-size:13px;color:#a08c72;line-height:1.7;">
      관리자가 비밀번호 재설정 링크를 보냈어요.<br>
      아래 버튼을 눌러 새 비밀번호를 설정하세요.
    </p>
    <a href="${actionLink}" style="display:block;text-align:center;background:#b07030;color:#fff;text-decoration:none;border-radius:8px;padding:12px 24px;font-size:14px;font-weight:700;">비밀번호 재설정하기</a>
    <p style="margin:16px 0 0;font-size:11px;color:#a08c72;line-height:1.7;">
      • 이 링크는 1시간 후 만료됩니다.<br>
      • 본인이 요청하지 않았다면 무시하세요.
    </p>
    <hr style="margin:18px 0;border:none;border-top:1px solid #ddd0b8;">
    <p style="margin:0;font-size:11px;color:#c0a880;">북로그 관리팀</p>
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

    // ── 임시 비밀번호 설정
    if (action === "set_password") {
      const { user_id, password } = body;
      if (!user_id || !password) return json({ error: "missing_params" }, 400);
      if (password.length < 6) return json({ error: "password_too_short" }, 400);

      const { error } = await sb.auth.admin.updateUserById(user_id, { password });
      if (error) return json({ error: "set_password_failed", detail: error.message }, 500);

      return json({ success: true });
    }

    // ── 쪽지 발송
    if (action === "send_dm") {
      const { user_id, message, admin_id } = body;
      if (!user_id || !message) return json({ error: "missing_params" }, 400);

      const { error } = await sb.from("notifications").insert({
        user_id,
        sender_id: admin_id || null,
        type: "admin_dm",
        message: `📩 관리자 쪽지: ${message}`,
        is_read: false,
        created_at: new Date().toISOString(),
      });
      if (error) return json({ error: "dm_failed", detail: error.message }, 500);

      return json({ success: true });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("[admin-users]", e);
    return json({ error: "internal_error", detail: String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
