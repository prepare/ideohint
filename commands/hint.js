"use strict";

var fs = require("fs");
var readline = require("readline");
var stream = require("stream");
var util = require("util");
var devnull = require("dev-null");
var hint = require("../hinter").hint;
var paramfileLib = require("../paramfile");
var strategyLib = require("../strategy");

const { lerp, xlerp, xclamp } = require('../support/common');


exports.command = "hint";
exports.describe = "Hint a feature file (hgf).";
exports.builder = function (yargs) {
	return yargs.alias("o", "output-into")
		.alias("?", "help")
		.alias("p", "parameters")
		.describe("help", "Displays this help.")
		.describe("o", "Output sfd path. When absent, the result sfd is written to STDOUT.")
		.describe("d", "Only process dk+m'th glyphs in the feature file. Combine with -m for parallel processing.")
		.describe("m", "Only process dk+m'th glyphs in the feature file. Combine with -d for parallel processing.")
		.describe("parameters", "Specify parameter file (in TOML).");
};

function by_rp(a, b) { return a[0] - b[0] || a[1] - b[1]; }
function getIpsaCalls(glyph) {
	var ip = [];
	var sa = [];
	for (var j = 0; j < glyph.interpolations.length; j++) {
		if (!ip[glyph.interpolations[j][3]]) ip[glyph.interpolations[j][3]] = [];
		ip[glyph.interpolations[j][3]].push(glyph.interpolations[j]);
	}
	for (var j = 0; j < glyph.shortAbsorptions.length; j++) {
		if (!sa[glyph.shortAbsorptions[j][2]]) sa[glyph.shortAbsorptions[j][2]] = [];
		sa[glyph.shortAbsorptions[j][2]].push(glyph.shortAbsorptions[j]);
	}
	var ipsacalls = [];
	var maxpri = Math.max(ip.length - 1, sa.length - 1);
	for (var j = maxpri; j >= 0; j--) {
		ipsacalls = ipsacalls.concat(
			ip[j] ? ip[j].sort(by_rp).map(slicelast) : [],
			sa[j] ? sa[j].sort(by_rp).map(slicelast) : []);
	}
	return ipsacalls;
}
function slicelast(x) { return x.slice(0, -1); }

exports.handler = function (argv) {
	if (argv.help) { yargs.showHelp(); process.exit(0); }

	var inStream = argv._[1] ? fs.createReadStream(argv._[1]) : process.stdin;
	var outStream = argv.o ? fs.createWriteStream(argv.o, { encoding: "utf-8" }) : process.stdout;
	var rl = readline.createInterface(inStream, devnull());


	var parameterFile = paramfileLib.from(argv);
	var strategy = strategyLib.from(argv, parameterFile);

	var divide = argv.d || 1;
	var modulo = argv.m || 0;

	function pad(s, p, n) {
		s = "" + s;
		while (s.length < n) s = p + s;
		return s;
	}
	function progressbar(u, len) {
		var buf = "";
		for (var j = 1; j <= len; j++) {
			buf += (j > u * len) ? " " : "#";
		}
		return buf;
	}

	var finished = false;
	var pendings = [];
	var PROGRESS_LENGTH = 30;

	function showProgressBar(currentProgress, j, n) {
		var pb = progressbar(j / n, PROGRESS_LENGTH);
		if (pb !== currentProgress) {
			process.stderr.write("HGFHINT: Hinting [" + pb + "](#" + pad(j, " ", 5) + "/" + pad(n, " ", 5) + ")" + " of " + (argv._[1] || "(stdin)") + " " + pad(modulo, "0", 3) + "d" + pad(divide, "0", 3) + "\n");
		}
		return pb;
	}

	function finish() {
		if (finished) return;
		finished = true;
		var currentProgress = progressbar(0, PROGRESS_LENGTH);
		for (var glyphIndex = 0; glyphIndex < pendings.length; glyphIndex++) {
			var data = pendings[glyphIndex];
			var glyph = data[2];
			var stemActions = [];
			var xExpansion = []
			let d = 0xffff;
			for (let j = 0; j < glyph.stems.length; j++) for (let k = 0; k < j; k++) {
				if (glyph.directOverlaps[j][k]) {
					let d1 = glyph.stems[j].y - glyph.stems[j].width - glyph.stems[k].y;
					if (d1 < d) d = d1;
				}
			}
			if (d < 1) d = 1;
			const cutoff = xclamp(strategy.PPEM_MIT,
				Math.round(strategy.UPM * strategy.SPARE_PIXLS / d),
				strategy.PPEM_MAX);

			for (var ppem = cutoff; ppem >= strategy.PPEM_MIN; ppem--) {
				const uppx = strategy.UPM / ppem;
				const actions = hint(glyph, ppem, strategy);
				stemActions[ppem] = actions.y;
				xExpansion[ppem] = actions.x.expand;
			}
			currentProgress = showProgressBar(currentProgress, glyphIndex, pendings.length);

			var sideIndependent = {
				blue: glyph.blueZoned,
				bottomBluePoints: glyph.bottomBluePoints,
				topBluePoints: glyph.topBluePoints,
				ipsacalls: getIpsaCalls(glyph),
				diagAligns: glyph.diagAligns,
				xIP: glyph.xIP,
				xExpansion: xExpansion,
				stems: glyph.stems.map(function (s) {
					return {
						y0: s.y,
						w0: s.width,
						posKeyAtTop: s.posKeyAtTop,
						posKey: s.posKey.id,
						advKey: s.advKey.id,
						posAlign: s.posAlign,
						advAlign: s.advAlign,
						diagHigh: s.diagHigh,
						diagLow: s.diagLow,
						slope: s.slope,
						keyDX: s.advKey.x - s.posKey.x
					};
				})
			};
			var recordLine = [data[0], data[1], { si: sideIndependent, sd: stemActions, pmin: strategy.PPEM_MIN, pmax: strategy.PPEM_MAX }];
			outStream.write(JSON.stringify(recordLine) + "\n");
		}
		currentProgress = showProgressBar(currentProgress, glyphIndex, pendings.length);
		if (process.stdout !== outStream) outStream.end();
	}

	var j = 0;
	rl.on("line", function (line) {
		if (j % divide === modulo % divide) {
			var l = line.trim();
			if (l) pendings.push(JSON.parse(l));
		}
		j += 1;
	});
	rl.on("close", finish);
};
