// うつろい暦 — build: inline src/* into one self-contained HTML file.
//   index.html          … a complete document (open the file directly, or host anywhere static)
//   dist/artifact.html  … the same page without the document skeleton (for hosts that add their own)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => readFileSync(join(root, 'src', f), 'utf8');
const skip = (process.env.SKIP || '').split(',');
const order = ['astro.js', 'data.js', 'motifs.js', 'sound.js', 'scene.js', 'main.js'].filter((f) => !skip.includes(f));

let tpl = src('index.template.html');
const css = src('style.css');
const js = order.filter((f) => existsSync(join(root, 'src', f)) || (console.warn('missing src/' + f), false)).map((f) => `/* ---- ${f} ---- */\n${src(f)}`).join('\n');
// </script> inside JS would end the tag early
const safeJs = js.replace(/<\/script/gi, '<\\/script');

tpl = tpl.replace('/*CSS*/', () => css).replace('<!--JS-->', () => `<script>\n${safeJs}\n</script>`);
const headMatch = tpl.match(/<!--HEAD-->([\s\S]*?)<!--\/HEAD-->/);
const head = headMatch[1].trim();
const body = tpl.replace(headMatch[0], '').trim();

const full = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
${head}
</head>
<body>
${body}
</body>
</html>
`;
// Artifact hosts wrap the page in their own skeleton; keep the stage inside the host's safe-area padding there.
const artifact = `${head.replace('</style>', '#stage{top:env(safe-area-inset-top,0px);bottom:env(safe-area-inset-bottom,0px)}\n</style>')}
${body}
`;

writeFileSync(join(root, 'index.html'), full);
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'artifact.html'), artifact);
console.log(`index.html ${(full.length / 1024).toFixed(1)} KB · dist/artifact.html ${(artifact.length / 1024).toFixed(1)} KB`);
