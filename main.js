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

    var LiveDevProtocol = null;
    try { LiveDevProtocol = brackets.getModule("LiveDevelopment/MultiBrowserImpl/protocol/LiveDevProtocol"); } catch (e) { /* optional */ }

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

    var EASINGS = ["ease", "ease-out", "ease-in", "ease-in-out", "linear", "cubic-bezier(.34,1.56,.64,1)"];

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
        var easing = opts.easing || "ease-out";
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
        return best;
    }

    function applyAnimation(anim, opts) {
        var sel = findMarkAtCursor();
        if (!sel) { flash("Click an element in the Live Preview first (or place your cursor on a tag)."); return; }
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
        var sel = findMarkAtCursor();
        var css = animCss(anim, opts);
        var js = '(function(){var el=document.querySelector(\'[data-brackets-id="' + (sel ? sel.mark.tagID : "") + '"]\');' +
            'if(!el)return;var s=document.getElementById("mo-trial")||document.createElement("style");s.id="mo-trial";' +
            's.textContent=' + JSON.stringify(css.keyframes + "\n.__mo-trial{animation:mo-kf-" + anim.id + " " + (opts.duration || anim.dur) + "ms " + (opts.easing || "ease-out") + " both" + (ATTENTION[anim.id] ? " infinite" : "") + "}") + ';' +
            'document.head.appendChild(s);el.classList.remove("__mo-trial");void el.offsetWidth;el.classList.add("__mo-trial");})();';
        try { LiveDevProtocol.evaluate(js); } catch (e) { /* ignore */ }
    }

    // ============================================================
    //  Panel UI
    // ============================================================
    var ui = { view: "gallery", duration: 600, easing: "ease-out", trigger: "load", cat: "entrance" };

    var $panel = $(
        '<div id="motion-panel" class="motion-panel">' +
        '  <div class="mo-header"><span class="mo-brand">✦ Motion</span>' +
        '    <div class="mo-target">no element selected</div></div>' +
        '  <div class="mo-controls"></div>' +
        '  <div class="mo-gallery"></div>' +
        '  <div class="mo-status"></div>' +
        '</div>'
    ).appendTo("body");
    $panel.hide();

    function renderControls() {
        var opts = EASINGS.map(function (e) { return '<option value="' + e + '"' + (e === ui.easing ? " selected" : "") + '>' + e + '</option>'; }).join("");
        var trg = ["load", "scroll", "hover"].map(function (t) { return '<button class="mo-trg' + (t === ui.trigger ? " on" : "") + '" data-trg="' + t + '">' + t + '</button>'; }).join("");
        $panel.find(".mo-controls").html(
            '<div class="mo-row"><label>Duration</label><input type="range" class="mo-dur" min="150" max="3000" step="50" value="' + ui.duration + '"><span class="mo-dur-val">' + ui.duration + 'ms</span></div>' +
            '<div class="mo-row"><label>Easing</label><select class="mo-easing">' + opts + '</select></div>' +
            '<div class="mo-row"><label>Trigger</label><div class="mo-trg-group">' + trg + '</div></div>'
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
    function renderTarget() {
        var sel = findMarkAtCursor();
        $panel.find(".mo-target").text(sel ? ("target: <" + sel.tag + ">") : "click an element in Live Preview");
    }
    function flash(msg) { $panel.find(".mo-status").text(msg); }

    function openPanel() {
        if (!$panel[0] || !document.body.contains($panel[0])) { $panel.appendTo("body"); }
        renderControls(); renderGallery(); renderTarget();
        $panel.show();
    }
    function closePanel() { $panel.hide(); }
    function togglePanel() { if ($panel.is(":visible")) { closePanel(); } else { openPanel(); } }

    // events
    $panel.on("input", ".mo-dur", function () { ui.duration = +this.value; $panel.find(".mo-dur-val").text(ui.duration + "ms"); });
    $panel.on("change", ".mo-easing", function () { ui.easing = this.value; });
    $panel.on("click", ".mo-trg", function () { ui.trigger = $(this).attr("data-trg"); renderControls(); });
    $panel.on("mouseenter", ".mo-tile", function () { var a = animById($(this).attr("data-anim")); if (a) { trial(a, ui); } });
    $panel.on("click", ".mo-tile", function () {
        var a = animById($(this).attr("data-anim"));
        if (a) { applyAnimation(a, { duration: ui.duration, easing: ui.easing, trigger: ui.trigger }); }
    });

    // toolbar button
    var $btn = $('<a href="#" id="motion-toolbar-btn" title="Motion" aria-label="Motion">✦</a>');
    var TOGGLE = "motion.toggle";
    $btn.on("click", function (e) { e.preventDefault(); e.stopPropagation(); togglePanel(); if ($panel.is(":visible")) { renderTarget(); } });
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
        // keep target label fresh when the user clicks around
        try {
            var em = brackets.getModule("editor/EditorManager");
            $(em).on("activeEditorChange", function () { if ($panel.is(":visible")) { renderTarget(); } });
        } catch (e) {}
        console.log("Motion ready.");
    });
});
