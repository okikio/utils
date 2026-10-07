/** Run one import in a fresh process; this module deliberately never imports the umbrella first. */
const [specifier] = Deno.args;
const started = performance.now();
const namespace = specifier === undefined ? {} : await import(specifier);
console.log(JSON.stringify({ exports: Object.keys(namespace).length, milliseconds: performance.now() - started }));

export {};
