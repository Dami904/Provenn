//! # Provenn Protocol
//!
//! An open Solana protocol where AI trading agents' track records are
//! unfakeable.
//!
//! ## Trust model
//!
//! 1. Agents register once, binding their identity to a strategy hash.
//! 2. Before each match, an agent COMMITS a hash of its prediction. The commit
//!    is timestamped by the chain (slot + unix time) — it cannot be backdated.
//! 3. The agent MUST reveal before settlement. **Unrevealed commits score as
//!    losses — silence is penalized.** This kills the classic scam of only
//!    publishing winning calls.
//! 4. Settlement scores each commit with a Brier-style loss in basis points
//!    and accumulates it into the agent's on-chain record.
//!
//! Nothing here requires trusting the agent operator: the only trusted party
//! (for now) is the settlement oracle, which is an explicit TODO below.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use anchor_lang::solana_program::pubkey;

declare_id!("Ayfm8HcwaMTXFVxc3zTvXBcLAu57tHc4gVKMgE1wSpr2");

/// TODO(oracle): placeholder admin oracle key. Settlement is currently gated
/// on this signer. Replace with verification of a TxLINE validation proof
/// (signed result attestation) so settlement itself becomes trustless.
/// NOTE: the original placeholder string was not a valid base58 pubkey and
/// could not compile; set to the deploy wallet as the interim admin oracle.
pub const SETTLE_AUTHORITY: Pubkey = pubkey!("Cr4NpDSDCxdry4zjq879iD21k5nLJKuUBt11LcadDpWB");

/// Maximum length of an agent's display name, in bytes.
pub const MAX_NAME_LEN: usize = 32;

/// Brier score assigned to an unrevealed commit: the maximum possible loss,
/// in basis points. Silence == maximally wrong.
pub const MAX_BRIER_BPS: u64 = 10_000;

#[program]
pub mod provenn_protocol {
    use super::*;

    /// Register a new agent.
    ///
    /// Creates the agent's identity PDA (seeds: `["agent", authority]`) and
    /// binds it to a `strategy_hash` — a hash of the agent's strategy
    /// description/code, committed up front so the operator cannot quietly
    /// swap strategies while keeping the track record.
    ///
    /// Trust model: one agent account per authority keypair. The track record
    /// lives on this PDA and is only ever written by protocol instructions —
    /// never directly by the operator.
    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        name: String,
        strategy_hash: [u8; 32],
    ) -> Result<()> {
        require!(name.len() <= MAX_NAME_LEN, ProvennError::NameTooLong);

        let agent = &mut ctx.accounts.agent;
        agent.authority = ctx.accounts.authority.key();
        agent.name = name;
        agent.strategy_hash = strategy_hash;
        agent.total_commits = 0;
        agent.revealed_count = 0;
        agent.cumulative_brier_bps = 0;
        agent.bump = ctx.bumps.agent;
        Ok(())
    }

    /// Commit to a prediction for a match, before the fact.
    ///
    /// Stores only `prediction_hash = sha256(prediction_bytes || nonce)` plus
    /// the chain's own slot and unix timestamp. The prediction itself stays
    /// secret until reveal, so committing leaks no alpha — but the timestamp
    /// proves the call was made in advance.
    ///
    /// Trust model: the commit PDA (seeds: `["commit", agent, match_id]`)
    /// allows exactly one commit per agent per match; there is no way to
    /// commit twice and later keep only the winner. **Unrevealed commits
    /// score as losses — silence is penalized.**
    pub fn commit(ctx: Context<Commit>, match_id: u64, prediction_hash: [u8; 32]) -> Result<()> {
        let clock = Clock::get()?;
        let commit = &mut ctx.accounts.commit;
        commit.agent = ctx.accounts.agent.key();
        commit.match_id = match_id;
        commit.prediction_hash = prediction_hash;
        commit.slot = clock.slot;
        commit.unix_timestamp = clock.unix_timestamp;
        commit.revealed = false;
        commit.settled = false;
        commit.prediction = Prediction::default();
        commit.brier_bps = 0;
        commit.bump = ctx.bumps.commit;

        let agent = &mut ctx.accounts.agent;
        agent.total_commits = agent
            .total_commits
            .checked_add(1)
            .ok_or(ProvennError::Overflow)?;
        Ok(())
    }

    /// Reveal a previously committed prediction.
    ///
    /// Verifies `sha256(prediction_bytes || nonce)` against the stored
    /// `prediction_hash` (prediction_bytes = Borsh serialization of
    /// `Prediction`). Must happen BEFORE `settle` for this commit; a reveal
    /// after settlement is rejected because the unrevealed commit has already
    /// been scored as a loss.
    ///
    /// Trust model: the hash check makes it impossible to reveal anything
    /// other than what was committed. **Unrevealed commits score as losses —
    /// silence is penalized**, so a rational agent always reveals, win or
    /// lose.
    pub fn reveal(
        ctx: Context<Reveal>,
        _match_id: u64,
        prediction: Prediction,
        nonce: Vec<u8>,
    ) -> Result<()> {
        let commit = &mut ctx.accounts.commit;
        require!(!commit.revealed, ProvennError::AlreadyRevealed);
        require!(!commit.settled, ProvennError::RevealAfterSettle);
        require!(prediction.outcome <= 2, ProvennError::InvalidOutcome);
        require!(
            prediction.confidence_bps <= 10_000,
            ProvennError::InvalidConfidence
        );

        let prediction_bytes = prediction.try_to_vec()?;
        let computed = hashv(&[&prediction_bytes, &nonce]);
        require!(
            computed.to_bytes() == commit.prediction_hash,
            ProvennError::HashMismatch
        );

        commit.prediction = prediction;
        commit.revealed = true;

        let agent = &mut ctx.accounts.agent;
        agent.revealed_count = agent
            .revealed_count
            .checked_add(1)
            .ok_or(ProvennError::Overflow)?;
        Ok(())
    }

    /// Settle a commit against the actual match outcome and accumulate the
    /// agent's Brier score.
    ///
    /// TODO(oracle): currently gated on the hardcoded `SETTLE_AUTHORITY`
    /// admin signer. Replace with on-chain verification of a TxLINE
    /// validation proof (signed result attestation from the feed) so results
    /// need no trusted admin.
    ///
    /// ## Scoring (basis points, lower is better)
    ///
    /// We collapse the 3-way market to a two-outcome Brier score on the
    /// PREDICTED outcome: the agent stakes probability `p` (confidence_bps)
    /// on its pick, and implicitly `1 - p` on "not my pick". This is a
    /// deliberate simplification of the full multi-category Brier score —
    /// the agent does not publish a full distribution over home/draw/away,
    /// only its pick and confidence, so we score exactly what was committed:
    ///
    /// - revealed and correct:  `brier_bps = (10000 - p)^2 / 10000`
    /// - revealed and wrong:    `brier_bps = p^2 / 10000`
    /// - unrevealed:            `brier_bps = 10000` (maximally wrong)
    ///
    /// **Unrevealed commits score as losses — silence is penalized.** This is
    /// the core mechanism that makes the track record unfakeable: you cannot
    /// bury your bad calls, and a maximally-confident wrong call costs as
    /// much as never showing up.
    pub fn settle(ctx: Context<Settle>, _match_id: u64, actual_outcome: u8) -> Result<()> {
        require!(actual_outcome <= 2, ProvennError::InvalidOutcome);
        require!(
            ctx.accounts.settle_authority.key() == SETTLE_AUTHORITY,
            ProvennError::NotAuthority
        );

        let commit = &mut ctx.accounts.commit;
        require!(!commit.settled, ProvennError::AlreadySettled);

        let brier_bps: u64 = if !commit.revealed {
            // Silence is penalized: score as maximally wrong.
            MAX_BRIER_BPS
        } else {
            let p = commit.prediction.confidence_bps as u64;
            if commit.prediction.outcome == actual_outcome {
                // (10000 - p)^2 / 10000
                let miss = MAX_BRIER_BPS - p;
                miss.checked_mul(miss).ok_or(ProvennError::Overflow)? / MAX_BRIER_BPS
            } else {
                // p^2 / 10000
                p.checked_mul(p).ok_or(ProvennError::Overflow)? / MAX_BRIER_BPS
            }
        };

        commit.settled = true;
        commit.brier_bps = brier_bps;

        let agent = &mut ctx.accounts.agent;
        agent.cumulative_brier_bps = agent
            .cumulative_brier_bps
            .checked_add(brier_bps)
            .ok_or(ProvennError::Overflow)?;
        Ok(())
    }
}

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

/// A revealed prediction: which outcome, and with what confidence.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default, InitSpace)]
pub struct Prediction {
    /// 0 = home win, 1 = draw, 2 = away win.
    pub outcome: u8,
    /// Confidence in the pick as basis points of probability (0..=10000).
    pub confidence_bps: u16,
}

/// An agent's on-chain identity and cumulative track record.
#[account]
#[derive(InitSpace)]
pub struct AgentAccount {
    /// Keypair allowed to commit/reveal on behalf of this agent.
    pub authority: Pubkey,
    /// Display name.
    #[max_len(MAX_NAME_LEN)]
    pub name: String,
    /// Hash of the agent's strategy, committed at registration.
    pub strategy_hash: [u8; 32],
    /// Total commits ever made (revealed or not).
    pub total_commits: u64,
    /// How many of those were revealed. `total - revealed` were auto-losses.
    pub revealed_count: u64,
    /// Sum of settled brier_bps. Mean Brier = cumulative / settled commits.
    pub cumulative_brier_bps: u64,
    pub bump: u8,
}

/// One prediction commit for one match by one agent.
#[account]
#[derive(InitSpace)]
pub struct CommitAccount {
    /// The agent PDA this commit belongs to.
    pub agent: Pubkey,
    /// Match identifier (maps to the TxLINE match id off-chain).
    pub match_id: u64,
    /// sha256(borsh(Prediction) || nonce), committed before the match.
    pub prediction_hash: [u8; 32],
    /// Slot at commit time — chain-attested "when".
    pub slot: u64,
    /// Unix timestamp at commit time.
    pub unix_timestamp: i64,
    /// Whether the prediction was revealed. Unrevealed at settle = auto-loss.
    pub revealed: bool,
    /// Whether this commit has been settled (scored).
    pub settled: bool,
    /// The revealed prediction (zeroed until reveal).
    pub prediction: Prediction,
    /// The Brier loss assigned at settlement, in basis points.
    pub brier_bps: u64,
    pub bump: u8,
}

// -----------------------------------------------------------------------------
// Instruction accounts
// -----------------------------------------------------------------------------

#[derive(Accounts)]
pub struct RegisterAgent<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + AgentAccount::INIT_SPACE,
        seeds = [b"agent", authority.key().as_ref()],
        bump
    )]
    pub agent: Account<'info, AgentAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct Commit<'info> {
    #[account(
        mut,
        seeds = [b"agent", authority.key().as_ref()],
        bump = agent.bump,
        has_one = authority @ ProvennError::NotAuthority
    )]
    pub agent: Account<'info, AgentAccount>,
    #[account(
        init,
        payer = authority,
        space = 8 + CommitAccount::INIT_SPACE,
        seeds = [b"commit", agent.key().as_ref(), &match_id.to_le_bytes()],
        bump
    )]
    pub commit: Account<'info, CommitAccount>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct Reveal<'info> {
    #[account(
        mut,
        seeds = [b"agent", authority.key().as_ref()],
        bump = agent.bump,
        has_one = authority @ ProvennError::NotAuthority
    )]
    pub agent: Account<'info, AgentAccount>,
    #[account(
        mut,
        seeds = [b"commit", agent.key().as_ref(), &match_id.to_le_bytes()],
        bump = commit.bump,
        constraint = commit.agent == agent.key() @ ProvennError::CommitAgentMismatch
    )]
    pub commit: Account<'info, CommitAccount>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(match_id: u64)]
pub struct Settle<'info> {
    #[account(mut)]
    pub agent: Account<'info, AgentAccount>,
    #[account(
        mut,
        seeds = [b"commit", agent.key().as_ref(), &match_id.to_le_bytes()],
        bump = commit.bump,
        constraint = commit.agent == agent.key() @ ProvennError::CommitAgentMismatch
    )]
    pub commit: Account<'info, CommitAccount>,
    /// TODO(oracle): replace admin signer with TxLINE validation-proof check.
    pub settle_authority: Signer<'info>,
}

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

#[error_code]
pub enum ProvennError {
    #[msg("Agent name exceeds maximum length")]
    NameTooLong,
    #[msg("Prediction was already revealed")]
    AlreadyRevealed,
    #[msg("Revealed prediction does not match the committed hash")]
    HashMismatch,
    #[msg("Cannot reveal after settlement — unrevealed commits are scored as losses")]
    RevealAfterSettle,
    #[msg("Commit was already settled")]
    AlreadySettled,
    #[msg("Signer is not the required authority")]
    NotAuthority,
    #[msg("Commit does not belong to this agent")]
    CommitAgentMismatch,
    #[msg("Outcome must be 0 (home), 1 (draw) or 2 (away)")]
    InvalidOutcome,
    #[msg("Confidence must be between 0 and 10000 basis points")]
    InvalidConfidence,
    #[msg("Arithmetic overflow")]
    Overflow,
}
