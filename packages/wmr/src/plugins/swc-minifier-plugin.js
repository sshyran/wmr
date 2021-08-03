import { minify } from '@swc/core';
import { hasDebugFlag } from '../lib/output-utils.js';

/** @returns {import('rollup').Plugin} */
export default function swcMinifyPlugin({ sourcemap = false, warnThreshold = 50, compress = false } = {}) {
	return {
		name: 'swc-minify',
		async renderChunk(code, chunk) {
			let out, duration;
			try {
				const start = Date.now();
				const p = minify(code, {
					compress,
					ecma: 2018,
					mangle: true,
					module: true,
					safari10: true,
					parse: {
						bare_returns: false,
						html5_comments: false,
						shebang: false
					},
					output: {
						comments: false
					}
				});
				out = await p;
				duration = Date.now() - start;
			} catch (err) {
				return this.error(err);
			}

			if (!out.code) out.code = code;

			if (duration > warnThreshold && hasDebugFlag()) {
				this.warn(`minify(${chunk.fileName}) took ${duration}ms`);
			}
			const map = typeof out.map === 'string' ? JSON.parse(out.map) : out.map || null;
			return { code: out.code, map };
		}
	};
}
