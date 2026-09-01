import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultManagedCodexHome } from "./codex-runtime-provider.mjs";

export const CODEXLESS_BROWSER_REPAIR_SKILL = "codexless-browser-repair";
export const CODEXLESS_GEMINI_SUPERVISOR_SKILL = "codexless-gemini-supervisor";
export const CODEXLESS_MANAGED_SKILL_MARKER = ".codexless-managed-skill.json";
export const CODEXLESS_MANAGED_SKILL_SCHEMA = 1;
export const CODEXLESS_SKILL_TRANSACTION_SCHEMA = 1;
export const CODEXLESS_BROWSER_REPAIR_TARGET_LANE = "existing";
export const CODEXLESS_GEMINI_SUPERVISOR_TARGET_LANE = "existing";

const TRANSACTION_STATE_FILE = "transaction.json";
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "..");

const SKILL_CONFIGS = Object.freeze({
  [CODEXLESS_BROWSER_REPAIR_SKILL]: Object.freeze({
    skill: CODEXLESS_BROWSER_REPAIR_SKILL,
    label: "Browser Repair",
    targetLane: CODEXLESS_BROWSER_REPAIR_TARGET_LANE,
    forbidManagedHome: true,
  }),
  [CODEXLESS_GEMINI_SUPERVISOR_SKILL]: Object.freeze({
    skill: CODEXLESS_GEMINI_SUPERVISOR_SKILL,
    label: "Gemini Supervisor",
    targetLane: CODEXLESS_GEMINI_SUPERVISOR_TARGET_LANE,
    forbidManagedHome: true,
  }),
});

export const CODEXLESS_PRODUCT_OWNED_SKILLS = Object.freeze(Object.keys(SKILL_CONFIGS));

export class CodexSkillSyncError extends Error {
  constructor(message, { code, stage }) {
    super(message);
    this.name = "CodexSkillSyncError";
    this.code = code;
    this.stage = stage;
  }
}

export function defaultCodexHome(env = process.env) {
  const explicit = typeof env?.CODEX_HOME === "string" ? env.CODEX_HOME.trim() : "";
  return path.resolve(explicit || path.join(os.homedir(), ".codex"));
}

export function defaultSkillSource(skill) {
  const config = skillConfig(skill);
  return path.join(projectRoot, "skills", config.skill);
}

export function defaultBrowserRepairSkillSource() {
  return defaultSkillSource(CODEXLESS_BROWSER_REPAIR_SKILL);
}

export function defaultGeminiSupervisorSkillSource() {
  return defaultSkillSource(CODEXLESS_GEMINI_SUPERVISOR_SKILL);
}

export function checkManagedSkill(options = {}) {
  const config = skillConfig(options.skill);
  const codexHome = path.resolve(options.codexHome ?? defaultCodexHome());
  const sourceDir = path.resolve(options.sourceDir ?? defaultSkillSource(config.skill));
  const targetLane = options.targetLane ?? config.targetLane;
  const managedCodexHome = path.resolve(options.managedCodexHome ?? defaultManagedCodexHome());

  assertExistingLane({ config, codexHome, targetLane, managedCodexHome });
  const source = inspectSource(sourceDir, config);
  const targetDir = targetFor(codexHome, config.skill);
  if (!existsSync(targetDir)) {
    return resultBase({ config, status: "missing", action: "install", source, targetDir });
  }
  const targetStat = lstatSync(targetDir);
  if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
    return resultBase({
      config,
      status: "conflict",
      action: "blocked",
      source,
      targetDir,
      reason: "target-is-not-a-managed-directory",
    });
  }

  const marker = readMarker(targetDir);
  if (!marker || marker.product !== "codexless" || marker.skill !== config.skill) {
    return resultBase({
      config,
      status: "conflict",
      action: "blocked",
      source,
      targetDir,
      reason: "target-not-owned-by-codexless",
    });
  }

  const target = inspectTree(targetDir, { excludeMarker: true });
  if (marker.contentHash !== target.contentHash) {
    return resultBase({
      config,
      status: "drifted",
      action: "blocked",
      source,
      targetDir,
      target,
      marker,
      reason: "managed-skill-content-changed-outside-sync",
    });
  }
  if (source.contentHash === target.contentHash) {
    return resultBase({
      config,
      status: "current",
      action: "no-op",
      source,
      targetDir,
      target,
      marker,
    });
  }
  return resultBase({
    config,
    status: "update_available",
    action: "update",
    source,
    targetDir,
    target,
    marker,
  });
}

export function prepareManagedSkillSync(options = {}) {
  const config = skillConfig(options.skill);
  const check = checkManagedSkill({ ...options, skill: config.skill });
  if (check.action === "no-op") {
    return { ...check, changed: false, transactionId: null, transactionStatus: "no-op" };
  }
  assertSyncAllowed(check, config);

  const codexHome = path.resolve(options.codexHome ?? defaultCodexHome());
  const sourceDir = path.resolve(options.sourceDir ?? defaultSkillSource(config.skill));
  const skillsRoot = path.join(codexHome, "skills");
  const targetDir = targetFor(codexHome, config.skill);
  mkdirSync(skillsRoot, { recursive: true });

  const transactionId = randomUUID();
  const transactionRoot = transactionRootFor(codexHome, config.skill, transactionId);
  const stageDir = path.join(transactionRoot, "staged");
  const backupDir = path.join(transactionRoot, "previous");
  const hadExistingTarget = existsSync(targetDir);
  mkdirSync(transactionRoot, { recursive: false });

  let oldTargetMoved = false;
  let activated = false;
  try {
    copyRegularTree(sourceDir, stageDir);
    const staged = inspectTree(stageDir, { excludeMarker: true });
    if (staged.contentHash !== check.sourceHash) {
      throw new CodexSkillSyncError(`Staged ${config.label} Skill does not match the source hash.`, {
        code: "CODEXLESS_SKILL_STAGE_MISMATCH",
        stage: "stage",
      });
    }
    writeManagedMarker(stageDir, staged, config.skill);

    if (hadExistingTarget) {
      renameSync(targetDir, backupDir);
      oldTargetMoved = true;
    }
    renameSync(stageDir, targetDir);
    activated = true;

    const final = checkManagedSkill({
      skill: config.skill,
      codexHome,
      sourceDir,
      targetLane: config.targetLane,
      managedCodexHome: options.managedCodexHome,
    });
    if (final.status !== "current") {
      throw new CodexSkillSyncError(`${config.label} Skill did not validate as current after prepare.`, {
        code: "CODEXLESS_SKILL_POSTCHECK_FAILED",
        stage: "postcheck",
      });
    }

    const state = {
      schemaVersion: CODEXLESS_SKILL_TRANSACTION_SCHEMA,
      product: "codexless",
      skill: config.skill,
      transactionId,
      hadExistingTarget,
      sourceHash: check.sourceHash,
      previousStatus: check.status,
      previousAction: check.action,
    };
    writeFileSync(path.join(transactionRoot, TRANSACTION_STATE_FILE), `${JSON.stringify(state, null, 2)}\n`, "utf8");
    return {
      ...final,
      changed: true,
      transactionId,
      transactionStatus: "prepared",
      previousStatus: check.status,
      previousAction: check.action,
    };
  } catch (error) {
    const rollbackFailure = rollbackInMemory({
      targetDir,
      backupDir,
      transactionRoot,
      oldTargetMoved,
      activated,
      sourceHash: check.sourceHash,
      skill: config.skill,
    });
    if (rollbackFailure) {
      throw new CodexSkillSyncError(`${config.label} Skill prepare failed and rollback could not restore the previous target: ${rollbackFailure}`, {
        code: "CODEXLESS_SKILL_ROLLBACK_FAILED",
        stage: "rollback",
      });
    }
    if (error instanceof CodexSkillSyncError) throw error;
    throw new CodexSkillSyncError(error instanceof Error ? error.message : String(error), {
      code: "CODEXLESS_SKILL_SYNC_FAILED",
      stage: "prepare",
    });
  }
}

export function finalizeManagedSkillSync({
  skill,
  codexHome = defaultCodexHome(),
  transactionId,
} = {}) {
  const config = skillConfig(skill);
  const resolvedHome = path.resolve(codexHome);
  const state = readTransaction(resolvedHome, config, transactionId);
  const targetDir = targetFor(resolvedHome, config.skill);
  const target = inspectManagedTarget(targetDir, config);
  if (target.contentHash !== state.sourceHash) {
    throw new CodexSkillSyncError(`Prepared ${config.label} Skill changed before transaction finalize; preserving rollback state.`, {
      code: "CODEXLESS_SKILL_TRANSACTION_DRIFT",
      stage: "finalize",
    });
  }
  rmSync(transactionRootFor(resolvedHome, config.skill, transactionId), { recursive: true, force: true });
  return {
    ok: true,
    skill: config.skill,
    status: "current",
    action: "no-op",
    changed: true,
    transactionId,
    transactionStatus: "finalized",
    targetDir,
    targetHash: target.contentHash,
  };
}

export function rollbackManagedSkillSync({
  skill,
  codexHome = defaultCodexHome(),
  transactionId,
} = {}) {
  const config = skillConfig(skill);
  const resolvedHome = path.resolve(codexHome);
  const state = readTransaction(resolvedHome, config, transactionId);
  const transactionRoot = transactionRootFor(resolvedHome, config.skill, transactionId);
  const backupDir = path.join(transactionRoot, "previous");
  const targetDir = targetFor(resolvedHome, config.skill);

  if (existsSync(targetDir)) {
    const target = inspectManagedTarget(targetDir, config);
    if (target.contentHash !== state.sourceHash) {
      throw new CodexSkillSyncError(`Prepared ${config.label} Skill changed before rollback; refusing to delete unexpected local content.`, {
        code: "CODEXLESS_SKILL_TRANSACTION_DRIFT",
        stage: "rollback",
      });
    }
    rmSync(targetDir, { recursive: true, force: true });
  }

  if (state.hadExistingTarget) {
    if (!existsSync(backupDir)) {
      throw new CodexSkillSyncError(`${config.label} Skill rollback backup is missing.`, {
        code: "CODEXLESS_SKILL_ROLLBACK_FAILED",
        stage: "rollback",
      });
    }
    renameSync(backupDir, targetDir);
  }
  rmSync(transactionRoot, { recursive: true, force: true });
  return {
    ok: true,
    skill: config.skill,
    status: state.hadExistingTarget ? "restored" : "missing",
    action: "rollback",
    changed: true,
    transactionId,
    transactionStatus: "rolled_back",
    targetDir,
  };
}

export function syncManagedSkill(options = {}) {
  const config = skillConfig(options.skill);
  const prepared = prepareManagedSkillSync({ ...options, skill: config.skill });
  if (!prepared.transactionId) return prepared;
  try {
    const finalized = finalizeManagedSkillSync({
      skill: config.skill,
      codexHome: options.codexHome ?? defaultCodexHome(),
      transactionId: prepared.transactionId,
    });
    return {
      ...prepared,
      transactionStatus: finalized.transactionStatus,
    };
  } catch (error) {
    return {
      ...prepared,
      transactionStatus: "prepared_cleanup_pending",
      warnings: [`The new Skill is active, but transaction cleanup could not complete: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

export function checkBrowserRepairSkill(options = {}) {
  return checkManagedSkill({ ...options, skill: CODEXLESS_BROWSER_REPAIR_SKILL });
}

export function prepareBrowserRepairSkillSync(options = {}) {
  return prepareManagedSkillSync({ ...options, skill: CODEXLESS_BROWSER_REPAIR_SKILL });
}

export function finalizeBrowserRepairSkillSync(options = {}) {
  return finalizeManagedSkillSync({ ...options, skill: CODEXLESS_BROWSER_REPAIR_SKILL });
}

export function rollbackBrowserRepairSkillSync(options = {}) {
  return rollbackManagedSkillSync({ ...options, skill: CODEXLESS_BROWSER_REPAIR_SKILL });
}

export function syncBrowserRepairSkill(options = {}) {
  return syncManagedSkill({ ...options, skill: CODEXLESS_BROWSER_REPAIR_SKILL });
}

export function checkGeminiSupervisorSkill(options = {}) {
  return checkManagedSkill({ ...options, skill: CODEXLESS_GEMINI_SUPERVISOR_SKILL });
}

export function prepareGeminiSupervisorSkillSync(options = {}) {
  return prepareManagedSkillSync({ ...options, skill: CODEXLESS_GEMINI_SUPERVISOR_SKILL });
}

export function finalizeGeminiSupervisorSkillSync(options = {}) {
  return finalizeManagedSkillSync({ ...options, skill: CODEXLESS_GEMINI_SUPERVISOR_SKILL });
}

export function rollbackGeminiSupervisorSkillSync(options = {}) {
  return rollbackManagedSkillSync({ ...options, skill: CODEXLESS_GEMINI_SUPERVISOR_SKILL });
}

export function syncGeminiSupervisorSkill(options = {}) {
  return syncManagedSkill({ ...options, skill: CODEXLESS_GEMINI_SUPERVISOR_SKILL });
}

function skillConfig(skill) {
  if (typeof skill !== "string" || !SKILL_CONFIGS[skill]) {
    throw new CodexSkillSyncError(`Unknown Codexless-managed Skill: ${String(skill ?? "")}`, {
      code: "CODEXLESS_SKILL_UNKNOWN",
      stage: "source",
    });
  }
  return SKILL_CONFIGS[skill];
}

function assertExistingLane({ config, codexHome, targetLane, managedCodexHome }) {
  if (targetLane !== config.targetLane) {
    throw new CodexSkillSyncError(`${config.label} is ${config.targetLane}-specific and cannot target Managed/Both.`, {
      code: "CODEXLESS_SKILL_LANE_UNSUPPORTED",
      stage: "lane-policy",
    });
  }
  if (config.forbidManagedHome && path.resolve(codexHome) === path.resolve(managedCodexHome)) {
    throw new CodexSkillSyncError(`${config.label} must not be installed into the isolated Managed CODEX_HOME.`, {
      code: "CODEXLESS_SKILL_MANAGED_HOME_FORBIDDEN",
      stage: "lane-policy",
    });
  }
}

function assertSyncAllowed(check, config) {
  if (check.action !== "blocked") return;
  throw new CodexSkillSyncError(
    check.reason === "target-not-owned-by-codexless"
      ? `A same-name ${config.label} Codex Skill already exists but is not owned by Codexless; refusing to overwrite it.`
      : check.reason === "managed-skill-content-changed-outside-sync"
        ? `The Codexless-managed ${config.label} Skill was edited outside the sync path; refusing to overwrite local changes.`
        : `The ${config.label} Skill target conflicts with the Codexless-managed install path.`,
    { code: "CODEXLESS_SKILL_TARGET_CONFLICT", stage: "preflight" }
  );
}

function targetFor(codexHome, skill) {
  return path.join(path.resolve(codexHome), "skills", skill);
}

function transactionRootFor(codexHome, skill, transactionId) {
  if (typeof transactionId !== "string" || !/^[0-9a-f-]{36}$/i.test(transactionId)) {
    throw new CodexSkillSyncError(`A valid ${skill} Skill transactionId is required.`, {
      code: "CODEXLESS_SKILL_TRANSACTION_INVALID",
      stage: "transaction",
    });
  }
  return path.join(path.resolve(codexHome), "skills", `.${skill}.txn-${transactionId}`);
}

function readTransaction(codexHome, config, transactionId) {
  const transactionRoot = transactionRootFor(codexHome, config.skill, transactionId);
  const statePath = path.join(transactionRoot, TRANSACTION_STATE_FILE);
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    if (
      state?.schemaVersion !== CODEXLESS_SKILL_TRANSACTION_SCHEMA
      || state?.product !== "codexless"
      || state?.skill !== config.skill
      || state?.transactionId !== transactionId
      || typeof state?.hadExistingTarget !== "boolean"
      || typeof state?.sourceHash !== "string"
      || !/^[0-9a-f]{64}$/.test(state.sourceHash)
    ) throw new Error("invalid transaction state");
    return state;
  } catch (error) {
    throw new CodexSkillSyncError(`${config.label} Skill transaction state is unavailable or invalid: ${error instanceof Error ? error.message : String(error)}`, {
      code: "CODEXLESS_SKILL_TRANSACTION_INVALID",
      stage: "transaction",
    });
  }
}

function rollbackInMemory({ targetDir, backupDir, transactionRoot, oldTargetMoved, activated, sourceHash, skill }) {
  try {
    if (activated && existsSync(targetDir)) {
      const target = inspectManagedTarget(targetDir, skillConfig(skill));
      if (target.contentHash !== sourceHash) throw new Error("activated target drifted during rollback");
      rmSync(targetDir, { recursive: true, force: true });
    }
    if (oldTargetMoved && existsSync(backupDir) && !existsSync(targetDir)) renameSync(backupDir, targetDir);
    rmSync(transactionRoot, { recursive: true, force: true });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function resultBase({ config, status, action, source, targetDir, target = null, marker = null, reason = null }) {
  return {
    ok: !new Set(["conflict", "drifted"]).has(status),
    skill: config.skill,
    targetLane: config.targetLane,
    status,
    action,
    reason,
    sourceDir: source.sourceDir,
    sourceHash: source.contentHash,
    sourceFiles: source.files,
    targetDir,
    targetHash: target?.contentHash ?? null,
    marker,
  };
}

function inspectSource(sourceDir, config) {
  const resolved = path.resolve(sourceDir);
  if (!existsSync(resolved)) {
    throw new CodexSkillSyncError(`Codexless ${config.label} Skill source directory is missing.`, {
      code: "CODEXLESS_SKILL_SOURCE_MISSING",
      stage: "source",
    });
  }
  const stat = lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new CodexSkillSyncError(`Codexless ${config.label} Skill source must be a real directory.`, {
      code: "CODEXLESS_SKILL_SOURCE_INVALID",
      stage: "source",
    });
  }
  const skillMd = path.join(resolved, "SKILL.md");
  if (!existsSync(skillMd) || !lstatSync(skillMd).isFile()) {
    throw new CodexSkillSyncError(`Codexless ${config.label} Skill source is missing SKILL.md.`, {
      code: "CODEXLESS_SKILL_SOURCE_INVALID",
      stage: "source",
    });
  }
  return { sourceDir: resolved, ...inspectTree(resolved, { excludeMarker: true }) };
}

function inspectManagedTarget(targetDir, config) {
  if (!existsSync(targetDir)) {
    throw new CodexSkillSyncError(`${config.label} Skill managed target is missing.`, {
      code: "CODEXLESS_SKILL_TRANSACTION_DRIFT",
      stage: "transaction",
    });
  }
  const marker = readMarker(targetDir);
  if (!marker || marker.product !== "codexless" || marker.skill !== config.skill) {
    throw new CodexSkillSyncError(`${config.label} Skill target is no longer Codexless-managed.`, {
      code: "CODEXLESS_SKILL_TRANSACTION_DRIFT",
      stage: "transaction",
    });
  }
  const target = inspectTree(targetDir, { excludeMarker: true });
  if (marker.contentHash !== target.contentHash) {
    throw new CodexSkillSyncError(`${config.label} Skill target content no longer matches its ownership marker.`, {
      code: "CODEXLESS_SKILL_TRANSACTION_DRIFT",
      stage: "transaction",
    });
  }
  return target;
}

function inspectTree(root, { excludeMarker = false } = {}) {
  const files = listRegularFiles(root, { excludeMarker });
  const hash = createHash("sha256");
  for (const relative of files) {
    const bytes = readFileSync(path.join(root, ...relative.split("/")));
    hash.update(relative, "utf8");
    hash.update("\0", "utf8");
    hash.update(createHash("sha256").update(bytes).digest("hex"), "utf8");
    hash.update("\n", "utf8");
  }
  return { files, contentHash: hash.digest("hex") };
}

function listRegularFiles(root, { excludeMarker = false } = {}) {
  const result = [];
  walk(root, "");
  return result.sort(compareStrings);

  function walk(current, relativeDir) {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => compareStrings(a.name, b.name));
    for (const entry of entries) {
      if (excludeMarker && !relativeDir && entry.name === CODEXLESS_MANAGED_SKILL_MARKER) continue;
      const absolute = path.join(current, entry.name);
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        throw new CodexSkillSyncError(`Skill trees must not contain symlinks: ${relative}`, {
          code: "CODEXLESS_SKILL_SYMLINK_REFUSED",
          stage: "tree-inspection",
        });
      }
      if (stat.isDirectory()) walk(absolute, relative);
      else if (stat.isFile()) result.push(relative.replaceAll("\\", "/"));
      else {
        throw new CodexSkillSyncError(`Skill tree contains unsupported entry: ${relative}`, {
          code: "CODEXLESS_SKILL_TREE_INVALID",
          stage: "tree-inspection",
        });
      }
    }
  }
}

function copyRegularTree(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: false });
  const files = listRegularFiles(sourceDir, { excludeMarker: true });
  for (const relative of files) {
    const source = path.join(sourceDir, ...relative.split("/"));
    const target = path.join(targetDir, ...relative.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(source));
  }
}

function writeManagedMarker(targetDir, tree, skill) {
  const marker = {
    schemaVersion: CODEXLESS_MANAGED_SKILL_SCHEMA,
    product: "codexless",
    skill,
    contentHash: tree.contentHash,
    files: tree.files,
  };
  writeFileSync(path.join(targetDir, CODEXLESS_MANAGED_SKILL_MARKER), `${JSON.stringify(marker, null, 2)}\n`, "utf8");
}

function readMarker(targetDir) {
  const markerPath = path.join(targetDir, CODEXLESS_MANAGED_SKILL_MARKER);
  if (!existsSync(markerPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(markerPath, "utf8"));
    if (
      parsed?.schemaVersion !== CODEXLESS_MANAGED_SKILL_SCHEMA
      || typeof parsed?.product !== "string"
      || typeof parsed?.skill !== "string"
      || typeof parsed?.contentHash !== "string"
      || !/^[0-9a-f]{64}$/.test(parsed.contentHash)
      || !Array.isArray(parsed.files)
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

function compareStrings(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
