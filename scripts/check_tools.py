"""Read-only inventory for the standalone board and optional features."""
import importlib.metadata
import platform
import shutil
import subprocess
import sys


def optional(name, minimum, factory, impact):
    path = shutil.which(name)
    version = 'missing'
    if path:
        try:
            result = subprocess.run([path, '--version'], capture_output=True, text=True, timeout=3)
            version = (result.stdout or result.stderr).strip().splitlines()[0] or 'version unknown'
        except (OSError, subprocess.SubprocessError, IndexError):
            version = 'version unknown'
    print(f'Optional {name}: {version}; minimum {minimum}; macOS {factory}; without it: {impact}')


def main():
    ready = sys.version_info >= (3, 9)
    print(f'Required Python: {platform.python_version()}; minimum 3.9; macOS Command Line Tools supply 3.9; without it: board unavailable')
    try:
        version = importlib.metadata.version('pytest')
    except importlib.metadata.PackageNotFoundError:
        version = 'missing'
    print(f'Optional pytest: {version}; tested 9.0.2, minimum unknown; macOS not normally supplied; without it: Python development suite unavailable')
    optional('node', 'unknown (tested 22)', 'not normally supplied', 'JavaScript tests and locked history reader tests')
    optional('herdr', '0.9.0 for terminal plugin', 'not normally supplied', 'terminal plugin activity and actions')
    print('Optional Firstmate producer: availability and version unknown; compatible work-control contract required; macOS not supplied; without it: board remains empty and controls disabled')
    print('Optional relay extension: availability and version unknown; compatible extension contract required; macOS not supplied; without it: relay settings unavailable')
    print('Optional browser: version unknown; minimum modern browser (unknown); macOS normally supplies Safari; without it: UI unavailable')
    print('READY' if ready else 'MISSING required tools or capabilities')
    return 0 if ready else 1


if __name__ == '__main__':
    sys.exit(main())
