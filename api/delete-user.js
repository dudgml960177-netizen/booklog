const SUPABASE_URL = 'https://xowlwzpoxrudgaoavkbr.supabase.co';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_KEY) return res.status(500).json({ error: '서버 설정 오류: 서비스 키 누락' });

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: '로그인이 필요해요' });
  const accessToken = authHeader.slice(7);

  const { targetUserId } = req.body || {};
  if (!targetUserId) return res.status(400).json({ error: 'targetUserId 필요' });

  const svcHeaders = {
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey': SERVICE_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
  };

  try {
    // 1. 호출자 신원 확인
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'apikey': SERVICE_KEY }
    });
    if (!userResp.ok) return res.status(401).json({ error: '유효하지 않은 토큰' });
    const userData = await userResp.json();
    const callerId = userData.id;
    if (!callerId) return res.status(401).json({ error: '인증 실패' });
    if (callerId === targetUserId) return res.status(400).json({ error: '자기 자신은 삭제할 수 없어요' });

    // 2. 관리자 권한 확인
    const profileResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(callerId)}&select=role`,
      { headers: svcHeaders }
    );
    const profiles = await profileResp.json();
    if (!profiles?.[0] || profiles[0].role !== 'admin') {
      return res.status(403).json({ error: '관리자 권한이 필요해요' });
    }

    // 3. 관련 데이터 순서대로 삭제 (FK 제약 고려)
    const del = (table, filter) =>
      fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: svcHeaders });

    // 대상 유저의 게시글 ID 수집 (게시글 댓글/좋아요 삭제 시 필요)
    const postsResp = await fetch(
      `${SUPABASE_URL}/rest/v1/posts?user_id=eq.${targetUserId}&select=id`,
      { headers: svcHeaders }
    );
    const posts = await postsResp.json();
    const postIds = Array.isArray(posts) ? posts.map(p => p.id) : [];

    // 게시글에 달린 좋아요·댓글 삭제
    if (postIds.length) {
      const idList = `(${postIds.join(',')})`;
      await del('post_likes', `post_id=in.${idList}`);
      await del('comments', `post_id=in.${idList}`);
    }

    // 유저가 남긴 좋아요·댓글·게시글 삭제
    await del('post_likes', `user_id=eq.${targetUserId}`);
    await del('comments', `user_id=eq.${targetUserId}`);
    await del('posts', `user_id=eq.${targetUserId}`);

    // 나머지 유저 데이터 삭제
    await del('friendships', `user_id=eq.${targetUserId}`);
    await del('friendships', `friend_id=eq.${targetUserId}`);
    await del('reports', `user_id=eq.${targetUserId}`);
    await del('notifications', `user_id=eq.${targetUserId}`);
    await del('quotes', `user_id=eq.${targetUserId}`);
    await del('books', `user_id=eq.${targetUserId}`);
    await del('user_goals', `user_id=eq.${targetUserId}`);
    await del('invite_codes', `owner_id=eq.${targetUserId}`);
    // used_by FK 제약 해제: 이 유저가 사용한 초대코드의 used_by를 null로 초기화
    await fetch(`${SUPABASE_URL}/rest/v1/invite_codes?used_by=eq.${targetUserId}`, {
      method: 'PATCH',
      headers: svcHeaders,
      body: JSON.stringify({ used_by: null })
    });
    await del('profiles', `id=eq.${targetUserId}`);

    // 4. auth.users 삭제 (서비스 롤 키 필요)
    const deleteResp = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users/${targetUserId}`,
      { method: 'DELETE', headers: svcHeaders }
    );
    if (!deleteResp.ok) {
      const errData = await deleteResp.json().catch(() => ({}));
      throw new Error(errData.message || `auth 삭제 실패 (HTTP ${deleteResp.status})`);
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('[delete-user]', e);
    return res.status(500).json({ error: e.message || '서버 오류' });
  }
}
