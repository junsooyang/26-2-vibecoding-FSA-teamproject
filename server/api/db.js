/**
 * 방/권한 관리용 SQLite 데이터베이스 레이어.
 *
 * Node 내장 node:sqlite 사용 (별도 설치/컴파일 불필요).
 * Yjs 영속화(persistence.js)와 같은 DB 파일(board.db)을 공유하되,
 * 테이블은 분리되어 있어 충돌하지 않는다.
 *
 * 테이블:
 *  - users:        사용자 계정 (아이디/해시된 비밀번호)
 *  - rooms:        방 (slug = 실시간 동기화에서 쓰는 방 이름, owner = 팀장)
 *  - room_members: 방-사용자 관계 + 역할(owner / member)
 */
import { DatabaseSync } from 'node:sqlite'

const DB_PATH = process.env.DB_PATH || 'board.db'

const db = new DatabaseSync(DB_PATH)

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    owner_id    INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS room_members (
    room_id   INTEGER NOT NULL,
    user_id   INTEGER NOT NULL,
    role      TEXT NOT NULL DEFAULT 'member',
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (room_id, user_id),
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- 팀원별 개인 공간: 사용자 + 방(slug) 단위로 개인 노트/파일을 서버에 저장.
  -- note: 개인 메모 텍스트, files_json: 개인 파일 목록(JSON, data URL 포함).
  -- 어느 기기에서 로그인해도 동일하게 보이도록 서버에 보관한다.
  CREATE TABLE IF NOT EXISTS personal_spaces (
    user_id    INTEGER NOT NULL,
    room_slug  TEXT NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    files_json TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, room_slug),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`)

export default db
