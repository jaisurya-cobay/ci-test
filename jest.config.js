/**
 * The project is native ESM ("type": "module"), so Jest runs through the VM
 * modules API. That flag lives in the npm scripts via cross-env — Jest cannot
 * enable it for itself.
 */
export default {
  testEnvironment: 'node',
  // No transform: Node 24 runs the source as-is, so there is no Babel step.
  transform: {},
  testMatch: ['**/src/tests/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/tests/**', '!src/server.js'],
  // Integration tests bind real sockets; give them room but still fail rather
  // than hang forever.
  testTimeout: 15000,
  verbose: true,
};
