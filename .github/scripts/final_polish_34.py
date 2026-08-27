from pathlib import Path

# Login: restore Firebase identity only. Authorization is never reopened automatically here.
p=Path('login.html'); t=p.read_text(encoding='utf-8')
old="const user=await auth.restoreSession({validate:false});"
new="const user=await auth.restoreSession({validate:false,homeEasy:false});"
if t.count(old)!=1: raise SystemExit(f'Expected one login restore call, got {t.count(old)}')
p.write_text(t.replace(old,new,1),encoding='utf-8')

# QA harness: seed a fake session only once. Re-injecting it on every navigation
# would artificially resurrect a revoked session and create a false login loop.
p=Path('.github/scripts/full_fire_browser.mjs'); t=p.read_text(encoding='utf-8')
old="await context.addInitScript(({s})=>{sessionStorage.setItem('HOMEEASY_AUTH_SESSION_V1',JSON.stringify(s));sessionStorage.setItem('APP_INIT_DONE','true');},{s:session({stale,perms,role})});"
new="await context.addInitScript(({s})=>{if(!sessionStorage.getItem('HOMEEASY_AUTH_SESSION_V1'))sessionStorage.setItem('HOMEEASY_AUTH_SESSION_V1',JSON.stringify(s));sessionStorage.setItem('APP_INIT_DONE','true');},{s:session({stale,perms,role})});"
if t.count(old)!=1: raise SystemExit(f'Expected one QA seed call, got {t.count(old)}')
p.write_text(t.replace(old,new,1),encoding='utf-8')
print('Final 3.4 auth polish applied')
