/* Pure-logic tests for Motion: class merging, animation CSS, style-block merge.
 * Extracts the real functions from ../main.js (no editor). Run: node test/motion.test.js */
"use strict";
const fs = require("fs"), path = require("path");
const SRC = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const i = SRC.indexOf("    function mergeClass("), j = SRC.indexOf("    var OBSERVER");
if (i < 0 || j < 0) { console.error("FATAL: markers not found"); process.exit(2); }
const region = SRC.slice(i, j);
const api = new Function("CLASS_PREFIX", "ATTENTION",
    region + "\nreturn { mergeClass, animCss, mergeStyleBody };"
)("mo-", { pulse: 1, shake: 1, float: 1, spin: 1 });

let pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n + (d ? "  -- " + d : "")); } }
console.log("motion.test.js");

// ---- mergeClass ----
ok("adds class to existing class attr", api.mergeClass('<div class="a b">', "mo-fade-up") === '<div class="a b mo-fade-up">');
ok("no-op if class already present", api.mergeClass('<div class="a mo-fade-up b">', "mo-fade-up") === '<div class="a mo-fade-up b">');
ok("adds class attr when none", api.mergeClass('<section id="x">', "mo-pop") === '<section class="mo-pop" id="x">');
ok("preserves single quotes", api.mergeClass("<a class='btn'>", "mo-pop") === "<a class='btn mo-pop'>");
ok("handles self-closing tag", api.mergeClass('<img src="x.png" />', "mo-zoom-in") === '<img class="mo-zoom-in" src="x.png" />');
ok("keeps other attrs + style intact", /class="card mo-pop"/.test(api.mergeClass('<div class="card" style="color:red">', "mo-pop")));
ok("bad input returns unchanged", api.mergeClass("not a tag", "mo-x") === "not a tag");

// ---- animCss ----
const load = api.animCss({ id: "fade-up", dur: 600, frames: "{from{opacity:0}to{opacity:1}}" }, { duration: 800, easing: "ease-out", trigger: "load" });
ok("load: class rule with animation shorthand", load.rule === ".mo-fade-up{animation:mo-kf-fade-up 800ms ease-out both}");
ok("load: keyframes emitted", load.keyframes === "@keyframes mo-kf-fade-up {from{opacity:0}to{opacity:1}}");
ok("load: cls returned", load.cls === "mo-fade-up" && load.scroll === false);

const hover = api.animCss({ id: "pop", dur: 450, frames: "{to{}}" }, { trigger: "hover" });
ok("hover: :hover selector", /^\.mo-pop:hover\{animation:/.test(hover.rule));

const scroll = api.animCss({ id: "fade-in", dur: 500, frames: "{to{}}" }, { trigger: "scroll" });
ok("scroll: hidden until .in-view", scroll.rule.indexOf(".mo-fade-in{opacity:0}") === 0 && scroll.rule.indexOf(".mo-fade-in.in-view{animation:") !== -1);
ok("scroll: flag set", scroll.scroll === true);

const att = api.animCss({ id: "pulse", dur: 900, frames: "{to{}}" }, { trigger: "load" });
ok("attention anim loops (infinite)", /infinite\}$/.test(att.rule));

// ---- mergeStyleBody ----
const c1 = api.animCss({ id: "fade-up", dur: 600, frames: "{from{opacity:0}to{opacity:1}}" }, {});
let body = api.mergeStyleBody("", c1);
ok("empty body -> keyframes + rule", body.indexOf("@keyframes mo-kf-fade-up") !== -1 && body.indexOf(".mo-fade-up{animation:") !== -1);
const c2 = api.animCss({ id: "pop", dur: 450, frames: "{to{transform:scale(1)}}" }, {});
body = api.mergeStyleBody(body, c2);
ok("second anim appended", body.indexOf("mo-kf-fade-up") !== -1 && body.indexOf("mo-kf-pop") !== -1);
const c1b = api.animCss({ id: "fade-up", dur: 300, frames: "{from{opacity:0}to{opacity:1}}" }, { duration: 300 });
body = api.mergeStyleBody(body, c1b);
ok("re-apply same class replaces rule (no dup)", (body.match(/\.mo-fade-up\{animation:/g) || []).length === 1);
ok("re-apply updates duration", body.indexOf("mo-kf-fade-up 300ms") !== -1);
ok("keyframes not duplicated", (body.match(/@keyframes mo-kf-fade-up/g) || []).length === 1);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
