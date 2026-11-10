import { useEffect, useState } from 'react'
import { api, type Member } from '../api/client'

interface Props {
  slug: string
  onClose: () => void
  /** 내 역할이 바뀌었을 때 (팀장 위임 후 참여자가 됨 등) */
  onRoleChanged?: (role: 'owner' | 'member') => void
  /** 내가 보드에서 나갔을 때 (보드 목록으로 이동) */
  onLeft?: () => void
}

/** 방 멤버 관리 패널 (팀장: 초대/강퇴/위임, 참여자: 조회 + 나가기) */
export default function MembersPanel({ slug, onClose, onRoleChanged, onLeft }: Props) {
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
      onRoleChanged?.(res.role)
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

  const [busy, setBusy] = useState(false)

  const transfer = async (m: Member) => {
    const ok = window.confirm(
      `${m.name}(@${m.username})님에게 팀장을 맡길까요?\n\n` +
        '맡기면 나는 참여자가 되고, 초대·내보내기·보드 삭제는 새 팀장만 할 수 있어요.',
    )
    if (!ok) return
    setError(null)
    setBusy(true)
    try {
      const res = await api.transferOwner(slug, m.id)
      setMembers(res.members)
      setMyRole('member')
      onRoleChanged?.('member')
    } catch (err) {
      setError(err instanceof Error ? err.message : '팀장 위임에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const leave = async () => {
    const ok = window.confirm(
      '이 보드에서 나갈까요?\n\n' +
        '보드 목록에서 사라지고, 이 보드에 둔 내 개인 공간(노트·파일)도 삭제돼요. ' +
        '다시 들어오려면 팀장에게 초대를 받아야 해요.',
    )
    if (!ok) return
    setError(null)
    setBusy(true)
    try {
      await api.leaveRoom(slug)
      onLeft?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : '보드에서 나가지 못했습니다.')
      setBusy(false)
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
                  {myRole === 'owner' && m.role === 'member' && (
                    <button
                      type="button"
                      className="ghost member-transfer"
                      onClick={() => transfer(m)}
                      disabled={busy}
                      title="이 팀원에게 팀장 맡기기"
                    >
                      팀장 위임
                    </button>
                  )}
                  {myRole === 'owner' && m.role !== 'owner' && (
                    <button
                      type="button"
                      className="danger"
                      onClick={() => remove(m.id)}
                      disabled={busy}
                    >
                      {m.role === 'invited' ? '초대 취소' : '내보내기'}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        {myRole === 'owner' ? (
          <p className="tip">
            팀장은 보드에서 나갈 수 없어요. 그만둘 때는 다른 팀원에게 <b>팀장 위임</b> 후 나가세요.
          </p>
        ) : (
          <>
            <p className="tip">멤버 초대/관리는 팀장만 할 수 있어요.</p>
            <div className="member-leave-row">
              <button type="button" className="danger" onClick={leave} disabled={busy}>
                🚪 이 보드에서 나가기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
