import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('worker', Path(__file__).with_name('worker.py'))
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)

class MaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        for name, value in [('BASE', self.base), ('RUNTIME', self.base/'runtime'), ('REQUESTS', self.base/'runtime/requests'), ('STATE', self.base/'runtime/status.json'), ('PRIVATE', self.base/'private.json')]:
            p = patch.object(w, name, value); p.start(); self.addCleanup(p.stop)
        w.REQUESTS.mkdir(parents=True)
        (self.base/'data/sessions').mkdir(parents=True)
        (self.base/'data/sessions/session').write_text('original')
        (self.base/'docker-compose.yml').write_text('services:\n  waha:\n    image: devlikeapro/waha:chrome-2026.9.1\n    container_name: homeeasy-waha\n')
        w.atomic(w.REQUESTS/'inflight.json', {'active':0})
        self.commands=[]
        def fake_run(args, timeout=120):
            self.commands.append(args)
            if args[:2] == ['docker','inspect']: return 'sha256:old'
            return ''
        for name, value in [('run',fake_run),('api_info',lambda:{'version':'2026.9.1','status':'WORKING'}),('release',lambda:('2026.9.2','2026-09-01T00:00:00+00:00'))]:
            p=patch.object(w,name,value);p.start();self.addCleanup(p.stop)
        p=patch.object(w.shutil,'disk_usage',return_value=SimpleNamespace(free=10*1024**3));p.start();self.addCleanup(p.stop)
        self.worker=w.Worker()

    def test_success_preserves_session_and_backup(self):
        def ready(*args):
            self.worker.publish(currentVersion='2026.9.2',channel='WORKING');return True
        self.worker.ready=ready
        self.worker.execute({'action':'update'})
        self.assertEqual(self.worker.state['lastResult'],'updated')
        self.assertFalse(self.worker.state['blockSends'])
        self.assertIn('chrome-2026.9.2',(self.base/'docker-compose.yml').read_text())
        self.assertTrue((self.base/'backups'/self.worker.state['backup']/'sessions.tgz').exists())

    def test_failed_update_restores_previous_session(self):
        results=iter([False,True]);self.worker.ready=lambda *a:next(results)
        self.worker.execute({'action':'update'})
        self.assertEqual(self.worker.state['lastResult'],'rolled_back')
        self.assertFalse(self.worker.state['blockSends'])
        self.assertEqual((self.base/'data/sessions/session').read_text(),'original')
        self.assertIn('chrome-2026.9.1',(self.base/'docker-compose.yml').read_text())
        self.assertEqual(self.worker.config['failedVersion'],'2026.9.2')

    def test_failed_recovery_pauses_sends(self):
        self.worker.ready=lambda *a:False
        self.worker.execute({'action':'update'})
        self.assertTrue(self.worker.state['blockSends'])
        self.assertEqual(self.worker.state['phase'],'attention')

    def test_no_automatic_retry_of_failed_release(self):
        self.worker.config['failedVersion']='2026.9.2'
        self.worker.execute({'action':'update','automatic':True})
        self.assertEqual(self.commands,[])

    def test_current_release_is_noop(self):
        with patch.object(w,'release',return_value=('2026.9.1','2026-09-01T00:00:00+00:00')):
            self.worker.execute({'action':'update'})
        self.assertEqual(self.commands,[])

    def test_recent_release_waits(self):
        with patch.object(w,'release',return_value=('2026.9.2',w.now())):
            self.worker.execute({'action':'update'})
        self.assertEqual(self.commands,[])

    def test_disconnected_does_not_restart(self):
        with patch.object(w,'api_info',return_value={'version':'2026.9.1','status':'FAILED'}):
            self.worker.execute({'action':'update'})
        self.assertEqual(self.commands,[])
        self.assertIn('aplazada',self.worker.state['error'])

    def test_bad_action_cannot_run_command(self):
        self.worker.execute({'action':'shell','command':'arbitrary'})
        self.assertEqual(self.commands,[])
        self.assertIn('permitida',self.worker.state['error'])

    def test_version_order_rejects_downgrade_and_input(self):
        self.assertFalse(w.newer('2026.8.1','2026.9.1'))
        self.assertFalse(w.newer('latest;bad','2026.9.1'))
        self.assertTrue(w.newer('2026.10.1','2026.9.1'))

    def test_restart_does_not_release_maintenance_lock(self):
        w.atomic(w.STATE,{'blockSends':True,'phase':'installing'})
        self.assertEqual(w.Worker().state['phase'],'attention')

if __name__=='__main__':unittest.main()
