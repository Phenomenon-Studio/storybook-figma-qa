// @ts-check
// Built like the phenomenon-skills site (Starlight, docs in ../docs, mermaid), so the two read as one family.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';
import { remarkDocsLinks } from './src/remarkDocsLinks.mjs';
import { claudeGrammar } from './src/claudeGrammar.mjs';

const base = '/storybook-figma-qa';
const repo = 'https://github.com/Phenomenon-Studio/storybook-figma-qa';

export default defineConfig({
  site: 'https://phenomenon-studio.github.io',
  base,
  markdown: {
    remarkPlugins: [[remarkDocsLinks, { base }]],
  },
  integrations: [
    // must come before starlight so ```mermaid fences aren't treated as code
    // `base` theme + autoTheme off: colors come from theme.css (Starlight tokens), so one
    // render serves light and dark without a re-render on toggle.
    mermaid({
      theme: 'base',
      autoTheme: false,
      enableLog: false,
      mermaidConfig: {
        // `classic`: Mermaid 12's default `neo` look pads decisions with a fixed 70x32px
        look: 'classic',
        themeVariables: { fontFamily: "'Albert Sans', Arial, sans-serif", fontSize: '15px' },
        flowchart: { curve: 'linear', padding: 14, nodeSpacing: 40, rankSpacing: 48, wrappingWidth: 220 },
      },
    }),
    starlight({
      title: 'Storybook Figma QA',
      logo: { src: './src/assets/mark.svg' },
      favicon: '/favicon.svg',
      customCss: ['./src/styles/theme.css'],
      expressiveCode: {
        // first dark, then light: Starlight swaps them with the site theme toggle
        themes: ['github-dark', 'github-light'],
        styleOverrides: { borderRadius: '8px' },
        shiki: { langs: [claudeGrammar] },
      },
      head: [
        { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' } },
        { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: true } },
        {
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            href: 'https://fonts.googleapis.com/css2?family=Albert+Sans:wght@400..700&family=Bricolage+Grotesque:opsz,wght@12..96,400..700&display=swap',
          },
        },
        // Re-renders diagrams measured before the brand fonts loaded (see the file).
        { tag: 'script', attrs: { src: `${base}/mermaid-fonts.js`, type: 'module' } },
      ],
      social: [{ icon: 'github', label: 'GitHub', href: repo }],
      editLink: { baseUrl: `${repo}/edit/main/docs/` },
      sidebar: [
        {
          label: 'Guides',
          items: [
            'getting-started',
            'philosophy',
            'workflow',
            'figma-stories',
            'variables-and-tokens',
            'ci',
            'upgrading',
          ],
        },
        {
          label: 'Commands',
          items: [
            'commands/init',
            'commands/report',
            'commands/scaffold',
            'commands/doctor',
            'commands/variables',
            'commands/migrate',
          ],
        },
        { label: 'Reference', items: ['reference/config', 'reference/exit-codes', 'reference/results-ui'] },
        { label: 'Agent skills', items: ['skills'] },
      ],
    }),
  ],
});
