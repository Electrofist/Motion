/*global define, brackets, $ */

// Motion - apply CSS animations to any element visually, from the Live Preview.
//
// Flow: put the cursor in (or click, in the preview) an element -> pick an
// animation -> Motion writes a class onto that element's source tag and a managed
// <style> block (keyframes + rule) into the document. Clean, standard CSS out.
//
// Source mapping: Phoenix instruments the live preview with data-brackets-id and
// keeps CodeMirror marks tagged with the same id, so we can map the selected
// element to its exact source range. See findMarkAtCursor().

define(function (require, exports, module) {
    "use strict";

    var CommandManager   = brackets.getModule("command/CommandManager"),
        Menus            = brackets.getModule("command/Menus"),
        EditorManager    = brackets.getModule("editor/EditorManager"),
        PreferencesManager = brackets.getModule("preferences/PreferencesManager"),
        ExtensionUtils   = brackets.getModule("utils/ExtensionUtils"),
        AppInit          = brackets.getModule("utils/AppInit");

    var LiveDevProtocol = null, LiveDevMB = null, HTMLInstr = null;
    try { LiveDevProtocol = brackets.getModule("LiveDevelopment/MultiBrowserImpl/protocol/LiveDevProtocol"); } catch (e) { /* optional */ }
    try { LiveDevMB = brackets.getModule("LiveDevelopment/LiveDevMultiBrowser"); } catch (e) { /* optional */ }
    try { HTMLInstr = brackets.getModule("LiveDevelopment/MultiBrowserImpl/language/HTMLInstrumentation"); } catch (e) { /* optional */ }

    ExtensionUtils.loadStyleSheet(module, "style.css");

    var prefs = PreferencesManager.getExtensionPrefs("motion");
    var CLASS_PREFIX = "mo-";
    var STYLE_ID = "motion-animations";

    // ============================================================
    //  Animation catalog (pure data)
    // ============================================================
    // Each: id, label, cat (entrance|attention), dur (default ms), from/to keyframe
    // css. Keyframes are authored as {from, to} or a full `frames` string.
    var ANIMS = [
        { id: "fade-in",    label: "Fade In",      cat: "entrance", dur: 500, frames: "{from{opacity:0}to{opacity:1}}" },
        { id: "fade-up",    label: "Fade Up",      cat: "entrance", dur: 600, frames: "{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}" },
        { id: "fade-down",  label: "Fade Down",    cat: "entrance", dur: 600, frames: "{from{opacity:0;transform:translateY(-24px)}to{opacity:1;transform:translateY(0)}}" },
        { id: "slide-left", label: "Slide Left",   cat: "entrance", dur: 600, frames: "{from{opacity:0;transform:translateX(40px)}to{opacity:1;transform:translateX(0)}}" },
        { id: "slide-right",label: "Slide Right",  cat: "entrance", dur: 600, frames: "{from{opacity:0;transform:translateX(-40px)}to{opacity:1;transform:translateX(0)}}" },
        { id: "zoom-in",    label: "Zoom In",      cat: "entrance", dur: 500, frames: "{from{opacity:0;transform:scale(0.9)}to{opacity:1;transform:scale(1)}}" },
        { id: "pop",        label: "Pop",          cat: "entrance", dur: 450, frames: "{0%{opacity:0;transform:scale(0.8)}60%{opacity:1;transform:scale(1.05)}100%{transform:scale(1)}}" },
        { id: "bounce-in",  label: "Bounce In",    cat: "entrance", dur: 700, frames: "{0%{opacity:0;transform:translateY(30px)}60%{opacity:1;transform:translateY(-8px)}100%{transform:translateY(0)}}" },
        { id: "pulse",      label: "Pulse",        cat: "attention", dur: 900, frames: "{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}" },
        { id: "shake",      label: "Shake",        cat: "attention", dur: 600, frames: "{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}" },
        { id: "float",      label: "Float",        cat: "attention", dur: 3000, frames: "{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}" },
        { id: "spin",       label: "Spin",         cat: "attention", dur: 1200, frames: "{from{transform:rotate(0)}to{transform:rotate(360deg)}}" }
    ];
    var ATTENTION = { pulse: 1, shake: 1, float: 1, spin: 1 };
    function animById(id) { for (var i = 0; i < ANIMS.length; i++) { if (ANIMS[i].id === id) { return ANIMS[i]; } } return null; }
    // Exact set of classes Motion may add — used by Reset to strip only our own classes.
    var MO_CLASSES = ANIMS.map(function (a) { return CLASS_PREFIX + a.id; });
    function isMoClass(c) { return MO_CLASSES.indexOf(c) !== -1; }

    // Static "what does this do" glyph per animation (drawn like the gallery reference:
    // a solid accent block + faded ghost trail + direction arrows). Uses currentColor so
    // the tile controls the hue; ghosts use opacity. viewBox is 44x44. The main block is
    // tagged .mo-blk so the tile can also live-animate it on hover.
    var A = 'stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"';
    var GLYPHS = {
        "fade-in":
            '<rect x="14" y="13" width="5" height="18" rx="2" fill="currentColor" opacity=".28"/>' +
            '<rect x="20" y="13" width="5" height="18" rx="2" fill="currentColor" opacity=".58"/>' +
            '<rect class="mo-blk" x="26" y="13" width="5" height="18" rx="2" fill="currentColor"/>',
        "fade-up":
            '<rect x="15" y="21" width="14" height="6" rx="3" fill="currentColor" opacity=".25"/>' +
            '<rect x="15" y="14" width="14" height="6" rx="3" fill="currentColor" opacity=".5"/>' +
            '<rect class="mo-blk" x="15" y="7" width="14" height="6" rx="3" fill="currentColor"/>' +
            '<path d="M36 27V15m0 0l-3 3m3-3l3 3" ' + A + '/>',
        "fade-down":
            '<rect x="15" y="7" width="14" height="6" rx="3" fill="currentColor" opacity=".25"/>' +
            '<rect x="15" y="14" width="14" height="6" rx="3" fill="currentColor" opacity=".5"/>' +
            '<rect class="mo-blk" x="15" y="21" width="14" height="6" rx="3" fill="currentColor"/>' +
            '<path d="M36 11v12m0 0l-3-3m3 3l3-3" ' + A + '/>',
        "slide-right":
            '<rect x="9" y="16" width="13" height="13" rx="3" fill="currentColor" opacity=".25"/>' +
            '<rect x="14" y="16" width="13" height="13" rx="3" fill="currentColor" opacity=".5"/>' +
            '<rect class="mo-blk" x="19" y="16" width="13" height="13" rx="3" fill="currentColor"/>' +
            '<path d="M15 35h12m0 0l-3-3m3 3l-3 3" ' + A + '/>',
        "slide-left":
            '<rect x="22" y="16" width="13" height="13" rx="3" fill="currentColor" opacity=".25"/>' +
            '<rect x="17" y="16" width="13" height="13" rx="3" fill="currentColor" opacity=".5"/>' +
            '<rect class="mo-blk" x="12" y="16" width="13" height="13" rx="3" fill="currentColor"/>' +
            '<path d="M29 35H17m0 0l3-3m-3 3l3 3" ' + A + '/>',
        "zoom-in":
            '<rect class="mo-blk" x="15" y="15" width="14" height="14" rx="3" fill="currentColor"/>' +
            '<path d="M13 13L8 8m0 0v4m0-4h4" ' + A + '/>' +
            '<path d="M31 13l5-5m0 0v4m0-4h-4" ' + A + '/>' +
            '<path d="M13 31l-5 5m0 0v-4m0 4h4" ' + A + '/>' +
            '<path d="M31 31l5 5m0 0v-4m0 4h-4" ' + A + '/>',
        "pop":
            '<path d="M11 17c-2.4 2.4-2.4 8 0 10.5" ' + A + ' opacity=".7"/>' +
            '<path d="M7 14c-3.6 3.6-3.6 12.5 0 16" ' + A + ' opacity=".35"/>' +
            '<path d="M33 17c2.4 2.4 2.4 8 0 10.5" ' + A + ' opacity=".7"/>' +
            '<path d="M37 14c3.6 3.6 3.6 12.5 0 16" ' + A + ' opacity=".35"/>' +
            '<rect class="mo-blk" x="15" y="14" width="14" height="16" rx="4" fill="currentColor"/>' +
            '<rect x="19.5" y="18.5" width="5" height="7" rx="1.5" fill="var(--z900)"/>',
        "bounce-in":
            '<rect x="15" y="9" width="14" height="6" rx="3" fill="currentColor" opacity=".3"/>' +
            '<rect class="mo-blk" x="15" y="20" width="14" height="7" rx="3" fill="currentColor"/>' +
            '<path d="M36 27V14m0 0l-3 3m3-3l3 3" ' + A + '/>',
        "pulse":
            '<rect x="11" y="11" width="22" height="22" rx="6" ' + A + ' opacity=".3"/>' +
            '<rect x="15" y="15" width="14" height="14" rx="4" ' + A + ' opacity=".55"/>' +
            '<rect class="mo-blk" x="18" y="18" width="8" height="8" rx="2.5" fill="currentColor"/>',
        "shake":
            '<rect class="mo-blk" x="15" y="14" width="14" height="14" rx="3" fill="currentColor"/>' +
            '<path d="M11 21H5m0 0l3-3m-3 3l3 3" ' + A + '/>' +
            '<path d="M33 21h6m0 0l-3-3m3 3l-3 3" ' + A + '/>',
        "float":
            '<rect class="mo-blk" x="14" y="15" width="14" height="14" rx="3" fill="currentColor"/>' +
            '<path d="M36 11v22m0-22l-3 3m3-3l3 3m-3 16l-3-3m3 3l3-3" ' + A + '/>',
        "spin":
            '<rect class="mo-blk" x="16" y="16" width="12" height="12" rx="3" fill="currentColor"/>' +
            '<path d="M31 15a12 12 0 1 0 4 8" ' + A + '/>' +
            '<path d="M35 14v6h-6" ' + A + '/>'
    };
    function glyphSvg(id) {
        return '<svg class="mo-glyph" viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">' + (GLYPHS[id] || '') + '</svg>';
    }

    // Impeccable craft floor: default to exponential ease-out, not reflexive bounce.
    var DEFAULT_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
    var EASINGS = [
        { v: DEFAULT_EASE,                  label: "Ease out — natural" },
        { v: "ease-out",                    label: "Ease out" },
        { v: "ease-in-out",                 label: "Ease in-out" },
        { v: "ease",                        label: "Ease" },
        { v: "linear",                      label: "Linear" },
        { v: "cubic-bezier(.34,1.56,.64,1)", label: "Overshoot" } // impeccable-disable-line bounce-easing -- user-selectable catalog easing, not a UI default
    ];

    // ============================================================
    //  Pure CSS/HTML helpers (unit-tested in test/motion.test.js)
    // ============================================================
    // Add a class to an opening tag string, preserving existing classes.
    function mergeClass(openTag, cls) {
        if (!openTag || !cls) { return openTag; }
        var m = openTag.match(/^(<[a-zA-Z][\w-]*)([\s\S]*?)(\/?>)$/);
        if (!m) { return openTag; }
        var head = m[1], attrs = m[2], tail = m[3];
        var cm = attrs.match(/\sclass\s*=\s*("([^"]*)"|'([^']*)')/);
        if (cm) {
            var val = cm[2] != null ? cm[2] : cm[3];
            var list = val.split(/\s+/).filter(Boolean);
            if (list.indexOf(cls) !== -1) { return openTag; } // already has it
            list.push(cls);
            var quote = cm[0].indexOf("'") !== -1 ? "'" : '"';
            var newAttr = ' class=' + quote + list.join(" ") + quote;
            return head + attrs.replace(cm[0], newAttr) + tail;
        }
        // no class attr: add one right after the tag name
        return head + ' class="' + cls + '"' + attrs + tail;
    }

    // The CSS for one animation: @keyframes + the trigger rule(s).
    function animCss(anim, opts) {
        opts = opts || {};
        var dur = opts.duration || anim.dur;
        var easing = opts.easing || DEFAULT_EASE;
        var trigger = opts.trigger || "load";
        var kfName = "mo-kf-" + anim.id;
        var cls = "." + CLASS_PREFIX + anim.id;
        var shorthand = kfName + " " + dur + "ms " + easing + " both";
        var iteration = ATTENTION[anim.id] ? " infinite" : "";
        var kf = "@keyframes " + kfName + " " + anim.frames;
        var rule;
        if (trigger === "hover") {
            rule = cls + ":hover{animation:" + shorthand + iteration + "}";
        } else if (trigger === "scroll") {
            // paused until IntersectionObserver adds .in-view (see OBSERVER)
            rule = cls + "{opacity:0}" + cls + ".in-view{animation:" + shorthand + iteration + "}";
        } else {
            rule = cls + "{animation:" + shorthand + iteration + "}";
        }
        return { keyframes: kf, rule: rule, cls: CLASS_PREFIX + anim.id, scroll: trigger === "scroll" };
    }

    // Merge a new anim's CSS into an existing managed style block body (dedup by name).
    function mergeStyleBody(existingBody, css) {
        var body = existingBody || "";
        if (body.indexOf(css.keyframes.split("{")[0]) === -1) { body += "\n" + css.keyframes; }
        // replace an existing rule for this class, else append
        var clsSel = css.rule.split("{")[0];
        var re = new RegExp(clsSel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{[^}]*\\}[^\\n]*", "g");
        if (re.test(body)) { body = body.replace(re, css.rule); }
        else { body += "\n" + css.rule; }
        return body.replace(/^\n+/, "");
    }

    var OBSERVER =
        '\n<script data-motion>\n' +
        '  (function(){var io=new IntersectionObserver(function(es){es.forEach(function(e){' +
        'if(e.isIntersecting){e.target.classList.add("in-view");io.unobserve(e.target);}})},{threshold:0.15});' +
        'document.querySelectorAll(\'[class*="' + CLASS_PREFIX + '"]\').forEach(function(el){io.observe(el);});})();\n' +
        '</script>';

    // ============================================================
    //  Phoenix integration
    // ============================================================
    function activeEditor() { return EditorManager.getActiveEditor() || EditorManager.getCurrentFullEditor(); }

    // The instrumented mark for the innermost element containing the cursor.
    function findMarkAtCursor() {
        var ed = activeEditor();
        if (!ed || !ed._codeMirror) { return null; }
        var cm = ed._codeMirror, pos = cm.getCursor();
        var marks = cm.getAllMarks().filter(function (m) { return m.tagID != null && m.find(); });
        var best = null, bestSpan = Infinity;
        marks.forEach(function (m) {
            var r = m.find();
            if (!r) { return; }
            var afterFrom = (pos.line > r.from.line) || (pos.line === r.from.line && pos.ch >= r.from.ch);
            var beforeTo  = (pos.line < r.to.line)   || (pos.line === r.to.line   && pos.ch <= r.to.ch);
            if (afterFrom && beforeTo) {
                var span = (r.to.line - r.from.line) * 100000 + (r.to.ch - r.from.ch);
                if (span < bestSpan) { bestSpan = span; best = { mark: m, from: r.from, to: r.to }; }
            }
        });
        if (!best) { return null; }
        var text = cm.getRange(best.from, best.to);
        var gt = text.indexOf(">");
        best.openTag = gt >= 0 ? text.slice(0, gt + 1) : text;
        best.tag = (best.openTag.match(/^<([a-zA-Z][\w-]*)/) || [])[1] || "element";
        best.doc = ed.document;
        best.fullText = text;
        best.tagId = best.mark.tagID;
        return best;
    }

    // The editor holding the previewed HTML (works even in design mode, editor hidden).
    function liveEditor() {
        if (LiveDevMB && LiveDevMB.getCurrentLiveDoc) {
            var ld = LiveDevMB.getCurrentLiveDoc();
            if (ld && ld.editor && ld.editor._codeMirror) { return ld.editor; }
        }
        return activeEditor();
    }

    // Resolve the *live-preview-selected* element (set by clicks in the preview) to its
    // source range. Falls back to the cursor-based mark if nothing has been picked yet.
    function resolveSelection() {
        if (ui.sel && ui.sel.tagId != null && HTMLInstr && HTMLInstr.getPositionFromTagId) {
            var ed = liveEditor();
            if (ed && ed._codeMirror) {
                var range = HTMLInstr.getPositionFromTagId(ed, parseInt(ui.sel.tagId, 10));
                if (range && range.from && range.to) {
                    var cm = ed._codeMirror;
                    var text = cm.getRange(range.from, range.to);
                    var gt = text.indexOf(">");
                    var openTag = gt >= 0 ? text.slice(0, gt + 1) : text;
                    var tag = (openTag.match(/^<([a-zA-Z][\w-]*)/) || [])[1] || "element";
                    return {
                        tagId: parseInt(ui.sel.tagId, 10), mark: { tagID: parseInt(ui.sel.tagId, 10) },
                        from: range.from, to: range.to, openTag: openTag, tag: tag,
                        doc: ed.document, fullText: text
                    };
                }
            }
        }
        return findMarkAtCursor();
    }

    // Parse tag / id / classes / text preview out of a resolved selection for the info bar.
    function selectionMeta() {
        var r = resolveSelection();
        if (!r) { return null; }
        var open = r.openTag || "";
        var clsM = open.match(/class\s*=\s*("([^"]*)"|'([^']*)')/);
        var classes = clsM ? (clsM[2] != null ? clsM[2] : clsM[3]).split(/\s+/).filter(Boolean) : [];
        var idM = open.match(/\bid\s*=\s*("([^"]*)"|'([^']*)')/);
        var domId = idM ? (idM[2] != null ? idM[2] : idM[3]) : "";
        var inner = (r.fullText || "").replace(/^<[^>]*>/, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        return { tag: r.tag, id: domId, classes: classes, text: inner.slice(0, 42) };
    }

    function applyAnimation(anim, opts) {
        var sel = resolveSelection();
        if (!sel) { flash("Click an element in the Live Preview to select it first."); return; }
        var css = animCss(anim, opts);
        var doc = sel.doc;
        doc.batchOperation(function () {
            // 1) merge the class onto the element's opening tag
            var newOpen = mergeClass(sel.openTag, css.cls);
            if (newOpen !== sel.openTag) {
                var openTo = { line: sel.from.line, ch: sel.from.ch + sel.openTag.length };
                doc.replaceRange(newOpen, sel.from, openTo);
            }
            // 2) ensure the managed <style> block (keyframes + rule)
            ensureStyleBlock(doc, css);
            // 3) scroll trigger needs the observer helper once
            if (css.scroll) { ensureObserver(doc); }
        });
        flash("Applied " + anim.label + " to <" + sel.tag + ">");
        refreshSelMeta();
        updateSelbar();
    }

    // Remove every Motion artifact from the previewed document: our classes, the managed
    // <style> block and the scroll observer. Uses incremental replaceRange edits (never
    // setText) so the live-preview instrumentation / brackets-ids stay in sync.
    function resetAll() {
        var ed = liveEditor();
        var doc = ed && ed.document ? ed.document : (activeEditor() && activeEditor().document);
        if (!doc) { flash("Open an HTML file in Live Preview to reset."); return; }
        var text = doc.getText(), edits = [], m;
        // managed <style> block(s)
        var reStyle = /[ \t]*<style id="motion-animations">[\s\S]*?<\/style>[ \t]*\r?\n?/g;
        while ((m = reStyle.exec(text))) { edits.push([m.index, m.index + m[0].length, ""]); }
        // scroll observer script(s)
        var reScript = /[ \t]*<script data-motion>[\s\S]*?<\/script>[ \t]*\r?\n?/g;
        while ((m = reScript.exec(text))) { edits.push([m.index, m.index + m[0].length, ""]); }
        // strip Motion classes from class attributes (only our own classes)
        var reClass = /\sclass\s*=\s*("([^"]*)"|'([^']*)')/g;
        while ((m = reClass.exec(text))) {
            var val = m[2] != null ? m[2] : m[3];
            var list = val.split(/\s+/).filter(Boolean);
            if (!list.some(isMoClass)) { continue; }
            var kept = list.filter(function (c) { return !isMoClass(c); });
            edits.push([m.index, m.index + m[0].length, kept.length ? ' class="' + kept.join(" ") + '"' : ""]);
        }
        if (!edits.length) { flash("Nothing to reset — no Motion animations found."); return; }
        var count = edits.length;
        // apply END -> START so earlier offsets stay valid and marks are preserved
        edits.sort(function (a, b) { return b[0] - a[0]; });
        doc.batchOperation(function () {
            edits.forEach(function (e) { doc.replaceRange(e[2], posFromOffset(doc, e[0]), posFromOffset(doc, e[1])); });
        });
        ui.sel = null; ui.selMeta = null;
        updateSelbar();
        flash("Reset — cleared Motion animations (" + count + " edit" + (count > 1 ? "s" : "") + ").");
    }

    // Insert or update the managed <style id="motion-animations"> block in <head>.
    function ensureStyleBlock(doc, css) {
        var text = doc.getText();
        var open = '<style id="' + STYLE_ID + '">';
        var idx = text.indexOf(open);
        if (idx !== -1) {
            var end = text.indexOf("</style>", idx);
            var body = text.slice(idx + open.length, end);
            var merged = mergeStyleBody(body, css);
            replaceByOffset(doc, idx + open.length, end, "\n" + merged.trim() + "\n");
        } else {
            var block = "\n" + open + "\n" + mergeStyleBody("", css).trim() + "\n</style>\n";
            var headClose = text.indexOf("</head>");
            if (headClose !== -1) { insertAtOffset(doc, headClose, block); }
            else { insertAtOffset(doc, 0, block); }
        }
    }

    function ensureObserver(doc) {
        var text = doc.getText();
        if (text.indexOf("<script data-motion>") !== -1) { return; }
        var bodyClose = text.indexOf("</body>");
        if (bodyClose !== -1) { insertAtOffset(doc, bodyClose, OBSERVER + "\n"); }
    }

    // offset helpers (doc uses line/ch; convert)
    function posFromOffset(doc, offset) {
        var text = doc.getText().slice(0, offset), line = 0, last = -1, i;
        for (i = 0; i < text.length; i++) { if (text[i] === "\n") { line++; last = i; } }
        return { line: line, ch: offset - last - 1 };
    }
    function insertAtOffset(doc, offset, str) { doc.replaceRange(str, posFromOffset(doc, offset)); }
    function replaceByOffset(doc, start, end, str) { doc.replaceRange(str, posFromOffset(doc, start), posFromOffset(doc, end)); }

    // Preview an animation live without touching source (best-effort via LiveDevProtocol).
    function trial(anim, opts) {
        if (!LiveDevProtocol || !LiveDevProtocol.evaluate) { flash("Open Live Preview to trial."); return; }
        var sel = resolveSelection();
        if (!sel) { return; }
        var css = animCss(anim, opts);
        var js = '(function(){var el=document.querySelector(\'[data-brackets-id="' + (sel.tagId != null ? sel.tagId : (sel.mark ? sel.mark.tagID : "")) + '"]\');' +
            'if(!el)return;var s=document.getElementById("mo-trial")||document.createElement("style");s.id="mo-trial";' +
            's.textContent=' + JSON.stringify(css.keyframes + "\n.__mo-trial{animation:mo-kf-" + anim.id + " " + (opts.duration || anim.dur) + "ms " + (opts.easing || DEFAULT_EASE) + " both" + (ATTENTION[anim.id] ? " infinite" : "") + "}") + ';' +
            'document.head.appendChild(s);el.classList.remove("__mo-trial");void el.offsetWidth;el.classList.add("__mo-trial");})();';
        try { LiveDevProtocol.evaluate(js); } catch (e) { /* ignore */ }
    }

    // ============================================================
    //  Panel UI
    // ============================================================
    var ui = { view: "gallery", selected: null, sel: null, selMeta: null, duration: 600, easing: DEFAULT_EASE, trigger: "load" };

    // Duration <-> Speed mapping. The speed slider runs slow (left) -> fast (right);
    // internally both drive the same duration in ms.
    var DUR_MIN = 150, DUR_MAX = 3000;
    function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
    function speedToDur(v) { return Math.round(DUR_MAX - (v / 100) * (DUR_MAX - DUR_MIN)); }
    function durToSpeed(d) { return clamp(Math.round((DUR_MAX - d) / (DUR_MAX - DUR_MIN) * 100), 0, 100); }

    var $panel = $(
        '<div id="motion-panel" class="motion-panel">' +
        '  <div class="mo-header">' +
        '    <span class="mo-brand">✦ Motion</span>' +
        '    <div class="mo-head-actions">' +
        '      <button class="mo-reset" title="Remove all applied animations">↺ Reset</button>' +
        '      <button class="mo-close" title="Close" aria-label="Close">✕</button>' +
        '    </div>' +
        '  </div>' +
        '  <div class="mo-controls"></div>' +
        '  <div class="mo-selbar"></div>' +
        '  <div class="mo-gallery"></div>' +
        '  <div class="mo-settings"></div>' +
        '  <div class="mo-status"></div>' +
        '</div>'
    ).appendTo("body");
    $panel.hide();

    // Top controls: Trigger only. Easing / Speed / Duration live in the per-animation
    // settings view (shown after you pick an animation).
    function renderControls() {
        var trg = ["load", "scroll", "hover"].map(function (t) { return '<button class="mo-trg' + (t === ui.trigger ? " on" : "") + '" data-trg="' + t + '">' + t + '</button>'; }).join("");
        $panel.find(".mo-controls").html(
            '<div class="mo-row"><label>Trigger</label><div class="mo-trg-group">' + trg + '</div></div>'
        );
    }

    // Per-animation settings: easing, speed (slider) and duration (editable number).
    function renderSettings() {
        var a = animById(ui.selected);
        if (!a) { return; }
        var opts = EASINGS.map(function (e) { return '<option value="' + e.v + '"' + (e.v === ui.easing ? " selected" : "") + '>' + e.label + '</option>'; }).join("");
        $panel.find(".mo-settings").html(
            '<div class="mo-set-head">' +
            '  <button class="mo-back" title="Back to gallery">‹</button>' +
            '  <span class="mo-set-title">' + glyphSvg(a.id) + '<span>' + a.label + '</span></span>' +
            '</div>' +
            '<div class="mo-row"><label>Easing</label><select class="mo-easing">' + opts + '</select></div>' +
            '<div class="mo-row"><label>Speed</label>' +
            '  <span class="mo-speed-end">Slow</span>' +
            '  <input type="range" class="mo-speed" min="0" max="100" step="1" value="' + durToSpeed(ui.duration) + '">' +
            '  <span class="mo-speed-end">Fast</span></div>' +
            '<div class="mo-row"><label>Duration</label>' +
            '  <input type="number" class="mo-dur-num" min="' + DUR_MIN + '" max="5000" step="10" value="' + ui.duration + '">' +
            '  <span class="mo-unit">ms</span></div>' +
            '<button class="mo-apply">Apply ' + a.label + '</button>'
        );
    }
    function tileHtml(a) {
        return '<button class="mo-tile" data-anim="' + a.id + '" title="' + a.label + '">' +
            '<span class="mo-thumb">' + glyphSvg(a.id) + '</span>' +
            '<span class="mo-tile-label">' + a.label + '</span></button>';
    }
    var CATS = [
        { key: "entrance",  label: "Entrance" },
        { key: "attention", label: "Attention" }
    ];
    function renderGallery() {
        var html = CATS.map(function (c) {
            var tiles = ANIMS.filter(function (a) { return a.cat === c.key; }).map(tileHtml).join("");
            if (!tiles) { return ""; }
            return '<div class="mo-cat">' + c.label + '</div><div class="mo-grid">' + tiles + '</div>';
        }).join("");
        $panel.find(".mo-gallery").html(html);
    }
    function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

    // Selection info bar: shows exactly what's selected in the Live Preview.
    // Uses the cached ui.selMeta so it stays put across re-instrumentation (e.g. after Apply).
    function refreshSelMeta() { var m = selectionMeta(); if (m) { ui.selMeta = m; } return ui.selMeta; }
    function updateSelbar() {
        var $b = $panel.find(".mo-selbar");
        var m = ui.selMeta;
        if (!m) {
            $b.removeClass("has-sel").html('<span class="mo-sel-dot"></span><span class="mo-sel-desc mo-sel-empty">No element selected — click one in the Live Preview</span>');
            return;
        }
        var applied = m.classes.filter(isMoClass);
        var userCls = m.classes.filter(function (c) { return !isMoClass(c); });
        var sig = '<b>' + esc(m.tag) + '</b>' +
            (m.id ? '<span class="mo-sel-id">#' + esc(m.id) + '</span>' : '') +
            userCls.map(function (c) { return '<span class="mo-sel-cls">.' + esc(c) + '</span>'; }).join('');
        var txt = m.text ? '<span class="mo-sel-text">“' + esc(m.text) + '”</span>' : '';
        var badge = applied.length ? '<span class="mo-sel-badge">' + applied.length + ' anim' + (applied.length > 1 ? 's' : '') + '</span>' : '';
        $b.addClass("has-sel").html('<span class="mo-sel-dot on"></span><span class="mo-sel-desc">' + sig + txt + '</span>' + badge);
    }

    // Fired when the user clicks an element in the Live Preview (works in design mode).
    function onPreviewClicked(e, msg) {
        if (!msg || msg.tagId == null) { return; }
        ui.sel = { tagId: parseInt(msg.tagId, 10) };
        refreshSelMeta();
        updateSelbar();
        if ($panel.is(":visible") && ui.view === "settings") { updateApplyState(); trialSelected(); }
    }
    function initLiveSelection() {
        if (!LiveDevMB || !LiveDevMB.EVENT_LIVE_PREVIEW_CLICKED) { return; }
        var EV = LiveDevMB.EVENT_LIVE_PREVIEW_CLICKED + ".motion";
        try { LiveDevMB.off(EV); } catch (e) { /* ignore */ }
        LiveDevMB.on(EV, onPreviewClicked);
    }

    function flash(msg) { $panel.find(".mo-status").text(msg); }

    // View switching between the gallery and the per-animation settings.
    function showGallery() {
        ui.view = "gallery";
        $panel.find(".mo-settings").hide();
        $panel.find(".mo-gallery").show();
    }
    function showSettings(id) {
        ui.view = "settings";
        ui.selected = id;
        renderSettings();
        updateApplyState();
        $panel.find(".mo-gallery").hide();
        $panel.find(".mo-settings").show();
        var a = animById(id);
        if (a) { trial(a, ui); } // preview immediately
    }
    function trialSelected() { var a = animById(ui.selected); if (a) { trial(a, ui); } }

    // Apply is only meaningful with a selected element — disable it with a clear
    // reason rather than letting the click fail with an after-the-fact error.
    function updateApplyState() {
        var $a = $panel.find(".mo-apply");
        if (!$a.length) { return; }
        var a = animById(ui.selected);
        var has = !!ui.selMeta;
        $a.prop("disabled", !has).text(has ? ("Apply " + (a ? a.label : "")) : "Select an element to apply");
    }

    function openPanel() {
        if (!$panel[0] || !document.body.contains($panel[0])) { $panel.appendTo("body"); }
        renderControls(); renderGallery(); refreshSelMeta(); updateSelbar();
        showGallery();
        // replay the entrance animation each time the panel opens
        $panel.removeClass("mo-open").show();
        if ($panel[0]) { void $panel[0].offsetWidth; }
        $panel.addClass("mo-open");
    }
    function closePanel() { $panel.hide().removeClass("mo-open"); }
    function togglePanel() { if ($panel.is(":visible")) { closePanel(); } else { openPanel(); } }

    // events
    $panel.on("click", ".mo-close", function (e) { e.preventDefault(); closePanel(); });
    $panel.on("click", ".mo-reset", function (e) { e.preventDefault(); resetAll(); });
    $panel.on("click", ".mo-trg", function () { ui.trigger = $(this).attr("data-trg"); renderControls(); });
    // gallery: hover previews, click opens that animation's settings
    $panel.on("mouseenter", ".mo-tile", function () { var a = animById($(this).attr("data-anim")); if (a) { trial(a, ui); } });
    $panel.on("click", ".mo-tile", function () { showSettings($(this).attr("data-anim")); });
    // settings
    $panel.on("click", ".mo-back", function () { showGallery(); });
    $panel.on("change", ".mo-easing", function () { ui.easing = this.value; trialSelected(); });
    $panel.on("input", ".mo-speed", function () {
        ui.duration = speedToDur(+this.value);
        $panel.find(".mo-dur-num").val(ui.duration);
        trialSelected();
    });
    $panel.on("input", ".mo-dur-num", function () {
        ui.duration = clamp(+this.value || DUR_MIN, DUR_MIN, 5000);
        $panel.find(".mo-speed").val(durToSpeed(ui.duration));
    });
    $panel.on("change", ".mo-dur-num", function () {
        ui.duration = clamp(+this.value || DUR_MIN, DUR_MIN, 5000);
        this.value = ui.duration;
        $panel.find(".mo-speed").val(durToSpeed(ui.duration));
        trialSelected();
    });
    $panel.on("click", ".mo-apply", function () {
        var a = animById(ui.selected);
        if (a) { applyAnimation(a, { duration: ui.duration, easing: ui.easing, trigger: ui.trigger }); }
    });

    // toolbar button
    var $btn = $('<a href="#" id="motion-toolbar-btn" title="Motion" aria-label="Motion">✦</a>');
    var TOGGLE = "motion.toggle";
    $btn.on("click", function (e) { e.preventDefault(); e.stopPropagation(); togglePanel(); if ($panel.is(":visible")) { updateSelbar(); } });
    $(document).on("mousedown.motion", function (e) {
        if (!$panel.is(":visible")) { return; }
        if ($(e.target).closest("#motion-panel, #motion-toolbar-btn").length) { return; }
        closePanel();
    });

    AppInit.appReady(function () {
        var $tb = $("#main-toolbar");
        if ($tb.length) { var $g = $tb.find(".buttons").first(); ($g.length ? $g : $tb).append($btn); }
        CommandManager.register("Toggle Motion", TOGGLE, togglePanel);
        try { var vm = Menus.getMenu(Menus.AppMenuBar.VIEW_MENU); if (vm) { vm.addMenuItem(TOGGLE); } } catch (e) {}
        // track element selection coming from clicks in the Live Preview
        initLiveSelection();
        try {
            var em = brackets.getModule("editor/EditorManager");
            $(em).on("activeEditorChange", function () { if ($panel.is(":visible")) { updateSelbar(); } });
        } catch (e) {}
        console.log("Motion ready.");
    });
    // Also (re)subscribe immediately in case appReady already fired (hot-reload path).
    initLiveSelection();
});
