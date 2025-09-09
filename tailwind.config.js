module.exports = {
	content: ["src/views/**/*.eta"],
	theme: {
		extend: {
			colors: {
				accent: "oklch(var(--accent) / <alpha-value>)",
			},
			spacing: {
				18: "4.5rem",
				88: "22rem",
				128: "32rem",
			},
			maxWidth: {
				"8xl": "88rem",
				"9xl": "96rem",
			},
			minHeight: {
				"screen-75": "75vh",
				"screen-50": "50vh",
			},
		},
	},
	plugins: [
		// Add line-clamp plugin for text truncation
		({ addUtilities }) => {
			addUtilities({
				".line-clamp-1": {
					overflow: "hidden",
					display: "-webkit-box",
					"-webkit-box-orient": "vertical",
					"-webkit-line-clamp": "1",
				},
				".line-clamp-2": {
					overflow: "hidden",
					display: "-webkit-box",
					"-webkit-box-orient": "vertical",
					"-webkit-line-clamp": "2",
				},
				".line-clamp-3": {
					overflow: "hidden",
					display: "-webkit-box",
					"-webkit-box-orient": "vertical",
					"-webkit-line-clamp": "3",
				},
			});
		},
	],
	darkMode: "class",
};
