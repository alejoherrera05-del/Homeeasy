from pathlib import Path


def patch(path, replacements):
    p = Path(path)
    raw = p.read_bytes()
    text = raw.decode('utf-8')
    newline = '\r\n' if b'\r\n' in raw else '\n'
    s = text.replace('\r\n', '\n')
    original = s
    for old, new in replacements:
        if old not in s:
            raise SystemExit(f'missing marker in {path}: {old[:140]}')
        s = s.replace(old, new, 1)
    if s == original:
        raise SystemExit(f'no changes in {path}')
    out = s if newline == '\n' else s.replace('\n', '\r\n')
    p.write_bytes(out.encode('utf-8'))
    print('PATCHED', path)

helper_block = r'''
  function ensureMobileTextEditorStyle() {
    if (document.getElementById("homeeasy-mobile-text-editor-style")) return;
    const style = document.createElement("style");
    style.id = "homeeasy-mobile-text-editor-style";
    style.textContent = `
      body.homeeasy-text-editor-open{overflow:hidden!important;}
      .homeeasy-expanded-text-source{cursor:pointer;touch-action:manipulation;}
      .homeeasy-text-editor-overlay{
        position:fixed;inset:0;z-index:12000;display:flex;align-items:flex-end;justify-content:center;
        padding:12px 12px calc(12px + env(safe-area-inset-bottom));
        background:rgba(45,35,39,.18);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);
        opacity:0;visibility:hidden;pointer-events:none;
        transition:opacity .22s ease,visibility .22s ease;
      }
      .homeeasy-text-editor-overlay.is-open{opacity:1;visibility:visible;pointer-events:auto;}
      .homeeasy-text-editor-panel{
        width:min(100%,580px);height:min(68dvh,620px);min-height:360px;max-height:calc(100dvh - 24px - env(safe-area-inset-top));
        display:flex;flex-direction:column;overflow:hidden;
        background:rgba(255,255,255,.985);border:1px solid rgba(166,69,90,.12);border-radius:26px;
        box-shadow:0 24px 70px rgba(68,42,50,.22),inset 0 1px 0 rgba(255,255,255,.9);
        transform:translateY(14px) scale(.987);transform-origin:center bottom;
        transition:transform .24s cubic-bezier(.2,.8,.2,1);
      }
      .homeeasy-text-editor-overlay.is-open .homeeasy-text-editor-panel{transform:translateY(0) scale(1);}
      .homeeasy-text-editor-handle{width:38px;height:4px;border-radius:999px;background:#DED7DA;margin:9px auto 3px;flex:0 0 auto;}
      .homeeasy-text-editor-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 18px 10px;}
      .homeeasy-text-editor-heading{min-width:0;text-align:left;}
      .homeeasy-text-editor-title{margin:0;color:#302A2D;font:700 1.02rem/1.2 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif;letter-spacing:-.015em;}
      .homeeasy-text-editor-caption{margin:4px 0 0;color:#8B8387;font:500 .72rem/1.35 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif;}
      .homeeasy-text-editor-done{border:0;background:rgba(166,69,90,.09);color:#A6455A;border-radius:999px;padding:9px 14px;font:700 .82rem/1 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif;flex:0 0 auto;}
      .homeeasy-text-editor-done:active{transform:scale(.96);}
      .homeeasy-text-editor-body{display:flex;flex:1;min-height:0;padding:4px 14px 14px;}
      .homeeasy-text-editor-input{
        display:block;width:100%;height:100%;min-height:0;resize:none;overflow:auto;-webkit-overflow-scrolling:touch;
        border:1px solid rgba(60,60,67,.11);outline:0;border-radius:18px;background:#FAF8F9;color:#2D282A;
        padding:16px 16px 24px;font:500 16px/1.55 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif;
        caret-color:#A6455A;box-shadow:inset 0 1px 2px rgba(43,31,36,.025);
      }
      .homeeasy-text-editor-input:focus{border-color:rgba(166,69,90,.34);background:#fff;box-shadow:0 0 0 4px rgba(166,69,90,.07);}
      @media (min-width:821px) and (pointer:fine){.homeeasy-text-editor-overlay{display:none!important;}}
      @media (prefers-reduced-motion:reduce){.homeeasy-text-editor-overlay,.homeeasy-text-editor-panel{transition:none!important;}}
    `;
    document.head.appendChild(style);
  }

  function installMobileTextEditor(options) {
    const opts = options || {};
    const target = document.getElementById(opts.targetId || "notas");
    if (!target || target.dataset.homeeasyExpandedEditor === "1") return null;
    target.dataset.homeeasyExpandedEditor = "1";
    ensureMobileTextEditorStyle();

    const mobileQuery = window.matchMedia("(max-width: 820px), (pointer: coarse)");
    const originalReadOnly = Boolean(target.readOnly);
    const overlay = document.createElement("div");
    overlay.className = "homeeasy-text-editor-overlay no-print";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <section class="homeeasy-text-editor-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(opts.title || "Editar observaciones")}">
        <div class="homeeasy-text-editor-handle" aria-hidden="true"></div>
        <header class="homeeasy-text-editor-header">
          <div class="homeeasy-text-editor-heading">
            <h2 class="homeeasy-text-editor-title">${escapeHtml(opts.title || "Editar observaciones")}</h2>
            <p class="homeeasy-text-editor-caption">Escribe y desplázate con libertad. El texto se conserva al cerrar.</p>
          </div>
          <button type="button" class="homeeasy-text-editor-done">Listo</button>
        </header>
        <div class="homeeasy-text-editor-body">
          <textarea class="homeeasy-text-editor-input" spellcheck="true"></textarea>
        </div>
      </section>`;
    document.body.appendChild(overlay);

    const editor = overlay.querySelector(".homeeasy-text-editor-input");
    const done = overlay.querySelector(".homeeasy-text-editor-done");
    let open = false;

    function syncMode() {
      const mobile = mobileQuery.matches;
      target.readOnly = mobile ? true : originalReadOnly;
      target.classList.toggle("homeeasy-expanded-text-source", mobile);
      target.setAttribute("aria-haspopup", mobile ? "dialog" : "false");
      if (!mobile && open) closeEditor();
    }

    function syncViewport() {
      if (!open || !window.visualViewport) return;
      overlay.style.top = window.visualViewport.offsetTop + "px";
      overlay.style.height = window.visualViewport.height + "px";
      overlay.style.bottom = "auto";
    }

    function commit() {
      target.value = editor.value;
      target.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function openEditor() {
      if (!mobileQuery.matches || open) return;
      open = true;
      editor.value = target.value || "";
      overlay.classList.add("is-open");
      overlay.setAttribute("aria-hidden", "false");
      document.body.classList.add("homeeasy-text-editor-open");
      syncViewport();
      window.requestAnimationFrame(function () {
        editor.focus({ preventScroll: true });
        const end = editor.value.length;
        try { editor.setSelectionRange(end, end); } catch (error) {}
      });
    }

    function closeEditor() {
      if (!open) return;
      commit();
      open = false;
      overlay.classList.remove("is-open");
      overlay.setAttribute("aria-hidden", "true");
      document.body.classList.remove("homeeasy-text-editor-open");
      overlay.style.top = "";
      overlay.style.height = "";
      overlay.style.bottom = "";
      target.blur();
    }

    target.addEventListener("click", function (event) {
      if (!mobileQuery.matches) return;
      event.preventDefault();
      openEditor();
    });
    target.addEventListener("focus", function () {
      if (!mobileQuery.matches) return;
      target.blur();
      openEditor();
    });
    editor.addEventListener("input", function () { target.value = editor.value; });
    done.addEventListener("click", closeEditor);
    overlay.addEventListener("click", function (event) { if (event.target === overlay) closeEditor(); });
    document.addEventListener("keydown", function (event) { if (open && event.key === "Escape") closeEditor(); });
    if (window.visualViewport) window.visualViewport.addEventListener("resize", syncViewport);
    if (typeof mobileQuery.addEventListener === "function") mobileQuery.addEventListener("change", syncMode);
    syncMode();
    return { open: openEditor, close: closeEditor, overlay: overlay, target: target };
  }

  function preparePaginatedClone(clonedDoc, options) {
    const opts = options || {};
    const area = clonedDoc.getElementById(opts.areaId || "area-pdf");
    if (!area) return { pages: 1, breaks: 0 };

    const pageWidthPx = Number(opts.pageWidthPx || 800);
    const pageHeightPx = Number(opts.pageHeightPx || (pageWidthPx * 279.4 / 215.9));
    const tableBody = clonedDoc.querySelector(opts.tableBodySelector || "#tabla-body");
    const tableHeader = clonedDoc.querySelector("thead tr");
    let breaks = 0;

    area.style.overflow = "visible";
    area.style.minHeight = pageHeightPx + "px";

    function topWithinArea(element) {
      return element.getBoundingClientRect().top - area.getBoundingClientRect().top;
    }

    function bottomWithinArea(element) {
      return element.getBoundingClientRect().bottom - area.getBoundingClientRect().top;
    }

    function crossesBoundary(element) {
      const top = topWithinArea(element);
      const bottom = bottomWithinArea(element);
      if (bottom - top >= pageHeightPx - 4) return false;
      return Math.floor((top + .5) / pageHeightPx) !== Math.floor((bottom - .5) / pageHeightPx);
    }

    function remainingOnPage(element) {
      const top = Math.max(0, topWithinArea(element));
      const mod = ((top % pageHeightPx) + pageHeightPx) % pageHeightPx;
      return pageHeightPx - mod;
    }

    function addTableBreak(row) {
      if (!tableBody || !crossesBoundary(row)) return;
      const gap = remainingOnPage(row);
      if (gap <= 1 || gap >= pageHeightPx - 1) return;
      const spacer = clonedDoc.createElement("tr");
      spacer.className = "pdf-smart-page-spacer";
      spacer.setAttribute("aria-hidden", "true");
      const cell = clonedDoc.createElement("td");
      cell.colSpan = Math.max(1, row.children.length || (tableHeader ? tableHeader.children.length : 4));
      cell.style.cssText = "height:" + gap + "px!important;min-height:" + gap + "px!important;padding:0!important;border:0!important;background:#fff!important;line-height:0!important;font-size:0!important;";
      spacer.style.cssText = "height:" + gap + "px!important;border:0!important;background:#fff!important;";
      spacer.appendChild(cell);
      tableBody.insertBefore(spacer, row);
      if (opts.repeatTableHeader !== false && tableHeader) {
        const repeat = tableHeader.cloneNode(true);
        repeat.classList.add("pdf-repeat-table-header");
        repeat.querySelectorAll(".no-print").forEach(function (node) { node.remove(); });
        tableBody.insertBefore(repeat, row);
      }
      breaks += 1;
    }

    function addBlockBreak(element) {
      if (!element || !element.parentNode || !crossesBoundary(element)) return;
      const gap = remainingOnPage(element);
      if (gap <= 1 || gap >= pageHeightPx - 1) return;
      const spacer = clonedDoc.createElement("div");
      spacer.className = "pdf-smart-page-spacer";
      spacer.setAttribute("aria-hidden", "true");
      spacer.style.cssText = "display:block!important;width:100%!important;height:" + gap + "px!important;min-height:" + gap + "px!important;flex:0 0 " + gap + "px!important;background:#fff!important;";
      element.parentNode.insertBefore(spacer, element);
      breaks += 1;
    }

    if (tableBody) {
      Array.from(tableBody.querySelectorAll(":scope > tr")).forEach(function (row) {
        if (!row.classList.contains("pdf-smart-page-spacer") && !row.classList.contains("pdf-repeat-table-header")) addTableBreak(row);
      });
    }

    const notes = clonedDoc.querySelector(opts.notesSelector || "#notas");
    const notesBlock = notes ? (notes.closest(".mb-4") || notes.parentElement) : null;
    addBlockBreak(notesBlock);
    addBlockBreak(clonedDoc.querySelector(opts.summarySelector || ".row.g-4.mt-auto"));
    addBlockBreak(clonedDoc.querySelector(opts.footerSelector || ".pdf-footer"));

    const totalHeight = area.getBoundingClientRect().height;
    const pages = Math.max(1, Math.ceil((totalHeight - .5) / pageHeightPx));
    const targetHeight = pages * pageHeightPx;
    const tailGap = targetHeight - totalHeight;
    if (tailGap > 1) {
      const tail = clonedDoc.createElement("div");
      tail.className = "pdf-smart-page-tail";
      tail.setAttribute("aria-hidden", "true");
      tail.style.cssText = "display:block!important;width:100%!important;height:" + tailGap + "px!important;min-height:" + tailGap + "px!important;flex:0 0 " + tailGap + "px!important;background:#fff!important;";
      area.appendChild(tail);
    }
    area.dataset.pdfSmartPages = String(pages);
    area.dataset.pdfSmartBreaks = String(breaks);
    return { pages: pages, breaks: breaks };
  }
'''

patch('homeeasy-docs.js', [
    ('\n  const autoType = detectDocumentType();', helper_block + '\n  const autoType = detectDocumentType();'),
    ('    const autoInit = function () { init({ url: DEFAULT_API_URL, documentType: autoType }); };',
     '    const autoInit = function () {\n      init({ url: DEFAULT_API_URL, documentType: autoType });\n      if (autoType === "cotizacion" || autoType === "pedido") {\n        installMobileTextEditor({\n          targetId: "notas",\n          title: autoType === "pedido" ? "Observaciones de fabricación" : "Observaciones especiales"\n        });\n      }\n    };'),
    ('    normalizePhone: normalizePhone,\n    state: state',
     '    normalizePhone: normalizePhone,\n    installMobileTextEditor: installMobileTextEditor,\n    preparePaginatedClone: preparePaginatedClone,\n    state: state')
])

clone_old = '''                    clonedDoc.querySelectorAll('textarea').forEach(ta => {\n                        const div = clonedDoc.createElement('div'); \n                        div.innerText = ta.value; \n                        div.className = ta.className; \n                        div.style.border = 'none'; \n                        div.style.background = 'transparent'; \n                        div.style.whiteSpace = 'pre-wrap';\n                        ta.parentNode.replaceChild(div, ta);\n                    });'''
clone_new = '''                    clonedDoc.querySelectorAll('textarea').forEach(ta => {\n                        const div = clonedDoc.createElement('div'); \n                        div.innerText = ta.value; \n                        div.className = ta.className; \n                        div.id = ta.id || '';\n                        div.style.border = 'none'; \n                        div.style.background = 'transparent'; \n                        div.style.whiteSpace = 'pre-wrap';\n                        div.style.overflowWrap = 'anywhere';\n                        div.style.lineHeight = '1.45';\n                        ta.parentNode.replaceChild(div, ta);\n                    });\n\n                    if (window.HomeEasyDocs && typeof window.HomeEasyDocs.preparePaginatedClone === 'function') {\n                        window.HomeEasyDocs.preparePaginatedClone(clonedDoc, {\n                            areaId: 'area-pdf',\n                            tableBodySelector: '#tabla-body',\n                            notesSelector: '#notas',\n                            summarySelector: '.row.g-4.mt-auto',\n                            footerSelector: '.pdf-footer',\n                            pageWidthPx: 800,\n                            repeatTableHeader: true\n                        });\n                    }'''

for path in ['cotizacion.html', 'pedido.html']:
    patch(path, [
        ('homeeasy-docs.js?v=4.2', 'homeeasy-docs.js?v=4.3'),
        (clone_old, clone_new),
        ('while (heightLeft > 25)', 'while (heightLeft > 0.5)')
    ])
