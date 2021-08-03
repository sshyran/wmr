/*
 * Note:
 * This Rollup config is used to build both the `wmr` and `create-wmr` packages.
 */
import { resolve, sep } from 'path';
import shebangPlugin from 'rollup-plugin-preserve-shebang';
import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import alias from '@rollup/plugin-alias';
import json from '@rollup/plugin-json';
import replace from '@rollup/plugin-replace';
import builtins from 'builtin-modules';
import swc from '@swc/core';

/** @type {import('rollup').RollupOptions} */
const config = {
	input: 'src/cli.js',
	inlineDynamicImports: true,
	output: {
		file: 'wmr.cjs',
		format: 'cjs',
		compact: true,
		freeze: false,
		interop: false,
		namespaceToStringTag: false,
		externalLiveBindings: false,
		preferConst: true,
		plugins: [
			{
				name: 'minify',
				async renderChunk(code) {
					const result = await swc.transform(code, {
						jsc: {
							target: 'es2021',
							parser: {
								dynamicImport: true
							},
							minify: {
								compress: true,
								sourceMap: true,
								mangle: true,
								module: true,
								ecma: 2019
							}
						},
						minify: true
					});
					if (typeof result.code === 'string') code = result.code;
					return { code };
				}
			}
		]
	},
	external: [...builtins, 'less', '@swc/core'],
	// /* Logs all included npm dependencies: */
	// external(source, importer) {
	// 	const ch = source[0];
	// 	if (ch === '.' || ch === '/') return false;
	// 	if (builtins.includes(source)) return true;
	// 	const mod = source.match(/^(@[^/]+\/)?[^/]+/)[0];
	// 	const mods = global.mods || (global.mods = new Set());
	// 	if (!mods.has(mod)) {
	// 		mods.add(mod);
	// 		console.log(mod, 'imported by', importer);
	// 	}
	// },
	plugins: [
		shebangPlugin(),
		replace({
			'process.env.VERSION': JSON.stringify(require('./package.json').version)
		}),
		{
			// This inlines some fs.promises.readFile() calls, while allowing them to run unbundled in Node.
			name: 'inline-fs-readfile',
			transform(code, id) {
				if (/\/\/\s*rollup-inline-files/.test(code)) {
					code = code.replace(
						/fs\.readFile\(new\s+URL\s*\(\s*(['"`])(.+?)\1\s*,\s*__filename\s*\)\s*,\s*'utf-8'\s*\)/g,
						(str, quote, filename) => {
							const path = require('path');
							const fs = require('fs');
							const filepath = path.resolve(path.dirname(id), filename);
							try {
								const text = fs.readFileSync(filepath, 'utf-8');
								// console.log('inlined ' + filename + ' into ' + id + ': ' + text.length + 'b');
								return `Promise.resolve(${JSON.stringify(text)})`;
							} catch (err) {
								this.warn(`Failed to inline ${filename} into ${id}:\n${err.message}`);
								return `Promise.reject(Error(${JSON.stringify(err.message)}))`;
							}
						}
					);
					return { code, map: null };
				}
			}
		},
		{
			// This fixes DevCert breaking in Rollup due to dynamic require usage.
			// https://github.com/davewasmer/devcert/blob/master/src/platforms/index.ts
			name: 'fix-devcert',
			transform(code, id) {
				if (/devcert[/\\]dist[/\\]platforms[/\\]index\.js$/.test(id)) {
					const platforms = require('fs')
						.readdirSync('../../node_modules/devcert/dist/platforms')
						.reduce((str, p) => {
							const name = p.replace(/\.js$/, '');
							if (name !== p && name !== 'index') {
								if (str) str += ',';
								str += `"${name}": require("./${p}")`;
							}
							return str;
						}, '');
					return code.replace('require(`./${process.platform}`)', `({${platforms}})[process.platform]`);
				}
			}
		},
		{
			// This ensures the template files for rollup-plugin-visualizer are inlined
			// rather than bundleds as fs.readFile()
			name: 'fix-visualizer',
			transform(code, id) {
				if (/rollup-plugin-visualizer[/\\]dist[/\\]plugin[/\\]build-stats\.js$/.test(id)) {
					code = code.replace(/fs.*readFile.*\(__dirname,\s*(.+?)\)\s*,\s*"utf8"\s*\)/g, (_str, stringifiedJoin) => {
						const path = require('path');
						const fs = require('fs');
						const filePathParts = stringifiedJoin
							.replace(/['"`]+/g, '')
							.replace(/\$\{template\}/g, 'treemap')
							.split(', ');
						const filepath = path.resolve(path.dirname(id), ...filePathParts);
						try {
							const text = fs.readFileSync(filepath, 'utf-8');
							return `Promise.resolve(${JSON.stringify(text)})`;
						} catch (err) {
							this.warn(`Failed to inline ${filepath} into ${id}:\n${err.message}`);
							return `Promise.reject(Error(${JSON.stringify(err.message)}))`;
						}
					});
					return { code, map: null };
				}
			}
		},
		alias({
			entries: [
				{ find: /^@babel\/plugin-syntax-jsx$/, replacement: require.resolve('./src/lib/~empty.js') },
				{ find: /^postcss$/, replacement: 'postcss-es6' },
				{ find: /^postcss[/\\]$/, replacement: `postcss-es6${sep}` },
				// bypass native modules aimed at production WS performance:
				{ find: /^bufferutil$/, replacement: `bufferutil${sep}fallback.js` },
				{ find: /^utf-8-validate$/, replacement: `utf-8-validate${sep}fallback.js` },
				// just use native streams:
				{ find: /(^|[/\\])readable-stream$/, replacement: require.resolve('./src/lib/~readable-stream.js') },
				{
					find: /(^|[/\\])readable-stream[/\\]duplex/,
					replacement: require.resolve('./src/lib/~readable-stream-duplex.js')
				},
				// just use util:
				{ find: /^inherits$/, replacement: require.resolve('./src/lib/~inherits.js') },
				// only pull in fsevents when its exports are accessed (avoids exceptions):
				{ find: /^fsevents$/, replacement: require.resolve('./src/lib/~fsevents.js') },
				// avoid pulling in 50kb of "editions" dependencies to resolve one file:
				{ find: /^istextorbinary$/, replacement: 'istextorbinary/edition-node-0.12/index.js' }, // 2.6.0
				{ find: /^acorn-import-assertions$/, replacement: require.resolve('acorn-import-assertions') }
			]
		}),
		commonjs({
			exclude: [/\.mjs$/, /\/rollup\//, resolve('src')],
			ignore: builtins,
			transformMixedEsModules: true,
			requireReturnsDefault: 'preferred'
		}),
		nodeResolve({
			preferBuiltins: true,
			// Rollup prefers "default" by default and rollup itself points to a
			// browser build there...
			exportConditions: ['node', 'import', 'module', 'default'],
			extensions: ['.mjs', '.js', '.json', '.es6', '.node']
		}),
		json()
	]
};

export default config;
