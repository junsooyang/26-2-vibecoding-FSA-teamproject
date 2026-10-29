import { useState } from 'react'
import { api, setToken, type User } from '../api/client'

interface Props {
  onAuthenticated: (user: User) => void
}

export default function AuthScreen({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res =
        mode === 'login'
          ? await api.login(username.trim(), password)
          : await api.register(username.trim(), name.trim(), password)
      setToken(res.token)
      onAuthenticated(res.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : '요청에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1>실시간 협업 보드</h1>

        <div className="tabs">
          <button
            type="button"
            className={mode === 'login' ? 'tab active' : 'tab'}
            onClick={() => setMode('login')}
          >
            로그인
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'tab active' : 'tab'}
            onClick={() => setMode('register')}
          >
            회원가입
          </button>
        </div>

        <form onSubmit={submit}>
          <label>
            아이디
            <input
              value={username}
              placeholder="영문/숫자/밑줄 3~20자"
              autoComplete="username"
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </label>

          {mode === 'register' && (
            <label>
              이름
              <input
                value={name}
                placeholder="예: 김팀장"
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
          )}

          <label>
            비밀번호
            <input
              type="password"
              value={password}
              placeholder="6자 이상"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error && <p className="error">{error}</p>}

          <button type="submit" disabled={loading}>
            {loading ? '처리 중...' : mode === 'login' ? '로그인' : '회원가입'}
          </button>
        </form>
      </div>
    </div>
  )
}
