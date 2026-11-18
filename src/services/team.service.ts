import 'server-only';
import type { Db } from '@/repositories/types';
import type { TeamMemberRow, TeamRow } from '@/types/database';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { appUrl } from '@/lib/urls';
import { TEAM_MAX_MEMBERS } from '@/config/plans';
import { sendEmail, templates } from '@/services/email';

/**
 * Gói Team: trưởng nhóm (người trả tiền) mời tối đa 4 người qua email; thành viên chấp nhận lời mời
 * để nhận quyền lợi Premium tới hết kỳ của nhóm. Mọi truy cập đi qua service role, nên quyền được
 * kiểm tra ở đây: chỉ trưởng nhóm mời/xóa/đổi tên/xem thống kê; thành viên xem nhóm và kịch bản chung.
 */
const log = logger.child({ module: 'team' });
const fail = (e: unknown): never => { throw new AppError('INTERNAL', undefined, e); };
const isActive = (t: TeamRow) => !!t.plan_expires_at && new Date(t.plan_expires_at).getTime() > Date.now();
type Rpc = { result: string };

async function membershipOf(db: Db, userId: string): Promise<{ team: TeamRow; me: TeamMemberRow } | null> {
  const { data: m, error } = await db.from('team_members').select('*').eq('user_id', userId).eq('status', 'active').maybeSingle();
  if (error) fail(error);
  if (!m) return null;
  const { data: team, error: e2 } = await db.from('teams').select('*').eq('id', m.team_id).single();
  if (e2) fail(e2);
  return { team: team!, me: m };
}
async function requireLeader(db: Db, userId: string) {
  const m = await membershipOf(db, userId);
  if (!m) throw new AppError('NOT_FOUND', { resource: 'team' });
  if (m.me.role !== 'leader') throw new AppError('TEAM_LEADER_ONLY');
  return m;
}
async function requireMember(db: Db, userId: string) {
  const m = await membershipOf(db, userId);
  if (!m) throw new AppError('NOT_FOUND', { resource: 'team' });
  return m;
}

/** Thống kê luyện tập 30 ngày gần nhất cho từng thành viên (bảng điều khiển của trưởng nhóm). */
async function memberStats(db: Db, userIds: string[]) {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const out: Record<string, { sessions30d: number; avgScore30d: number | null; bestScore30d: number | null; lastPracticeAt: string | null; totalSessions: number }> = {};
  userIds.forEach((id) => { out[id] = { sessions30d: 0, avgScore30d: null, bestScore30d: null, lastPracticeAt: null, totalSessions: 0 }; });
  if (!userIds.length) return out;
  const { data, error } = await db.from('analysis_results').select('user_id, overall_score, finished_at').in('user_id', userIds).eq('status', 'completed').not('overall_score', 'is', null);
  if (error) fail(error);
  const sums: Record<string, { n: number; s: number }> = {};
  for (const r of data ?? []) {
    const o = out[r.user_id]!; o.totalSessions++;
    if (r.finished_at && (!o.lastPracticeAt || r.finished_at > o.lastPracticeAt)) o.lastPracticeAt = r.finished_at;
    if (r.finished_at && r.finished_at >= since && r.overall_score != null) {
      const a = (sums[r.user_id] ??= { n: 0, s: 0 }); a.n++; a.s += r.overall_score;
      o.bestScore30d = Math.max(o.bestScore30d ?? 0, r.overall_score);
    }
  }
  for (const [id, a] of Object.entries(sums)) { out[id]!.sessions30d = a.n; out[id]!.avgScore30d = Math.round(a.s / a.n); }
  return out;
}

function inviteEmail(p: { teamName: string; leaderName: string; lang: 'vi' | 'en'; url: string }) {
  const en = p.lang === 'en';
  const title = en ? `You're invited to join ${p.teamName}` : `Bạn được mời vào ${p.teamName}`;
  const text = en
    ? `${p.leaderName} invited you to their team on luyenthuyettrinh.com. Log in or sign up with this email, then accept the invite to practise with Premium features.`
    : `${p.leaderName} mời bạn vào nhóm trên luyenthuyettrinh.com. Đăng nhập hoặc đăng ký bằng email này rồi chấp nhận lời mời để luyện tập với quyền lợi Premium.`;
  return { subject: title, html: templates.simple(title, text, { label: en ? 'Accept invite' : 'Chấp nhận lời mời', url: p.url }), text: `${text}\n\n${p.url}` };
}

export const teamService = {
  /** Nhóm của tôi (nếu có) + các lời mời đang chờ gửi tới email của tôi. Thống kê chỉ trả cho trưởng nhóm. */
  async view(db: Db, userId: string, email: string) {
    const m = await membershipOf(db, userId);
    const { data: inv, error } = await db.from('team_members').select('team_id, invited_at, teams(name, owner_id, plan_expires_at)').eq('email', email.toLowerCase()).eq('status', 'invited');
    if (error) fail(error);
    const invites = (inv ?? []).map((r) => {
      const t = r.teams as unknown as Pick<TeamRow, 'name' | 'owner_id' | 'plan_expires_at'> | null;
      return { teamId: r.team_id, teamName: t?.name ?? '', invitedAt: r.invited_at, active: !!t?.plan_expires_at && new Date(t.plan_expires_at).getTime() > Date.now() };
    });
    if (!m) return { team: null, invites };

    const { data: rows, error: e2 } = await db.from('team_members').select('*').eq('team_id', m.team.id).order('invited_at');
    if (e2) fail(e2);
    const ids = (rows ?? []).filter((r) => r.user_id && r.status === 'active').map((r) => r.user_id!);
    const { data: profs, error: e3 } = ids.length ? await db.from('profiles').select('id, full_name').in('id', ids) : { data: [], error: null };
    if (e3) fail(e3);
    const names = Object.fromEntries((profs ?? []).map((p) => [p.id, p.full_name]));
    const leader = m.me.role === 'leader', stats = leader ? await memberStats(db, ids) : null;
    const members = (rows ?? []).map((r) => ({
      email: r.email, name: r.user_id ? names[r.user_id] || '' : '', role: r.role, status: r.status, joinedAt: r.joined_at, invitedAt: r.invited_at,
      isMe: r.user_id === userId, ...(stats && r.user_id && r.status === 'active' ? { stats: stats[r.user_id] } : {}),
    }));
    let totals = null;
    if (stats) {
      const ss = Object.values(stats), scored = ss.filter((x) => x.avgScore30d != null);
      totals = {
        members: members.filter((x) => x.status === 'active').length, pendingInvites: members.filter((x) => x.status === 'invited').length,
        sessions30d: ss.reduce((a, x) => a + x.sessions30d, 0),
        avgScore30d: scored.length ? Math.round(scored.reduce((a, x) => a + x.avgScore30d! * x.sessions30d, 0) / Math.max(1, scored.reduce((a, x) => a + x.sessions30d, 0))) : null,
        activeMembers30d: ss.filter((x) => x.sessions30d > 0).length,
      };
    }
    return {
      team: { id: m.team.id, name: m.team.name, active: isActive(m.team), planExpiresAt: m.team.plan_expires_at, role: m.me.role, maxMembers: TEAM_MAX_MEMBERS, members, totals },
      invites,
    };
  },

  async rename(db: Db, userId: string, name: string) {
    const { team } = await requireLeader(db, userId);
    const { error } = await db.from('teams').update({ name }).eq('id', team.id);
    if (error) fail(error);
  },

  async invite(db: Db, userId: string, email: string, lang: 'vi' | 'en') {
    const { team } = await requireLeader(db, userId);
    if (!isActive(team)) throw new AppError('TEAM_INACTIVE');
    const { data, error } = await db.rpc('team_invite', { p_team: team.id, p_email: email, p_max: TEAM_MAX_MEMBERS });
    if (error) fail(error);
    const r = (data as unknown as Rpc).result;
    if (r === 'full') throw new AppError('TEAM_FULL', { max: TEAM_MAX_MEMBERS });
    if (r === 'already') throw new AppError('ALREADY_INVITED');
    const { data: leader } = await db.from('profiles').select('full_name').eq('id', userId).maybeSingle();
    await sendEmail({ to: email.toLowerCase(), template: 'team_invite', ...inviteEmail({ teamName: team.name, leaderName: leader?.full_name || 'luyenthuyettrinh.com', lang, url: appUrl('/#nhom') }) });
    log.info('team invite', { teamId: team.id });
  },

  async join(db: Db, userId: string, email: string, teamId: string) {
    const { data: t, error: e1 } = await db.from('teams').select('*').eq('id', teamId).maybeSingle();
    if (e1) fail(e1);
    if (!t) throw new AppError('NOT_FOUND', { resource: 'team' });
    if (!isActive(t)) throw new AppError('TEAM_INACTIVE');
    const { data, error } = await db.rpc('team_join', { p_team: teamId, p_user: userId, p_email: email });
    if (error) fail(error);
    const r = (data as unknown as Rpc).result;
    if (r === 'not_found') throw new AppError('NOT_FOUND', { resource: 'invite' });
    if (r === 'in_other_team') throw new AppError('IN_OTHER_TEAM');
    log.info('team join', { teamId });
  },

  /** Từ chối lời mời (người được mời) — chỉ xóa lời mời gửi tới email của chính mình. */
  async decline(db: Db, email: string, teamId: string) {
    const { error } = await db.from('team_members').delete().eq('team_id', teamId).eq('email', email.toLowerCase()).eq('status', 'invited');
    if (error) fail(error);
  },

  /** Trưởng nhóm xóa một email; thành viên tự rời nhóm (email của chính mình). */
  async remove(db: Db, userId: string, myEmail: string, email: string) {
    const m = await requireMember(db, userId);
    const self = email.toLowerCase() === myEmail.toLowerCase();
    if (!self && m.me.role !== 'leader') throw new AppError('TEAM_LEADER_ONLY');
    const { data, error } = await db.rpc('team_remove', { p_team: m.team.id, p_email: email });
    if (error) fail(error);
    const r = (data as unknown as Rpc).result;
    if (r === 'is_leader') throw new AppError('INVALID_STATE', { reason: 'leader_cannot_leave' });
    if (r === 'not_found') throw new AppError('NOT_FOUND', { resource: 'member' });
  },

  async listScripts(db: Db, userId: string) {
    const { team } = await requireMember(db, userId);
    const { data, error } = await db.from('team_scripts').select('id, title, body, author_id, created_at').eq('team_id', team.id).order('created_at', { ascending: false }).limit(100);
    if (error) fail(error);
    const ids = [...new Set((data ?? []).map((x) => x.author_id).filter(Boolean))] as string[];
    const { data: profs } = ids.length ? await db.from('profiles').select('id, full_name').in('id', ids) : { data: [] };
    const names = Object.fromEntries((profs ?? []).map((p) => [p.id, p.full_name]));
    return (data ?? []).map((x) => ({ id: x.id, title: x.title, body: x.body, authorName: x.author_id ? names[x.author_id] || '' : '', mine: x.author_id === userId, createdAt: x.created_at }));
  },

  async addScript(db: Db, userId: string, i: { title: string; body: string }) {
    const { team } = await requireMember(db, userId);
    if (!isActive(team)) throw new AppError('TEAM_INACTIVE');
    const { data, error } = await db.from('team_scripts').insert({ team_id: team.id, author_id: userId, title: i.title, body: i.body }).select('id').single();
    if (error) fail(error);
    return { id: data!.id };
  },

  /** Xóa kịch bản: tác giả hoặc trưởng nhóm. */
  async removeScript(db: Db, userId: string, id: string) {
    const { team, me } = await requireMember(db, userId);
    const { data: row, error } = await db.from('team_scripts').select('author_id').eq('id', id).eq('team_id', team.id).maybeSingle();
    if (error) fail(error);
    if (!row) throw new AppError('NOT_FOUND', { resource: 'script' });
    if (row.author_id !== userId && me.role !== 'leader') throw new AppError('TEAM_LEADER_ONLY');
    const { error: e2 } = await db.from('team_scripts').delete().eq('id', id);
    if (e2) fail(e2);
  },
};
