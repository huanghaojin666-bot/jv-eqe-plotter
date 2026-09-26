"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");

assert.match(
  html,
  /id="deviceGradientToggle"[^>]*aria-controls="gradientControls"[^>]*aria-expanded="false"/
);
assert.match(html, /id="gradientControls" class="gradient-controls" hidden/);
assert.match(app, /function syncGradientControlsVisibility\(\)/);
assert.match(app, /const expanded = elements\.deviceGradientToggle\.checked/);
assert.match(app, /elements\.gradientControls\.hidden = !expanded/);
assert.match(styles, /\.gradient-controls\[hidden\]\s*\{\s*display:\s*none;/);

console.log("UI visibility tests passed");
