"use strict"

var fs = require('fs');
var path = require('path');
var stream = require('stream');
var readline = require('readline');

exports.command = "merge <parts..>"
exports.describe = "Merge HGF or HGI files."
exports.builder = function (yargs) {
	return yargs.alias('o', 'output-into');
}

exports.handler = function (argv) {
	var outStream = argv.o ? fs.createWriteStream(argv.o, { encoding: 'utf-8' }) : process.stdout;
	var buf = {};
	var nRead = 0;
	var nTotal = 0;
	argv.parts.forEach(function (file) {
		var d = fs.readFileSync(file, 'utf-8').trim().split('\n');
		for (var j = 0; j < d.length; j++) if (d[j].trim()) {
			var data = JSON.parse(d[j].trim());
			nRead += 1;
			if (!buf[data[1]]) {
				buf[data[1]] = true;
				outStream.write(d[j] + '\n');
				nTotal += 1;
			}
		}
	});
	process.stderr.write(nRead + " records found; " + nTotal + " records after merging.\n");
}