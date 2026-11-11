/**
 * 보드 문서(Yjs)·서버에서 온 주소를 화면에 쓰기 전에 검사한다.
 *
 * 공유 문서는 어떤 멤버든 직접 고칠 수 있어서, 화면 입력에서 막아도
 * 조작된 클라이언트가 `javascript:` 같은 주소를 넣을 수 있다. 그래서 "보여 줄 때" 다시 검사한다.
 */

const FILE_REF_PREFIX = 'fsafile:'

/** 링크(<a href>)로 열어도 되는 주소면 그대로, 아니면 undefined. http(s)·서버 파일 참조만 허용 */
export function safeLinkHref(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined
  const u = url.trim()
  if (u.startsWith(FILE_REF_PREFIX)) return u
  try {
    const parsed = new URL(u)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? u : undefined
  } catch {
    return undefined
  }
}

/** 내려받기 전용 링크(개인 파일): data:·blob: 주소만 허용 (HTML 형식 data URL 은 제외) */
export function safeDownloadHref(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined
  const u = url.trim()
  if (/^blob:/i.test(u)) return u
  if (/^data:/i.test(u) && !/^data:\s*(text\/html|application\/xhtml|image\/svg)/i.test(u)) return u
  return undefined
}

/** <img src> 로 써도 되는 주소: 서버 파일 참조, blob:, 래스터 이미지 data URL 만 (외부 주소는 추적에 쓰일 수 있어 막음) */
export function safeImageSrc(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined
  const u = url.trim()
  if (u.startsWith(FILE_REF_PREFIX)) return u
  if (/^blob:/i.test(u)) return u
  if (/^data:image\/(png|jpe?g|gif|webp);/i.test(u)) return u
  return undefined
}
