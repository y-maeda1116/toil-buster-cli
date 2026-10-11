#!/usr/bin/env node
// tsup はフラットに dist/index.js を出力する (src/cli/index.ts をバンドル)。
// package.json の start スクリプトも dist/index.js を参照するため、ここでもそれを指す。
import("../dist/index.js");
