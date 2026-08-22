// CommonJS entry point for Windows compatibility.
// Electron loads this file first; it dynamically imports the ESM main module.
(async function bootstrap() {
  try {
    await import('./main.mjs');
  } catch (error) {
    console.error('Failed to start Emerald Online 3DS:', error);
    process.exitCode = 1;
  }
})();
