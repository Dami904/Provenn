import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import anchorPkg from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import type { Prediction } from "../agent/prediction.js";

// @coral-xyz/anchor is CJS; grab the pieces off the default export so this
// works under NodeNext ESM without interop surprises.
const { AnchorProvider, BN, Program, Wallet } = anchorPkg;

/** Program ID of the deployed Provenn protocol (devnet). */
export const PROVENN_PROGRAM_ID = new PublicKey("Ayfm8HcwaMTXFVxc3zTvXBcLAu57tHc4gVKMgE1wSpr2");

/** TxODDS on-chain data oracle (devnet) — target of the trustless-settlement CPI. */
export const TXORACLE_PROGRAM_ID = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");

/** TxODDS full-time goal stat keys, in the order settle_with_proof expects (home, away). */
export const HOME_GOALS_STAT_KEY = 1;
export const AWAY_GOALS_STAT_KEY = 2;

export const DEVNET_RPC = "https://api.devnet.solana.com";

/** A TxODDS Merkle proof node as returned by /api/scores/stat-validation. */
export interface ProofNodeWire {
  hash: string;
  isRightSibling: boolean;
}

/** Decode a wire proof hash (base64 or hex) to exactly 32 bytes. */
function decode32(hash: string): number[] {
  const isHex = /^[0-9a-fA-F]{64}$/.test(hash);
  const buf = isHex ? Buffer.from(hash, "hex") : Buffer.from(hash, "base64");
  if (buf.length !== 32) {
    throw new Error(`proof hash did not decode to 32 bytes (got ${buf.length})`);
  }
  return Array.from(buf);
}

const mapProof = (nodes: ProofNodeWire[]) =>
  nodes.map((n) => ({ hash: decode32(n.hash), isRightSibling: n.isRightSibling }));

const IDL_PATH = fileURLToPath(new URL("../idl/provenn_protocol.json", import.meta.url));

/** Decoded AgentAccount (BNs normalized to bigint). */
export interface AgentState {
  authority: PublicKey;
  name: string;
  strategyHash: Uint8Array;
  totalCommits: bigint;
  revealedCount: bigint;
  cumulativeBrierBps: bigint;
}

/** Decoded CommitAccount (BNs normalized to bigint). */
export interface CommitState {
  agent: PublicKey;
  matchId: bigint;
  predictionHash: Uint8Array;
  slot: bigint;
  unixTimestamp: bigint;
  revealed: boolean;
  settled: boolean;
  prediction: Prediction;
  brierBps: bigint;
}

/**
 * Load the signing keypair: the WALLET_KEYPAIR env var (JSON byte array, for
 * cloud deploys) takes precedence over a Solana CLI keypair file
 * (defaults to ~/.config/solana/id.json).
 */
export function loadWalletKeypair(path?: string): Keypair {
  const fromEnv = process.env.WALLET_KEYPAIR;
  if (fromEnv) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fromEnv) as number[]));
  }
  const file = path ?? join(homedir(), ".config", "solana", "id.json");
  const secret = JSON.parse(readFileSync(file, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

/**
 * Thin typed client over the deployed Provenn program.
 *
 * PDA seeds (must match lib.rs):
 *   agent  = ["agent", authority]
 *   commit = ["commit", agent, match_id.to_le_bytes()]
 */
export class ProvennChainClient {
  readonly connection: Connection;
  readonly wallet: Keypair;
  /** True when constructed without a real wallet — reads work, signing methods must not be called. */
  readonly readOnly: boolean;
  // anchor's Program generic typing adds little here; the IDL is loaded at runtime.
  private readonly program: InstanceType<typeof Program>;

  constructor(rpcUrl: string, wallet: Keypair, readOnly = false) {
    this.connection = new Connection(rpcUrl, "confirmed");
    this.wallet = wallet;
    this.readOnly = readOnly;
    const provider = new AnchorProvider(this.connection, new Wallet(wallet), {
      commitment: "confirmed",
    });
    const idl = JSON.parse(readFileSync(IDL_PATH, "utf8"));
    this.program = new Program(idl, provider);
  }

  static connect(rpcUrl: string = DEVNET_RPC, walletPath?: string): ProvennChainClient {
    return new ProvennChainClient(rpcUrl, loadWalletKeypair(walletPath));
  }

  /**
   * Connect without a wallet — every account on the program is public, so
   * reads (fetchAgent(authority), allAgents, allCommits) need no key. The
   * ephemeral keypair never signs anything.
   */
  static connectReadOnly(rpcUrl: string = DEVNET_RPC): ProvennChainClient {
    return new ProvennChainClient(rpcUrl, Keypair.generate(), true);
  }

  agentPda(authority: PublicKey = this.wallet.publicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), authority.toBuffer()],
      PROVENN_PROGRAM_ID,
    )[0];
  }

  commitPda(matchId: bigint, authority: PublicKey = this.wallet.publicKey): PublicKey {
    const matchLe = Buffer.alloc(8);
    matchLe.writeBigUInt64LE(matchId);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("commit"), this.agentPda(authority).toBuffer(), matchLe],
      PROVENN_PROGRAM_ID,
    )[0];
  }

  /** register_agent(name, strategy_hash) — creates the agent PDA. */
  async registerAgent(name: string, strategyHash: Uint8Array): Promise<string> {
    return this.program.methods
      .registerAgent(name, Array.from(strategyHash))
      .accounts({ authority: this.wallet.publicKey })
      .rpc();
  }

  /** commit(match_id, prediction_hash) — one commit per agent per match. */
  async commit(matchId: bigint, predictionHash: Uint8Array): Promise<string> {
    return this.program.methods
      .commit(new BN(matchId.toString()), Array.from(predictionHash))
      .accounts({ authority: this.wallet.publicKey })
      .rpc();
  }

  /** reveal(match_id, prediction, nonce) — must hash-match the commit. */
  async reveal(matchId: bigint, prediction: Prediction, nonce: Uint8Array): Promise<string> {
    return this.program.methods
      .reveal(
        new BN(matchId.toString()),
        { outcome: prediction.outcome, confidenceBps: prediction.confidence_bps },
        Buffer.from(nonce),
      )
      .accounts({ authority: this.wallet.publicKey })
      .rpc();
  }

  /** settle(match_id, actual_outcome) — signer must be SETTLE_AUTHORITY. */
  async settle(matchId: bigint, actualOutcome: number): Promise<string> {
    return this.program.methods
      .settle(new BN(matchId.toString()), actualOutcome)
      .accounts({
        agent: this.agentPda(),
        commit: this.commitPda(matchId),
        settleAuthority: this.wallet.publicKey,
      })
      .rpc();
  }

  /** Daily-scores root PDA on the TxODDS oracle for the day containing `tsMs`. */
  txoracleDailyScoresPda(tsMs: number): PublicKey {
    const epochDay = Math.floor(tsMs / 86_400_000);
    const epochLe = Buffer.alloc(2);
    epochLe.writeUInt16LE(epochDay);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("daily_scores_roots"), epochLe],
      TXORACLE_PROGRAM_ID,
    )[0];
  }

  /**
   * settle_with_proof(match_id, actual_outcome, payload) — trustless settlement.
   *
   * Build `validation` from TxLineClient.getScoreStatValidation(fixtureId, seq,
   * [HOME_GOALS_STAT_KEY, AWAY_GOALS_STAT_KEY]); this maps it into the program's
   * StatValidationInput and derives the TxODDS daily-root PDA from the record
   * timestamp. `actualOutcome` (0/1/2) is the result the caller asserts — the
   * program only accepts it if the TxODDS oracle proves it.
   */
  async settleWithProof(
    matchId: bigint,
    actualOutcome: number,
    validation: {
      ts: number;
      summary: { fixtureId: number; updateStats: { updateCount: number; minTimestamp: number; maxTimestamp: number }; eventStatsSubTreeRoot: number[] | string };
      statsToProve: Array<{ key: number; value: number; period: number }>;
      statProofs: ProofNodeWire[][];
      subTreeProof: ProofNodeWire[];
      mainTreeProof: ProofNodeWire[];
      eventStatRoot: number[] | string;
    },
    authority?: PublicKey,
  ): Promise<string> {
    const to32 = (v: number[] | string) =>
      typeof v === "string" ? decode32(v) : v;

    const payload = {
      ts: new BN(validation.ts),
      fixtureSummary: {
        fixtureId: new BN(validation.summary.fixtureId),
        updateStats: {
          updateCount: validation.summary.updateStats.updateCount,
          minTimestamp: new BN(validation.summary.updateStats.minTimestamp),
          maxTimestamp: new BN(validation.summary.updateStats.maxTimestamp),
        },
        eventsSubTreeRoot: to32(validation.summary.eventStatsSubTreeRoot),
      },
      fixtureProof: mapProof(validation.subTreeProof),
      mainTreeProof: mapProof(validation.mainTreeProof),
      eventStatRoot: to32(validation.eventStatRoot),
      stats: validation.statsToProve.map((s, i) => ({
        stat: { key: s.key, value: s.value, period: s.period },
        statProof: mapProof(validation.statProofs[i] ?? []),
      })),
    };

    const dailyScoresRoots = this.txoracleDailyScoresPda(validation.ts);
    return this.program.methods
      .settleWithProof(new BN(matchId.toString()), actualOutcome, payload)
      .accounts({
        agent: this.agentPda(authority),
        commit: this.commitPda(matchId, authority),
        dailyScoresRoots,
        txoracleProgram: TXORACLE_PROGRAM_ID,
      })
      .rpc();
  }

  async fetchAgent(authority?: PublicKey): Promise<AgentState | undefined> {
    const acc = await (this.program.account as any).agentAccount.fetchNullable(
      this.agentPda(authority),
    );
    if (!acc) return undefined;
    return {
      authority: acc.authority,
      name: acc.name,
      strategyHash: Uint8Array.from(acc.strategyHash),
      totalCommits: BigInt(acc.totalCommits.toString()),
      revealedCount: BigInt(acc.revealedCount.toString()),
      cumulativeBrierBps: BigInt(acc.cumulativeBrierBps.toString()),
    };
  }

  async fetchCommit(matchId: bigint, authority?: PublicKey): Promise<CommitState | undefined> {
    const acc = await (this.program.account as any).commitAccount.fetchNullable(
      this.commitPda(matchId, authority),
    );
    if (!acc) return undefined;
    return {
      agent: acc.agent,
      matchId: BigInt(acc.matchId.toString()),
      predictionHash: Uint8Array.from(acc.predictionHash),
      slot: BigInt(acc.slot.toString()),
      unixTimestamp: BigInt(acc.unixTimestamp.toString()),
      revealed: acc.revealed,
      settled: acc.settled,
      prediction: {
        outcome: acc.prediction.outcome,
        confidence_bps: acc.prediction.confidenceBps,
      },
      brierBps: BigInt(acc.brierBps.toString()),
    };
  }

  /** All registered agent accounts — the open registry. */
  async allAgents(): Promise<AgentState[]> {
    const accs = (await (this.program.account as any).agentAccount.all()) as Array<{
      account: any;
    }>;
    return accs.map(({ account: acc }) => ({
      authority: acc.authority,
      name: acc.name,
      strategyHash: Uint8Array.from(acc.strategyHash),
      totalCommits: BigInt(acc.totalCommits.toString()),
      revealedCount: BigInt(acc.revealedCount.toString()),
      cumulativeBrierBps: BigInt(acc.cumulativeBrierBps.toString()),
    }));
  }

  /** All commit accounts on the program (the whole public ledger, any agent). */
  async allCommits(): Promise<CommitState[]> {
    const accs = (await (this.program.account as any).commitAccount.all()) as Array<{
      account: any;
    }>;
    return accs.map(({ account: acc }) => ({
      agent: acc.agent,
      matchId: BigInt(acc.matchId.toString()),
      predictionHash: Uint8Array.from(acc.predictionHash),
      slot: BigInt(acc.slot.toString()),
      unixTimestamp: BigInt(acc.unixTimestamp.toString()),
      revealed: acc.revealed,
      settled: acc.settled,
      prediction: {
        outcome: acc.prediction.outcome,
        confidence_bps: acc.prediction.confidenceBps,
      },
      brierBps: BigInt(acc.brierBps.toString()),
    }));
  }
}
