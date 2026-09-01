import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkGeminiSupervisorSkill,
  CODEXLESS_GEMINI_SUPERVISOR_SKILL,
  CODEXLESS_GEMINI_SUPERVISOR_TARGET_LANE,
  CODEXLESS_MANAGED_SKILL_MARKER,
  CodexSkillSyncError,
  defaultGeminiSupervisorSkillSource,
  syncGeminiSupervisorSkill,
} from "../src/codex-skill-sync.mjs";

function withFixture(fn) {
  const root = mkdtempSync(path.join(os.tmpdir(), "codexless-gemini-skill-"));
  const codexHome = path.join(root, "codex-home");
  const sourceDir = path.join(root, "source", CODEXLESS_GEMINI_SUPERVISOR_SKILL);
  cpSync(defaultGeminiSupervisorSkillSource(), sourceDir, { recursive: true });
  try {
    return fn({ root, codexHome, sourceDir });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function targetDir(codexHome) {
  return path.join(codexHome, "skills", CODEXLESS_GEMINI_SUPERVISOR_SKILL);
}

test("Gemini supervisor is Existing-specific and refuses the Managed home", () => {
  withFixture(({ root, sourceDir }) => {
    const managedHome = path.join(root, "managed-codex-home");
    assert.equal(CODEXLESS_GEMINI_SUPERVISOR_TARGET_LANE, "existing");
    assert.throws(
      () => checkGeminiSupervisorSkill({ codexHome: managedHome, managedCodexHome: managedHome, sourceDir }),
      (error) => error instanceof CodexSkillSyncError && error.code === "CODEXLESS_SKILL_MANAGED_HOME_FORBIDDEN"
    );
    assert.throws(
      () => checkGeminiSupervisorSkill({ codexHome: path.join(root, "existing"), managedCodexHome: managedHome, sourceDir, targetLane: "managed" }),
      (error) => error instanceof CodexSkillSyncError && error.code === "CODEXLESS_SKILL_LANE_UNSUPPORTED"
    );
  });
});

test("fresh Gemini supervisor sync is atomic, marked, and preserves unrelated user Skills", () => {
  withFixture(({ codexHome, sourceDir }) => {
    const unrelated = path.join(codexHome, "skills", "gemini-antigravity", "SKILL.md");
    mkdirSync(path.dirname(unrelated), { recursive: true });
    writeFileSync(unrelated, "user-owned transport\n", "utf8");

    const before = checkGeminiSupervisorSkill({ codexHome, sourceDir });
    assert.equal(before.status, "missing");
    assert.equal(before.action, "install");

    const installed = syncGeminiSupervisorSkill({ codexHome, sourceDir });
    assert.equal(installed.status, "current");
    assert.equal(installed.changed, true);
    assert.equal(readFileSync(unrelated, "utf8"), "user-owned transport\n");

    const marker = JSON.parse(readFileSync(path.join(targetDir(codexHome), CODEXLESS_MANAGED_SKILL_MARKER), "utf8"));
    assert.equal(marker.product, "codexless");
    assert.equal(marker.skill, CODEXLESS_GEMINI_SUPERVISOR_SKILL);
    assert.match(marker.contentHash, /^[0-9a-f]{64}$/);

    const second = syncGeminiSupervisorSkill({ codexHome, sourceDir });
    assert.equal(second.status, "current");
    assert.equal(second.changed, false);
  });
});

test("same-name user-owned Gemini supervisor is never overwritten", () => {
  withFixture(({ codexHome, sourceDir }) => {
    const target = targetDir(codexHome);
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, "SKILL.md"), "user-owned supervisor\n", "utf8");

    const check = checkGeminiSupervisorSkill({ codexHome, sourceDir });
    assert.equal(check.status, "conflict");
    assert.equal(check.action, "blocked");
    assert.equal(check.reason, "target-not-owned-by-codexless");
    assert.throws(
      () => syncGeminiSupervisorSkill({ codexHome, sourceDir }),
      (error) => error instanceof CodexSkillSyncError && error.code === "CODEXLESS_SKILL_TARGET_CONFLICT"
    );
    assert.equal(readFileSync(path.join(target, "SKILL.md"), "utf8"), "user-owned supervisor\n");
    assert.equal(existsSync(path.join(target, CODEXLESS_MANAGED_SKILL_MARKER)), false);
  });
});

test("Gemini supervisor contract pins adversarial depth instead of first-candidate convergence", () => {
  const skill = readFileSync(new URL("../skills/codexless-gemini-supervisor/SKILL.md", import.meta.url), "utf8");
  const forensic = readFileSync(new URL("../skills/codexless-gemini-supervisor/references/serious-investigation.md", import.meta.url), "utf8");
  const implementation = readFileSync(new URL("../skills/codexless-gemini-supervisor/references/implementation-review.md", import.meta.url), "utf8");
  const operations = readFileSync(new URL("../skills/codexless-gemini-supervisor/references/operations.md", import.meta.url), "utf8");

  assert.match(skill, /plausible candidate is \*\*not\*\* a stopping condition/i);
  assert.match(skill, /Investigator.*adversarial falsifier/is);
  assert.match(skill, /different fresh Gemini conversation/i);
  assert.match(skill, /Do not majority-vote/i);
  assert.match(skill, /NEEDS_MORE_EVIDENCE/);
  assert.match(forensic, /evidence_against/);
  assert.match(forensic, /counterexample_attempt/);
  assert.match(forensic, /strongest_alternative/);
  assert.match(implementation, /immutable base\/head diff/i);
  assert.match(implementation, /implementer may not certify its own change/i);
  assert.match(operations, /rg --files/);
  assert.match(operations, /30–60 seconds/);
  assert.match(operations, /Do not feed the full trajectory into every reviewer/i);
});

test("skill lane policy registers the Gemini supervisor as product-owned Existing-only", () => {
  const policy = JSON.parse(readFileSync(new URL("../config/skill-lane-policy.json", import.meta.url), "utf8"));
  assert.equal(policy.productOwnedSkills[CODEXLESS_GEMINI_SUPERVISOR_SKILL].target, "existing");
});
