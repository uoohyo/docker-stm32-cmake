# ============================================
# Stage 1: Extract pre-downloaded STM32CubeCLT
# ============================================
# The installer zip is downloaded in GitHub Actions (download-cubeclt.js)
# before this build runs — no credentials needed inside Docker.
FROM ubuntu:22.04 AS extractor

# Set shell with pipefail for safer RUN commands
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# STM32CubeCLT Version (can be overridden at build time)
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
# Stage 2: Runtime Image
# ============================================
FROM ubuntu:22.04

# Set shell with pipefail for safer RUN commands
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Metadata
LABEL maintainer="uoohyo <https://github.com/uoohyo>"
LABEL description="STM32 Cmake Project for Docker with downloaded installer"

# STM32CubeCLT Version
ARG CUBECLT_VERSION=1.21.0
ENV CUBECLT_VERSION=${CUBECLT_VERSION}

# System Dependencies for STM32 development
RUN echo ">>> Installing system dependencies..." && \
    dpkg --add-architecture i386 && \
    apt-get update && \
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
    # ARM GCC dependencies
    libc6:i386 \
    libncurses5:i386 \
    libstdc++6:i386 \
    # STM32CubeCLT dependencies
    default-jre-headless \
    libxml2 \
    # Utilities
    ca-certificates \
    curl \
    unzip \
    file && \
    apt-get clean && rm -rf /var/lib/apt/lists/* && \
    echo ">>> Done."

# Copy extracted STM32CubeCLT from downloader stage
COPY --from=extractor /cubeclt_installer /opt/cubeclt-installer

# Install STM32CubeCLT
RUN echo ">>> Installing STM32CubeCLT ${CUBECLT_VERSION}..." && \
    mkdir -p /opt/st/stm32cubeclt && \
    (cd /opt/cubeclt-installer && \
    INSTALLER=$(find . -maxdepth 2 -name "*.sh" -o -name "*.run" | head -1) && \
    if [ -n "$INSTALLER" ]; then \
        echo ">>> Found installer: $INSTALLER"; \
        chmod +x "$INSTALLER"; \
        EXTRACT_DIR="/tmp/stm32cubeclt-extract"; \
        mkdir -p "$EXTRACT_DIR"; \
        "$INSTALLER" --target "$EXTRACT_DIR" --noexec && \
        echo ">>> Extraction complete, copying files..."; \
        if [ -d "$EXTRACT_DIR/STM32CubeCLT" ]; then \
            cp -r "$EXTRACT_DIR/STM32CubeCLT"/* /opt/st/stm32cubeclt/; \
        elif [ -d "$EXTRACT_DIR" ] && [ "$(ls -A "$EXTRACT_DIR")" ]; then \
            cp -r "$EXTRACT_DIR"/* /opt/st/stm32cubeclt/; \
        fi; \
        rm -rf "$EXTRACT_DIR"; \
    elif [ -d "STM32CubeCLT" ]; then \
        echo ">>> Found extracted directory, copying..."; \
        cp -r STM32CubeCLT/* /opt/st/stm32cubeclt/; \
    else \
        echo ">>> Copying all installer files..."; \
        cp -r ./* /opt/st/stm32cubeclt/; \
    fi) && \
    rm -rf /opt/cubeclt-installer && \
    echo ">>> Verifying installation..." && \
    ([ -d "/opt/st/stm32cubeclt/GNU-tools-for-STM32" ] && echo "  ✓ GNU ARM Toolchain found" || echo "  ⚠ GNU ARM Toolchain not found") && \
    ([ -d "/opt/st/stm32cubeclt/STM32CubeProgrammer" ] && echo "  ✓ STM32CubeProgrammer found" || echo "  ⚠ STM32CubeProgrammer not found") && \
    echo ">>> Installation complete"

# Working Directory
WORKDIR /workspace

# Set up PATH for STM32CubeCLT tools
ENV PATH="/opt/st/stm32cubeclt/STM32CubeProgrammer/bin:${PATH}"
ENV PATH="/opt/st/stm32cubeclt/STM32CubeMX:${PATH}"
ENV PATH="/opt/st/stm32cubeclt/GNU-tools-for-STM32/bin:${PATH}"

# Entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r//' /entrypoint.sh && chmod 755 /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["bash"]
