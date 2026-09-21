# Uncapped renderer benchmark

The designer uses the browser's animation frame scheduling. It has no application
FPS cap. A steady 60 FPS on a 60 Hz display does not measure the renderer's maximum
throughput.

If you have changed the app since the last build, run `npm run build` first. Then run:

```sh
npm run benchmark:browser
```

If the preview is not already running, this command starts it and waits until it
responds before opening Chrome. Keep the terminal open while benchmarking and
press Ctrl+C after closing Chrome.

The default URL is the production preview at `http://localhost:4173`. To use the
development server or a different address, pass its URL:

```sh
npm run benchmark:browser -- http://localhost:5173
```

This launches Chrome (or Edge if Chrome is unavailable on Windows) with
`--disable-frame-rate-limit` and `--disable-gpu-vsync`. A new temporary profile for
each run ensures the flags apply without falling back to an existing normal browser
session. This profile has its own saved application state; load the same project
and match the camera and render settings before comparing results. Set `CHROME_PATH`
if the browser is installed outside the standard locations.

Use the 3D fullscreen button and watch the FPS counter once asset loading and
shader compilation have finished. Compare at the same viewport size: fullscreen
usually renders more pixels. The reported FPS is render throughput; the monitor
still displays at its physical refresh rate. Browser, driver, and compositor
behavior may still constrain throughput. Close the benchmark browser when finished.

For a custom address, the launcher checks that the address responds before opening
Chrome. Preview the launch configuration without opening a browser using
`npm run benchmark:browser -- --dry-run`.

References: [browser animation-frame scheduling](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)
and [Chromium's frame-limit switch](https://chromium.googlesource.com/chromium/src/+/887f2f6d9cf0803ea679f4373da04ce5a3915e39/components/viz/common/switches.cc).
