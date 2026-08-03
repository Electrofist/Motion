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
        ExtensionUtils   = brackets.getModule("utils/ExtensionUtils"),
        AppInit          = brackets.getModule("utils/AppInit");

    var LiveDevProtocol = null, LiveDevMB = null, HTMLInstr = null;
    try { LiveDevProtocol = brackets.getModule("LiveDevelopment/MultiBrowserImpl/protocol/LiveDevProtocol"); } catch (e) { /* optional */ }
    try { LiveDevMB = brackets.getModule("LiveDevelopment/LiveDevMultiBrowser"); } catch (e) { /* optional */ }
    try { HTMLInstr = brackets.getModule("LiveDevelopment/MultiBrowserImpl/language/HTMLInstrumentation"); } catch (e) { /* optional */ }

    ExtensionUtils.loadStyleSheet(module, "style.css");

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
        { id: "spin",       label: "Spin",         cat: "attention", dur: 1200, frames: "{from{transform:rotate(0)}to{transform:rotate(360deg)}}" },
        { id: "flip-in",    label: "Flip In",      cat: "entrance", dur: 650, frames: "{0%{opacity:0;transform:perspective(420px) rotateX(80deg)}60%{opacity:1;transform:perspective(420px) rotateX(-12deg)}100%{transform:perspective(420px) rotateX(0)}}" },
        { id: "roll-in",    label: "Roll In",      cat: "entrance", dur: 700, frames: "{0%{opacity:0;transform:translateX(-100%) rotate(-120deg)}100%{opacity:1;transform:translateX(0) rotate(0)}}" },
        { id: "blur-in",    label: "Blur In",      cat: "entrance", dur: 600, frames: "{0%{opacity:0;filter:blur(12px)}100%{opacity:1;filter:blur(0)}}" },
        { id: "wobble",     label: "Wobble",       cat: "attention", dur: 900, frames: "{0%,100%{transform:translateX(0)}15%{transform:translateX(-25%) rotate(-5deg)}30%{transform:translateX(20%) rotate(3deg)}45%{transform:translateX(-15%) rotate(-3deg)}60%{transform:translateX(10%) rotate(2deg)}75%{transform:translateX(-5%) rotate(-1deg)}}" },
        { id: "heartbeat",  label: "Heartbeat",    cat: "attention", dur: 1300, frames: "{0%{transform:scale(1)}14%{transform:scale(1.3)}28%{transform:scale(1)}42%{transform:scale(1.3)}70%{transform:scale(1)}}" },
        { id: "tada",       label: "Tada",         cat: "attention", dur: 900, frames: "{0%{transform:scale(1) rotate(0)}10%,20%{transform:scale(.9) rotate(-3deg)}30%,50%,70%,90%{transform:scale(1.1) rotate(3deg)}40%,60%,80%{transform:scale(1.1) rotate(-3deg)}100%{transform:scale(1) rotate(0)}}" }
    ];
    // Which animations loop continuously (animation-iteration-count: infinite).
    var ATTENTION = { pulse: 1, shake: 1, float: 1, spin: 1, heartbeat: 1 };
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
            '<path d="M35 14v6h-6" ' + A + '/>',
        "flip-in":
            '<rect class="mo-blk" x="13" y="10" width="18" height="16" rx="3" fill="currentColor"/>' +
            '<line x1="13" y1="18" x2="31" y2="18" stroke="var(--z900)" stroke-width="1.5" opacity=".45"/>' +
            '<path d="M35 12c3 2.5 3 7.5 0 10" ' + A + ' opacity=".6"/>' +
            '<path d="M35 22l-1-3m1 3l3-1" ' + A + ' opacity=".6"/>',
        "roll-in":
            '<rect class="mo-blk" x="18" y="16" width="14" height="14" rx="3" fill="currentColor"/>' +
            '<path d="M10 33c-3-9 3-17 12-19" ' + A + ' opacity=".5"/>' +
            '<path d="M22 12l-2 2m2-2l2 2" ' + A + ' opacity=".5"/>',
        "blur-in":
            '<rect x="11" y="11" width="22" height="22" rx="6" fill="currentColor" opacity=".16"/>' +
            '<rect x="14" y="14" width="16" height="16" rx="4.5" fill="currentColor" opacity=".34"/>' +
            '<rect class="mo-blk" x="16.5" y="16.5" width="11" height="11" rx="3" fill="currentColor"/>',
        "wobble":
            '<rect class="mo-blk" x="15" y="15" width="14" height="14" rx="3" fill="currentColor"/>' +
            '<path d="M10 29q-4-7 0-14" ' + A + ' opacity=".55"/>' +
            '<path d="M10 15l-2 3m2-3l3 1" ' + A + ' opacity=".55"/>' +
            '<path d="M34 15q4 7 0 14" ' + A + ' opacity=".55"/>' +
            '<path d="M34 29l2-3m-2 3l-3-1" ' + A + ' opacity=".55"/>',
        "heartbeat":
            '<path class="mo-blk" d="M22 30.5C11.5 22.5 8 18 11.5 14.2 14 11.5 18.7 12 22 15.6 25.3 12 30 11.5 32.5 14.2 36 18 32.5 22.5 22 30.5Z" fill="currentColor"/>',
        "tada":
            '<rect class="mo-blk" x="15" y="15" width="14" height="14" rx="3" fill="currentColor"/>' +
            '<path d="M22 6v5M22 33v5M6 22h5M33 22h5M11 11l3.5 3.5M33 11l-3.5 3.5M11 33l3.5-3.5M33 33l-3.5-3.5" ' + A + ' opacity=".6"/>'
    };
    function glyphSvg(id) {
        return '<svg class="mo-glyph" viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">' + (GLYPHS[id] || '') + '</svg>';
    }

    // ============================================================
    //  <PURE-HELPERS>  (extracted & unit-tested in test/motion.test.js —
    //  everything between the PURE-HELPERS sentinels must stay side-effect-free
    //  and reference only CLASS_PREFIX / ATTENTION or values declared in here.)
    // ============================================================

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

    // Duration <-> Speed mapping. The speed slider runs slow (left) -> fast (right);
    // both drive the same duration in ms. Slider range == input range (no mismatch).
    var DUR_MIN = 150, DUR_MAX = 3000;
    function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
    function speedToDur(v) { return Math.round(DUR_MAX - (v / 100) * (DUR_MAX - DUR_MIN)); }
    function durToSpeed(d) { return clamp(Math.round((DUR_MAX - d) / (DUR_MAX - DUR_MIN) * 100), 0, 100); }

    // Return the opening tag up to the first ">" that is OUTSIDE any quoted
    // attribute value (a naive indexOf(">") splits <a title="x>y" class="c">).
    function sliceOpenTag(text) {
        var q = null;
        for (var i = 0; i < text.length; i++) {
            var c = text.charAt(i);
            if (q) { if (c === q) { q = null; } }
            else if (c === '"' || c === "'") { q = c; }
            else if (c === ">") { return text.slice(0, i + 1); }
        }
        return text;
    }

    // Advance a {line,ch} position by a (possibly multi-line) string. Used to bound
    // an edit of the opening tag when it spans several lines.
    function advancePos(from, str) {
        var nl = str.split("\n");
        if (nl.length === 1) { return { line: from.line, ch: from.ch + str.length }; }
        return { line: from.line + nl.length - 1, ch: nl[nl.length - 1].length };
    }

    // Remove Motion's own classes from a class-attribute value; returns the kept
    // classes joined (empty string if none remain). moClasses is the exact allow-list.
    function stripMotionClasses(value, moClasses) {
        return value.split(/\s+/).filter(function (c) { return c && moClasses.indexOf(c) === -1; }).join(" ");
    }

    // Add a class to an opening tag string, preserving existing classes. Handles
    // double/single-quoted and unquoted class values, and any letter case.
    function mergeClass(openTag, cls) {
        if (!openTag || !cls) { return openTag; }
        var m = openTag.match(/^(<[a-zA-Z][\w-]*)([\s\S]*?)(\/?>)$/);
        if (!m) { return openTag; }
        var head = m[1], attrs = m[2], tail = m[3];
        var cm = attrs.match(/(\sclass\s*=\s*)("([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
        if (cm) {
            var val = cm[3] != null ? cm[3] : (cm[4] != null ? cm[4] : cm[5]);
            var list = val.split(/\s+/).filter(Boolean);
            if (list.indexOf(cls) !== -1) { return openTag; } // already has it
            list.push(cls);
            var quote = cm[2].charAt(0) === "'" ? "'" : '"';
            var newAttr = cm[1] + quote + list.join(" ") + quote;
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
    // ============================================================
    //  </PURE-HELPERS>
    // ============================================================

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
        best.openTag = sliceOpenTag(text);
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
        // Once the user has picked an element in the preview, resolve strictly by its
        // brackets-id. If that id no longer maps (the page re-instrumented after an
        // edit), return null — do NOT silently fall back to the cursor, which would
        // target an unrelated element.
        if (ui.sel && ui.sel.tagId != null) {
            if (HTMLInstr && HTMLInstr.getPositionFromTagId) {
                var ed = liveEditor();
                if (ed && ed._codeMirror) {
                    var range = HTMLInstr.getPositionFromTagId(ed, parseInt(ui.sel.tagId, 10));
                    if (range && range.from && range.to) {
                        var cm = ed._codeMirror;
                        var text = cm.getRange(range.from, range.to);
                        var openTag = sliceOpenTag(text);
                        var tag = (openTag.match(/^<([a-zA-Z][\w-]*)/) || [])[1] || "element";
                        return {
                            tagId: parseInt(ui.sel.tagId, 10), mark: { tagID: parseInt(ui.sel.tagId, 10) },
                            from: range.from, to: range.to, openTag: openTag, tag: tag,
                            doc: ed.document, fullText: text
                        };
                    }
                }
            }
            return null;
        }
        // Nothing picked yet: fall back to the editor cursor's instrumented element.
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
        try {
            doc.batchOperation(function () {
                // 1) merge the class onto the element's opening tag (openTag may span lines)
                var newOpen = mergeClass(sel.openTag, css.cls);
                if (newOpen !== sel.openTag) {
                    doc.replaceRange(newOpen, sel.from, advancePos(sel.from, sel.openTag));
                }
                // 2) ensure the managed <style> block (keyframes + rule)
                ensureStyleBlock(doc, css);
                // 3) scroll trigger needs the observer helper once
                if (css.scroll) { ensureObserver(doc); }
            });
        } catch (e) {
            flash("Couldn't edit this file (is it writable?).");
            return;
        }
        clearTrial(); // the real class now drives it; drop the transient preview
        flash("Applied " + anim.label + " to <" + sel.tag + ">");
        refreshSelMeta();
        updateSelbar();
    }

    // Remove every Motion artifact from the previewed document: our classes, the managed
    // <style> block and the scroll observer. Uses incremental replaceRange edits (never
    // setText) so the live-preview instrumentation / brackets-ids stay in sync.
    function resetAll() {
        clearTrial(); // drop any live preview before touching source
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
        // strip Motion classes from class attributes (quoted or unquoted, any case)
        var reClass = /(\sclass\s*=\s*)("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
        while ((m = reClass.exec(text))) {
            var val = m[3] != null ? m[3] : (m[4] != null ? m[4] : m[5]);
            if (!val.split(/\s+/).some(isMoClass)) { continue; }
            var kept = stripMotionClasses(val, MO_CLASSES);
            var quote = m[2].charAt(0) === "'" ? "'" : '"';
            edits.push([m.index, m.index + m[0].length, kept ? m[1] + quote + kept + quote : ""]);
        }
        if (!edits.length) { flash("Nothing to reset — no Motion animations found."); return; }
        var count = edits.length;
        // apply END -> START so earlier offsets stay valid and marks are preserved
        edits.sort(function (a, b) { return b[0] - a[0]; });
        try {
            doc.batchOperation(function () {
                edits.forEach(function (e) { doc.replaceRange(e[2], posFromOffset(doc, e[0]), posFromOffset(doc, e[1])); });
            });
        } catch (e) {
            flash("Couldn't edit this file (is it writable?).");
            return;
        }
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
            insertAtOffset(doc, headInsertOffset(text), block);
        }
    }

    // Best spot for a managed block in <head>: before </head>, else just after the
    // opening <head ...>, else before <body>, else after the doctype/<html>, else 0.
    function headInsertOffset(text) {
        var headClose = text.indexOf("</head>");
        if (headClose !== -1) { return headClose; }
        var headOpen = text.match(/<head[^>]*>/i);
        if (headOpen) { return headOpen.index + headOpen[0].length; }
        var bodyOpen = text.search(/<body[\s>]/i);
        if (bodyOpen !== -1) { return bodyOpen; }
        var htmlOpen = text.match(/<html[^>]*>/i);
        if (htmlOpen) { return htmlOpen.index + htmlOpen[0].length; }
        return 0;
    }

    function ensureObserver(doc) {
        var text = doc.getText();
        if (text.indexOf("<script data-motion>") !== -1) { return; }
        var bodyClose = text.indexOf("</body>");
        if (bodyClose === -1) { bodyClose = text.indexOf("</html>"); }
        // fall back to end of document so scroll animations never get stuck invisible
        insertAtOffset(doc, bodyClose !== -1 ? bodyClose : text.length, OBSERVER + "\n");
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
    // Remove any lingering preview from every element (the trial is a transient,
    // single-element effect — it must never accumulate across selections).
    function clearTrial() {
        if (!LiveDevProtocol || !LiveDevProtocol.evaluate) { return; }
        try {
            LiveDevProtocol.evaluate('(function(){var l=document.querySelectorAll(".__mo-trial");for(var i=0;i<l.length;i++){l[i].classList.remove("__mo-trial");}var s=document.getElementById("mo-trial");if(s){s.parentNode.removeChild(s);}})();');
        } catch (e) { /* ignore */ }
    }

    function trial(anim, opts) {
        // Silent when there's no live preview or nothing selected — this fires on
        // every gallery hover and must not spam the status line.
        if (!LiveDevProtocol || !LiveDevProtocol.evaluate) { return; }
        var sel = resolveSelection();
        if (!sel) { return; }
        var css = animCss(anim, opts);
        var id = sel.tagId != null ? sel.tagId : (sel.mark ? sel.mark.tagID : "");
        // Clear the class from ALL elements first, so only the current target previews.
        var js = '(function(){var l=document.querySelectorAll(".__mo-trial");for(var i=0;i<l.length;i++){l[i].classList.remove("__mo-trial");}' +
            'var el=document.querySelector(\'[data-brackets-id="' + id + '"]\');' +
            'if(!el)return;var s=document.getElementById("mo-trial")||document.createElement("style");s.id="mo-trial";' +
            's.textContent=' + JSON.stringify(css.keyframes + "\n.__mo-trial{animation:mo-kf-" + anim.id + " " + (opts.duration || anim.dur) + "ms " + (opts.easing || DEFAULT_EASE) + " both" + (ATTENTION[anim.id] ? " infinite" : "") + "}") + ';' +
            'document.head.appendChild(s);el.classList.remove("__mo-trial");void el.offsetWidth;el.classList.add("__mo-trial");})();';
        try { LiveDevProtocol.evaluate(js); } catch (e) { /* ignore */ }
    }

    // ============================================================
    //  Panel UI
    // ============================================================
    var ui = { view: "gallery", selected: null, sel: null, selMeta: null, duration: 600, easing: DEFAULT_EASE, trigger: "load" };
    // DUR_MIN/DUR_MAX, clamp, speedToDur, durToSpeed live in the PURE-HELPERS block above.

    var $panel = $(
        '<div id="motion-panel" class="motion-panel">' +
        '  <div class="mo-header">' +
        '    <span class="mo-brand">✦ Motion</span>' +
        '    <div class="mo-head-actions">' +
        '      <button class="mo-reset" title="Remove all applied animations">↺ Reset</button>' +
        '      <button class="mo-close" title="Close" aria-label="Close">✕</button>' +
        '    </div>' +
        '  </div>' +
        '  <div class="mo-selbar"></div>' +
        '  <div class="mo-gallery"></div>' +
        '  <div class="mo-settings"></div>' +
        '  <div class="mo-status"></div>' +
        '</div>'
    ).appendTo("body");
    $panel.addClass("mo-hidden");

    var TRIGGERS = [
        { v: "load",   label: "On load",   hint: "plays when the page loads" },
        { v: "scroll", label: "On scroll", hint: "plays when scrolled into view" },
        { v: "hover",  label: "On hover",  hint: "plays on mouse hover" }
    ];

    // Per-animation settings, laid out as stacked full-width fields (label above the
    // control) with a large segmented Trigger, a prominent Speed slider, an editable
    // Duration and an Easing select. Generous vertical rhythm.
    function renderSettings() {
        var a = animById(ui.selected);
        if (!a) { return; }
        var seg = TRIGGERS.map(function (t) {
            return '<button class="mo-seg-btn' + (t.v === ui.trigger ? " on" : "") + '" data-trg="' + t.v + '" title="' + t.hint + '">' + t.label + '</button>';
        }).join("");
        var curEase = EASINGS.filter(function (e) { return e.v === ui.easing; })[0] || EASINGS[0];
        var easeItems = EASINGS.map(function (e) { var on = e.v === ui.easing; return '<button type="button" role="option" aria-selected="' + on + '" class="mo-menu-item' + (on ? " on" : "") + '" data-ease="' + e.v + '">' + e.label + '</button>'; }).join("");
        $panel.find(".mo-settings").html(
            '<div class="mo-set-head">' +
            '  <button class="mo-back" title="Back to gallery" aria-label="Back to gallery">‹</button>' +
            '  <span class="mo-set-title">' + glyphSvg(a.id) + '<span>' + a.label + '</span></span>' +
            '</div>' +
            '<div class="mo-field">' +
            '  <label class="mo-field-label">Trigger</label>' +
            '  <div class="mo-seg">' + seg + '</div>' +
            '</div>' +
            '<div class="mo-field">' +
            '  <div class="mo-field-head"><label class="mo-field-label">Speed</label><span class="mo-field-val">' + ui.duration + ' ms</span></div>' +
            '  <div class="mo-slider"><span class="mo-speed-end">Slow</span>' +
            '    <input type="range" class="mo-speed" min="0" max="100" step="1" value="' + durToSpeed(ui.duration) + '">' +
            '  <span class="mo-speed-end">Fast</span></div>' +
            '</div>' +
            '<div class="mo-field">' +
            '  <label class="mo-field-label">Easing</label>' +
            '  <div class="mo-select">' +
            '    <button type="button" class="mo-select-btn" aria-haspopup="listbox" aria-expanded="false"><span class="mo-select-label">' + curEase.label + '</span><span class="mo-select-caret" aria-hidden="true">▾</span></button>' +
            '    <div class="mo-menu" role="listbox" aria-label="Easing">' + easeItems + '</div>' +
            '  </div>' +
            '</div>' +
            '<div class="mo-field">' +
            '  <label class="mo-field-label">Duration</label>' +
            '  <div class="mo-dur-row"><input type="number" class="mo-dur-num" min="' + DUR_MIN + '" max="' + DUR_MAX + '" step="10" value="' + ui.duration + '"><span class="mo-unit">ms</span></div>' +
            '</div>' +
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
        clearTrial(); // stop any preview lingering on the previously selected element
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
    // View toggling uses a class (mo-hide) rather than jQuery show/hide, which would
    // write inline display:block and break the panel's / settings' flex layout.
    function showGallery() {
        ui.view = "gallery";
        clearTrial();
        $panel.find(".mo-settings").addClass("mo-hide");
        $panel.find(".mo-gallery").removeClass("mo-hide");
    }
    function showSettings(id) {
        ui.view = "settings";
        ui.selected = id;
        renderSettings();
        updateApplyState();
        $panel.find(".mo-gallery").addClass("mo-hide");
        $panel.find(".mo-settings").removeClass("mo-hide");
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
        // Enable strictly on a currently-resolvable selection, so the button's target
        // always matches what apply would edit (never a stale cursor element).
        var has = !!resolveSelection();
        $a.prop("disabled", !has).text(has ? ("Apply " + (a ? a.label : "")) : "Select an element to apply");
    }

    function openPanel() {
        if (!$panel[0] || !document.body.contains($panel[0])) { $panel.appendTo("body"); }
        renderGallery(); refreshSelMeta(); updateSelbar();
        showGallery();
        $panel.removeClass("mo-hidden");
        restorePos(); // apply the last dragged position, if any
    }
    function closePanel() { clearTrial(); $panel.addClass("mo-hidden"); }
    function togglePanel() { if ($panel.is(":visible")) { closePanel(); } else { openPanel(); } }

    // ── Drag to reposition (header is the handle) so the panel can be moved off the
    //    element you're animating. Position persists across sessions.
    var POS_KEY = "motion.panelPos";
    function applyPos(pos) {
        if (!pos || pos.left == null) { return; }
        var w = $panel.outerWidth() || 340, h = $panel.outerHeight() || 400;
        $panel.css({
            left: clamp(pos.left, 4, Math.max(4, window.innerWidth - w - 4)) + "px",
            top: clamp(pos.top, 4, Math.max(4, window.innerHeight - h - 4)) + "px",
            right: "auto"
        });
    }
    function restorePos() { try { applyPos(JSON.parse(localStorage.getItem(POS_KEY))); } catch (e) { /* ignore */ } }
    var drag = null;
    $panel.on("mousedown", ".mo-header", function (e) {
        if ($(e.target).closest("button, a, input, select").length) { return; } // controls still work
        var r = $panel[0].getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        $panel.addClass("mo-dragging");
        e.preventDefault();
    });
    $(document).on("mousemove.motion", function (e) {
        if (!drag) { return; }
        var w = $panel.outerWidth(), h = $panel.outerHeight();
        $panel.css({
            left: clamp(e.clientX - drag.dx, 4, window.innerWidth - w - 4) + "px",
            top: clamp(e.clientY - drag.dy, 4, window.innerHeight - h - 4) + "px",
            right: "auto"
        });
    });
    $(document).on("mouseup.motion", function () {
        if (!drag) { return; }
        drag = null; $panel.removeClass("mo-dragging");
        try { localStorage.setItem(POS_KEY, JSON.stringify({ left: parseInt($panel.css("left"), 10), top: parseInt($panel.css("top"), 10) })); } catch (e) { /* ignore */ }
    });

    // events
    $panel.on("click", ".mo-close", function (e) { e.preventDefault(); closePanel(); });
    $panel.on("click", ".mo-reset", function (e) { e.preventDefault(); resetAll(); });
    // gallery: hover previews, click opens that animation's settings
    $panel.on("mouseenter", ".mo-tile", function () { var a = animById($(this).attr("data-anim")); if (a) { trial(a, ui); } });
    $panel.on("mouseleave", ".mo-gallery", function () { if (ui.view === "gallery") { clearTrial(); } });
    $panel.on("click", ".mo-tile", function () { showSettings($(this).attr("data-anim")); });
    // settings
    $panel.on("click", ".mo-back", function () { showGallery(); });
    $panel.on("click", ".mo-seg-btn", function () {
        ui.trigger = $(this).attr("data-trg");
        $panel.find(".mo-seg-btn").removeClass("on");
        $(this).addClass("on");
        trialSelected();
    });
    // Easing custom dropdown (native <select> won't paint its value in this webview).
    function closeEaseMenu() { $panel.find(".mo-select").removeClass("open").find(".mo-select-btn").attr("aria-expanded", "false"); }
    $panel.on("click", ".mo-select-btn", function (e) {
        e.preventDefault(); e.stopPropagation();
        var open = $(this).closest(".mo-select").toggleClass("open").hasClass("open");
        $(this).attr("aria-expanded", open ? "true" : "false");
    });
    $panel.on("click", ".mo-menu-item", function (e) {
        e.preventDefault(); e.stopPropagation();
        ui.easing = $(this).attr("data-ease");
        var $s = $(this).closest(".mo-select");
        $s.find(".mo-select-label").text($(this).text());
        $s.find(".mo-menu-item").removeClass("on").attr("aria-selected", "false");
        $(this).addClass("on").attr("aria-selected", "true");
        closeEaseMenu();
        trialSelected();
    });
    $panel.on("click", function (e) { if (!$(e.target).closest(".mo-select").length) { closeEaseMenu(); } });
    function syncSpeedReadout() { $panel.find(".mo-field-val").text(ui.duration + " ms"); }
    $panel.on("input", ".mo-speed", function () {
        ui.duration = speedToDur(+this.value);
        $panel.find(".mo-dur-num").val(ui.duration);
        syncSpeedReadout();
        trialSelected();
    });
    $panel.on("input", ".mo-dur-num", function () {
        ui.duration = clamp(+this.value || DUR_MIN, DUR_MIN, DUR_MAX);
        $panel.find(".mo-speed").val(durToSpeed(ui.duration));
        syncSpeedReadout();
    });
    $panel.on("change", ".mo-dur-num", function () {
        ui.duration = clamp(+this.value || DUR_MIN, DUR_MIN, DUR_MAX);
        this.value = ui.duration;
        $panel.find(".mo-speed").val(durToSpeed(ui.duration));
        syncSpeedReadout();
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
    $(document).on("keydown.motion", function (e) {
        if (!$panel.is(":visible")) { return; }
        if (e.key === "Escape" || e.keyCode === 27) {
            if ($panel.find(".mo-select.open").length) { closeEaseMenu(); }
            else { closePanel(); }
        }
    });
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
