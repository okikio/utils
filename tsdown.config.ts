// tsdown.config.ts
import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["mod.ts"],
  outDir: "dist",
  format: ["esm"],
  target: "esnext",
  platform: "neutral",
  dts: true,
  clean: true,
  unbundle: true,

  deps: {
    neverBundle: [/^node:/],
  },

  outputOptions(outputOptions) {
    outputOptions.postBanner = chunk => {
      if (!chunk.isEntry) return "";

      const dtsPath = `./${chunk.fileName.replace(/\.js$/, ".d.ts").split("/").at(-1)}`;
      return `/* @ts-self-types="${dtsPath}" */`;
    };

    return outputOptions;
  },

  workspace: {
    include: ["packages/*"],
  },
});