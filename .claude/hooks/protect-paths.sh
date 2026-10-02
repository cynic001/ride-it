#!/bin/bash
# Edit/Write 대상이 보호 폴더면 차단(exit 2 → 사유가 Claude에게 전달됨)
f=$(jq -r '.tool_input.file_path // empty')
[ -e "$f" ] || exit 0 # 새 파일 추가는 허용
case "$f" in
  */blender/*|*/assets/vendor/*|*/assets/models/legacy/*)
    echo "보호된 경로입니다: $f (blender/, assets/vendor/, assets/models/legacy/ 는 Edit/Write 금지 — 필요하면 사용자에게 먼저 물어보세요)" >&2
    exit 2;;
esac
exit 0
