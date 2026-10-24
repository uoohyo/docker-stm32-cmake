#!/usr/bin/env python3
"""Render discovered toolchain versions separately from registry availability."""
import argparse
import json
from pathlib import Path
import re

VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")


def normalize(versions):
    if not isinstance(versions, list) or not versions:
        raise ValueError("Expected a nonempty discovered version array")
    result = {}
    for item in versions:
        version = item.get("version", "")
        if not VERSION_RE.fullmatch(version):
            raise ValueError(f"Invalid version: {version!r}")
        if not isinstance(item.get("linux_supported"), bool):
            raise ValueError(f"Missing Linux support status for {version}")
        if version in result and result[version] != item:
            raise ValueError(f"Conflicting discovery records for {version}")
        result[version] = item
    return sorted(result.values(), key=lambda x: tuple(map(int, x["version"].split("."))), reverse=True)


def latest(versions):
    return normalize(versions)[0]["version"]


def render(versions, tags):
    versions = normalize(versions)
    if not isinstance(tags, list) or any(not isinstance(tag, str) for tag in tags):
        raise ValueError("Expected a registry tag array")
    full = ["| Version | Status | ST Download | Docker Pull |", "| ------- | ------ | ----------- | ----------- |"]
    readme = []
    for item in versions:
        version = item["version"]
        hub = f"https://hub.docker.com/r/uoohyo/stm32-cmake/tags?name={version}"
        available = item["linux_supported"] and version in tags
        if available:
            status = "![available](https://img.shields.io/badge/available-2496ED?style=flat-square&logo=docker&logoColor=white)"
            pull = f"[`docker pull uoohyo/stm32-cmake:{version}`]({hub})"
            if len(readme) < 6:
                readme.append(f'<tr><td>v{version}</td><td><a href="{hub}"><img src="https://img.shields.io/badge/available-2496ED?style=flat-square&logo=docker&logoColor=white" alt="available" /></a></td></tr>')
        else:
            status = "![not built](https://img.shields.io/badge/not%20built-orange?style=flat-square)" if item["linux_supported"] else "![not supported](https://img.shields.io/badge/not%20supported-gray?style=flat-square)"
            pull = "-"
        full.append(f"| `{version}` | {status} | [Download](https://www.st.com/en/development-tools/stm32cubeclt.html) | {pull} |")
    return "\n".join(full) + "\n", "\n".join(readme) + "\n"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["latest", "render"])
    parser.add_argument("versions", type=Path)
    parser.add_argument("--tags", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path("/tmp"))
    args = parser.parse_args()
    versions = json.loads(args.versions.read_text())
    if args.command == "latest":
        print(latest(versions))
    else:
        if args.tags is None:
            parser.error("render requires --tags")
        full, readme = render(versions, json.loads(args.tags.read_text()))
        args.output_dir.mkdir(parents=True, exist_ok=True)
        (args.output_dir / "table-full.md").write_text(full)
        (args.output_dir / "table-readme.md").write_text(readme)
