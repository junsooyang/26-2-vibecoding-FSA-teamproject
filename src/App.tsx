import { useEffect, useState } from 'react'
import Board from './Board'
import AuthScreen from './screens/AuthScreen'
import RoomListScreen from './screens/RoomListScreen'
import { api, getToken, setToken, type Room, type User } from './api/client'
import type { AwarenessUser } from './collab/useCollabBoard'

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#6366f1', '#d946ef']
function colorFor(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length]
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [room, setRoom] = useState<Room | null>(null)
  const [booting, setBooting] = useState(true)

  // 저장된 토큰이 있으면 자동 로그인 복원
  useEffect(() => {
    const token = getToken()
    if (!token) {
      setBooting(false)
      return
    }
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => setToken(null))
      .finally(() => setBooting(false))
  }, [])

  const logout = () => {
    setToken(null)
    setUser(null)
    setRoom(null)
  }

  if (booting) {
    return (
      <div className="lobby">
        <div className="lobby-card">
          <p className="tip">불러오는 중...</p>
        </div>
      </div>
    )
  }

  // 1) 미인증 → 로그인/회원가입
  if (!user) {
    return <AuthScreen onAuthenticated={setUser} />
  }

  // 2) 방 선택 전 → 방 목록
  if (!room) {
    return <RoomListScreen user={user} onEnterRoom={setRoom} onLogout={logout} />
  }

  // 3) 방 입장 → 실시간 협업 보드
  const awarenessUser: AwarenessUser = { name: user.name, color: colorFor(user.username) }
  return (
    <Board
      room={room.slug}
      roomName={room.name}
      user={awarenessUser}
      onLeave={() => setRoom(null)}
    />
  )
}
