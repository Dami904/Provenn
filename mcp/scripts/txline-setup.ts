/**
 * TxLINE devnet access setup (one-shot, idempotent).
 *
 * Flow (docs/txline-api-notes.md §1 "Devnet", reference: github.com/txodds/tx-on-chain
 * examples/devnet/{scripts/subscription_free_tier.ts,common/users.ts}):
 *   1. subscribe(serviceLevel=1, weeks=4) on the devnet TxLINE program (free tier, 0 TxL,
 *      but requires a Token-2022 ATA for the TxL mint and SOL for fees).
 *   2. POST /auth/guest/start (host root) -> guest JWT.
 *   3. Sign `${txSig}:${leagues.join(",")}:${jwt}` (empty leagues -> `${txSig}::${jwt}`)
 *      with the subscribing wallet: detached ed25519, base64.
 *   4. POST /api/token/activate {txSig, walletSignature, leagues: []} -> API token.
 *   5. Append TXLINE_ENV / TXLINE_JWT / TXLINE_API_TOKEN to <repo>/.env (gitignored).
 *
 * Run: npx tsx scripts/txline-setup.ts
 * Re-run: if .env already holds a TXLINE_API_TOKEN it exits early (token stays valid
 * for the subscription window; JWT can always be re-fetched from /auth/guest/start).
 */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import nacl from "tweetnacl";
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import TxoracleIdl from "./txoracle-idl.json" with { type: "json" };

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENV_PATH = join(REPO_ROOT, ".env");

const RPC_URL = "https://api.devnet.solana.com";
const HOST = "https://txline-dev.txodds.com";
const GUEST_START_URL = `${HOST}/auth/guest/start`;
const ACTIVATE_URL = `${HOST}/api/token/activate`;
const TXL_MINT = new PublicKey("4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG");
const SERVICE_LEVEL = 1; // devnet free tier, real-time (samplingIntervalSec = 0)
const DURATION_WEEKS = 4; // minimum; must be a multiple of 4
const LEAGUES: number[] = []; // free tier: empty

const WALLET_PATH = process.env.ANCHOR_WALLET ?? join(homedir(), ".config", "solana", "id.json");

function readEnvVar(name: string): string | undefined {
  if (!existsSync(ENV_PATH)) return undefined;
  const m = readFileSync(ENV_PATH, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  return m?.[1]?.trim() || undefined;
}

async function getGuestJwt(): Promise<string> {
  const res = await fetch(GUEST_START_URL, { method: "POST" });
  if (!res.ok) throw new Error(`guest/start failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error(`guest/start response missing token: ${JSON.stringify(body)}`);
  return body.token;
}

async function main() {
  if (readEnvVar("TXLINE_API_TOKEN")) {
    console.log(`Already activated: TXLINE_API_TOKEN present in ${ENV_PATH}. Nothing to do.`);
    console.log("(Delete the TXLINE_* lines from .env to force a fresh subscribe+activate.)");
    return;
  }

  const secretKey = Uint8Array.from(JSON.parse(readFileSync(WALLET_PATH, "utf8")));
  const wallet = Keypair.fromSecretKey(secretKey);
  console.log("Wallet:", wallet.publicKey.toBase58());

  const connection = new Connection(RPC_URL, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const program = new anchor.Program(TxoracleIdl as anchor.Idl, provider);
  console.log("Program:", program.programId.toBase58());

  // --- 1. On-chain subscribe (free tier still moves through the token accounts) ---
  const userTokenAccount = getAssociatedTokenAddressSync(
    TXL_MINT, wallet.publicKey, false, TOKEN_2022_PROGRAM_ID,
  );
  if (!(await connection.getAccountInfo(userTokenAccount))) {
    console.log("Creating TxL Token-2022 ATA:", userTokenAccount.toBase58());
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey, userTokenAccount, wallet.publicKey, TXL_MINT,
        TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
    const sig = await anchor.web3.sendAndConfirmTransaction(connection, tx, [wallet], {
      commitment: "confirmed",
    });
    console.log("ATA created:", sig);
  }

  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")], program.programId,
  );
  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")], program.programId,
  );
  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    TXL_MINT, tokenTreasuryPda, true, TOKEN_2022_PROGRAM_ID,
  );

  console.log(`Subscribing: serviceLevel=${SERVICE_LEVEL}, weeks=${DURATION_WEEKS}`);
  const tx = await program.methods
    .subscribe(SERVICE_LEVEL, DURATION_WEEKS)
    .accounts({
      user: wallet.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint: TXL_MINT,
      userTokenAccount,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  const latest = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = latest.blockhash;
  tx.feePayer = wallet.publicKey;
  tx.sign(wallet);
  const txSig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(
    { signature: txSig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed",
  );
  console.log("Subscribe tx confirmed:", txSig);

  // --- 2. Guest JWT ---
  const jwt = await getGuestJwt();
  console.log("Guest JWT acquired (", jwt.slice(0, 24), "... )");

  // --- 3+4. Sign activation message and activate ---
  const message = `${txSig}:${LEAGUES.join(",")}:${jwt}`;
  const walletSignature = Buffer.from(
    nacl.sign.detached(new TextEncoder().encode(message), wallet.secretKey),
  ).toString("base64");

  const res = await fetch(ACTIVATE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: JSON.stringify({ txSig, walletSignature, leagues: LEAGUES }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`token/activate failed: ${res.status} ${raw}`);
  // Docs say text/plain token; reference code does `data.token || data` — handle both.
  let apiToken = raw.trim();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.token) apiToken = parsed.token;
  } catch { /* plain text token */ }
  console.log("Activation succeeded. API token:", apiToken);

  // --- 5. Persist to .env ---
  const lines = `TXLINE_ENV=devnet\nTXLINE_JWT=${jwt}\nTXLINE_API_TOKEN=${apiToken}\n`;
  appendFileSync(ENV_PATH, lines, "utf8");
  console.log(`Appended TXLINE_ENV / TXLINE_JWT / TXLINE_API_TOKEN to ${ENV_PATH}`);
  console.log("Subscription tx signature:", txSig);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
