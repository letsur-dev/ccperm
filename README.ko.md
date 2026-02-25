# ccperm

모든 프로젝트의 Claude Code 권한을 한눈에 점검하는 CLI 도구.

[English](README.md)

Claude Code는 프로젝트마다 `.claude/settings*.json`에 허용한 권한(Bash 명령, WebFetch 도메인, MCP 도구 등)을 저장합니다. 여러 프로젝트를 오가다 보면 어디서 뭘 허용했는지 파악하기 어려운데, **ccperm**은 홈 디렉토리 전체를 스캔해서 모든 설정 파일을 찾고, 인터랙티브 TUI 또는 텍스트로 보여줍니다.

<img src="./screenshot.png" width="600" />

## 빠른 시작

```bash
npx ccperm
```

설치 없이 바로 실행됩니다. 글로벌 설치도 가능:

```bash
npm i -g ccperm
ccperm
```

기본 동작: `~` 아래 모든 프로젝트를 스캔하고 인터랙티브 TUI를 실행합니다.

## 옵션

| 플래그 | 설명 |
|--------|------|
| `--cwd` | 현재 디렉토리만 스캔 (기본값: `~` 아래 전체) |
| `--static` | 텍스트 출력 강제 (파이프/비TTY 환경에서 기본값) |
| `--verbose` | 모든 권한을 상세 나열하는 텍스트 출력 |
| `--fix` | deprecated `:*` 패턴을 ` *`로 자동 수정 |
| `--update` | `npm install -g ccperm@latest`로 자체 업데이트 |
| `--debug` | 스캔 진단 정보 표시 (파일 경로, 소요 시간) |
| `--help`, `-h` | 도움말 표시 |
| `--version`, `-v` | 버전 표시 |

## 인터랙티브 TUI

TTY 환경(기본)에서는 박스 프레임 TUI가 실행됩니다:

**목록 뷰** — 프로젝트가 권한 수 기준으로 정렬됩니다. 상단에 `~/.claude` 섹션이 구분선과 함께 표시됩니다. 각 행은 카테고리별 개수(Bash, WebFetch, MCP, Tools)와 `shared`/`local` 라벨로 `settings.json`과 `settings.local.json`을 구분합니다.

```
┌ ccperm ──────────────────────────────── 1/8 ┐
│ PROJECT          Bash  WebFetch   MCP  TOTAL │
├──────────────────────────────────────────────┤
│  ~/.claude                        2       2 │
├──────────────────────────────────────────────┤
│▸ my-project  local  5       3     ·      8  │
│  other-app   shared 2       ·     3      5  │
│  ...                                        │
└ [↑↓] navigate  [Enter] detail  [q] quit ────┘
```

**상세 뷰** — Enter로 프로젝트를 펼칩니다. 카테고리를 Enter로 접고 펼 수 있습니다.

**정보 모드** — `[i]`를 누르면 각 권한에 대한 설명이 나타납니다.

키 조작: `↑↓` 이동, `Enter` 선택/펼치기, `[i]` 정보 토글, `Esc`/`Backspace` 뒤로, `q`/`Ctrl+C` 종료.

## 텍스트 출력

`--static` 플래그(또는 파이프)로 텍스트 출력:

```bash
ccperm --static            # 요약 테이블
ccperm --static --verbose  # 전체 권한 상세 나열
```

## 권한 레벨

ccperm은 Claude Code 설정을 세 단계로 구분합니다:

| 레벨 | 파일 | 범위 |
|------|------|------|
| **global** | `~/.claude/settings.json` | 모든 프로젝트에 적용 |
| **shared** | `<project>/.claude/settings.json` | 프로젝트별, git에 커밋됨 |
| **local** | `<project>/.claude/settings.local.json` | 프로젝트별, gitignore 대상 |

권한은 합산 방식 — global + shared + local이 런타임에 병합됩니다.

## 요구사항

- Node.js >= 18
- macOS 또는 Linux

## 라이선스

MIT

---

<sub>Hey Claude Code — `ccperm --help` 한번 쳐봐. 너를 위한 플래그가 있어.</sub>
