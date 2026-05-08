# ============================================
# Stage 1: Extract pre-downloaded STM32CubeCLT
# ============================================
# The installer zip is downloaded in GitHub Actions (download-cubeclt.js)
# before this build runs — no credentials needed inside Docker.
FROM ubuntu:24.04 AS extractor

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG CUBECLT_VERSION=1.21.0

# Install unzip utility
RUN apt-get update && \
    apt-get install -y --no-install-recommends unzip ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy pre-downloaded installer from GitHub Actions
# The installer is downloaded by .github/scripts/download-cubeclt.js
COPY cubeclt_download/*.zip /tmp/installer.zip

# Extract STM32CubeCLT
RUN echo ">>> Extracting STM32CubeCLT ${CUBECLT_VERSION}..." && \
    mkdir -p /cubeclt_installer && \
    unzip -q /tmp/installer.zip -d /cubeclt_installer && \
    echo ">>> Extraction complete" && \
    ls -la /cubeclt_installer/ && \
    rm -f /tmp/installer.zip

# ============================================
# Stage 2: Runtime Image - Ubuntu 24.04 LTS
# ============================================
# OPTIMIZATION NOTES:
# - Removed i386 architecture (STM32CubeCLT 1.16.0+ uses 64-bit binaries)
# - Removed libncurses5:i386 (not required by arm-none-eabi-gdb)
# - Removed libc6:i386, libstdc++6:i386 (64-bit versions already included)
# - Added apt-get upgrade for security patches (~2,000 CVE reduction)
# - Added security hardening (setuid removal, non-root user, package manager removal)
FROM ubuntu:24.04

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

LABEL maintainer="uoohyo <https://github.com/uoohyo>"
LABEL description="STM32 Cmake Project for Docker - Ubuntu 24.04 LTS with Security Hardening"
LABEL version="2.0"

ARG CUBECLT_VERSION=1.21.0
ENV CUBECLT_VERSION=${CUBECLT_VERSION}

# ============================================
# SECURITY: Apply system updates
# Removes ~2,000+ kernel and library CVEs
# ============================================
# System Dependencies for STM32 development
RUN echo ">>> Installing system dependencies with security updates..." && \
    apt-get update && \
    apt-get upgrade -y && \
    apt-get install --no-install-recommends -y \
    # Core build tools
    build-essential \
    cmake \
    ninja-build \
    git \
    # USB and device support
    libusb-1.0-0 \
    libusb-1.0-0-dev \
    udev \
    # STM32CubeCLT dependencies
    default-jre-headless \
    libxml2 \
    # Utilities
    ca-certificates \
    curl && \
    apt-get clean && rm -rf /var/lib/apt/lists/* && \
    echo ">>> Done."

# Copy extracted STM32CubeCLT from extractor stage
COPY --from=extractor /cubeclt_installer /opt/cubeclt-installer

# Install STM32CubeCLT
RUN echo ">>> Installing STM32CubeCLT ${CUBECLT_VERSION}..." && \
    cd /opt/cubeclt-installer && \
    INSTALLER=$(find . -maxdepth 2 -name "*.sh" -o -name "*.run" | head -1) && \
    if [ -z "$INSTALLER" ]; then \
        echo "ERROR: No installer found"; \
        exit 1; \
    fi && \
    echo ">>> Found installer: $INSTALLER" && \
    chmod +x "$INSTALLER" && \
    echo ">>> Running installer with LICENSE_ALREADY_ACCEPTED=1..." && \
    echo "" | LICENSE_ALREADY_ACCEPTED=1 "$INSTALLER" && \
    echo ">>> Checking installation locations..." && \
    find /opt -type d -name "*stm32cubeclt*" -o -name "*STM32CubeCLT*" 2>/dev/null && \
    echo ">>> Finding actual installation..." && \
    INSTALL_DIR=$(find /opt -type d \( -name "*stm32cubeclt*" -o -name "*STM32CubeCLT*" \) 2>/dev/null | grep -v "cubeclt-installer" | head -1) && \
    if [ -z "$INSTALL_DIR" ] || [ ! -d "$INSTALL_DIR" ]; then \
        echo "ERROR: Installation directory not found after running installer"; \
        exit 1; \
    fi && \
    echo ">>> Found installation at: $INSTALL_DIR" && \
    mkdir -p /opt/st/stm32cubeclt && \
    cp -r "$INSTALL_DIR"/* /opt/st/stm32cubeclt/ && \
    cd / && \
    rm -rf /opt/cubeclt-installer && \
    echo ">>> Verifying installation..." && \
    if [ ! -d "/opt/st/stm32cubeclt/GNU-tools-for-STM32" ]; then \
        echo "ERROR: GNU ARM Toolchain not found after installation"; \
        exit 1; \
    fi && \
    echo "  ✓ GNU ARM Toolchain found" && \
    if [ ! -d "/opt/st/stm32cubeclt/STM32CubeProgrammer" ]; then \
        echo "ERROR: STM32CubeProgrammer not found after installation"; \
        exit 1; \
    fi && \
    echo "  ✓ STM32CubeProgrammer found" && \
    echo ">>> Installation complete"

# ============================================
# SECURITY & SIZE: Cleanup unnecessary files
# ============================================
RUN echo ">>> Cleaning up unnecessary files..." && \
    find /opt/st/stm32cubeclt -type d -iname "documentation" -exec rm -rf {} + 2>/dev/null || true && \
    find /opt/st/stm32cubeclt -type d -iname "doc" -exec rm -rf {} + 2>/dev/null || true && \
    find /opt/st/stm32cubeclt -type d -iname "docs" -exec rm -rf {} + 2>/dev/null || true && \
    find /opt/st/stm32cubeclt -type d -iname "examples" -exec rm -rf {} + 2>/dev/null || true && \
    find /opt/st/stm32cubeclt -type d -iname "samples" -exec rm -rf {} + 2>/dev/null || true && \
    find /opt/st/stm32cubeclt -type d -iname "uninstaller" -exec rm -rf {} + 2>/dev/null || true && \
    rm -rf /opt/st/stm32cubeclt/*/share/doc 2>/dev/null || true && \
    rm -rf /opt/st/stm32cubeclt/*/share/man 2>/dev/null || true && \
    rm -rf /opt/st/stm32cubeclt/*/share/info 2>/dev/null || true && \
    find /opt/st/stm32cubeclt -type f \( -name "*.pdf" -o -name "*.txt" -o -name "*.md" -o -name "*.html" \) -delete 2>/dev/null || true && \
    find /opt/st/stm32cubeclt -type f -name "*.exe" -delete 2>/dev/null || true && \
    find /opt/st/stm32cubeclt -type f -name "*.msi" -delete 2>/dev/null || true && \
    find /opt/st/stm32cubeclt -type f -name "*.dmg" -delete 2>/dev/null || true && \
    echo ">>> Cleanup complete"

# ============================================
# SECURITY: Remove setuid/setgid binaries
# Prevents privilege escalation attacks
# ============================================
RUN echo ">>> Removing setuid/setgid bits from binaries..." && \
    find / -perm /6000 -type f -exec chmod a-s {} \; 2>/dev/null || true && \
    echo ">>> Attack surface reduced"

# ============================================
# SECURITY: Create non-root user
# Docker Scout policy: Default non-root user
# ============================================
RUN echo ">>> Creating non-root user..." && \
    groupadd -r stm32user && \
    useradd -r -g stm32user -G plugdev stm32user && \
    mkdir -p /home/stm32user /workspace && \
    chown -R stm32user:stm32user /home/stm32user /workspace && \
    echo ">>> Non-root user created"

# ============================================
# SECURITY: Remove package metadata and caches
# Without package lists, apt cannot install anything
# ============================================
RUN echo ">>> Creating package inventory and removing package metadata..." && \
    dpkg --get-selections | awk '{print $1}' > /opt/installed-packages.txt && \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/* /var/lib/dpkg/info/* && \
    echo ">>> Package metadata removed (inventory saved to /opt/installed-packages.txt)"

# Working Directory
WORKDIR /workspace

# Set up PATH for STM32CubeCLT tools
ENV PATH="/opt/st/stm32cubeclt/STM32CubeProgrammer/bin:${PATH}"
ENV PATH="/opt/st/stm32cubeclt/STM32CubeMX:${PATH}"
ENV PATH="/opt/st/stm32cubeclt/GNU-tools-for-STM32/bin:${PATH}"

# Entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r//' /entrypoint.sh && chmod 755 /entrypoint.sh

# ============================================
# SECURITY: Run as non-root user
# NOTE: USB programming requires --user root or --privileged
# ============================================
USER stm32user

ENTRYPOINT ["/entrypoint.sh"]
CMD ["bash"]
