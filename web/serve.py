#!/usr/bin/env python3
"""Compatibility entrypoint for installations that invoke serve.py."""
from launch import main


if __name__ == '__main__':
    raise SystemExit(main())
