"use strict";

const { execFileSync } = require("node:child_process");

exports.default = async function afterPack(context) {
	if (context.electronPlatformName !== "darwin") return;
	execFileSync("/usr/bin/xattr", ["-cr", context.appOutDir], { stdio: "inherit" });
};
