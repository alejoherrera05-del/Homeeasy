from pathlib import Path

page_path = Path('seguimiento.html')
source_path = Path('seguimiento-hommy.js')
workflow_path = Path('.github/workflows/seguimiento-hommy-qa.yml')

page = page_path.read_text(encoding='utf-8')
old_tag = '<script src="seguimiento-hommy.js?v=10b1" defer></script>'
new_tag = '<script src="seguimiento-hommy.js?v=10c2" defer></script>'
page = page.replace(old_tag, new_tag, 1)
watchdog = '''    <script>
      window.addEventListener('load', () => {
        window.setTimeout(() => {
          if (window.__HOMEEASY_SEGUIMIENTO_HOMMY_10B__) return;
          const retry = document.createElement('script');
          retry.src = 'seguimiento-hommy.js?v=10c2-retry';
          retry.defer = true;
          document.head.appendChild(retry);
        }, 1400);
      }, { once: true });
    </script>
'''
if watchdog not in page:
    page = page.replace(new_tag + '\n', new_tag + '\n' + watchdog, 1)
page_path.write_text(page, encoding='utf-8')

source = source_path.read_text(encoding='utf-8')
source = source.replace('const REQUEST_TIMEOUT_MS = 75_000;', 'const REQUEST_TIMEOUT_MS = 90_000;', 1)
source_path.write_text(source, encoding='utf-8')

workflow = workflow_path.read_text(encoding='utf-8')
workflow = workflow.replace('seguimiento-hommy.js?v=10b1', 'seguimiento-hommy.js?v=10c2')
if "10c2-retry" not in workflow:
    workflow = workflow.replace(
        "assert page.count(tag) == 1, 'Seguimiento must load the Hommy extension exactly once'",
        "assert page.count(tag) == 1, 'Seguimiento must load the Hommy extension exactly once'\n          assert 'seguimiento-hommy.js?v=10c2-retry' in page, 'Seguimiento must retry Hommy loader after transient failure'",
        1,
    )
workflow_path.write_text(workflow, encoding='utf-8')

print('Seguimiento 10C2 loader patch applied')
