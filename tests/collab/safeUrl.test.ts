import { describe, expect, it } from 'vitest'
import { safeDownloadHref, safeImageSrc, safeLinkHref } from '../../src/collab/safeUrl'

describe('safeLinkHref (첨부 링크)', () => {
  it('http(s)·서버 파일 참조는 그대로', () => {
    expect(safeLinkHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(safeLinkHref('http://example.com')).toBe('http://example.com')
    expect(safeLinkHref('fsafile:room-1/abc')).toBe('fsafile:room-1/abc')
  })
  it('스크립트·data·잘못된 주소는 막는다', () => {
    for (const u of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<b>x', 'vbscript:x', 'not a url', 42, null]) {
      expect(safeLinkHref(u)).toBeUndefined()
    }
  })
})

describe('safeImageSrc (사진 노드)', () => {
  it('서버 파일·blob·래스터 data URL 만 허용', () => {
    expect(safeImageSrc('fsafile:r/x')).toBe('fsafile:r/x')
    expect(safeImageSrc('blob:http://localhost/1')).toBe('blob:http://localhost/1')
    expect(safeImageSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    expect(safeImageSrc('data:image/jpeg;base64,AAAA')).toBe('data:image/jpeg;base64,AAAA')
  })
  it('외부 주소·SVG·스크립트는 막는다', () => {
    for (const u of ['https://tracker.example/p.gif', 'data:image/svg+xml;base64,AAAA', 'javascript:alert(1)', undefined]) {
      expect(safeImageSrc(u)).toBeUndefined()
    }
  })
})

describe('safeDownloadHref (개인 파일)', () => {
  it('data·blob 은 허용하되 HTML·SVG data URL 과 스크립트는 막는다', () => {
    expect(safeDownloadHref('data:application/pdf;base64,AAAA')).toBe('data:application/pdf;base64,AAAA')
    expect(safeDownloadHref('blob:http://localhost/1')).toBe('blob:http://localhost/1')
    for (const u of ['data:text/html,<script>1</script>', 'data:image/svg+xml,<svg/>', 'javascript:alert(1)', 'https://x.example']) {
      expect(safeDownloadHref(u)).toBeUndefined()
    }
  })
})
