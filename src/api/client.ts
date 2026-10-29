/**
 * 방/권한 관리 REST API 클라이언트.
 * JWT 토큰은 localStorage 에 보관하고 모든 요청에 Authorization 헤더로 첨부한다.
 */

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api'
const TOKEN_KEY = 'fsa_token'

export interface User {
  id: number
  username: string
  name: string
}

export interface Room {
  id: number
  slug: string
  name: string
  owner_id: number
  created_at: number
  role?: 'owner' | 'member'
  member_count?: number
}

export interface Member {
  id: number
  username: string
  name: string
  role: 'owner' | 'member'
  joined_at: number
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken()
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    // 응답 본문 없음
  }

  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error ?? `요청 실패 (${res.status})`
    throw new Error(message)
  }
  return data as T
}

export const api = {
  // 인증
  register: (username: string, name: string, password: string) =>
    request<{ token: string; user: User }>('POST', '/auth/register', { username, name, password }),
  login: (username: string, password: string) =>
    request<{ token: string; user: User }>('POST', '/auth/login', { username, password }),
  me: () => request<{ user: User }>('GET', '/auth/me'),

  // 방
  listRooms: () => request<{ rooms: Room[] }>('GET', '/rooms'),
  createRoom: (name: string) => request<{ room: Room }>('POST', '/rooms', { name }),
  getRoom: (slug: string) =>
    request<{ room: Room; role: 'owner' | 'member'; members: Member[] }>('GET', `/rooms/${slug}`),
  inviteMember: (slug: string, username: string) =>
    request<{ members: Member[] }>('POST', `/rooms/${slug}/members`, { username }),
  removeMember: (slug: string, userId: number) =>
    request<{ members: Member[] }>('DELETE', `/rooms/${slug}/members/${userId}`),
  deleteRoom: (slug: string) => request<{ ok: true }>('DELETE', `/rooms/${slug}`),
}
