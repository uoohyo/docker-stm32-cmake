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
INSTALL_LOG="/tmp/cubeclt_install.log"

echo "=== STM32CubeCLT Installation ==="
echo "Version    : ${CUBECLT_VERSION}"
echo ""

# Check if already installed
if [ -d "${CUBECLT_INSTALL_DIR}" ] && [ -f "${CUBECLT_INSTALL_DIR}/.installed" ]; then
    echo ">>> STM32CubeCLT ${CUBECLT_VERSION} is already installed."
    echo ""
else
    echo ">>> Installing STM32CubeCLT ${CUBECLT_VERSION} (this may take a while)..."

    # Create installation directory
    mkdir -p "${CUBECLT_INSTALL_DIR}"
    cd /opt/cubeclt-installer

    # Find the installer script or executable
    # STM32CubeCLT typically comes with a .sh installer or extracted files
    if [ -f "st-stm32cubeclt.sh" ]; then
        # If there's a shell installer, run it
        echo ">>> Running STM32CubeCLT installer..."
        chmod +x st-stm32cubeclt.sh
        ./st-stm32cubeclt.sh --mode unattended --prefix /opt/st 2>&1 | tee "${INSTALL_LOG}"
    elif [ -d "STM32CubeCLT" ]; then
        # If already extracted, just copy to installation directory
        echo ">>> Copying STM32CubeCLT files..."
        cp -r STM32CubeCLT/* "${CUBECLT_INSTALL_DIR}/"
    else
        # Try to find any installer or directory
        INSTALLER=$(find . -maxdepth 2 -name "*.sh" -o -name "*.run" | head -1)
        if [ -n "$INSTALLER" ]; then
            echo ">>> Running installer: $INSTALLER"
            chmod +x "$INSTALLER"
            "$INSTALLER" --mode unattended --prefix /opt/st 2>&1 | tee "${INSTALL_LOG}"
        else
            # Last resort: copy everything
            echo ">>> Copying all files to ${CUBECLT_INSTALL_DIR}..."
            cp -r . "${CUBECLT_INSTALL_DIR}/"
        fi
    fi

    # Verify installation by checking for key components
    echo ">>> Verifying STM32CubeCLT installation..."
    VERIFIED=false

    # Check for STM32CubeProgrammer
    if [ -d "${CUBECLT_INSTALL_DIR}/STM32CubeProgrammer" ]; then
        echo "  ✓ STM32CubeProgrammer found"
        VERIFIED=true
    fi

    # Check for STM32CubeMX
    if [ -d "${CUBECLT_INSTALL_DIR}/STM32CubeMX" ] || [ -f "${CUBECLT_INSTALL_DIR}/STM32CubeMX.exe" ]; then
        echo "  ✓ STM32CubeMX found"
        VERIFIED=true
    fi

    # Check for GNU ARM toolchain
    if [ -d "${CUBECLT_INSTALL_DIR}/GNU-tools-for-STM32" ]; then
        echo "  ✓ GNU ARM Toolchain found"
        VERIFIED=true

        # Add ARM GCC to PATH
        export PATH="${CUBECLT_INSTALL_DIR}/GNU-tools-for-STM32/bin:${PATH}"
    fi

    if [ "$VERIFIED" = false ]; then
        echo "[WARNING] Could not verify all STM32CubeCLT components"
        echo "Installation directory contents:"
        ls -la "${CUBECLT_INSTALL_DIR}"
    fi

    # Mark as installed
    echo "${CUBECLT_VERSION}" > "${CUBECLT_INSTALL_DIR}/.installed"

    echo ">>> STM32CubeCLT ${CUBECLT_VERSION} installation complete."
fi

# Update PATH for all tools
export PATH="${CUBECLT_INSTALL_DIR}/STM32CubeProgrammer/bin:${PATH}"
export PATH="${CUBECLT_INSTALL_DIR}/STM32CubeMX:${PATH}"
export PATH="${CUBECLT_INSTALL_DIR}/GNU-tools-for-STM32/bin:${PATH}"

# Cleanup installer files
echo ">>> Cleaning up..."
rm -rf /opt/cubeclt-installer

echo ""
echo "=== STM32CubeCLT ${CUBECLT_VERSION} is ready. ==="
echo ""
echo "Available tools:"

# Check and display available tools
if command -v arm-none-eabi-gcc &> /dev/null; then
    echo "  • ARM GCC: $(arm-none-eabi-gcc --version | head -1)"
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
