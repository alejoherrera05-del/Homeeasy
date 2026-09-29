#!/usr/bin/env python3
"""Fixed WAHA maintenance operations. Runs locally, no TCP listener or shell input."""
import datetime as dt
import fcntl
import json
import os
import re
import shutil
import subprocess
import tarfile
import threading
import time
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

BASE = Path('/opt/homeeasy-whatsapp')
RUNTIME = BASE / 'maintenance-runtime'
REQUESTS = RUNTIME / 'requests'
STATE = RUNTIME / 'status.json'
PRIVATE = BASE / 'maintenance-state.json'
VERSION = re.compile(r'^202\d\.\d{1,2}\.\d{1,3}$')
BLOCK_PHASES = {'draining', 'backup', 'installing', 'verifying', 'rollback', 'attention'}

def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def read(file, default=None):
    try:
        if file.is_symlink():
            return default
        return json.loads(file.read_text())
    except (OSError, ValueError):
        return default

def atomic(file, value, mode=0o644):
    temp = file.with_suffix('.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False))
    os.chmod(temp, mode)
    temp.replace(file)

def run(args, timeout=120):
    p = subprocess.run(args, cwd=BASE, capture_output=True, text=True, timeout=timeout)
    if p.returncode:
        raise RuntimeError('Falló ' + ' '.join(args[:3]))
    return p.stdout.strip()

def api_info():
    # The existing API key stays inside the bridge container and is never returned.
    script = '''(async()=>{const h={"X-Api-Key":process.env.WAHA_API_KEY};const base=process.env.WAHA_BASE_URL;const v=await fetch(base+"/api/version",{headers:h,signal:AbortSignal.timeout(8000)}).then(r=>r.json());const s=await fetch(base+"/api/sessions/"+encodeURIComponent(process.env.WAHA_SESSION||"homeeasy"),{headers:h,signal:AbortSignal.timeout(8000)}).then(r=>r.json());console.log(JSON.stringify({version:v.version,status:s.status}));})().catch(()=>process.exit(1))'''
    return json.loads(run(['docker', 'exec', 'homeeasy-whatsapp-bridge', 'node', '-e', script], 25))

def release():
    request = urllib.request.Request('https://api.github.com/repos/devlikeapro/waha/releases/latest', headers={'User-Agent': 'HomeEasy-Maintenance/1.0'})
    with urllib.request.urlopen(request, timeout=20) as response:
        result = json.load(response)
    tag = result.get('tag_name', '')
    if result.get('draft') or result.get('prerelease') or not VERSION.fullmatch(tag):
        raise RuntimeError('No hay una versión estable compatible.')
    published = dt.datetime.fromisoformat(result['published_at'].replace('Z', '+00:00'))
    return tag, published.isoformat()

def newer(target, current):
    return bool(VERSION.fullmatch(target or '') and VERSION.fullmatch(current or '') and tuple(map(int, target.split('.'))) > tuple(map(int, current.split('.'))))

class Worker:
    def __init__(self):
        self.lock = threading.RLock()
        self.config = read(PRIVATE, {'automatic': False})
        self.state = read(STATE, {})
        self.state.update(available=True, automatic=bool(self.config.get('automatic')), schedule='03:00 America/Bogota', minimumAgeHours=72)
        # Never silently resume a partially completed update after process/host failure.
        if self.state.get('blockSends'):
            self.state.update(phase='attention', busy=False, message='Mantenimiento interrumpido. Se requiere revisar el servidor; los envíos siguen pausados.')
        else:
            self.state.update(phase='idle', busy=False, blockSends=False)
        self.publish()

    def publish(self, **values):
        with self.lock:
            self.state.update(values, heartbeat=now())
            atomic(STATE, self.state)

    def heartbeat(self):
        while True:
            time.sleep(15)
            self.publish()

    def phase(self, phase, message):
        self.publish(phase=phase, message=message, busy=True, blockSends=phase in BLOCK_PHASES)

    def check(self):
        self.phase('checking', 'Comprobando la conexión y las versiones estables…')
        info = api_info()
        tag, published = release()
        self.publish(currentVersion=info.get('version'), channel=info.get('status'), latestVersion=tag, publishedAt=published,
                     updateAvailable=newer(tag, info.get('version')), checkedAt=now())

    def ready(self, seconds=180):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            try:
                info = api_info()
                if info.get('status') == 'WORKING':
                    self.publish(currentVersion=info.get('version'), channel='WORKING')
                    return True
            except Exception:
                pass
            self.publish()
            time.sleep(5)
        return False

    def update(self, automatic=False):
        self.check()
        tag = self.state['latestVersion']
        if not self.state['updateAvailable']:
            return 'Ya tienes la versión estable actual.'
        published = dt.datetime.fromisoformat(self.state['publishedAt'])
        if (dt.datetime.now(dt.timezone.utc) - published).total_seconds() < 72 * 3600:
            return 'Versión detectada. Se esperarán 72 horas desde su publicación antes de instalarla.'
        if automatic and self.config.get('failedVersion') == tag:
            return 'La versión disponible falló anteriormente. Requiere revisión antes de repetirla.'
        if self.state.get('channel') != 'WORKING':
            raise RuntimeError('Actualización aplazada: WhatsApp debe estar conectado antes de comenzar.')
        if shutil.disk_usage(BASE).free < 4 * 1024**3:
            raise RuntimeError('Actualización aplazada: se necesitan 4 GB libres para el respaldo.')
        image = 'devlikeapro/waha:chrome-' + tag
        self.phase('downloading', 'Descargando la versión estable; puedes seguir enviando.')
        run(['docker', 'pull', image], 1200)
        backup = BASE / 'backups' / ('maintenance-' + dt.datetime.now().strftime('%Y%m%d-%H%M%S'))
        backup.mkdir(mode=0o700, parents=True)
        compose = BASE / 'docker-compose.yml'
        original = compose.read_text()
        # Only the known WAHA image line may be changed; never accept a user-supplied image.
        pattern = r'(?m)^(\s+image:\s*)devlikeapro/waha:chrome(?:-202\d\.\d{1,2}\.\d{1,3})?\s*$'
        changed, count = re.subn(pattern, lambda m: m.group(1) + image, original)
        if count != 1:
            raise RuntimeError('La configuración del servidor requiere revisión.')
        old_image = run(['docker', 'inspect', 'homeeasy-waha', '--format', '{{.Image}}'])
        rollback_image = 'homeeasy-waha:rollback-' + backup.name
        run(['docker', 'tag', old_image, rollback_image])
        shutil.copy2(compose, backup / 'docker-compose.yml')
        self.publish(backup=backup.name)
        self.phase('draining', 'Esperando que terminen los envíos antes de actualizar…')
        deadline = time.monotonic() + 180
        quiet = 0
        while True:
            inflight = read(REQUESTS / 'inflight.json')
            if isinstance(inflight, dict) and inflight.get('active') == 0:
                quiet += 1
                if quiet >= 3:
                    break
            else:
                quiet = 0
            if time.monotonic() > deadline:
                raise RuntimeError('Actualización aplazada: todavía hay operaciones en curso.')
            self.publish()
            time.sleep(2)
        stopped = False
        snapshot = False
        try:
            self.phase('backup', 'Guardando el respaldo de la sesión…')
            stopped = True
            run(['docker', 'compose', 'stop', 'waha'])
            with tarfile.open(backup / 'sessions.tgz', 'w:gz') as archive:
                archive.add(BASE / 'data/sessions', arcname='sessions')
            snapshot = True
            self.phase('installing', 'Instalando WhatsApp; los envíos están pausados temporalmente.')
            compose.write_text(changed)
            run(['docker', 'compose', 'config', '--quiet'])
            run(['docker', 'compose', 'up', '-d', '--no-deps', 'waha'])
            self.phase('verifying', 'Comprobando la reconexión de WhatsApp…')
            if not self.ready() or self.state['currentVersion'] != tag:
                raise RuntimeError('La nueva versión no reconectó correctamente.')
            self.publish(lastUpdateAt=now(), lastResult='updated', updateAvailable=False)
            self.config.pop('failedVersion', None)
            return 'Actualización completada. WhatsApp está conectado.'
        except Exception as failure:
            self.config['failedVersion'] = tag
            if stopped:
                self.phase('rollback', 'Restaurando la versión y sesión anteriores…')
                try:
                    run(['docker', 'compose', 'stop', 'waha'])
                    if snapshot:
                        sessions = BASE / 'data/sessions'
                        sessions.rename(backup / 'sessions-after-update')
                        with tarfile.open(backup / 'sessions.tgz') as archive:
                            archive.extractall(BASE / 'data', filter='data')
                    compose.write_text(re.sub(pattern, lambda m: m.group(1) + rollback_image, original))
                    run(['docker', 'compose', 'up', '-d', '--no-deps', 'waha'])
                    if not self.ready():
                        raise RuntimeError('La sesión anterior no reconectó.')
                    # Keep the exact prior tag pinned to the restored local image.
                    previous_tag = re.search(pattern, original).group(0).split('image:', 1)[1].strip()
                    run(['docker', 'tag', old_image, previous_tag])
                    compose.write_text(original)
                    self.publish(lastResult='rolled_back')
                except Exception:
                    self.publish(phase='attention', blockSends=True, busy=False, lastResult='needs_attention',
                                 message='La recuperación necesita atención técnica. Los respaldos están conservados y los envíos pausados.')
                    raise RuntimeError('No se pudo verificar la recuperación automática.') from failure
            raise RuntimeError('La actualización no se completó. Se conservó la versión anterior.') from failure
        finally:
            atomic(PRIVATE, self.config, 0o600)

    def execute(self, command):
        if self.state.get('phase') == 'attention':
            return
        action = command.get('action')
        self.publish(jobId=command.get('id'), requestedBy=str(command.get('actor', 'scheduler'))[:160])
        try:
            if action == 'automatic' and type(command.get('enabled')) is bool:
                self.config['automatic'] = command['enabled']
                atomic(PRIVATE, self.config, 0o600)
                self.publish(automatic=command['enabled'])
                message = 'Actualizaciones nocturnas activadas.' if command['enabled'] else 'Actualizaciones nocturnas pausadas; la revisión automática sigue activa.'
            elif action == 'check':
                self.check()
                message = 'Hay una actualización disponible.' if self.state['updateAvailable'] else 'WhatsApp está en la versión estable actual.'
            elif action == 'update':
                message = self.update(command.get('automatic') is True)
            else:
                raise RuntimeError('Acción no permitida.')
            self.publish(message=message, error=None)
        except Exception as e:
            self.publish(error=str(e)[:250], message=str(e)[:250])
        finally:
            if self.state.get('phase') != 'attention':
                self.publish(phase='idle', busy=False, blockSends=False)

    def loop(self):
        threading.Thread(target=self.heartbeat, daemon=True).start()
        last_check = 0
        while True:
            command_file = REQUESTS / 'command.json'
            if command_file.exists():
                command = read(command_file)
                if isinstance(command, dict):
                    command_file.unlink()
                    self.execute({k: command[k] for k in ['id', 'action', 'enabled', 'actor'] if k in command})
            local = dt.datetime.now(ZoneInfo('America/Bogota'))
            day = local.date().isoformat()
            if self.config.get('automatic') and local.hour == 3 and self.config.get('lastNight') != day:
                self.config['lastNight'] = day
                atomic(PRIVATE, self.config, 0o600)
                self.execute({'action': 'update', 'automatic': True, 'id': 'night-' + day})
                last_check = time.time()
            elif time.time() - last_check > 6 * 3600:
                self.execute({'action': 'check', 'id': 'check-' + day})
                last_check = time.time()
            self.publish()
            time.sleep(5)

if __name__ == '__main__':
    RUNTIME.mkdir(mode=0o755, exist_ok=True)
    with open(BASE / 'maintenance.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        Worker().loop()
