"""Run the recorded producer contract in a temporary synthetic directory."""
from pathlib import Path
import sys
import tempfile

from fixture_owner import create_fixture_tree

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fm_contract_check


def main():
    with tempfile.TemporaryDirectory(prefix='deck-contract-') as directory:
        root = create_fixture_tree(directory)
        return fm_contract_check.main(['--home', str(root / 'owner')])


if __name__ == '__main__':
    raise SystemExit(main())
