/**
 * Yjs 문서 영속화 레이어 (SQLite 또는 Postgres — server/db.js).
 *
 * 동작:
 *  - 방(room)별로 Yjs 문서 전체를 바이너리 1행(docs 테이블)으로 저장한다.
 *  - 방이 처음 열릴 때 DB에서 읽어 문서에 복원(bindState)한다.
 *  - 문서가 바뀌면 debounce 후 최신 상태를 통째로 다시 써서 저장한다.
 *  - 모든 참여자가 나가 문서가 메모리에서 내려갈 때 마지막으로 저장(writeState)한다.
 *
 * DB 가 비동기라서 생기는 두 가지 위험을 막는다.
 *  1) 불러오기가 끝나기 전에 저장하면 "빈 문서"가 저장된 내용을 덮어쓴다.
 *     → 불러오기에 성공한 뒤에만 저장한다. 불러오기에 실패한 방은 아예 저장하지 않는다.
 *  2) 마지막 사람이 나가 최종 저장 중일 때 누가 다시 들어오면, 저장 전의 옛 내용을 불러올 수 있다.
 *     → 그 방의 저장이 끝날 때까지 기다렸다가 불러온다.
 */
import { createRequire } from 'node:module'
import { db } from './db.js'

// y-websocket(utils.cjs)는 yjs 를 CommonJS(require)로 불러온다.
// 여기서도 동일한 CJS 인스턴스를 사용해야 "Yjs was already imported" 경고와
// 인스턴스 불일치 문제를 피할 수 있다.
const require = createRequire(import.meta.url)
/** @type {typeof import('yjs')} */
const Y = require('yjs')

const DEBOUNCE_MS = 800

/** 저장된 방 스냅샷을 Uint8Array 로 읽어온다. 없으면 null. */
async function loadState(roomName) {
  const row = await db.get('SELECT state FROM docs WHERE name = ?', [roomName])
  if (!row || !row.state) return null
  const s = row.state
  return s instanceof Uint8Array ? s : new Uint8Array(s)
}

/** 보드(rooms 테이블)가 아직 존재하는지. 삭제된 보드를 마지막 접속자가 나갈 때 되살리지 않기 위함 */
async function roomStillExists(roomName) {
  return !!(await db.get('SELECT 1 AS ok FROM rooms WHERE slug = ?', [roomName]))
}

/** 현재 Yjs 문서 상태를 통째로 DB 에 저장한다. (삭제된 보드는 저장하지 않는다) */
async function saveState(roomName, ydoc) {
  if (!(await roomStillExists(roomName))) {
    console.log(`[persistence] 방 '${roomName}' 은(는) 삭제되어 저장하지 않습니다.`)
    return false
  }
  const update = Y.encodeStateAsUpdate(ydoc)
  await db.run(
    `INSERT INTO docs (name, state, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (name) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
    [roomName, update, Date.now()],
  )
  return true
}

/** 방별 상태: 불러오기 결과(성공 여부), debounce 타이머 */
const loaded = new WeakMap() // ydoc -> Promise<boolean>
const timers = new Map() // roomName -> timeout
/** 방별로 진행 중인 저장 (다음 불러오기가 기다린다) */
const pendingWrites = new Map() // roomName -> Promise

/** 같은 방의 저장을 한 줄로 세워 순서대로 실행한다 */
function queueWrite(roomName, task) {
  const prev = pendingWrites.get(roomName) ?? Promise.resolve()
  const next = prev.then(task, task)
  const tracked = next.finally(() => {
    if (pendingWrites.get(roomName) === tracked) pendingWrites.delete(roomName)
  })
  pendingWrites.set(roomName, tracked)
  return next
}

/**
 * y-websocket 의 setPersistence 에 넘길 핸들러.
 * provider = y-websocket/bin/utils 가 관리하는 WSSharedDoc(= Y.Doc 확장)
 */
export const persistence = {
  provider: 'db',

  /** 방 문서가 처음 로드될 때: DB 상태 복원 + 변경 감지 시 저장 등록 */
  bindState: (roomName, ydoc) => {
    const ready = (async () => {
      // 직전 접속자들의 최종 저장이 끝난 뒤에 불러온다
      await pendingWrites.get(roomName)?.catch(() => {})
      const persisted = await loadState(roomName)
      if (persisted) {
        Y.applyUpdate(ydoc, persisted)
        console.log(`[persistence] 방 '${roomName}' 복원 완료 (${persisted.byteLength} bytes)`)
      } else {
        console.log(`[persistence] 방 '${roomName}' 신규 생성`)
      }
      return true
    })().catch((err) => {
      // 불러오지 못한 문서를 저장하면 기존 내용을 덮어쓰므로, 이 문서는 저장하지 않는다.
      console.error(`[persistence] 방 '${roomName}' 불러오기 실패 (이 연결 동안 저장하지 않음):`, err)
      return false
    })
    loaded.set(ydoc, ready)

    // 문서가 바뀔 때마다 debounce 후 저장 (불러오기에 성공한 뒤에만)
    ydoc.on('update', () => {
      const existing = timers.get(roomName)
      if (existing) clearTimeout(existing)
      timers.set(
        roomName,
        setTimeout(() => {
          timers.delete(roomName)
          ready.then((ok) => {
            if (!ok) return
            queueWrite(roomName, () => saveState(roomName, ydoc)).catch((err) =>
              console.error(`[persistence] 방 '${roomName}' 저장 실패:`, err),
            )
          })
        }, DEBOUNCE_MS),
      )
    })
    return ready
  },

  /** 방이 메모리에서 내려갈 때(모든 참여자 퇴장): 마지막 상태 저장 */
  writeState: (roomName, ydoc) => {
    const t = timers.get(roomName)
    if (t) {
      clearTimeout(t)
      timers.delete(roomName)
    }
    const ready = loaded.get(ydoc) ?? Promise.resolve(false)
    return queueWrite(roomName, async () => {
      if (!(await ready)) return
      try {
        if (await saveState(roomName, ydoc)) {
          console.log(`[persistence] 방 '${roomName}' 최종 저장 완료`)
        }
      } catch (err) {
        console.error(`[persistence] 방 '${roomName}' 최종 저장 실패:`, err)
      }
    })
  },
}

/** 진행 중인 저장이 모두 끝날 때까지 기다린다 (서버 종료 시) */
export async function flushPendingWrites() {
  await Promise.allSettled([...pendingWrites.values()])
}
