set -e
mkdir -p dist
npx esbuild src/app.js --bundle --minify --format=iife --target=es2020 --outfile=dist/app.js --log-level=warning
python3 - <<'PY'
t=open('src/template.html').read(); js=open('dist/app.js').read()
assert '</script' not in js
open('index.html','w').write(t.replace('<script>/*BUNDLE*/</script>', '<script>'+js+'</script>'))
PY
ls -la index.html
