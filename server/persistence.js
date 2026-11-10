/**
 * SQLite 기반 Yjs 영속화 레이어.
 *
 * Node 24 내장 SQLite(node:sqlite)를 사용하므로 별도 설치/컴파일이 필요 없다.
 *
 * 동작:
 *  - 방(room)별로 Yjs 문서 전체를 바이너리(BLOB) 1행으로 저장한다.
 *  - 방이 처음 열릴 때 DB에서 읽어 문서에 복원(bindState)한다.
 *  - 문서가 바뀌면 debounce 후 최신 상태를 통째로 다시 써서 저장한다.
 *  - 모든 참여자가 나가 문서가 메모리에서 내려갈 때 마지막으로 저장(writeState)한다.
 *
 * 전체 스냅샷을 통째로 저장하는 단순한 방식이다. 팀플 규모(노드 수백 개)에서는
 * 충분히 빠르고, 구현이 단순해 장애 지점이 적다.
 */
import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'

// y-websocket(utils.cjs)는 yjs 를 CommonJS(require)로 불러온다.
// 여기서도 동일한 CJS 인스턴스를 사용해야 "Yjs was already imported" 경고와
// 인스턴스 불일치 문제를 피할 수 있다.
const require = createRequire(import.meta.url)
/** @type {typeof import('yjs')} */
const Y = require('yjs')

const DB_PATH = process.env.DB_PATH || 'board.db'
const DEBOUNCE_MS = 800

const db = new DatabaseSync(DB_PATH)

// 방 데이터 테이블: name(방이름, PK) + state(Yjs 문서 바이너리) + updated_at
db.exec(`
  CREATE TABLE IF NOT EXISTS docs (
    name       TEXT PRIMARY KEY,
    state      BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  )
`)

const selectStmt = db.prepare('SELECT state FROM docs WHERE name = ?')
const upsertStmt = db.prepare(`
  INSERT INTO docs (name, state, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(name) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at
`)

/** 저장된 방 스냅샷을 Uint8Array 로 읽어온다. 없으면 null. */
function loadState(roomName) {
  const row = selectStmt.get(roomName)
  if (!row || !row.state) return null
  // node:sqlite 의 BLOB 은 Uint8Array 로 반환된다.
  return row.state instanceof Uint8Array ? row.state : new Uint8Array(row.state)
}

/**
 * 보드(rooms 테이블)가 아직 존재하는지 확인한다.
 * 삭제된 보드의 문서를 마지막 접속자가 나갈 때 다시 저장해 되살리는 일을 막기 위함이다.
 * rooms 테이블 자체가 없거나 조회에 실패하면(= API 서버가 아직 DB 를 만들기 전) 기존처럼 저장한다.
 */
function roomStillExists(roomName) {
  try {
    return !!db.prepare('SELECT 1 AS ok FROM rooms WHERE slug = ?').get(roomName)
  } catch {
    return true
  }
}

/** 현재 Yjs 문서 상태를 통째로 DB 에 저장한다. (삭제된 보드는 저장하지 않는다) */
function saveState(roomName, ydoc) {
  if (!roomStillExists(roomName)) {
    console.log(`[persistence] 방 '${roomName}' 은(는) 삭제되어 저장하지 않습니다.`)
    return false
  }
  const update = Y.encodeStateAsUpdate(ydoc)
  upsertStmt.run(roomName, update, Date.now())
  return true
}

// 방별 debounce 타이머 관리
const timers = new Map()

/**
 * y-websocket 의 setPersistence 에 넘길 핸들러.
 * provider = y-websocket/bin/utils 가 관리하는 WSSharedDoc(= Y.Doc 확장)
 */
export const persistence = {
  provider: 'sqlite',

  /** 방 문서가 처음 로드될 때: DB 상태 복원 + 변경 감지 시 저장 등록 */
  bindState: async (roomName, ydoc) => {
    const persisted = loadState(roomName)
    if (persisted) {
      Y.applyUpdate(ydoc, persisted)
      console.log(`[persistence] 방 '${roomName}' 복원 완료 (${persisted.byteLength} bytes)`)
    } else {
      console.log(`[persistence] 방 '${roomName}' 신규 생성`)
    }

    // 문서가 바뀔 때마다 debounce 후 저장
    ydoc.on('update', () => {
      const existing = timers.get(roomName)
      if (existing) clearTimeout(existing)
      timers.set(
        roomName,
        setTimeout(() => {
          try {
            saveState(roomName, ydoc)
            timers.delete(roomName)
          } catch (err) {
            console.error(`[persistence] 방 '${roomName}' 저장 실패:`, err)
          }
        }, DEBOUNCE_MS),
      )
    })
  },

  /** 방이 메모리에서 내려갈 때(모든 참여자 퇴장): 마지막 상태 저장 */
  writeState: async (roomName, ydoc) => {
    const t = timers.get(roomName)
    if (t) {
      clearTimeout(t)
      timers.delete(roomName)
    }
    try {
      if (saveState(roomName, ydoc)) {
        console.log(`[persistence] 방 '${roomName}' 최종 저장 완료`)
      }
    } catch (err) {
      console.error(`[persistence] 방 '${roomName}' 최종 저장 실패:`, err)
    }
  },
}

export function closeDb() {
  try {
    db.close()
  } catch {
    // ignore
  }
}
