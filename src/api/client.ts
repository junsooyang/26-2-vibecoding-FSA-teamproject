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
  role: 'owner' | 'member' | 'invited'
  joined_at: number
}

/** 내가 초대받은(수락 대기 중인) 방 */
export interface Invite {
  id: number
  slug: string
  name: string
  owner_id: number
  created_at: number
  owner_name: string
}

/** 개인 공간 파일 (data URL 로 서버에 저장) */
export interface PersonalFile {
  id: string
  name: string
  url: string
  size: number
}

export interface PersonalSpace {
  note: string
  files: PersonalFile[]
}

/** AI 가 제안한 세부 WBS 작업 1개 */
export interface AiTaskDraft {
  label: string
  checklist: string[]
}

export interface AiBreakdownResponse {
  provider: 'gemini' | 'openai' | 'rule'
  model: string
  tasks: AiTaskDraft[]
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

// ---------------------------------------------------------------------------
// 보드 파일(사진/첨부): 서버 디스크에 저장하고, 보드 문서에는 참조 문자열만 둔다.
// 참조 형식: fsafile:<보드 slug>/<파일 id>
// 내려받기에는 인증이 필요해서 <img src> 에 바로 쓸 수 없다. → 인증 헤더로 가져온 뒤 blob URL 로 변환한다.
// ---------------------------------------------------------------------------

export const FILE_REF_PREFIX = 'fsafile:'

/** 보드 문서에 저장된 값이 서버 파일 참조인지 (예전 data URL / 외부 링크와 구분) */
export function isFileRef(url: string | undefined): url is string {
  return typeof url === 'string' && url.startsWith(FILE_REF_PREFIX)
}

export interface UploadedFile {
  id: string
  name: string
  mime: string
  size: number
  /** 보드 문서에 저장할 참조 문자열 */
  ref: string
}

/** 파일을 서버에 올린다. kind=image 는 PNG/JPG/GIF/WEBP 만 허용된다. */
export async function uploadFile(
  slug: string,
  file: File,
  kind: 'image' | 'file',
): Promise<UploadedFile> {
  const token = getToken()
  const res = await fetch(`${API_BASE}/files/${encodeURIComponent(slug)}?kind=${kind}`, {
    method: 'POST',
    headers: {
      // JSON 으로 오해되지 않게 항상 octet-stream. 실제 형식은 헤더로 전달한다.
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name),
      'X-File-Type': file.type || 'application/octet-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: file,
  })
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    // 응답 본문 없음
  }
  if (!res.ok) {
    throw new Error((data as { error?: string } | null)?.error ?? `업로드 실패 (${res.status})`)
  }
  return (data as { file: UploadedFile }).file
}

// 같은 파일을 여러 번 가져오지 않도록 참조별로 결과(Promise)를 캐시한다.
const blobUrlCache = new Map<string, Promise<string>>()

/** 파일 참조를 브라우저에서 쓸 수 있는 blob URL 로 바꾼다. (인증 헤더 포함, 캐시됨) */
export function fetchFileBlobUrl(ref: string): Promise<string> {
  const cached = blobUrlCache.get(ref)
  if (cached) return cached

  const promise = (async () => {
    const path = ref.slice(FILE_REF_PREFIX.length) // "<slug>/<id>"
    const token = getToken()
    const res = await fetch(`${API_BASE}/files/${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) throw new Error(`파일을 불러오지 못했어요 (${res.status})`)
    return URL.createObjectURL(await res.blob())
  })()

  // 실패한 결과는 캐시에 남기지 않아 다음에 다시 시도할 수 있게 한다.
  promise.catch(() => blobUrlCache.delete(ref))
  blobUrlCache.set(ref, promise)
  return promise
}

/** 서버 파일 참조를 지정한 파일명으로 내려받는다. */
export async function downloadFileRef(ref: string, filename: string) {
  const url = await fetchFileBlobUrl(ref)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
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
  /** 팀장 위임 (팀장만). 성공하면 나는 참여자가 된다. */
  transferOwner: (slug: string, userId: number) =>
    request<{ ok: true; role: 'member'; members: Member[] }>('POST', `/rooms/${slug}/transfer`, {
      userId,
    }),
  /** 보드에서 나가기 (참여자만) */
  leaveRoom: (slug: string) => request<{ ok: true }>('POST', `/rooms/${slug}/leave`),

  // 초대 수락/거절
  listInvites: () => request<{ invites: Invite[] }>('GET', '/rooms/invites/list'),
  acceptInvite: (slug: string) =>
    request<{ ok: true; room: Room }>('POST', `/rooms/${slug}/accept`),
  declineInvite: (slug: string) => request<{ ok: true }>('POST', `/rooms/${slug}/decline`),

  // 개인 공간 (서버 저장 — 어느 기기에서든 동일하게 보임)
  getPersonal: (slug: string) =>
    request<PersonalSpace>('GET', `/personal/${slug}`),
  savePersonal: (slug: string, data: PersonalSpace) =>
    request<{ ok: true }>('PUT', `/personal/${slug}`, data),

  // AI 기반 WBS 세부 작업 분해
  breakdownTasks: (
    slug: string,
    payload: { topic: string; context?: string; count?: number },
  ) =>
    request<AiBreakdownResponse>(
      'POST',
      `/ai/${encodeURIComponent(slug)}/breakdown`,
      payload,
    ),
}
