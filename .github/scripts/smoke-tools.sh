#!/usr/bin/env bash
# Run required tools directly; version text alone is not success.
set -euo pipefail
check_tool() {
    local tool=$1 output
    shift
    command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; return 1; }
    output=$("$tool" "$@" 2>&1) || { printf '%s\n' "$output" >&2; return 1; }
    [ -n "$output" ] || { echo "Empty output from $tool" >&2; return 1; }
    printf '%s: %s\n' "$tool" "$output"
}
check_tool arm-none-eabi-gcc --version
check_tool cmake --version
check_tool ninja --version
# --help does not connect to hardware or require a physical probe.
check_tool STM32_Programmer_CLI --help
