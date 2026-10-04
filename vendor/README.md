# vendor

`tiptap.bundle.js` is TipTap and the few ProseMirror parts the workspace uses, bundled once into a
single static file so the site keeps no build step. It is loaded with a normal script tag and
exposes a global called `TT`. `tiptap-entry.js` is the list of what goes into it.

To rebuild it (only when `tiptap-entry.js` changes or TipTap is upgraded):

```
mkdir /tmp/tiptap-build && cd /tmp/tiptap-build
npm init -y
npm install @tiptap/core @tiptap/pm @tiptap/extension-document @tiptap/extension-paragraph \
            @tiptap/extension-text @tiptap/extensions esbuild
cp <repo>/vendor/tiptap-entry.js entry.js
npx esbuild entry.js --bundle --minify --format=iife --global-name=TT --outfile=<repo>/vendor/tiptap.bundle.js
```

The workspace tests (`tests/workspace`) load this file in a real browser, so run them after a rebuild.
