import { useEffect, useState } from 'react'
import { api, type Invite, type Room, type User } from '../api/client'

interface Props {
  user: User
  onEnterRoom: (room: Room) => void
  onLogout: () => void
}

export default function RoomListScreen({ user, onEnterRoom, onLogout }: Props) {
  const [rooms, setRooms] = useState<Room[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [newRoomName, setNewRoomName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const loadRooms = async () => {
    try {
      const [roomsRes, invitesRes] = await Promise.all([api.listRooms(), api.listInvites()])
      setRooms(roomsRes.rooms)
      setInvites(invitesRes.invites)
    } catch (err) {
      setError(err instanceof Error ? err.message : '방 목록을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRooms()
  }, [])

  const acceptInvite = async (invite: Invite) => {
    setError(null)
    try {
      const res = await api.acceptInvite(invite.slug)
      await loadRooms()
      onEnterRoom(res.room)
    } catch (err) {
      setError(err instanceof Error ? err.message : '초대 수락에 실패했습니다.')
    }
  }

  const declineInvite = async (invite: Invite) => {
    setError(null)
    try {
      await api.declineInvite(invite.slug)
      await loadRooms()
    } catch (err) {
      setError(err instanceof Error ? err.message : '초대 거절에 실패했습니다.')
    }
  }

  /** 이름을 입력하지 않았을 때 쓸 기본 이름: 새보드(1), 새보드(2) ... 중 아직 안 쓰는 가장 작은 번호 */
  const nextDefaultName = () => {
    const used = new Set(rooms.map((r) => r.name))
    let n = 1
    while (used.has(`새보드(${n})`)) n++
    return `새보드(${n})`
  }

  const createRoom = async (e: React.FormEvent) => {
    e.preventDefault()
    if (creating) return
    const name = newRoomName.trim() || nextDefaultName()
    setCreating(true)
    setError(null)
    try {
      const res = await api.createRoom(name)
      setNewRoomName('')
      await loadRooms()
      onEnterRoom(res.room)
    } catch (err) {
      setError(err instanceof Error ? err.message : '방 생성에 실패했습니다.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="lobby">
      <div className="lobby-card wide">
        <div className="card-head">
          <div>
            <h1>내 보드</h1>
            <p className="subtitle">{user.name}님 (@{user.username})</p>
          </div>
          <button type="button" className="ghost" onClick={onLogout}>
            로그아웃
          </button>
        </div>

        <form className="create-row" onSubmit={createRoom}>
          <input
            value={newRoomName}
            placeholder="새 보드 이름 (비워두면 새보드(1), 새보드(2)... 자동)"
            onChange={(e) => setNewRoomName(e.target.value)}
          />
          <button type="submit" disabled={creating}>
            {creating ? '생성 중...' : '+ 방 만들기'}
          </button>
        </form>

        {error && <p className="error">{error}</p>}

        {invites.length > 0 && (
          <div className="invite-box">
            <div className="invite-title">📨 받은 초대 {invites.length}건</div>
            <ul className="invite-list">
              {invites.map((inv) => (
                <li key={inv.id} className="invite-item">
                  <div className="invite-info">
                    <span className="room-name">{inv.name}</span>
                    <span className="invite-from">{inv.owner_name}님의 초대</span>
                  </div>
                  <div className="invite-actions">
                    <button type="button" className="invite-accept" onClick={() => acceptInvite(inv)}>
                      수락
                    </button>
                    <button type="button" className="ghost" onClick={() => declineInvite(inv)}>
                      거절
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {loading ? (
          <p className="tip">불러오는 중...</p>
        ) : rooms.length === 0 ? (
          <p className="tip">아직 참여 중인 보드가 없어요. 위에서 새 보드를 만들어보세요.</p>
        ) : (
          <ul className="room-list">
            {rooms.map((room) => (
              <li key={room.id}>
                <button type="button" className="room-item" onClick={() => onEnterRoom(room)}>
                  <span className="room-name">{room.name}</span>
                  <span className="room-meta">
                    <span className={room.role === 'owner' ? 'role owner' : 'role member'}>
                      {room.role === 'owner' ? '팀장' : '참여자'}
                    </span>
                    <span>멤버 {room.member_count}명</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
