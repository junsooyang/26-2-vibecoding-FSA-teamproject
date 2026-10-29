# 26-2 바이브코딩 FSA 팀플 · 실시간 협업 보드

팀 프로젝트의 **브레인스토밍 / 마인드맵 / WBS** 작성을 돕는 실시간 협업 보드입니다.
팀장이 방을 만들면 참여자들이 같은 방에 접속해 **노드를 생성하고, 트리를 연결하거나 이동하면 변경 사항이 실시간으로 동기화**됩니다.

## 기술 스택

| 영역 | 사용 기술 |
|------|-----------|
| 프론트엔드 | React 18 + TypeScript + Vite |
| 캔버스 / 노드 UI | [React Flow (`@xyflow/react`)](https://reactflow.dev) |
| 실시간 동기화 | [Yjs](https://docs.yjs.dev) (CRDT) + `y-websocket` |
| 실시간 서버 | Node.js + `ws` + `y-websocket` 유틸 |
| 영속화(저장) | SQLite (Node.js 내장 `node:sqlite`) |

> **왜 Yjs(CRDT)인가?** 여러 명이 동시에 같은 노드를 옮기거나 수정해도 충돌 없이 자동 병합됩니다. 협업 보드의 가장 어려운 "동시 편집" 문제를 해결하는 핵심입니다.

## 프로젝트 구조

```
.
├── index.html
├── package.json
├── vite.config.ts
├── server/
│   ├── index.js            # y-websocket 실시간 서버
│   └── persistence.js      # SQLite 영속화 (방별 Yjs 문서 저장/복원)
└── src/
    ├── main.tsx
    ├── App.tsx             # 로비(방 입장 화면)
    ├── Board.tsx           # React Flow 캔버스 + 툴바
    ├── index.css
    └── collab/
        ├── yjs.ts          # Yjs 문서 / 방 연결 레이어
        └── useCollabBoard.ts  # React Flow <-> Yjs 브릿지 훅
```

## 실행 방법

### 1. 의존성 설치
```bash
npm install
```

### 2. 실시간 서버 실행 (터미널 1)
```bash
npm run server
```
`ws://localhost:1234` 에서 협업 서버가 뜹니다.

### 3. 웹 앱 실행 (터미널 2)
```bash
npm run dev
```
브라우저에서 `http://localhost:5173` 접속.

### 4. 실시간 동기화 확인
1. 닉네임과 방 이름(예: `fsa-demo`)을 입력하고 **방 입장**
2. 브라우저 탭을 하나 더 열어 **같은 방 이름**으로 접속
3. 한쪽에서 노드를 추가/이동/연결하면 다른 쪽에 즉시 반영됩니다.

## 영속화 (데이터 저장)

보드 내용은 서버의 **SQLite 데이터베이스(`board.db`)** 에 방(room)별로 저장됩니다.

- 노드/엣지를 바꾸면 서버가 잠시(약 0.8초) 뒤 Yjs 문서 전체를 DB에 저장합니다.
- 모든 참여자가 방을 나가면 마지막 상태를 한 번 더 저장합니다.
- **서버를 껐다 켜도** 같은 방 이름으로 다시 들어가면 내용이 그대로 복원됩니다.

Node.js 18 이상에 내장된 `node:sqlite` 를 사용하므로 **별도 설치나 네이티브 컴파일이 필요 없습니다.**
DB 파일 위치는 환경변수 `DB_PATH` 로 바꿀 수 있습니다. (`board.db` 는 `.gitignore` 로 커밋에서 제외됩니다.)

```bash
# DB 파일 경로를 바꾸고 싶을 때
DB_PATH=data/myboard.db npm run server
```

## 사용법

| 동작 | 방법 |
|------|------|
| 노드 추가 | 빈 캔버스를 **더블클릭** |
| 노드 내용 수정 | 노드를 **더블클릭** |
| 노드 이동 | 노드를 **드래그** |
| 트리 연결 | 노드 가장자리의 **점(handle)끼리 드래그** |
| 노드/엣지 삭제 | 선택 후 `Delete` 키 |

## 다음 단계 아이디어

- [x] 보드 영속화 (SQLite — 서버 재시작해도 보드 유지)
- [ ] 방/권한 관리를 위한 백엔드 추가 (NestJS/Express + JWT)
- [ ] 마인드맵 자동 레이아웃, WBS 전용 노드 타입
- [ ] 실시간 커서/선택 영역 표시 (Yjs awareness 확장)
- [ ] 배포 (프론트: Vercel · 웹소켓 서버: Railway/Render/Fly.io)
