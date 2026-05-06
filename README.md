# docker-stm32-cmake

[![Build](https://img.shields.io/github/actions/workflow/status/uoohyo/docker-stm32-cmake/build-all-versions.yml?branch=main&style=flat-square&logo=github-actions&label=build)](https://github.com/uoohyo/docker-stm32-cmake/actions/workflows/build-all-versions.yml)
[![Docker Pulls](https://img.shields.io/docker/pulls/uoohyo/stm32cubeclt?style=flat-square&logo=docker)](https://hub.docker.com/r/uoohyo/stm32cubeclt)
[![Docker Image Size](https://img.shields.io/docker/image-size/uoohyo/stm32cubeclt/latest?style=flat-square&logo=docker)](https://hub.docker.com/r/uoohyo/stm32cubeclt)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

<!-- markdownlint-disable MD033 -->
<table>
  <tr>
    <td><img src="./.github/docker-stm32-cmake.jpg" width="256" height="256" alt="docker-stm32-cmake" /></td>
    <td valign="top">
      <b>STM32CubeCLT Version Build Status</b>
      <table>
        <tr><th>Version</th><th>Status</th></tr>
<!-- VERSION_TABLE_START -->
<!-- VERSION_TABLE_END -->
        <tr><td colspan="2" align="center"><a href="docs/versions.md"><b>📋 See all versions →</b></a></td></tr>
      </table>
    </td>
  </tr>
</table>
<!-- markdownlint-enable MD033 -->

A Docker image providing a headless CI/CD environment for [STM32CubeCLT](https://www.st.com/en/development-tools/stm32cubeclt.html) (STMicroelectronics Command Line Tools). This image includes STM32CubeMX, STM32CubeProgrammer, and GNU ARM Embedded Toolchain, perfect for automated STM32 firmware builds and programming.

> **Note:** The installer is downloaded from ST's website during the Docker build process using authenticated download. An ST account is required.

## Features

- 🚀 **Fully automated** - No manual downloads required
- 🔐 **Secure authentication** - Uses GitHub Secrets for ST account credentials
- 🛠️ **Complete toolchain** - Includes STM32CubeMX, STM32CubeProgrammer, and ARM GCC
- 📦 **Ready for CI/CD** - Optimized for GitHub Actions and other CI systems
- 🐳 **Multi-stage build** - Efficient Docker image size

## Quick Start

### Prerequisites

You need an ST account (free registration at [my.st.com](https://my.st.com)).

### Pull from Docker Hub

```bash
docker pull uoohyo/stm32cubeclt:latest
```

Or use a specific version:

```bash
docker pull uoohyo/stm32cubeclt:1.16.0
```

### Run the Container

```bash
docker run -it -v $(pwd):/workspace uoohyo/stm32cubeclt:latest
```

This mounts your current directory to `/workspace` in the container, where you can access your STM32 projects.

## Building Locally

### Required GitHub Secrets

To build this image, you need to set up the following GitHub repository secrets:

- `ST_USERNAME` - Your ST account email
- `ST_PASSWORD` - Your ST account password
- `DOCKERHUB_USERNAME` - (Optional) Your Docker Hub username for pushing images
- `DOCKERHUB_TOKEN` - (Optional) Your Docker Hub access token

### Build with Docker

```bash
docker build \
  --build-arg ST_USERNAME="your-email@example.com" \
  --build-arg ST_PASSWORD="your-password" \
  --build-arg CUBECLT_VERSION="1.16.0" \
  -t stm32cubeclt:local .
```

### Build with GitHub Actions

The repository includes a GitHub Actions workflow that automatically builds and pushes the image:

1. Fork this repository
2. Add `ST_USERNAME` and `ST_PASSWORD` to your repository secrets
3. Push to `main` branch or manually trigger the workflow
4. The image will be built and optionally pushed to Docker Hub

## Usage Examples

### Build an STM32 Project with CMake

```bash
docker run -it -v $(pwd):/workspace uoohyo/stm32cubeclt:latest bash -c "
  cd /workspace/your-stm32-project
  mkdir -p build && cd build
  cmake .. -G Ninja
  ninja
"
```

### Generate Code with STM32CubeMX

```bash
docker run -it -v $(pwd):/workspace uoohyo/stm32cubeclt:latest bash -c "
  STM32CubeMX -q your-project.ioc
"
```

### Program STM32 Device

```bash
docker run -it --privileged -v /dev/bus/usb:/dev/bus/usb \
  -v $(pwd):/workspace uoohyo/stm32cubeclt:latest bash -c "
  STM32_Programmer_CLI -c port=SWD -w /workspace/firmware.hex -v -rst
"
```

### Compile with ARM GCC

```bash
docker run -it -v $(pwd):/workspace uoohyo/stm32cubeclt:latest bash -c "
  arm-none-eabi-gcc --version
  cd /workspace
  make
"
```

## Included Tools

The Docker image includes the following tools from STM32CubeCLT:

| Tool                    | Description                          | Path                                       |
| ----------------------- | ------------------------------------ | ------------------------------------------ |
| **STM32CubeMX**         | STM32 initialization code generator  | `/opt/st/stm32cubeclt/STM32CubeMX`         |
| **STM32CubeProgrammer** | STM32 programming and debugging tool | `/opt/st/stm32cubeclt/STM32CubeProgrammer` |
| **GNU ARM Toolchain**   | GCC compiler for ARM Cortex-M        | `/opt/st/stm32cubeclt/GNU-tools-for-STM32` |

Additional tools:

- CMake
- Ninja build system
- Git

## Environment Variables

| Variable          | Description                     | Default  |
| ----------------- | ------------------------------- | -------- |
| `CUBECLT_VERSION` | STM32CubeCLT version to install | `1.16.0` |

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Build STM32 Firmware

on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    container:
      image: uoohyo/stm32cubeclt:latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Build firmware
        run: |
          mkdir -p build && cd build
          cmake .. -G Ninja
          ninja
      
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: firmware
          path: build/*.hex
```

### GitLab CI Example

```yaml
build:
  image: uoohyo/stm32cubeclt:latest
  script:
    - mkdir -p build && cd build
    - cmake .. -G Ninja
    - ninja
  artifacts:
    paths:
      - build/*.hex
```

## Version Support

| STM32CubeCLT Version | Docker Tag         | Status                   |
| -------------------- | ------------------ | ------------------------ |
| 1.16.0               | `1.16.0`, `latest` | ✅ Tested                 |
| 1.15.0               | `1.15.0`           | ⚠️ Should work (untested) |

To build a different version, specify the `CUBECLT_VERSION` build argument.

## Troubleshooting

### Build fails with "ST credentials required"

Make sure you've set the `ST_USERNAME` and `ST_PASSWORD` build arguments or GitHub secrets.

### Download fails or times out

ST's download servers may be slow or temporarily unavailable. Try:

1. Rebuilding the image
2. Checking your ST account credentials
3. Verifying your ST account has access to download STM32CubeCLT

### USB device not detected in container

For STM32CubeProgrammer to access USB devices:

```bash
docker run -it --privileged \
  -v /dev/bus/usb:/dev/bus/usb \
  uoohyo/stm32cubeclt:latest
```

### ARM GCC not found

Make sure the entrypoint script has completed. The PATH is set up automatically in `/entrypoint.sh`.

## Project Structure

```plaintext
.
├── .github/
│   ├── scripts/
│   │   └── download-cubeclt.sh    # ST authentication & download script
│   └── workflows/
│       └── build-stm32cubeclt.yml # GitHub Actions workflow
├── Dockerfile                      # Multi-stage Docker build
├── entrypoint.sh                   # Installation & setup script
├── LICENSE
└── README.md
```

## How It Works

1. **Download Stage**: Authenticates with ST account and downloads STM32CubeCLT
   - Uses curl to login to my.st.com
   - Extracts session cookies
   - Downloads the installer package

2. **Build Stage**: Installs STM32CubeCLT and sets up the environment
   - Installs system dependencies
   - Runs STM32CubeCLT installer
   - Configures PATH for all tools

3. **Runtime**: Ready-to-use STM32 development environment

## Security Notes

- ST credentials are only used during Docker build and are **not** stored in the final image
- Credentials are passed as build arguments, which are not persisted in image layers when using BuildKit
- Use GitHub repository secrets for CI/CD to keep credentials secure
- Never commit credentials to your repository

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

[MIT License](./LICENSE)

Copyright (c) 2026 uoohyo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
