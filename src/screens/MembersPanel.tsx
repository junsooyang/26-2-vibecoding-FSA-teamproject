import { useEffect, useState } from 'react'
import { api, type Member } from '../api/client'

interface Props {
  slug: string
  onClose: () => void
}

/** 방 멤버 관리 패널 (팀장은 초대/강퇴 가능, 참여자는 조회만) */
export default function MembersPanel({ slug, onClose }: Props) {
  const [members, setMembers] = useState<Member[]>([])
  const [myRole, setMyRole] = useState<'owner' | 'member'>('member')
  const [inviteUsername, setInviteUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    try {
      const res = await api.getRoom(slug)
      setMembers(res.members)
      setMyRole(res.role)
    } catch (err) {
      setError(err instanceof Error ? err.message : '멤버 정보를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const invite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteUsername.trim()) return
    setError(null)
    try {
      const res = await api.inviteMember(slug, inviteUsername.trim())
      setMembers(res.members)
      setInviteUsername('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '초대에 실패했습니다.')
    }
  }

  const remove = async (userId: number) => {
    setError(null)
    try {
      const res = await api.removeMember(slug, userId)
      setMembers(res.members)
    } catch (err) {
      setError(err instanceof Error ? err.message : '내보내기에 실패했습니다.')
    }
  }

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>멤버 관리</h2>
          <button type="button" className="ghost" onClick={onClose}>
            닫기
          </button>
        </div>

        {myRole === 'owner' && (
          <form className="create-row" onSubmit={invite}>
            <input
              value={inviteUsername}
              placeholder="초대할 사용자 아이디 (가입된 계정)"
              onChange={(e) => setInviteUsername(e.target.value)}
            />
            <button type="submit" disabled={!inviteUsername.trim()}>
              초대
            </button>
          </form>
        )}

        {error && <p className="error">{error}</p>}

        {loading ? (
          <p className="tip">불러오는 중...</p>
        ) : (
          <ul className="member-list">
            {members.map((m) => (
              <li key={m.id}>
                <span className="member-info">
                  <span className="member-name">{m.name}</span>
                  <span className="member-email">@{m.username}</span>
                </span>
                <span className="member-actions">
                  <span
                    className={
                      m.role === 'owner'
                        ? 'role owner'
                        : m.role === 'invited'
                          ? 'role invited'
                          : 'role member'
                    }
                  >
                    {m.role === 'owner' ? '팀장' : m.role === 'invited' ? '초대 대기중' : '참여자'}
                  </span>
                  {myRole === 'owner' && m.role !== 'owner' && (
                    <button type="button" className="danger" onClick={() => remove(m.id)}>
                      {m.role === 'invited' ? '초대 취소' : '내보내기'}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        {myRole !== 'owner' && (
          <p className="tip">멤버 초대/관리는 팀장만 할 수 있어요.</p>
        )}
      </div>
    </div>
  )
}
