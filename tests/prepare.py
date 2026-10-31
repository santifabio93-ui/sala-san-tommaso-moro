"""Build a disposable Supabase project from the application's original SQL."""
import os
from pathlib import Path
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / 'tests/.runtime'
CLI = os.environ.get('SUPABASE_CLI', 'supabase')
RUNTIME.mkdir(exist_ok=True)
(RUNTIME / 'status.json').unlink(missing_ok=True)
project = RUNTIME / 'supabase'
project.mkdir(exist_ok=True)
(project / 'config.toml').write_text('''project_id = "sala-regression-tests"
[api]
port = 55321
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
[db]
port = 55322
shadow_port = 55320
major_version = 17
[db.seed]
enabled = false
[studio]
enabled = false
[local_smtp]
enabled = false
[analytics]
enabled = false
[auth]
site_url = "http://127.0.0.1:8765"
[auth.email]
enable_signup = true
enable_confirmations = false
''')
migrations = project / 'migrations'
migrations.mkdir(exist_ok=True)
for old in migrations.glob('*.sql'):
    old.unlink()
sources = [ROOT / 'supabase/schema.sql', *sorted((ROOT / 'supabase').glob('[0-9]*.sql'))]
for i, source in enumerate(sources, 1):
    shutil.copyfile(source, migrations / f'{i:014d}_{source.stem}.sql')
env = os.environ.copy()
# Official Docker Hub mirror, useful where public.ecr.aws is unavailable.
env.setdefault('SUPABASE_INTERNAL_IMAGE_REGISTRY', 'docker.io')
base = [CLI, '--workdir', str(RUNTIME)]
# BusyBox wget ignores no_proxy. Limit this compatibility helper to the exact
# loopback healthcheck; all other destinations retain their proxy configuration.
health_helper = b'''#!/bin/sh
if [ "$#" -eq 4 ]; then
  case "$4" in
    http://127.0.0.1:9999/health|http://127.0.0.1:5000/status) exec /usr/bin/wget -Y off "$@" ;;
  esac
fi
exec /usr/bin/wget "$@"
'''
start = subprocess.Popen(base + ['start', '-x', 'studio,imgproxy,logflare,vector,supavisor,edge-runtime'], env=env, stdout=subprocess.DEVNULL)
patched = set()
while start.poll() is None:
    for service in ('auth', 'storage'):
        if service in patched:
            continue
        result = subprocess.run(['docker', 'exec', '-u', '0', '-i',
            f'supabase_{service}_sala-regression-tests', 'sh', '-c',
            'cat > /usr/local/bin/wget && chmod 755 /usr/local/bin/wget'],
            input=health_helper, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if result.returncode == 0:
            patched.add(service)
    time.sleep(1)
if start.returncode:
    raise SystemExit(start.returncode)
# Always replay from zero: stale schemas must never make a regression pass.
subprocess.run(base + ['db', 'reset', '--local', '--no-seed'], env=env, check=True, stdout=subprocess.DEVNULL)
status = subprocess.check_output(base + ['status', '-o', 'json'], env=env)
(RUNTIME / 'status.json').write_bytes(status)
print(f'Rebuilt local test database from {len(sources)} SQL files.')
