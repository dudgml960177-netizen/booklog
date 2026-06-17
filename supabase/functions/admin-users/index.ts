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

  // ── 공개 액션: request_reset (관리자 인증 불필요)
  // 유저가 직접 비밀번호 재설정을 요청할 때 사용
  // 이메일 링크를 앱 URL로 래핑해 이메일 보안 스캐너의 토큰 소비를 방지
  let _publicBody: any = null;
  try { _publicBody = await req.clone().json(); } catch { /* ignore */ }
  if (_publicBody?.action === 'request_reset') {
    const { email } = _publicBody;
    if (!email) return json({ error: "missing_email" }, 400);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: "https://booklog-neon.vercel.app/" },
    });
    if (linkErr) return json({ error: "generate_failed", detail: linkErr.message }, 500);

    const actionLink = (linkData as any)?.properties?.action_link || (linkData as any)?.action_link;
    if (!actionLink) return json({ error: "no_action_link" }, 500);

    const proxyLink = `https://booklog-neon.vercel.app/?pw_go=${btoa(actionLink)}`;

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
      비밀번호 재설정을 요청하셨어요.<br>
      아래 버튼을 눌러 새 비밀번호를 설정하세요. (버튼을 직접 클릭해야 동작합니다)
    </p>
    <a href="${proxyLink}" style="display:block;text-align:center;background:#b07030;color:#fff;text-decoration:none;border-radius:8px;padding:12px 24px;font-size:14px;font-weight:700;">비밀번호 재설정하기</a>
    <p style="margin:16px 0 0;font-size:11px;color:#a08c72;line-height:1.7;">
      • 이 링크는 1시간 후 만료됩니다.<br>
      • 본인이 요청하지 않았다면 무시하세요.
    </p>
    <hr style="margin:18px 0;border:none;border-top:1px solid #ddd0b8;">
    <p style="margin:0;font-size:11px;color:#c0a880;">북로그 팀</p>
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
      const [authRes, profRes, inviteRes, payRes] = await Promise.all([
        sb.auth.admin.listUsers({ perPage: 1000 }),
        sb.from("profiles").select("id, display_name, role, avatar_url"),
        sb.from("invite_codes").select("used_by").not("used_by", "is", null),
        sb.from("payments").select("email").eq("status", "confirmed"),
      ]);
      if (authRes.error) return json({ error: "auth_list_failed", detail: authRes.error.message }, 500);

      const invitedSet = new Set((inviteRes.data || []).map((r: any) => r.used_by));
      const purchaserEmails = new Set((payRes.data || []).map((r: any) => (r.email || "").toLowerCase()));

      const profMap = new Map((profRes.data || []).map((p) => [p.id, p]));
      const users = (authRes.data.users || [])
        .map((u) => {
          const via_invite = invitedSet.has(u.id);
          const via_purchase = purchaserEmails.has((u.email || "").toLowerCase());
          const join_type = via_invite && via_purchase ? "both"
            : via_invite ? "invite"
            : via_purchase ? "purchase"
            : "unknown";
          return {
            id: u.id,
            email: u.email ?? "",
            created_at: u.created_at,
            last_sign_in_at: u.last_sign_in_at ?? null,
            email_confirmed: !!u.email_confirmed_at,
            display_name: profMap.get(u.id)?.display_name || u.email?.split("@")[0] || "—",
            role: profMap.get(u.id)?.role || "user",
            join_type,
          };
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      return json({ users });
    }

    // ── 회원 삭제
    if (action === "delete") {
      const { user_id } = body;
      if (!user_id) return json({ error: "missing_user_id" }, 400);

      const stepErrors: string[] = [];

      // 1단계: 이 유저의 posts에 달린 모든 참조 데이터 먼저 삭제
      const { data: userPosts } = await sb.from("posts").select("id").eq("user_id", user_id);
      const postIds = (userPosts || []).map((p: any) => p.id);
      if (postIds.length > 0) {
        const r1 = await sb.from("post_likes").delete().in("post_id", postIds);
        if (r1.error) stepErrors.push("post_likes/post_id: " + r1.error.message);
        const r2 = await sb.from("comments").delete().in("post_id", postIds);
        if (r2.error) stepErrors.push("comments/post_id: " + r2.error.message);
        const r3 = await sb.from("reports").delete().in("post_id", postIds);
        if (r3.error) stepErrors.push("reports/post_id: " + r3.error.message);
        const r4 = await sb.from("notifications").delete().in("post_id", postIds);
        if (r4.error) stepErrors.push("notifications/post_id: " + r4.error.message);
      }

      // 2단계: 유저 본인 활동 데이터 삭제 (FK 의존 순서)
      const steps: [string, string, string][] = [
        ["post_likes", "user_id", user_id],
        ["comments", "user_id", user_id],
        ["reports", "reporter_id", user_id],
        ["notifications", "user_id", user_id],
        ["notifications", "sender_id", user_id],
        ["user_goals", "user_id", user_id],
        ["quotes", "user_id", user_id],
        ["books", "user_id", user_id],
        ["posts", "user_id", user_id],
      ];
      for (const [table, col, val] of steps) {
        const { error: e } = await (sb.from(table) as any).delete().eq(col, val);
        if (e) stepErrors.push(`${table}/${col}: ${e.message}`);
      }

      // friendships: requester_id / receiver_id 컬럼
      const { error: fe } = await sb.from("friendships").delete().or(`requester_id.eq.${user_id},receiver_id.eq.${user_id}`);
      if (fe) stepErrors.push("friendships: " + fe.message);

      // invite_codes: 사용한 코드 used_by 초기화(profiles FK), 소유 코드 삭제
      const { error: icNull } = await sb.from("invite_codes").update({ used_by: null }).eq("used_by", user_id);
      if (icNull) stepErrors.push("invite_codes/used_by: " + icNull.message);
      const { error: icDel } = await sb.from("invite_codes").delete().eq("owner_id", user_id);
      if (icDel) stepErrors.push("invite_codes/owner_id: " + icDel.message);

      // profiles 삭제
      const { error: profErr } = await sb.from("profiles").delete().eq("id", user_id);
      if (profErr) stepErrors.push("profiles/id: " + profErr.message);

      if (stepErrors.length > 0) {
        return json({ error: "pre_delete_failed", detail: stepErrors.join(" | ") }, 500);
      }

      // 3단계: auth 유저 삭제
      const { error } = await sb.auth.admin.deleteUser(user_id);
      if (error) return json({ error: "delete_failed", detail: String(error) }, 500);

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

      const proxyLink = `https://booklog-neon.vercel.app/?pw_go=${btoa(actionLink)}`;
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
      아래 버튼을 눌러 새 비밀번호를 설정하세요. (버튼을 직접 클릭해야 동작합니다)
    </p>
    <a href="${proxyLink}" style="display:block;text-align:center;background:#b07030;color:#fff;text-decoration:none;border-radius:8px;padding:12px 24px;font-size:14px;font-weight:700;">비밀번호 재설정하기</a>
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
