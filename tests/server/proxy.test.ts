/**
 * TRUST_PROXY (프록시 뒤 실제 IP 구분) 테스트.
 *  - 켜면: 프록시가 붙인 X-Forwarded-For 로 사용자를 구분 → 한 사람이 남의 아이디를 잠가도 다른 사람은 로그인된다
 *  - 끄면(기본): X-Forwarded-For 를 무시 → 헤더를 꾸며 로그인 실패 제한을 피할 수 없다
 */
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeApi, register, startServers, type TestServers } from '../helpers/server'

const nodeRequire = createRequire(import.meta.url)

let servers: TestServers
const extra: Server[] = []

beforeAll(async () => {
  servers = await startServers()
})

afterAll(async () => {
  await Promise.all(extra.map((s) => new Promise((r) => s.close(() => r(null)))))
  await servers.close()
})

/** TRUST_PROXY 값을 정해 API 앱을 하나 더 띄운다 (DB 는 같은 임시 DB) */
async function appWith(trust: string | undefined) {
  const { createApp } = nodeRequire('../../server/api/app.js') as {
    createApp: () => import('express').Express
  }
  const prev = process.env.TRUST_PROXY
  if (trust === undefined) delete process.env.TRUST_PROXY
  else process.env.TRUST_PROXY = trust
  const app = createApp()
  if (prev === undefined) delete process.env.TRUST_PROXY
  else process.env.TRUST_PROXY = prev
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  extra.push(server)
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
}

/** X-Forwarded-For 를 붙여 로그인 */
async function login(base: string, ip: string, username: string, password: string) {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ username, password }),
  })
  return res.status
}

describe('TRUST_PROXY 값 해석', () => {
  it('비움/0/false 는 끔, 숫자는 단계 수, 그 밖은 목록', () => {
    const { trustProxySetting } = nodeRequire('../../server/api/app.js') as {
      trustProxySetting: (raw?: string) => unknown
    }
    expect(trustProxySetting('')).toBe(false)
    expect(trustProxySetting(undefined)).toBe(false)
    expect(trustProxySetting('0')).toBe(false)
    expect(trustProxySetting('false')).toBe(false)
    expect(trustProxySetting('1')).toBe(1)
    expect(trustProxySetting('loopback, 10.0.0.0/8')).toEqual(['loopback', '10.0.0.0/8'])
  })
})

describe('프록시 뒤 로그인 실패 제한', () => {
  it('켜면(1): 공격자가 피해자 아이디를 잠가도 피해자 IP 에서는 로그인된다', async () => {
    const base = await appWith('1')
    const call = makeApi(base)
    await register(call, 'px_victim')
    for (let i = 0; i < 10; i++) {
      expect(await login(base, '203.0.113.9', 'px_victim', `wrong${i}`)).toBe(401)
    }
    expect(await login(base, '203.0.113.9', 'px_victim', 'secret1234')).toBe(429) // 공격자 IP 는 막힘
    expect(await login(base, '198.51.100.7', 'px_victim', 'secret1234')).toBe(200) // 피해자는 정상
  }, 30000)

  it('끄면(기본): X-Forwarded-For 를 바꿔도 제한을 피할 수 없다', async () => {
    const base = await appWith(undefined)
    const call = makeApi(base)
    await register(call, 'px_spoof')
    for (let i = 0; i < 10; i++) {
      // 매번 다른 IP 인 척해도 실제 접속 IP 는 같다
      expect(await login(base, `192.0.2.${i}`, 'px_spoof', `wrong${i}`)).toBe(401)
    }
    expect(await login(base, '192.0.2.200', 'px_spoof', 'secret1234')).toBe(429)
  }, 30000)
})
