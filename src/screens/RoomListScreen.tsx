import { useEffect, useState } from 'react'
import { api, type Room, type User } from '../api/client'

interface Props {
  user: User
  onEnterRoom: (room: Room) => void
  onLogout: () => void
}

export default function RoomListScreen({ user, onEnterRoom, onLogout }: Props) {
  const [rooms, setRooms] = useState<Room[]>([])
  const [newRoomName, setNewRoomName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const loadRooms = async () => {
    try {
      const res = await api.listRooms()
      setRooms(res.rooms)
    } catch (err) {
      setError(err instanceof Error ? err.message : '방 목록을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRooms()
  }, [])

  const createRoom = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newRoomName.trim()) return
    setCreating(true)
    setError(null)
    try {
      const res = await api.createRoom(newRoomName.trim())
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
            <p className="subtitle">{user.name}님 ({user.email})</p>
          </div>
          <button type="button" className="ghost" onClick={onLogout}>
            로그아웃
          </button>
        </div>

        <form className="create-row" onSubmit={createRoom}>
          <input
            value={newRoomName}
            placeholder="새 보드 이름 (예: 2학기 프로젝트 WBS)"
            onChange={(e) => setNewRoomName(e.target.value)}
          />
          <button type="submit" disabled={creating || !newRoomName.trim()}>
            {creating ? '생성 중...' : '+ 방 만들기'}
          </button>
        </form>

        {error && <p className="error">{error}</p>}

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
