// Temporary: proves a red CI blocks the deploy job. Removed immediately after.
describe('deploy gate', () => {
  it('fails on purpose', () => {
    expect(1).toBe(2);
  });
});
