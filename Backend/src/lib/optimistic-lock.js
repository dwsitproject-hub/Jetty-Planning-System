/**
 * Optimistic concurrency: reject a save made against a version someone else has since replaced.
 * No `expectedUpdatedAt` means the caller opted out (legacy clients), so the save goes through.
 */
export function assertNotStale(currentUpdatedAt, expectedUpdatedAt) {
  if (expectedUpdatedAt == null || expectedUpdatedAt === '') return;
  const expected = new Date(expectedUpdatedAt).getTime();
  if (Number.isNaN(expected)) {
    throw Object.assign(new Error('expectedUpdatedAt is not a valid timestamp'), { statusCode: 400 });
  }
  if (currentUpdatedAt && new Date(currentUpdatedAt).getTime() !== expected) {
    throw Object.assign(new Error('This record was updated by someone else. Reload to see the latest.'), {
      statusCode: 409,
    });
  }
}
