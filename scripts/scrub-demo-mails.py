"""Strip the local Outlook account name from generated demo .msg files.

Outlook writes PR_LAST_MODIFIER_NAME (0x3FFA001F) and PR_CREATOR_NAME (0x3FF8001F)
with the signed-in mailbox and refuses to let PropertyAccessor override them.
The streams are overwritten in place with a fictional name of identical byte
length so the compound file layout stays valid.

Usage: python scripts/scrub-demo-mails.py [dir=client/public/demo-mails]
"""
import sys
from pathlib import Path

import olefile

PLACEHOLDER = "Chartering Desk (demo)"
STREAMS = ["__substg1.0_3FFA001F", "__substg1.0_3FF8001F"]


def scrub(path: Path) -> list[str]:
    changed = []
    with olefile.OleFileIO(str(path), write_mode=True) as ole:
        for name in STREAMS:
            if not ole.exists(name):
                continue
            size = ole.get_size(name)
            chars = size // 2
            text = (PLACEHOLDER[:chars]).ljust(chars)
            data = text.encode("utf-16-le")
            if len(data) != size:
                continue
            current = ole.openstream(name).read()
            if current == data:
                continue
            ole.write_stream(name, data)
            changed.append(name)
    return changed


def main() -> None:
    folder = Path(sys.argv[1] if len(sys.argv) > 1 else "client/public/demo-mails")
    for path in sorted(folder.glob("*.msg")):
        changed = scrub(path)
        print(f"{path.name}: {'scrubbed ' + ', '.join(changed) if changed else 'clean'}")


if __name__ == "__main__":
    main()
