/**
 * 서버 테스트 공용 도우미.
 *
 * 서버 모듈(server/api/db.js, server/persistence.js 등)은 import 하는 순간 DB_PATH 환경변수로
 * DB 파일을 연다. 그래서 반드시 환경변수를 먼저 정한 뒤 동적 import 해야 한다.
 * 테스트마다 OS 임시 폴더에 새 DB 파일과 업로드 폴더를 만들고, 끝나면 지운다.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import WebSocket from 'ws'

const nodeRequire = createRequire(import.meta.url)

export interface TestServers {
  api: string
  ws: string
  dbPath: string
  uploadDir: string
  close: () => Promise<void>
}

export async function startServers(options: { recheckMs?: number } = {}): Promise<TestServers> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-board-test-'))
  const dbPath = path.join(dir, 'test.db')
  const uploadDir = path.join(dir, 'uploads')
  process.env.DB_PATH = dbPath
  process.env.UPLOAD_DIR = uploadDir
  process.env.JWT_SECRET = 'test-secret'

  // 환경변수를 정한 뒤에 불러와야 임시 DB 를 쓴다.
  // 서버 코드는 Vite 변환을 거치지 않고 Node 가 직접 불러오도록 require 를 쓴다.
  // (Vite 5 는 Node 22 에 생긴 내장 모듈 'node:sqlite' 를 몰라 변환하다 실패한다.
  //  Node 22.12+ 는 ESM 모듈도 require 로 불러올 수 있다.)
  const { createApp } = nodeRequire('../../server/api/app.js') as {
    createApp: () => import('express').Express
  }
  const { createRealtimeServer } = nodeRequire('../../server/realtime.js') as {
    createRealtimeServer: (o?: { recheckMs?: number }) => {
      server: Server
      close: () => Promise<void>
    }
  }

  const apiServer: Server = await new Promise((resolve) => {
    const s = createApp().listen(0, () => resolve(s))
  })
  const realtime = createRealtimeServer({ recheckMs: options.recheckMs ?? 200 })
  await new Promise<void>((resolve) => realtime.server.listen(0, '127.0.0.1', () => resolve()))

  const apiPort = (apiServer.address() as AddressInfo).port
  const wsPort = (realtime.server.address() as AddressInfo).port

  return {
    api: `http://127.0.0.1:${apiPort}/api`,
    ws: `ws://127.0.0.1:${wsPort}`,
    dbPath,
    uploadDir,
    close: async () => {
      await new Promise<void>((resolve) => apiServer.close(() => resolve()))
      await realtime.close()
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        // 윈도우에서 DB 파일 잠금이 늦게 풀리면 남을 수 있음 (OS 임시 폴더라 무해)
      }
    },
  }
}

export interface ApiResult<T = any> {
  status: number
  json: T
}

/** JSON API 호출 */
export function makeApi(base: string) {
  return async function call<T = any>(
    method: string,
    p: string,
    token?: string | null,
    body?: unknown,
  ): Promise<ApiResult<T>> {
    const res = await fetch(base + p, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    let json: any = null
    try {
      json = await res.json()
    } catch {
      // 본문 없음
    }
    return { status: res.status, json }
  }
}

/** 회원가입 후 토큰 반환 */
export async function register(call: ReturnType<typeof makeApi>, username: string) {
  const r = await call('POST', '/auth/register', null, {
    username,
    name: `${username}-이름`,
    password: 'secret1234',
  })
  if (r.status !== 201) throw new Error(`register ${username} failed: ${r.status}`)
  return r.json.token as string
}

/** 실시간 서버 접속 시도: 열리면 { ws, closed }, 거절되면 { status } */
export function connectWs(
  wsBase: string,
  slug: string,
  token?: string,
): Promise<{ ws?: WebSocket; status?: number; closed: Promise<number> }> {
  return new Promise((resolve) => {
    const q = token === undefined ? '' : `?token=${encodeURIComponent(token)}`
    const ws = new WebSocket(`${wsBase}/${encodeURIComponent(slug)}${q}`)
    let resolveClosed: (code: number) => void = () => {}
    const closed = new Promise<number>((r) => (resolveClosed = r))
    ws.on('open', () => resolve({ ws, closed }))
    ws.on('close', (code) => resolveClosed(code))
    ws.on('unexpected-response', (_req, res) => {
      resolve({ status: res.statusCode, closed })
      ws.terminate()
    })
    ws.on('error', () => resolve({ status: 0, closed }))
  })
}

/** 지정한 시간 안에 연결이 닫히면 닫힘 코드, 아니면 null */
export function closeCodeWithin(closed: Promise<number>, ms: number): Promise<number | null> {
  return Promise.race([closed, new Promise<null>((r) => setTimeout(() => r(null), ms))])
}
