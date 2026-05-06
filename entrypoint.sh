#!/bin/bash
set -e

# Banner
cat << 'EOF'

$$$$$$$\                      $$\                                  $$$$$$\ $$$$$$$$\ $$\      $$\  $$$$$$\   $$$$$$\           $$$$$$\  $$\      $$\  $$$$$$\  $$\   $$\ $$$$$$$$\
$$  __$$\                     $$ |                                $$  __$$\\__$$  __|$$$\    $$$ |$$ ___$$\ $$  __$$\         $$  __$$\ $$$\    $$$ |$$  __$$\ $$ | $$  |$$  _____|
$$ |  $$ | $$$$$$\   $$$$$$$\ $$ |  $$\  $$$$$$\   $$$$$$\        $$ /  \__|  $$ |   $$$$\  $$$$ |\_/   $$ |\__/  $$ |        $$ /  \__|$$$$\  $$$$ |$$ /  $$ |$$ |$$  / $$ |
$$ |  $$ |$$  __$$\ $$  _____|$$ | $$  |$$  __$$\ $$  __$$\       \$$$$$$\    $$ |   $$\$$\$$ $$ |  $$$$$ /  $$$$$$  |$$$$$$\ $$ |      $$\$$\$$ $$ |$$$$$$$$ |$$$$$  /  $$$$$\
$$ |  $$ |$$ /  $$ |$$ /      $$$$$$  / $$$$$$$$ |$$ |  \__|       \____$$\   $$ |   $$ \$$$  $$ |  \___$$\ $$  ____/ \______|$$ |      $$ \$$$  $$ |$$  __$$ |$$  $$<   $$  __|
$$ |  $$ |$$ |  $$ |$$ |      $$  _$$<  $$   ____|$$ |            $$\   $$ |  $$ |   $$ |\$  /$$ |$$\   $$ |$$ |              $$ |  $$\ $$ |\$  /$$ |$$ |  $$ |$$ |\$$\  $$ |
$$$$$$$  |\$$$$$$  |\$$$$$$$\ $$ | \$$\ \$$$$$$$\ $$ |            \$$$$$$  |  $$ |   $$ | \_/ $$ |\$$$$$$  |$$$$$$$$\         \$$$$$$  |$$ | \_/ $$ |$$ |  $$ |$$ | \$$\ $$$$$$$$\
\_______/  \______/  \_______|\__|  \__| \_______|\__|             \______/   \__|   \__|     \__| \______/ \________|         \______/ \__|     \__|\__|  \__|\__|  \__|\________|

                                                                                          STMicroelectronics STM32CubeCLT for Docker
                                                                                                                  Creative by Uoohyo
                                                                                                           https://github.com/uoohyo

EOF

# Variables
CUBECLT_INSTALL_DIR="/opt/st/stm32cubeclt"

echo "=== STM32CubeCLT ${CUBECLT_VERSION} is ready ==="
echo ""
echo "Available tools:"

# Check and display available tools
if command -v arm-none-eabi-gcc &> /dev/null; then
    echo "  • ARM GCC: $(arm-none-eabi-gcc --version | head -1)"
else
    echo "  ✗ ARM GCC: not found"
fi

if command -v STM32_Programmer_CLI &> /dev/null; then
    echo "  • STM32CubeProgrammer CLI: $(STM32_Programmer_CLI --version 2>&1 | head -1 || echo 'installed')"
fi

if [ -d "${CUBECLT_INSTALL_DIR}/STM32CubeMX" ]; then
    echo "  • STM32CubeMX: installed"
fi

if command -v cmake &> /dev/null; then
    echo "  • CMake: $(cmake --version | head -1)"
fi

echo ""
echo "Environment:"
echo "  • Installation: ${CUBECLT_INSTALL_DIR}"
echo "  • Workspace: /workspace"
echo ""

# Run Command
exec "$@"
