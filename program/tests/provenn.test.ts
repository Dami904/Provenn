// Provenn Protocol — in-process integration tests (litesvm, no live validator).
//
// These tests load the already-built program shared object at
// ../target/deploy/provenn_protocol.so into an in-process LiteSVM instance and
// exercise the commit/reveal/settle state machine end to end. They run in CI
// with no validator, no RPC, and no airdrop faucet.
//
// AUTHORITY-SIGNING LIMITATION (real finding):
//   `settle` is gated on a HARDCODED SETTLE_AUTHORITY pubkey
//   (Cr4NpDSDCxdry4zjq879iD21k5nLJKuUBt11LcadDpWB) baked into the program
//   source. To exercise the authority-gated cases (4 unrevealed->settle,
//   5 reveal-after-settle, 7 happy settle) a test must produce a *valid
//   signature* from that exact key — which requires its secret key. We load it
//   from ~/.config/solana/id.json ONLY if that file's pubkey equals
//   SETTLE_AUTHORITY; otherwise those three cases are skipped with a warning.
//   Case 6 (non-authority rejected) needs no real key and always runs.
//   A later refactor to a configurable / multisig settle authority would make
//   these tests fully portable. We deliberately do NOT modify program source.

import { describe, it, expect, beforeEach, test } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import { BorshCoder, BN } from "@coral-xyz/anchor";
import { LiteSVM, FailedTransactionMetadata } from "litesvm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const idl = JSON.parse(
  readFileSync(join(__dirname, "../target/idl/provenn_protocol.json"), "utf8"),
);
const SO_PATH = join(__dirname, "../target/deploy/provenn_protocol.so");
const PROGRAM_ID = new PublicKey(idl.address);
const SETTLE_AUTHORITY = new PublicKey(
  "Cr4NpDSDCxdry4zjq879iD21k5nLJKuUBt11LcadDpWB",
);
const coder = new BorshCoder(idl);

// -- try to load the real SETTLE_AUTHORITY keypair (deploy wallet) -----------
function loadSettleAuthority(): Keypair | null {
  const p = join(homedir(), ".config", "solana", "id.json");
  if (!existsSync(p)) return null;
  try {
    const kp = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))),
    );
    if (kp.publicKey.equals(SETTLE_AUTHORITY)) return kp;
    return null;
  } catch {
    return null;
  }
}
const settleAuthorityKp = loadSettleAuthority();
const HAS_AUTH = settleAuthorityKp !== null;
if (!HAS_AUTH) {
  console.warn(
    "\n[provenn tests] WARNING: ~/.config/solana/id.json is missing or its " +
      "pubkey != SETTLE_AUTHORITY (Cr4NpDSDCxdry4zjq879iD21k5nLJKuUBt11LcadDpWB). " +
      "Skipping authority-gated cases 4, 5 and 7. Case 6 still runs.\n",
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function freshSvm(): LiteSVM {
  const svm = new LiteSVM();
  svm.addProgramFromFile(PROGRAM_ID, SO_PATH);
  return svm;
}

function agentPda(authority: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), authority.toBuffer()],
    PROGRAM_ID,
  )[0];
}

function commitPda(agent: PublicKey, matchId: bigint): PublicKey {
  const mid = Buffer.alloc(8);
  mid.writeBigUInt64LE(matchId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("commit"), agent.toBuffer(), mid],
    PROGRAM_ID,
  )[0];
}

function escrowPda(commit: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), commit.toBuffer()],
    PROGRAM_ID,
  )[0];
}

function treasuryPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("treasury")], PROGRAM_ID)[0];
}

// borsh(Prediction) is exactly 3 bytes: [outcome, conf_lo, conf_hi] (u16 LE).
function predictionBytes(outcome: number, confidenceBps: number): Buffer {
  const b = Buffer.alloc(3);
  b.writeUInt8(outcome, 0);
  b.writeUInt16LE(confidenceBps, 1);
  return b;
}

function predictionHash(
  outcome: number,
  confidenceBps: number,
  nonce: Buffer,
): Buffer {
  return createHash("sha256")
    .update(Buffer.concat([predictionBytes(outcome, confidenceBps), nonce]))
    .digest();
}

function send(
  svm: LiteSVM,
  ixs: TransactionInstruction[],
  payer: Keypair,
  signers: Keypair[],
) {
  const tx = new Transaction();
  tx.recentBlockhash = svm.latestBlockhash();
  tx.feePayer = payer.publicKey;
  ixs.forEach((ix) => tx.add(ix));
  tx.sign(...signers);
  return svm.sendTransaction(tx);
}

function isFailed(res: unknown): res is FailedTransactionMetadata {
  return res instanceof FailedTransactionMetadata;
}

function expectOk(res: unknown, label: string) {
  if (isFailed(res)) {
    throw new Error(`${label} expected success but failed: ${res.toString()}`);
  }
}

// Assert the tx failed AND the program error message / name appears in logs.
function expectFailWith(res: unknown, needle: string, label: string) {
  expect(isFailed(res), `${label} should have failed`).toBe(true);
  const text = (res as FailedTransactionMetadata).toString();
  const logs = (res as FailedTransactionMetadata).meta().logs().join("\n");
  expect(
    text.includes(needle) || logs.includes(needle),
    `${label}: expected error text/logs to contain "${needle}".\n--- err ---\n${text}\n--- logs ---\n${logs}`,
  ).toBe(true);
}

// instruction builders --------------------------------------------------------

function ixRegister(authority: PublicKey, name: string): TransactionInstruction {
  const data = coder.instruction.encode("register_agent", {
    name,
    strategyHash: Array.from(Buffer.alloc(32, 9)),
  });
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: agentPda(authority), isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function ixCommit(
  authority: PublicKey,
  matchId: bigint,
  predHash: Buffer,
  stake: bigint = 0n,
): TransactionInstruction {
  const agent = agentPda(authority);
  const commit = commitPda(agent, matchId);
  const data = coder.instruction.encode("commit", {
    match_id: new BN(matchId.toString()),
    prediction_hash: Array.from(predHash),
    stake: new BN(stake.toString()),
  });
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: agent, isSigner: false, isWritable: true },
      { pubkey: commit, isSigner: false, isWritable: true },
      { pubkey: escrowPda(commit), isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function ixReveal(
  authority: PublicKey,
  matchId: bigint,
  outcome: number,
  confidenceBps: number,
  nonce: Buffer,
): TransactionInstruction {
  const agent = agentPda(authority);
  const data = coder.instruction.encode("reveal", {
    _match_id: new BN(matchId.toString()),
    prediction: { outcome, confidence_bps: confidenceBps },
    nonce: Buffer.from(nonce),
  });
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: agent, isSigner: false, isWritable: true },
      { pubkey: commitPda(agent, matchId), isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

function ixSettle(
  agentAuthority: PublicKey,
  settleSigner: PublicKey,
  matchId: bigint,
  actualOutcome: number,
): TransactionInstruction {
  const agent = agentPda(agentAuthority);
  const commit = commitPda(agent, matchId);
  const data = coder.instruction.encode("settle", {
    _match_id: new BN(matchId.toString()),
    actual_outcome: actualOutcome,
  });
  // Account order must match the Settle struct in lib.rs:
  // agent, commit, escrow, authority, treasury, settle_authority, system_program.
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: agent, isSigner: false, isWritable: true },
      { pubkey: commit, isSigner: false, isWritable: true },
      { pubkey: escrowPda(commit), isSigner: false, isWritable: true },
      { pubkey: agentAuthority, isSigner: false, isWritable: true },
      { pubkey: treasuryPda(), isSigner: false, isWritable: true },
      { pubkey: settleSigner, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// account decoders ------------------------------------------------------------

function readAgent(svm: LiteSVM, authority: PublicKey) {
  const acc = svm.getAccount(agentPda(authority));
  if (!acc) throw new Error("agent account not found");
  return coder.accounts.decode("AgentAccount", Buffer.from(acc.data));
}

function readCommit(svm: LiteSVM, authority: PublicKey, matchId: bigint) {
  const acc = svm.getAccount(commitPda(agentPda(authority), matchId));
  if (!acc) throw new Error("commit account not found");
  return coder.accounts.decode("CommitAccount", Buffer.from(acc.data));
}

function readEscrow(svm: LiteSVM, authority: PublicKey, matchId: bigint) {
  const commit = commitPda(agentPda(authority), matchId);
  const acc = svm.getAccount(escrowPda(commit));
  // A closed escrow (settled) is drained to 0 lamports and its data zeroed.
  if (!acc || acc.lamports === 0) return null;
  return coder.accounts.decode("StakeEscrow", Buffer.from(acc.data));
}

function readTreasury(svm: LiteSVM) {
  const acc = svm.getAccount(treasuryPda());
  return acc ? coder.accounts.decode("Treasury", Buffer.from(acc.data)) : null;
}

// A funded agent authority (NOT the settle authority).
function newAgentAuthority(svm: LiteSVM): Keypair {
  const kp = Keypair.generate();
  svm.airdrop(kp.publicKey, BigInt(10_000_000_000));
  return kp;
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("provenn-protocol state machine (litesvm)", () => {
  let svm: LiteSVM;
  beforeEach(() => {
    svm = freshSvm();
  });

  // Case 1 -------------------------------------------------------------------
  it("case 1: happy path register -> commit -> reveal", () => {
    const auth = newAgentAuthority(svm);
    const matchId = 42n;
    const nonce = Buffer.from("nonce-happy-1");
    const outcome = 2;
    const conf = 7500;

    expectOk(send(svm, [ixRegister(auth.publicKey, "alpha")], auth, [auth]), "register");

    let agent = readAgent(svm, auth.publicKey);
    expect(agent.name).toBe("alpha");
    expect(Number(agent.total_commits)).toBe(0);

    expectOk(
      send(svm, [ixCommit(auth.publicKey, matchId, predictionHash(outcome, conf, nonce))], auth, [auth]),
      "commit",
    );
    agent = readAgent(svm, auth.publicKey);
    expect(Number(agent.total_commits)).toBe(1);
    expect(Number(agent.revealed_count)).toBe(0);

    expectOk(
      send(svm, [ixReveal(auth.publicKey, matchId, outcome, conf, nonce)], auth, [auth]),
      "reveal",
    );
    agent = readAgent(svm, auth.publicKey);
    const commit = readCommit(svm, auth.publicKey, matchId);
    expect(Number(agent.total_commits)).toBe(1);
    expect(Number(agent.revealed_count)).toBe(1);
    expect(commit.revealed).toBe(true);
    expect(commit.prediction.outcome).toBe(outcome);
    expect(commit.prediction.confidence_bps).toBe(conf);
  });

  // Case 2 -------------------------------------------------------------------
  it("case 2: double-commit for same match_id is rejected", () => {
    const auth = newAgentAuthority(svm);
    const matchId = 7n;
    const h = predictionHash(0, 5000, Buffer.from("n"));
    expectOk(send(svm, [ixRegister(auth.publicKey, "a")], auth, [auth]), "register");
    expectOk(send(svm, [ixCommit(auth.publicKey, matchId, h)], auth, [auth]), "commit-1");

    // Second commit to the same PDA must fail (account already initialized).
    svm.expireBlockhash(); // fresh blockhash so it isn't a duplicate-signature reject
    const res = send(svm, [ixCommit(auth.publicKey, matchId, h)], auth, [auth]);
    expect(isFailed(res), "second commit should fail").toBe(true);

    // total_commits must NOT have advanced past 1.
    expect(Number(readAgent(svm, auth.publicKey).total_commits)).toBe(1);
  });

  // Case 3 -------------------------------------------------------------------
  it("case 3: reveal with wrong nonce is rejected (HashMismatch)", () => {
    const auth = newAgentAuthority(svm);
    const matchId = 3n;
    const goodNonce = Buffer.from("correct-nonce");
    const outcome = 1;
    const conf = 6000;
    expectOk(send(svm, [ixRegister(auth.publicKey, "a")], auth, [auth]), "register");
    expectOk(
      send(svm, [ixCommit(auth.publicKey, matchId, predictionHash(outcome, conf, goodNonce))], auth, [auth]),
      "commit",
    );

    const res = send(
      svm,
      [ixReveal(auth.publicKey, matchId, outcome, conf, Buffer.from("WRONG-nonce"))],
      auth,
      [auth],
    );
    expectFailWith(res, "HashMismatch", "case 3 wrong-nonce reveal");
    // and the commit is still unrevealed
    expect(readCommit(svm, auth.publicKey, matchId).revealed).toBe(false);
    expect(Number(readAgent(svm, auth.publicKey).revealed_count)).toBe(0);
  });

  // Case 6 -------------------------------------------------------------------
  // Needs NO real authority key -> ALWAYS runs.
  it("case 6: non-authority signer calling settle is rejected (NotAuthority)", () => {
    const auth = newAgentAuthority(svm);
    const matchId = 11n;
    expectOk(send(svm, [ixRegister(auth.publicKey, "a")], auth, [auth]), "register");
    expectOk(
      send(svm, [ixCommit(auth.publicKey, matchId, predictionHash(0, 5000, Buffer.from("n")))], auth, [auth]),
      "commit",
    );

    const impostor = newAgentAuthority(svm); // random funded keypair, != SETTLE_AUTHORITY
    const res = send(
      svm,
      [ixSettle(auth.publicKey, impostor.publicKey, matchId, 0)],
      impostor,
      [impostor],
    );
    expectFailWith(res, "NotAuthority", "case 6 impostor settle");
    // commit not settled, cumulative unchanged
    expect(readCommit(svm, auth.publicKey, matchId).settled).toBe(false);
    expect(Number(readAgent(svm, auth.publicKey).cumulative_brier_bps)).toBe(0);
  });

  // Cases 4, 5, 7 require a valid SETTLE_AUTHORITY signature ------------------
  const authGated = HAS_AUTH ? it : it.skip;

  // Case 4 -------------------------------------------------------------------
  authGated(
    "case 4: reveal AFTER settle is rejected (RevealAfterSettle)",
    () => {
      const kp = settleAuthorityKp!;
      // Use the settle authority ALSO as the agent authority here (any funded
      // key works for register/commit/reveal; it just needs to sign).
      svm.airdrop(kp.publicKey, BigInt(10_000_000_000));
      const matchId = 100n;
      const nonce = Buffer.from("n4");
      const outcome = 2;
      const conf = 8000;

      expectOk(send(svm, [ixRegister(kp.publicKey, "a")], kp, [kp]), "register");
      expectOk(
        send(svm, [ixCommit(kp.publicKey, matchId, predictionHash(outcome, conf, nonce))], kp, [kp]),
        "commit",
      );
      // settle BEFORE reveal (unrevealed)
      expectOk(
        send(svm, [ixSettle(kp.publicKey, kp.publicKey, matchId, outcome)], kp, [kp]),
        "settle",
      );
      // now reveal must be rejected
      svm.expireBlockhash();
      const res = send(svm, [ixReveal(kp.publicKey, matchId, outcome, conf, nonce)], kp, [kp]);
      expectFailWith(res, "RevealAfterSettle", "case 4 reveal-after-settle");
    },
  );

  // Case 5 -------------------------------------------------------------------
  authGated(
    "case 5: unrevealed commit settles to exactly 10000 bps (silence = max loss)",
    () => {
      const kp = settleAuthorityKp!;
      svm.airdrop(kp.publicKey, BigInt(10_000_000_000));
      const matchId = 200n;

      expectOk(send(svm, [ixRegister(kp.publicKey, "a")], kp, [kp]), "register");
      expectOk(
        send(svm, [ixCommit(kp.publicKey, matchId, predictionHash(0, 5000, Buffer.from("n5")))], kp, [kp]),
        "commit",
      );
      expect(Number(readAgent(svm, kp.publicKey).cumulative_brier_bps)).toBe(0);

      // settle while unrevealed
      expectOk(
        send(svm, [ixSettle(kp.publicKey, kp.publicKey, matchId, 1)], kp, [kp]),
        "settle unrevealed",
      );
      const commit = readCommit(svm, kp.publicKey, matchId);
      const agent = readAgent(svm, kp.publicKey);
      expect(commit.settled).toBe(true);
      expect(Number(commit.brier_bps)).toBe(10000);
      expect(Number(agent.cumulative_brier_bps)).toBe(10000);
    },
  );

  // Case 7 -------------------------------------------------------------------
  authGated(
    "case 7: revealed correct pick scores (10000-p)^2/10000 and cumulative updates",
    () => {
      const kp = settleAuthorityKp!;
      svm.airdrop(kp.publicKey, BigInt(10_000_000_000));
      const matchId = 300n;
      const nonce = Buffer.from("n7");
      const outcome = 2; // predicted away
      const p = 7500; // confidence bps
      const expectedBrier = Math.floor(((10000 - p) * (10000 - p)) / 10000); // 625

      expectOk(send(svm, [ixRegister(kp.publicKey, "a")], kp, [kp]), "register");
      expectOk(
        send(svm, [ixCommit(kp.publicKey, matchId, predictionHash(outcome, p, nonce))], kp, [kp]),
        "commit",
      );
      expectOk(
        send(svm, [ixReveal(kp.publicKey, matchId, outcome, p, nonce)], kp, [kp]),
        "reveal",
      );
      // settle with actual == predicted (correct)
      expectOk(
        send(svm, [ixSettle(kp.publicKey, kp.publicKey, matchId, outcome)], kp, [kp]),
        "settle correct",
      );
      const commit = readCommit(svm, kp.publicKey, matchId);
      const agent = readAgent(svm, kp.publicKey);
      expect(commit.settled).toBe(true);
      expect(Number(commit.brier_bps)).toBe(expectedBrier);
      expect(Number(agent.cumulative_brier_bps)).toBe(expectedBrier);
    },
  );

  // Case 8 -------------------------------------------------------------------
  // Needs NO real authority (just commit) -> ALWAYS runs.
  it("case 8: staking a commit escrows the stake into the StakeEscrow PDA", () => {
    const auth = newAgentAuthority(svm);
    const matchId = 800n;
    const stake = 1_000_000n;
    expectOk(send(svm, [ixRegister(auth.publicKey, "a")], auth, [auth]), "register");
    expectOk(
      send(svm, [ixCommit(auth.publicKey, matchId, predictionHash(0, 6000, Buffer.from("n8")), stake)], auth, [auth]),
      "commit staked",
    );
    const escrow = readEscrow(svm, auth.publicKey, matchId);
    expect(escrow).not.toBeNull();
    expect(Number(escrow!.amount)).toBe(Number(stake));
    // The escrow account holds at least the staked lamports (plus its own rent).
    const commit = commitPda(agentPda(auth.publicKey), matchId);
    const escrowAcc = svm.getAccount(escrowPda(commit))!;
    expect(escrowAcc.lamports).toBeGreaterThanOrEqual(Number(stake));
  });

  const authGatedStake = HAS_AUTH ? it : it.skip;

  // Case 9 -------------------------------------------------------------------
  authGatedStake(
    "case 9: a good call refunds accuracy-weighted stake and slashes the rest to treasury",
    () => {
      const kp = settleAuthorityKp!;
      svm.airdrop(kp.publicKey, BigInt(10_000_000_000));
      const matchId = 900n;
      const nonce = Buffer.from("n9");
      const outcome = 2;
      const p = 7500; // brier 625 on a correct call
      const stake = 1_000_000n;
      const brier = 625;
      const slash = Number((stake * BigInt(brier)) / 10000n); // 62500

      expectOk(send(svm, [ixRegister(kp.publicKey, "a")], kp, [kp]), "register");
      expectOk(send(svm, [ixCommit(kp.publicKey, matchId, predictionHash(outcome, p, nonce), stake)], kp, [kp]), "commit");
      expectOk(send(svm, [ixReveal(kp.publicKey, matchId, outcome, p, nonce)], kp, [kp]), "reveal");
      expectOk(send(svm, [ixSettle(kp.publicKey, kp.publicKey, matchId, outcome)], kp, [kp]), "settle correct");

      // escrow closed, treasury got exactly the slash.
      expect(readEscrow(svm, kp.publicKey, matchId)).toBeNull();
      const treasury = readTreasury(svm);
      expect(treasury).not.toBeNull();
      expect(Number(treasury!.total_slashed)).toBe(slash);
    },
  );

  // Case 10 ------------------------------------------------------------------
  authGatedStake(
    "case 10: an unrevealed (hidden) staked call is fully slashed to treasury",
    () => {
      const kp = settleAuthorityKp!;
      svm.airdrop(kp.publicKey, BigInt(10_000_000_000));
      const matchId = 1000n;
      const stake = 2_000_000n;

      expectOk(send(svm, [ixRegister(kp.publicKey, "a")], kp, [kp]), "register");
      expectOk(send(svm, [ixCommit(kp.publicKey, matchId, predictionHash(0, 5000, Buffer.from("n10")), stake)], kp, [kp]), "commit");
      // settle WITHOUT revealing -> brier 10000 -> full slash
      expectOk(send(svm, [ixSettle(kp.publicKey, kp.publicKey, matchId, 1)], kp, [kp]), "settle unrevealed");

      expect(readEscrow(svm, kp.publicKey, matchId)).toBeNull();
      const treasury = readTreasury(svm);
      expect(Number(treasury!.total_slashed)).toBe(Number(stake));
    },
  );

  if (!HAS_AUTH) {
    test.skip("cases 4/5/7/9/10 SKIPPED: no SETTLE_AUTHORITY keypair available in this environment", () => {});
  }
});
