import aspectRatio from '@tailwindcss/aspect-ratio';
import containerQueries from '@tailwindcss/container-queries';
import forms from '@tailwindcss/forms';
import typography from '@tailwindcss/typography';
import type { Config } from 'tailwindcss';

export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],

	theme: {
		extend: {
			/*
			=== COMMONS TAILWIND DESIGN SYSTEM ===
			Semantic tokens for global participation infrastructure
			*/

			fontFamily: {
				// === DUAL-FONT SYSTEM ===
				// Satoshi: Brand identity, words, UI copy, CTAs
				// JetBrains Mono: Data, metrics, counts, codes

				sans: [
					'"Satoshi"',
					'ui-sans-serif',
					'system-ui',
					'-apple-system',
					'BlinkMacSystemFont',
					'"Segoe UI"',
					'Roboto',
					'"Helvetica Neue"',
					'Arial',
					'sans-serif'
				], // Default: Satoshi for all text

				brand: [
					'"Satoshi"',
					'ui-sans-serif',
					'system-ui',
					'-apple-system',
					'BlinkMacSystemFont',
					'"Segoe UI"',
					'Roboto',
					'"Helvetica Neue"',
					'Arial',
					'sans-serif'
				], // Explicit brand font (Satoshi)

				mono: [
					'"JetBrains Mono"',
					'ui-monospace',
					'SFMono-Regular',
					'Menlo',
					'Monaco',
					'Consolas',
					'Liberation Mono',
					'Courier New',
					'monospace'
				], // Data, metrics, counts, codes

				// Legacy support (for gradual migration)
				participation: [
					'"Satoshi"',
					'ui-sans-serif',
					'system-ui',
					'-apple-system',
					'BlinkMacSystemFont',
					'"Segoe UI"',
					'Roboto',
					'"Helvetica Neue"',
					'Arial',
					'sans-serif'
				]
			},

			colors: {
				// Core Participation Brand Colors - Vibrant Trust
				'participation-primary': {
					50: '#eef2ff',
					100: '#e0e7ff',
					200: '#c7d2fe',
					300: '#a5b4fc',
					400: '#818cf8',
					500: '#6366f1', // Indigo-500 - vibrant, trustworthy
					600: '#4f46e5', // Indigo-600 - primary brand
					700: '#4338ca', // Indigo-700 - hover states
					800: '#3730a3', // Indigo-800 - pressed states
					900: '#312e81', // Indigo-900 - dark text
					950: '#1e1b4b' // Indigo-950 - darkest
				},

				// Accent Colors - Distinctive Voice
				'participation-accent': {
					50: '#faf5ff',
					100: '#f3e8ff',
					200: '#e9d5ff',
					300: '#d8b4fe',
					400: '#c084fc',
					500: '#a855f7', // Violet-500 - accent
					600: '#9333ea', // Violet-600 - "Count" color
					700: '#7c3aed', // Violet-700 - hover
					800: '#6b21a8', // Violet-800 - pressed
					900: '#581c87', // Violet-900 - dark
					950: '#3b0764' // Violet-950 - darkest
				},

				// Delivery Channel Colors - Semantic Differentiation
				'channel-verified': {
					50: '#ecfdf5',
					100: '#d1fae5',
					200: '#a7f3d0',
					300: '#6ee7b7',
					400: '#34d399',
					500: '#10b981', // Verified delivery green
					600: '#059669',
					700: '#047857',
					800: '#065f46',
					900: '#064e3b'
				},
				'channel-community': {
					50: '#f0f9ff',
					100: '#e0f2fe',
					200: '#bae6fd',
					300: '#7dd3fc',
					400: '#38bdf8',
					500: '#0ea5e9', // Community outreach blue
					600: '#0284c7',
					700: '#0369a1',
					800: '#075985',
					900: '#0c4a6e'
				},

				// Participation Status Colors - Clear Communication
				'status-success': {
					50: '#f0fdf4',
					500: '#22c55e',
					700: '#15803d'
				},
				'status-warning': {
					50: '#fffbeb',
					500: '#f59e0b',
					700: '#a16207'
				},
				'status-error': {
					50: '#fef2f2',
					500: '#ef4444',
					700: '#b91c1c'
				},
				'status-info': {
					50: '#eff6ff',
					500: '#3b82f6',
					700: '#1d4ed8'
				},
				'status-neutral': {
					50: '#f9fafb',
					500: '#6b7280',
					700: '#374151'
				},

				// Surface Colors - Infrastructure Hierarchy
				surface: {
					base: '#ffffff',
					raised: '#f9fafb',
					overlay: '#f3f4f6',
					inverted: '#111827',
					accent: '#f8fafc',
					border: '#e5e7eb',
					'border-strong': '#d1d5db'
				},

				// Text Colors - Clear Hierarchy
				text: {
					primary: '#111827',
					secondary: '#374151',
					tertiary: '#6b7280',
					quaternary: '#9ca3af',
					inverse: '#ffffff',
					accent: '#4f46e5' // Indigo-600 - links, interactive elements
				},

				// Legacy Support (for existing components) - keeping for backward compatibility
				congressional: {
					50: '#ecfdf5',
					100: '#d1fae5',
					200: '#a7f3d0',
					500: '#10b981',
					600: '#059669',
					700: '#047857'
				},
				direct: {
					50: '#f0f9ff',
					100: '#e0f2fe',
					200: '#bae6fd',
					500: '#0ea5e9',
					600: '#0284c7',
					700: '#0369a1'
				},
				// New governance-neutral aliases
				verified: {
					50: '#ecfdf5',
					100: '#d1fae5',
					200: '#a7f3d0',
					500: '#10b981',
					600: '#059669',
					700: '#047857'
				},
				community: {
					50: '#f0f9ff',
					100: '#e0f2fe',
					200: '#bae6fd',
					500: '#0ea5e9',
					600: '#0284c7',
					700: '#0369a1'
				},
				status: {
					active: '#10b981',
					pending: '#f59e0b',
					error: '#ef4444',
					neutral: '#6b7280'
				}
			},

			// Participation Spacing System - Consistent Rhythm
			spacing: {
				'participation-xs': '0.25rem', // 4px
				'participation-sm': '0.5rem', // 8px
				'participation-md': '0.75rem', // 12px
				'participation-lg': '1rem', // 16px
				'participation-xl': '1.5rem', // 24px
				'participation-2xl': '2rem', // 32px
				'participation-3xl': '3rem', // 48px

				// Component-specific spacing
				'badge-x': '0.75rem', // 12px - more generous
				'badge-y': '0.25rem', // 4px
				'button-x': '1.5rem', // 24px - touch-friendly
				'button-y': '0.75rem', // 12px
				card: '1.5rem', // 24px
				section: '4rem' // 64px - major sections
			},

			// Participation Border Radius - Consistent Roundness
			borderRadius: {
				participation: '0.375rem', // 6px - subtle corners
				'participation-md': '0.5rem', // 8px - medium elements
				'participation-lg': '0.75rem', // 12px - cards, surfaces
				'participation-xl': '1rem' // 16px - major containers
			},

			// Box Shadows - Infrastructure Depth
			boxShadow: {
				'participation-sm': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
				'participation-md': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
				'participation-lg': '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
				'participation-brand': '0 4px 14px 0 rgb(79 70 229 / 0.15)', // Indigo-600 branded shadow
				'participation-verified': '0 4px 14px 0 rgb(16 185 129 / 0.15)',
				'participation-community': '0 4px 14px 0 rgb(14 165 233 / 0.15)',

				// Atmospheric shadows (Phase 3: Cypherpunk Newsroom)
				'atmospheric-card':
					'inset 0 1px 0 0 rgba(255, 255, 255, 0.6), 0 1px 2px 0 rgba(0, 0, 0, 0.05)',
				'atmospheric-card-hover':
					'inset 0 1px 0 0 rgba(255, 255, 255, 0.8), 0 8px 16px -4px rgba(0, 0, 0, 0.08)',
				'atmospheric-featured':
					'inset 0 2px 0 0 rgba(255, 255, 255, 0.8), 0 12px 24px -8px rgba(139, 92, 246, 0.12)'
			},

			// Typography Scale — Fluid (clamp-based, 320px–1600px viewport range)
			// Overrides standard Tailwind sizes so text-lg, text-xl, etc. scale fluidly.
			// Line-heights are unitless ratios so they scale with the fluid font-size.
			// xs/sm/base stay fixed — body text shouldn't shrink below 16px (iOS zoom prevention).
			fontSize: {
				lg: ['var(--fluid-lg, 1.125rem)', { lineHeight: '1.55' }],
				xl: ['var(--fluid-xl, 1.25rem)', { lineHeight: '1.4' }],
				'2xl': ['var(--fluid-2xl, 1.5rem)', { lineHeight: '1.33' }],
				'3xl': ['var(--fluid-3xl, 1.875rem)', { lineHeight: '1.2' }],
				'4xl': ['var(--fluid-4xl, 2.25rem)', { lineHeight: '1.15' }],
				'5xl': ['var(--fluid-display, 2.5rem)', { lineHeight: '1.1' }]
			},

			// Animations - Participation Interaction Feedback
			animation: {
				'participation-pulse': 'participation-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
				'participation-bounce': 'participation-bounce 1s ease-in-out',
				'participation-fade-in': 'participation-fade-in 0.3s ease-out',
				'participation-slide-up': 'participation-slide-up 0.3s ease-out',
				'save-pulse': 'save-pulse 2s ease-in-out infinite',
				shine: 'shine 3s ease-in-out infinite'
			},

			keyframes: {
				'participation-pulse': {
					'0%, 100%': { opacity: '1' },
					'50%': { opacity: '0.7' }
				},
				'participation-bounce': {
					'0%, 20%, 53%, 80%, 100%': { transform: 'translateY(0)' },
					'40%, 43%': { transform: 'translateY(-8px)' },
					'70%': { transform: 'translateY(-4px)' },
					'90%': { transform: 'translateY(-2px)' }
				},
				'participation-fade-in': {
					'0%': { opacity: '0' },
					'100%': { opacity: '1' }
				},
				'participation-slide-up': {
					'0%': { transform: 'translateY(16px)', opacity: '0' },
					'100%': { transform: 'translateY(0)', opacity: '1' }
				},
				'save-pulse': {
					'0%, 100%': { opacity: '1' },
					'50%': { opacity: '0.5' }
				},
				shine: {
					'0%': { transform: 'translateX(-100%) rotate(12deg)' },
					'50%, 100%': { transform: 'translateX(200%) rotate(12deg)' }
				}
			},

			// Transition Timings - Participation Interactions
			transitionDuration: {
				participation: '200ms',
				'participation-slow': '300ms'
			},

			transitionTimingFunction: {
				participation: 'cubic-bezier(0.4, 0, 0.2, 1)',
				'participation-bounce': 'cubic-bezier(0.68, -0.55, 0.265, 1.55)'
			}
		}
	},

	plugins: [typography, forms, containerQueries, aspectRatio]
} as Config;
