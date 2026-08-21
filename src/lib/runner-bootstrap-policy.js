const RUNNER_BOOTSTRAP_ALLOWLIST = Object.freeze({
  "monkeyskill-runner-bootstrap": Object.freeze({
    "1.0.6": Object.freeze({
      packageHash: "eb4d2956a00f5d2232fe0a06a0f58b050bc831502cafc48e6286db5248701869",
      protocolSchemaVersion: 2,
      protocolProfile: "monkeyskill-normalized-developer-conformance-v1"
    })
  })
});

export function validateRunnerBootstrapObservation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Runner Bootstrap verification payload is missing.");
  }
  assertExactKeys(value, [
    "id",
    "version",
    "bootstrapUrl",
    "packageHash",
    "protocolSchemaVersion",
    "protocolProfile",
    "verifiedFileCount",
    "verifiedByteCount"
  ], "Runner Bootstrap verification payload");
  if (typeof value.id !== "string" || typeof value.version !== "string") {
    throw new Error("Runner Bootstrap identity is invalid.");
  }
  const policy = RUNNER_BOOTSTRAP_ALLOWLIST[value.id]?.[value.version];
  if (!policy) throw new Error("This Runner Bootstrap version is not allowed by the installed Extension.");
  if (value.packageHash !== policy.packageHash) {
    throw new Error("Runner Bootstrap package hash does not match the installed Extension policy.");
  }
  if (value.protocolSchemaVersion !== policy.protocolSchemaVersion
    || value.protocolProfile !== policy.protocolProfile) {
    throw new Error("Runner Bootstrap protocol is incompatible with the installed Extension.");
  }
  if (!Number.isInteger(value.verifiedFileCount) || value.verifiedFileCount < 1 || value.verifiedFileCount > 32) {
    throw new Error("Runner Bootstrap verified file count is invalid.");
  }
  if (!Number.isInteger(value.verifiedByteCount) || value.verifiedByteCount < 1 || value.verifiedByteCount > 1_000_000) {
    throw new Error("Runner Bootstrap verified byte count is invalid.");
  }
  let bootstrapUrl;
  try {
    bootstrapUrl = new URL(value.bootstrapUrl);
  } catch {
    throw new Error("Runner Bootstrap URL is invalid.");
  }
  const local = bootstrapUrl.protocol === "http:"
    && ["127.0.0.1", "localhost"].includes(bootstrapUrl.hostname);
  if (bootstrapUrl.protocol !== "https:" && !local) {
    throw new Error("Runner Bootstrap URL must use HTTPS; localhost is allowed for development.");
  }
  if (bootstrapUrl.username || bootstrapUrl.password || bootstrapUrl.search || bootstrapUrl.hash
    || !bootstrapUrl.pathname.endsWith("/bootstrap.json")) {
    throw new Error("Runner Bootstrap URL shape is invalid.");
  }
  return Object.freeze({
    id: value.id,
    version: value.version,
    bootstrapUrl: bootstrapUrl.href,
    packageHash: policy.packageHash,
    protocolSchemaVersion: policy.protocolSchemaVersion,
    protocolProfile: policy.protocolProfile,
    verifiedFileCount: value.verifiedFileCount,
    verifiedByteCount: value.verifiedByteCount
  });
}

export function buildVerifiedRunnerBootstrapPrompt(verified, extensionVersion) {
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(extensionVersion)) {
    throw new Error("Extension version is invalid.");
  }
  return [
    "Build and install the MonkeySkill Runner from this Extension-verified Bootstrap.",
    "",
    `Package ID: ${verified.id}`,
    `Version: ${verified.version}`,
    `URL: ${verified.bootstrapUrl}`,
    `Expected package SHA-256: ${verified.packageHash}`,
    `Host protocol schema: ${verified.protocolSchemaVersion}`,
    `Host protocol profile: ${verified.protocolProfile}`,
    `Verified by MonkeySkill Extension: ${extensionVersion}`,
    "",
    "Before reading or following any Bootstrap instruction, download bootstrap.json with no credentials and no redirects, verify every listed file byte length and SHA-256, recompute packageHash from the manifest core, and abort unless the result exactly matches the expected package SHA-256 above. Then follow the verified human-readable Bootstrap to build, independently test, and install the user-scoped Runner."
  ].join("\n");
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has unsupported fields.`);
  }
}

export { RUNNER_BOOTSTRAP_ALLOWLIST };
