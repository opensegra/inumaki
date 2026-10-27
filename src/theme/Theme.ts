/** Color roles a theme maps to ANSI SGR parameters. */
export type Tone = 'accent' | 'success' | 'warn' | 'danger' | 'muted';

/** Every brand-specific value the package prints. */
export interface Theme {
	name: string;
	tagline: string;
	icon: string;
	/** SGR parameters per tone, e.g. `38;5;44` or `35`. */
	palette: Record<Tone, string>;
	/** ASCII art printed once; empty falls back to the one-line wordmark. */
	banner: string[];
}

export type ThemeOverrides = Partial<Omit<Theme, 'palette'>> & { palette?: Partial<Theme['palette']> };

/** Joins per-letter glyph rows into banner lines. */
function letters(...glyphs: string[][]): string[] {
	return glyphs[0].map((_, row) =>
		glyphs
			.map((glyph) => glyph[row])
			.join('')
			.trimEnd()
	);
}

export const defaultTheme: Theme = {
	name: 'SEGRA',
	tagline: 'segmented media transfer',
	icon: '◆',
	palette: { accent: '38;5;44', success: '38;5;42', warn: '38;5;214', danger: '38;5;203', muted: '38;5;245' },
	banner: letters(
		[' ____  ', '/ ___| ', '\\___ \\ ', ' ___) |', '|____/ '],
		[' _____ ', '| ____|', '|  _|  ', '| |___ ', '|_____|'],
		['  ____ ', ' / ___|', '| |  _ ', '| |_| |', ' \\____|'],
		[' ____  ', '|  _ \\ ', '| |_) |', '|  _ < ', '|_| \\_\\'],
		['    _    ', '   / \\   ', '  / _ \\  ', ' / ___ \\ ', '/_/   \\_\\']
	)
};

/** Merges overrides onto a base theme; a new `name` drops the base banner and tagline, which spell the old brand. */
export function defineTheme(overrides: ThemeOverrides, base: Theme = defaultTheme): Theme {
	const renamed = overrides.name !== undefined && overrides.name !== base.name;

	return {
		...base,
		...(renamed ? { banner: [], tagline: '' } : {}),
		...overrides,
		palette: { ...base.palette, ...overrides.palette }
	};
}
