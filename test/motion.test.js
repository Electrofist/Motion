/* Pure-logic tests for Motion. Extracts the real functions from the PURE-HELPERS
 * block in ../main.js (no editor needed) so tests can't drift from the source.
 * Run: node test/motion.test.js  (or: npm test)
 */
"use strict";
const fs = require("fs"), path = require("path");
const SRC = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

// Extract everything between the // <PURE-HELPERS> ... // </PURE-HELPERS> sentinels.
const open = SRC.indexOf("<PURE-HELPERS>");
const close = SRC.indexOf("</PURE-HELPERS>");
if (open < 0 || close < 0) { console.error("FATAL: PURE-HELPERS sentinels not found in main.js"); process.exit(2); }
const region = SRC.slice(SRC.indexOf("\n", open) + 1, SRC.lastIndexOf("\n", close));

const RETURN = "\nreturn { mergeClass, animCss, mergeStyleBody, sliceOpenTag, advancePos, " +
    "stripMotionClasses, clamp, speedToDur, durToSpeed, bezierToStr, bezierParse, DEFAULT_EASE, EASINGS, DUR_MIN, DUR_MAX };";
const api = new Function("CLASS_PREFIX", "ATTENTION", region + RETURN)(
    "mo-", { pulse: 1, shake: 1, float: 1, spin: 1 }
);

// Fail fast if the region didn't export something (turns a lazy ReferenceError-at-call
// into an explicit harness failure).
["mergeClass", "animCss", "mergeStyleBody", "sliceOpenTag", "advancePos", "stripMotionClasses",
 "clamp", "speedToDur", "durToSpeed", "bezierToStr", "bezierParse"].forEach(function (n) {
    if (typeof api[n] !== "function") { console.error("FATAL: missing pure fn " + n); process.exit(2); }
});
if (typeof api.DEFAULT_EASE !== "string" || !Array.isArray(api.EASINGS)) { console.error("FATAL: missing EASINGS/DEFAULT_EASE"); process.exit(2); }

let pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n + (d ? "  -- " + d : "")); } }
function eq(n, got, want) { ok(n, got === want, "got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }
console.log("motion.test.js");

const MO = ["mo-fade-up", "mo-pop", "mo-fade-in", "mo-pulse"]; // sample Motion class allow-list

// ---- mergeClass ----
eq("mergeClass: adds to existing class", api.mergeClass('<div class="a b">', "mo-fade-up"), '<div class="a b mo-fade-up">');
eq("mergeClass: no-op if present", api.mergeClass('<div class="a mo-fade-up b">', "mo-fade-up"), '<div class="a mo-fade-up b">');
eq("mergeClass: adds class attr when none", api.mergeClass('<section id="x">', "mo-pop"), '<section class="mo-pop" id="x">');
eq("mergeClass: single quotes preserved", api.mergeClass("<a class='btn'>", "mo-pop"), "<a class='btn mo-pop'>");
eq("mergeClass: self-closing tag", api.mergeClass('<img src="x.png" />', "mo-zoom-in"), '<img class="mo-zoom-in" src="x.png" />');
eq("mergeClass: self-close no space", api.mergeClass('<input type="text"/>', "mo-pop"), '<input class="mo-pop" type="text"/>');
ok("mergeClass: keeps other attrs", /class="card mo-pop"/.test(api.mergeClass('<div class="card" style="color:red">', "mo-pop")));
eq("mergeClass: bad input unchanged", api.mergeClass("not a tag", "mo-x"), "not a tag");
eq("mergeClass: unquoted class merges (no dup attr)", api.mergeClass('<div class=foo>', "mo-pop"), '<div class="foo mo-pop">');
eq("mergeClass: uppercase CLASS merges", api.mergeClass('<div CLASS="a">', "mo-pop"), '<div CLASS="a mo-pop">');
eq("mergeClass: substring not a false dup", api.mergeClass('<div class="mo-popover">', "mo-pop"), '<div class="mo-popover mo-pop">');
eq("mergeClass: multiline attrs", api.mergeClass('<div\n  class="a">', "mo-pop"), '<div\n  class="a mo-pop">');
eq("mergeClass: empty class value", api.mergeClass('<div class="">', "mo-pop"), '<div class="mo-pop">');
ok("mergeClass: does not match data-class", api.mergeClass('<div data-class="x">', "mo-pop") === '<div class="mo-pop" data-class="x">');

// ---- animCss ----
const load = api.animCss({ id: "fade-up", dur: 600, frames: "{from{opacity:0}to{opacity:1}}" }, { duration: 800, easing: "ease-out", trigger: "load" });
eq("animCss: load rule", load.rule, ".mo-fade-up{animation:mo-kf-fade-up 800ms ease-out both}");
eq("animCss: keyframes", load.keyframes, "@keyframes mo-kf-fade-up {from{opacity:0}to{opacity:1}}");
ok("animCss: cls + scroll flag", load.cls === "mo-fade-up" && load.scroll === false);
ok("animCss: default easing = DEFAULT_EASE", api.animCss({ id: "pop", dur: 450, frames: "{to{}}" }, {}).rule.indexOf("450ms " + api.DEFAULT_EASE + " both") !== -1);
ok("animCss: duration override", api.animCss({ id: "pop", dur: 450, frames: "{to{}}" }, { duration: 1000 }).rule.indexOf("mo-kf-pop 1000ms") !== -1);
ok("animCss: explicit easing", api.animCss({ id: "pop", dur: 450, frames: "{to{}}" }, { easing: "linear" }).rule.indexOf("450ms linear both") !== -1);
ok("animCss: hover selector", /^\.mo-pop:hover\{animation:/.test(api.animCss({ id: "pop", dur: 450, frames: "{to{}}" }, { trigger: "hover" }).rule));
const scroll = api.animCss({ id: "fade-in", dur: 500, frames: "{to{}}" }, { trigger: "scroll" });
ok("animCss: scroll hidden until in-view", scroll.rule.indexOf(".mo-fade-in{opacity:0}") === 0 && scroll.rule.indexOf(".mo-fade-in.in-view{animation:") !== -1);
ok("animCss: scroll flag set", scroll.scroll === true);
ok("animCss: scroll non-attention has no infinite", scroll.rule.indexOf("infinite") === -1);
ok("animCss: attention loops (load)", /infinite\}$/.test(api.animCss({ id: "pulse", dur: 900, frames: "{to{}}" }, { trigger: "load" }).rule));
ok("animCss: attention + scroll → infinite in in-view", /\.in-view\{animation:[^}]*infinite\}/.test(api.animCss({ id: "pulse", dur: 900, frames: "{to{}}" }, { trigger: "scroll" }).rule));

// ---- animCss: delay + loop ----
ok("animCss: delay emits second time value", api.animCss({ id: "pop", dur: 450, frames: "{to{}}" }, { delay: 200 }).rule.indexOf("450ms " + api.DEFAULT_EASE + " 200ms both") !== -1);
ok("animCss: no delay when 0", api.animCss({ id: "pop", dur: 450, frames: "{to{}}" }, { delay: 0 }).rule.indexOf("both") !== -1 && api.animCss({ id: "pop", dur: 450, frames: "{to{}}" }, { delay: 0 }).rule.indexOf("0ms both") === -1);
ok("animCss: loop:true forces infinite", /infinite\}$/.test(api.animCss({ id: "pop", dur: 450, frames: "{to{}}" }, { loop: true }).rule));
ok("animCss: loop:false overrides attention", api.animCss({ id: "pulse", dur: 900, frames: "{to{}}" }, { loop: false }).rule.indexOf("infinite") === -1);
ok("animCss: loop unset → attention default", /infinite\}$/.test(api.animCss({ id: "pulse", dur: 900, frames: "{to{}}" }, {}).rule));
ok("animCss: delay + loop together", /450ms .* 300ms both infinite\}$/.test(api.animCss({ id: "pop", dur: 450, frames: "{to{}}" }, { delay: 300, loop: true }).rule));

// ---- mergeStyleBody ----
const c1 = api.animCss({ id: "fade-up", dur: 600, frames: "{from{opacity:0}to{opacity:1}}" }, {});
let body = api.mergeStyleBody("", c1);
ok("mergeStyleBody: empty → keyframes + rule", body.indexOf("@keyframes mo-kf-fade-up") !== -1 && body.indexOf(".mo-fade-up{animation:") !== -1);
const c2 = api.animCss({ id: "pop", dur: 450, frames: "{to{transform:scale(1)}}" }, {});
body = api.mergeStyleBody(body, c2);
ok("mergeStyleBody: second anim appended", body.indexOf("mo-kf-fade-up") !== -1 && body.indexOf("mo-kf-pop") !== -1);
const c1b = api.animCss({ id: "fade-up", dur: 300, frames: "{from{opacity:0}to{opacity:1}}" }, { duration: 300 });
body = api.mergeStyleBody(body, c1b);
eq("mergeStyleBody: re-apply replaces (no dup rule)", (body.match(/\.mo-fade-up\{animation:/g) || []).length, 1);
ok("mergeStyleBody: re-apply updates duration", body.indexOf("mo-kf-fade-up 300ms") !== -1);
eq("mergeStyleBody: keyframes not duplicated", (body.match(/@keyframes mo-kf-fade-up/g) || []).length, 1);
let hbody = api.mergeStyleBody("", api.animCss({ id: "pop", dur: 450, frames: "{to{}}" }, { trigger: "hover" }));
hbody = api.mergeStyleBody(hbody, api.animCss({ id: "pop", dur: 450, frames: "{to{}}" }, { trigger: "hover" }));
eq("mergeStyleBody: hover re-apply dedup", (hbody.match(/\.mo-pop:hover\{animation:/g) || []).length, 1);
let sbody = api.mergeStyleBody("", api.animCss({ id: "fade-in", dur: 500, frames: "{to{}}" }, { trigger: "scroll" }));
sbody = api.mergeStyleBody(sbody, api.animCss({ id: "fade-in", dur: 500, frames: "{to{}}" }, { trigger: "scroll" }));
eq("mergeStyleBody: scroll re-apply → one in-view rule", (sbody.match(/\.mo-fade-in\.in-view\{animation:/g) || []).length, 1);

// ---- sliceOpenTag ----
eq("sliceOpenTag: simple", api.sliceOpenTag('<div class="a">rest</div>'), '<div class="a">');
eq("sliceOpenTag: quote-aware (> inside attr)", api.sliceOpenTag('<a title="x>y" class="c">Link</a>'), '<a title="x>y" class="c">');
eq("sliceOpenTag: single-quote attr", api.sliceOpenTag("<img src='a>b'/>after"), "<img src='a>b'/>");
eq("sliceOpenTag: no close returns input", api.sliceOpenTag("<div class=x"), "<div class=x");

// ---- advancePos ----
eq("advancePos: single line", JSON.stringify(api.advancePos({ line: 5, ch: 2 }, "abcd")), JSON.stringify({ line: 5, ch: 6 }));
eq("advancePos: multi line", JSON.stringify(api.advancePos({ line: 5, ch: 2 }, "ab\ncd\ne")), JSON.stringify({ line: 7, ch: 1 }));

// ---- stripMotionClasses ----
eq("stripMotionClasses: keeps user, drops motion", api.stripMotionClasses("card mo-pop mo-fade-up", MO), "card");
eq("stripMotionClasses: only motion → empty", api.stripMotionClasses("mo-pop", MO), "");
eq("stripMotionClasses: no motion → unchanged", api.stripMotionClasses("btn hero", MO), "btn hero");

// ---- speed/duration/clamp ----
eq("speedToDur(0) = DUR_MAX", api.speedToDur(0), api.DUR_MAX);
eq("speedToDur(100) = DUR_MIN", api.speedToDur(100), api.DUR_MIN);
eq("durToSpeed(DUR_MAX) = 0", api.durToSpeed(api.DUR_MAX), 0);
eq("durToSpeed(DUR_MIN) = 100", api.durToSpeed(api.DUR_MIN), 100);
[150, 600, 1500, 3000].forEach(function (d) {
    ok("speed<->dur round-trip ~" + d, Math.abs(api.speedToDur(api.durToSpeed(d)) - d) <= 30, "d=" + d);
});
eq("durToSpeed clamps above range", api.durToSpeed(99999), 0);
eq("durToSpeed clamps below range", api.durToSpeed(-100), 100);
eq("clamp above", api.clamp(10, 0, 5), 5);
eq("clamp below", api.clamp(-3, 0, 5), 0);
eq("clamp within", api.clamp(3, 0, 5), 3);

// ---- EASINGS invariants ----
ok("EASINGS default-first", api.EASINGS[0].v === api.DEFAULT_EASE);
eq("EASINGS length", api.EASINGS.length, 6);

// ---- cubic-bezier helpers ----
eq("bezierToStr basic", api.bezierToStr([0.25, 0.1, 0.25, 1]), "cubic-bezier(0.25,0.1,0.25,1)");
eq("bezierToStr rounds to 2dp", api.bezierToStr([0.166, 1.234, 0.3, 0.999]), "cubic-bezier(0.17,1.23,0.3,1)");
eq("bezierParse round-trips", api.bezierToStr(api.bezierParse("cubic-bezier(.34,1.56,.64,1)")), "cubic-bezier(0.34,1.56,0.64,1)");
ok("bezierParse handles spaces", JSON.stringify(api.bezierParse("cubic-bezier(0.16, 1, 0.3, 1)")) === JSON.stringify([0.16, 1, 0.3, 1]));
eq("bezierParse rejects non-bezier", api.bezierParse("ease-out"), null);

// ---- catalog integrity: every animation is fully wired (id + glyph + hover rule) ----
const CSS = fs.readFileSync(path.join(__dirname, "..", "style.css"), "utf8");
const animsBlock = SRC.slice(SRC.indexOf("var ANIMS = ["), SRC.indexOf("];", SRC.indexOf("var ANIMS = [")) + 2);
const animIds = (animsBlock.match(/\bid:\s*"([\w-]+)"/g) || []).map(function (m) { return m.match(/"([\w-]+)"/)[1]; });
const glyphsStart = SRC.indexOf("var GLYPHS = {");
const glyphsBlock = SRC.slice(glyphsStart, SRC.indexOf("\n    };", glyphsStart));
const glyphKeys = (glyphsBlock.match(/^\s{8}"([\w-]+)":/gm) || []).map(function (m) { return m.match(/"([\w-]+)"/)[1]; });

ok("catalog: has animations", animIds.length >= 18, "got " + animIds.length);
eq("catalog: unique ids", new Set(animIds).size, animIds.length);
animIds.forEach(function (id) {
    ok("glyph exists: " + id, glyphKeys.indexOf(id) !== -1);
    ok("hover rule exists: " + id, CSS.indexOf('data-anim="' + id + '"') !== -1);
});
// every animation's frames body is well-formed CSS keyframes ({ ... })
(animsBlock.match(/frames:\s*"(\{[^"]*\})"/g) || []).forEach(function (m, i) {
    var f = m.match(/"(\{[^"]*\})"/)[1];
    ok("frames well-formed: " + (animIds[i] || i), /^\{[\s\S]*\}$/.test(f) && f.indexOf("{", 1) !== -1);
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
