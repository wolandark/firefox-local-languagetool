#!/usr/bin/env bash

set -euo pipefail

python3 - <<'PY'
import json
from pathlib import Path

m = json.loads(Path('manifest.json').read_text())
assert m['manifest_version'] == 3
assert m['background']['scripts'] == ['background.js']
assert m['content_scripts'][0]['js'] == ['content/boot.js']
assert 'default_popup' not in m['action']
assert Path('content/overlay.js').exists()
assert Path('content/popup.js').exists()
assert 'id="variant"' in Path('pages/popup.html').read_text()
assert all(Path('icons/icon' + size + '.png').exists() for size in ('16', '32', '48', '128'))
print('manifest and inline UI files: ok')
PY

response="$(curl -fsS -X POST http://127.0.0.1:8081/v2/check \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'language=en-US' \
  --data-urlencode 'text=This are teh test.')"

python3 -c 'import json,sys; d=json.loads(sys.argv[1]); assert d["software"]["version"]; assert d["matches"]; print("LanguageTool API: ok ({} match(es))".format(len(d["matches"])))' "$response"

languages="$(curl -fsS http://127.0.0.1:8081/v2/languages)"
python3 -c 'import json,sys; codes={x["longCode"] for x in json.loads(sys.argv[1])}; required={"en-US","en-GB","de-DE","de-AT","de-CH"}; assert required <= codes, sorted(required-codes); print("dialect list: ok")' "$languages"
