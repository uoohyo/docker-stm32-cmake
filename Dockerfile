# ============================================
# Stage 1: Extract pre-downloaded STM32CubeCLT
# ============================================
# The installer zip is downloaded in GitHub Actions (download-cubeclt.js)
# before this build runs — no credentials needed inside Docker.
FROM ubuntu:24.04 AS extractor

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG CUBECLT_VERSION=1.21.0

RUN apt-get update && \
    apt-get install -y --no-install-recommends unzip ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY cubeclt_download/*.zip /tmp/installer.zip

RUN echo ">>> Extracting STM32CubeCLT ${CUBECLT_VERSION}..." && \
    mkdir -p /cubeclt_installer && \
    unzip -q /tmp/installer.zip -d /cubeclt_installer && \
    rm -f /tmp/installer.zip && \
    echo ">>> Extraction complete"

# ============================================
# Stage 2: Runtime Image - Ubuntu 24.04 LTS
# ============================================
FROM ubuntu:24.04

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG CUBECLT_VERSION=1.21.0
ENV CUBECLT_VERSION=${CUBECLT_VERSION}

LABEL maintainer="uoohyo <https://github.com/uoohyo>"
LABEL description="STM32CubeCLT development toolchain for Docker (CMake, ARM GCC, STM32CubeProgrammer)"
LABEL version="${CUBECLT_VERSION}"
LABEL org.opencontainers.image.source="https://github.com/uoohyo/docker-stm32-cmake"
LABEL org.opencontainers.image.licenses="MIT"

# System dependencies
# - libusb-1.0-0: runtime only (not -dev, headers not needed at runtime)
# - udev omitted: device manager has no function inside a container
# - default-jre-headless: required by STM32CubeMX
RUN echo ">>> Installing system dependencies..." && \
    apt-get update && \
    apt-get upgrade -y && \
    apt-get install --no-install-recommends -y \
        build-essential \
        cmake \
        ninja-build \
        git \
        libusb-1.0-0 \
        default-jre-headless \
        libxml2 \
        ca-certificates \
        curl && \
    apt-get clean && rm -rf /var/lib/apt/lists/* && \
    echo ">>> Done."

# Copy extracted STM32CubeCLT from extractor stage
COPY --from=extractor /cubeclt_installer /opt/cubeclt-installer

# Install STM32CubeCLT, clean up docs/unused files, remove setuid bits,
# and create non-root user — all in one layer so deletions actually reduce size.
RUN echo ">>> Installing STM32CubeCLT ${CUBECLT_VERSION}..." && \
    cd /opt/cubeclt-installer && \
    INSTALLER=$(find . -maxdepth 2 \( -name "*.sh" -o -name "*.run" \) | head -1) && \
    [ -n "$INSTALLER" ] || { echo "ERROR: No installer found"; exit 1; } && \
    chmod +x "$INSTALLER" && \
    echo "" | LICENSE_ALREADY_ACCEPTED=1 "$INSTALLER" && \
    INSTALL_DIR=$(find /opt -type d \( -name "*stm32cubeclt*" -o -name "*STM32CubeCLT*" \) 2>/dev/null \
        | grep -v "cubeclt-installer" | head -1) && \
    [ -n "$INSTALL_DIR" ] || { echo "ERROR: Installation directory not found"; exit 1; } && \
    TARGET_DIR="/opt/st/stm32cubeclt" && \
    if [ "$INSTALL_DIR" != "$TARGET_DIR" ]; then \
        mkdir -p /opt/st && mv "$INSTALL_DIR" "$TARGET_DIR"; \
    fi && \
    rm -rf /opt/cubeclt-installer && \
    # Verify
    [ -d "/opt/st/stm32cubeclt/GNU-tools-for-STM32" ] || \
        { echo "ERROR: GNU ARM Toolchain not found"; exit 1; } && \
    echo "  ✓ GNU ARM Toolchain found" && \
    [ -d "/opt/st/stm32cubeclt/STM32CubeProgrammer" ] || \
        { echo "ERROR: STM32CubeProgrammer not found"; exit 1; } && \
    echo "  ✓ STM32CubeProgrammer found" && \
    # Remove documentation, examples, and Windows/macOS-only binaries
    # (must be in the same RUN layer to actually reduce image size)
    find /opt/st/stm32cubeclt -type d \
        \( -iname "documentation" -o -iname "doc" -o -iname "docs" \
           -o -iname "examples" -o -iname "samples" -o -iname "uninstaller" \) \
        -exec rm -rf {} + 2>/dev/null || true && \
    find /opt/st/stm32cubeclt -type f \
        \( -name "*.pdf" -o -name "*.txt" -o -name "*.md" -o -name "*.html" \
           -o -name "*.exe" -o -name "*.msi" -o -name "*.dmg" \) \
        -delete 2>/dev/null || true && \
    rm -rf /opt/st/stm32cubeclt/*/share/doc \
           /opt/st/stm32cubeclt/*/share/man \
           /opt/st/stm32cubeclt/*/share/info 2>/dev/null || true && \
    # Remove setuid/setgid bits from system binaries (privilege escalation hardening)
    find /usr /bin /sbin -perm /6000 -type f -exec chmod a-s {} \; 2>/dev/null || true && \
    # Create non-root user for default container execution
    groupadd -r stm32user && \
    useradd -r -g stm32user stm32user && \
    mkdir -p /home/stm32user /workspace && \
    chown -R stm32user:stm32user /home/stm32user /workspace && \
    echo ">>> Installation complete"

WORKDIR /workspace

# Combine all PATH additions into a single ENV instruction (one layer)
ENV PATH="/opt/st/stm32cubeclt/GNU-tools-for-STM32/bin:/opt/st/stm32cubeclt/STM32CubeProgrammer/bin:/opt/st/stm32cubeclt/STM32CubeMX:${PATH}"

COPY entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh

# Run as non-root by default
# For USB programming use: docker run --user root --privileged
USER stm32user

ENTRYPOINT ["/entrypoint.sh"]
CMD ["bash"]
