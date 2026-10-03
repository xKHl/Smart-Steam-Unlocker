/**
 * Process-wide operation coordinator shared by all achievement operation modes.
 *
 * A non-terminal Humanized schedule or Instant queue owns an AppID + achievement
 * lease until it reaches a deterministic release point. The coordinator is
 * deliberately independent of Steam and Electron so services can enforce the
 * same invariant without relying on renderer state.
 */

class OperationLeaseConflictError extends Error {
  constructor(existingLease, requestedLease) {
    super(`Achievement ${requestedLease.achievementId} for AppID ${requestedLease.appId} is already leased by ${existingLease.mode}.`);
    this.name = 'OperationLeaseConflictError';
    this.code = 'OPERATION_LEASE_CONFLICT';
    this.existingLease = { ...existingLease };
    this.requestedLease = { ...requestedLease };
  }
}

function leaseKey(appId, achievementId) {
  return `${String(appId)}:${String(achievementId)}`;
}

function normalizeLease(lease) {
  if (!lease || lease.appId === undefined || lease.appId === null || !lease.achievementId || !lease.mode || !lease.ownerId) {
    throw new Error('A lease requires appId, achievementId, mode, and ownerId.');
  }
  return Object.freeze({
    appId: lease.appId,
    achievementId: String(lease.achievementId),
    mode: lease.mode,
    ownerId: String(lease.ownerId),
    state: lease.state ?? 'active',
  });
}

function createOperationCoordinator() {
  const leases = new Map();

  function getLease(appId, achievementId) {
    const lease = leases.get(leaseKey(appId, achievementId));
    return lease ? { ...lease } : null;
  }

  function assertAvailable(normalizedLeases, { allowedOwnerIds = new Set() } = {}) {
    for (const lease of normalizedLeases) {
      const existing = leases.get(leaseKey(lease.appId, lease.achievementId));
      if (existing && existing.ownerId !== lease.ownerId && !allowedOwnerIds.has(existing.ownerId)) {
        throw new OperationLeaseConflictError(existing, lease);
      }
    }
  }

  function claim(lease) {
    const normalized = normalizeLease(lease);
    assertAvailable([normalized]);
    leases.set(leaseKey(normalized.appId, normalized.achievementId), normalized);
    return { ...normalized };
  }

  function claimMany(requestedLeases) {
    const normalized = requestedLeases.map(normalizeLease);
    assertAvailable(normalized);
    normalized.forEach((lease) => leases.set(leaseKey(lease.appId, lease.achievementId), lease));
    return normalized.map((lease) => ({ ...lease }));
  }

  /**
   * Atomically replaces all leases owned by `previousOwnerId` with `nextLeases`.
   * This is used when a persisted schedule or queue changes composition.
   */
  function replaceOwner(previousOwnerId, nextLeases) {
    const normalized = nextLeases.map(normalizeLease);
    assertAvailable(normalized, { allowedOwnerIds: new Set(previousOwnerId ? [String(previousOwnerId)] : []) });

    if (previousOwnerId) releaseOwner(previousOwnerId);
    normalized.forEach((lease) => leases.set(leaseKey(lease.appId, lease.achievementId), lease));
    return normalized.map((lease) => ({ ...lease }));
  }

  function release(appId, achievementId, ownerId = null) {
    const key = leaseKey(appId, achievementId);
    const existing = leases.get(key);
    if (!existing || (ownerId && existing.ownerId !== String(ownerId))) return false;
    leases.delete(key);
    return true;
  }

  function releaseOwner(ownerId) {
    const normalizedOwner = String(ownerId);
    let released = 0;
    for (const [key, lease] of leases.entries()) {
      if (lease.ownerId === normalizedOwner) {
        leases.delete(key);
        released += 1;
      }
    }
    return released;
  }

  function snapshot() {
    return [...leases.values()].map((lease) => ({ ...lease }));
  }

  /** Process restart is a deterministic stale-lease recovery boundary. */
  function resetForRestart() {
    leases.clear();
  }

  return {
    claim,
    claimMany,
    getLease,
    release,
    releaseOwner,
    replaceOwner,
    resetForRestart,
    snapshot,
  };
}

const operationCoordinator = createOperationCoordinator();

module.exports = {
  OperationLeaseConflictError,
  createOperationCoordinator,
  leaseKey,
  operationCoordinator,
};
