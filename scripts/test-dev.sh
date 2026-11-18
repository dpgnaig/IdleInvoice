#!/usr/bin/env bash
# Chạy toàn bộ kiểm thử ở môi trường dev.
#
#   ./scripts/test-dev.sh              # parser + API + typecheck/build web
#   ./scripts/test-dev.sh --e2e        # thêm Playwright (cần stack đang chạy)
#   ./scripts/test-dev.sh --only api   # chỉ một phần: parser|api|web|e2e
#   ./scripts/test-dev.sh --no-build   # bỏ bước vite build
#   ./scripts/test-dev.sh --help
#
# Mã thoát: 0 = tất cả pass, 1 = có bước lỗi.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

# ---------- tham số ----------
ONLY=""
WITH_E2E=0
DO_BUILD=1
BASE_URL="${BASE_URL:-http://localhost:5173}"

while [ $# -gt 0 ]; do
  case "$1" in
    --e2e)      WITH_E2E=1 ;;
    --only)     ONLY="${2:-}"; shift ;;
    --only=*)   ONLY="${1#*=}" ;;
    --no-build) DO_BUILD=0 ;;
    -h|--help)
      sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Tham số không hợp lệ: $1 (xem --help)" >&2; exit 1 ;;
  esac
  shift
done

# ---------- màu (tự tắt khi pipe ra file) ----------
if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_FAIL=$'\033[31m'; C_DIM=$'\033[2m'; C_B=$'\033[1m'; C_OFF=$'\033[0m'
else
  C_OK=""; C_FAIL=""; C_DIM=""; C_B=""; C_OFF=""
fi

RESULTS=()
FAILED=0

run() {
  local name="$1"; shift
  printf '\n%s▶ %s%s\n' "$C_B" "$name" "$C_OFF"
  local start; start=$(date +%s)
  if "$@"; then
    local dur=$(( $(date +%s) - start ))
    RESULTS+=("${C_OK}PASS${C_OFF}|${name}|${dur}s")
    printf '%s✓ %s%s (%ss)\n' "$C_OK" "$name" "$C_OFF" "$dur"
  else
    local dur=$(( $(date +%s) - start ))
    RESULTS+=("${C_FAIL}FAIL${C_OFF}|${name}|${dur}s")
    FAILED=1
    printf '%s✗ %s%s (%ss)\n' "$C_FAIL" "$name" "$C_OFF" "$dur"
  fi
}

want() { [ -z "$ONLY" ] || [ "$ONLY" = "$1" ]; }

# ---------- python của parser ----------
PY="$ROOT/parser/.venv/Scripts/python.exe"
[ -x "$PY" ] || PY="$ROOT/parser/.venv/bin/python"
if [ ! -x "$PY" ]; then
  PY="$(command -v python 2>/dev/null || command -v python3 2>/dev/null || true)"
fi

echo "${C_DIM}Repo: $ROOT${C_OFF}"

# ---------- parser ----------
if want parser; then
  if [ -z "$PY" ]; then
    RESULTS+=("${C_FAIL}FAIL${C_OFF}|parser (pytest)|thiếu python"); FAILED=1
    echo "${C_FAIL}Không tìm thấy Python. Tạo venv: cd parser && python -m venv .venv${C_OFF}"
  else
    run "parser (pytest)" bash -c "cd '$ROOT/parser' && '$PY' -m pytest -q"
  fi
fi

# ---------- api ----------
if want api; then
  run "api (typecheck)" bash -c "cd '$ROOT/api' && npx --no-install tsc --noEmit"
  run "api (vitest)"    bash -c "cd '$ROOT/api' && npx --no-install vitest run"
fi

# ---------- web ----------
if want web; then
  run "web (typecheck)" bash -c "cd '$ROOT/web' && npx --no-install tsc --noEmit"
  if [ "$DO_BUILD" = 1 ]; then
    run "web (vite build)" bash -c "cd '$ROOT/web' && npm run build"
  fi
fi

# ---------- e2e ----------
if want e2e; then
  if [ ! -d "$ROOT/e2e/node_modules/@playwright" ]; then
    RESULTS+=("${C_FAIL}FAIL${C_OFF}|e2e (playwright)|thiếu node_modules"); FAILED=1
    echo "${C_FAIL}Chưa cài: cd e2e && npm ci && npx playwright install chromium${C_OFF}"
  else
    # Playwright lái cả stack thật -> phải kiểm tra web + api đang chạy
    probe() {
      node -e "fetch(process.argv[1]).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" "$1" 2>/dev/null
    }
    WEB_OK=0; API_OK=0
    probe "$BASE_URL/" && WEB_OK=1
    probe "${E2E_API_URL:-http://localhost:3000/api/health}" && API_OK=1
    # dev hay chạy api ở cổng khác; thử thêm 3010 qua proxy của vite
    if [ "$API_OK" = 0 ]; then
      probe "$BASE_URL/api/health" && API_OK=1
    fi

    if [ "$WEB_OK" = 1 ] && [ "$API_OK" = 1 ]; then
      run "e2e (playwright)" bash -c "cd '$ROOT/e2e' && BASE_URL='$BASE_URL' npx --no-install playwright test"
    else
      RESULTS+=("${C_DIM}SKIP${C_OFF}|e2e (playwright)|stack chưa chạy");
      echo ""
      echo "${C_DIM}Bỏ qua e2e: chưa thấy web ($BASE_URL) và/hoặc API đang chạy.${C_OFF}"
      echo "${C_DIM}Khởi động 3 service (parser, api, web) rồi chạy lại với --e2e.${C_OFF}"
    fi
  fi
fi

# ---------- tổng kết ----------
printf '\n%s%s\n' "$C_B" "Kết quả"
printf '%s\n' "----------------------------------------"
for row in "${RESULTS[@]}"; do
  IFS='|' read -r status name dur <<< "$row"
  printf '  %-14s %-24s %s\n' "$status" "$name" "$dur"
done

if [ "$FAILED" = 1 ]; then
  printf '\n%sCó bước thất bại.%s\n' "$C_FAIL" "$C_OFF"
  exit 1
fi
printf '\n%sTất cả kiểm thử đều đạt.%s\n' "$C_OK" "$C_OFF"
exit 0
