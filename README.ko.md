# ccperm

모든 프로젝트의 Claude Code 권한을 한눈에 점검하는 CLI 도구.

[English](README.md)

Claude Code는 프로젝트마다 `.claude/settings*.json`에 허용한 권한(Bash 명령, WebFetch 도메인, MCP 도구 등)을 저장합니다. 여러 프로젝트를 오가다 보면 어디서 뭘 허용했는지 파악하기 어려운데, **ccperm**으로 전체 권한을 한번에 점검할 수 있습니다.

## 빠른 시작

```bash
npx ccperm --all
```

설치 없이 바로 실행됩니다. 글로벌 설치도 가능:

```bash
npm i -g ccperm
ccperm --all
```

## 사용법

```bash
npx ccperm              # 현재 프로젝트 권한 점검
npx ccperm --all        # 홈 디렉토리 아래 모든 프로젝트 점검
npx ccperm --fix        # deprecated 패턴 자동 수정
npx ccperm --all --fix  # 전체 점검 + 수정
```

## 출력 예시

```
━━━ Claude Code Permission Audit ━━━

Scope: ~ (all projects)
Scanned 12 files:

  ~/Documents/project-a/.claude/settings.local.json  (Bash: 5, WebFetch: 3, Tools: 1)
    Bash (5)
      npm run build *
      docker compose *
      curl *
      git add *
      ssh *
    WebFetch (3)
      github.com
      docs.anthropic.com
      api.example.com
    Tools (1)
      WebSearch

  ~/Documents/project-b/.claude/settings.local.json  (Bash: 2, MCP: 3)
    Bash (2)
      python3 *
      pytest *
    MCP (3)
      browseros__browser_navigate
      browseros__browser_click_element
      browseros__browser_get_screenshot

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
All clean! No deprecated :* patterns found.
```

## 옵션

| 플래그 | 설명 |
|--------|------|
| `--all` | 홈 디렉토리 아래 전체 프로젝트 스캔 |
| `--fix` | deprecated `:*` 패턴을 ` *`로 자동 수정 |
| `--help`, `-h` | 도움말 표시 |
| `--version`, `-v` | 버전 표시 |
| `--update` | 업데이트 확인 |

## Deprecated 패턴 수정

Claude Code가 이전에 "Allow always" 권한을 `:*`로 저장하는 버그가 있었습니다. 이로 인해 권한 팝업이 반복되는데, `--fix`로 자동 수정할 수 있습니다.

```
수정 전: Bash(npm run build:*)
수정 후: Bash(npm run build *)
```

## 요구사항

- Node.js >= 18
- macOS 또는 Linux

## 라이선스

MIT
