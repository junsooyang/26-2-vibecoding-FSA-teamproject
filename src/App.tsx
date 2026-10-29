import { useState } from 'react'
import Board from './Board'
import type { AwarenessUser } from './collab/useCollabBoard'

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#6366f1', '#d946ef']
function randomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)]
}

export default function App() {
  const [joined, setJoined] = useState(false)
  const [room, setRoom] = useState('fsa-demo')
  const [name, setName] = useState('')
  const [user, setUser] = useState<AwarenessUser>({ name: '', color: randomColor() })

  if (joined) {
    return <Board room={room} user={user} onLeave={() => setJoined(false)} />
  }

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1>실시간 협업 보드</h1>
        <p className="subtitle">26-2 바이브코딩 FSA 팀플 · 브레인스토밍 / 마인드맵 / WBS</p>

        <label>
          닉네임
          <input
            value={name}
            placeholder="예: 김팀장"
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label>
          방 이름 (같은 방 이름으로 접속하면 실시간 공유)
          <input
            value={room}
            placeholder="예: fsa-demo"
            onChange={(e) => setRoom(e.target.value)}
          />
        </label>

        <button
          disabled={!name.trim() || !room.trim()}
          onClick={() => {
            setUser({ name: name.trim(), color: randomColor() })
            setJoined(true)
          }}
        >
          방 입장
        </button>

        <p className="tip">
          팁: 브라우저 탭을 하나 더 열어 같은 방 이름으로 접속하면 실시간 동기화를 바로 확인할 수 있어요.
        </p>
      </div>
    </div>
  )
}
