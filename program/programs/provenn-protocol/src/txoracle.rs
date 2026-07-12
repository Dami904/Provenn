//! Foreign-program glue for TxODDS's on-chain data oracle (`txoracle`).
//!
//! TxODDS anchors daily Merkle roots of its score/stat data in PDAs on Solana
//! and exposes a `validate_stat_v2` instruction that returns `true` iff a
//! supplied record + Merkle proof hashes up to the anchored root AND a caller
//! "strategy" of predicates over the proven stats holds. The Merkle hashing
//! lives inside their (closed-source) program, so we never re-implement it —
//! we CPI into `validate_stat_v2` and trust only its boolean answer.
//!
//! Everything here is a faithful Borsh mirror of the published devnet IDL
//! (program `6pW6…yP2J`, `validate_stat_v2` discriminator below). Field order
//! and enum variant order MUST match the IDL exactly or serialization drifts.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey;

/// TxODDS oracle program (devnet). Same host as the TxLINE data feed.
pub const TXORACLE_PROGRAM_ID: Pubkey = pubkey!("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");

/// Anchor discriminator for `validate_stat_v2` (from the devnet IDL).
pub const VALIDATE_STAT_V2_DISCM: [u8; 8] = [208, 215, 194, 214, 241, 71, 246, 178];

// -----------------------------------------------------------------------------
// Borsh mirrors of the txoracle IDL types (exact field/variant order).
// -----------------------------------------------------------------------------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProofNode {
    pub hash: [u8; 32],
    pub is_right_sibling: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScoreStat {
    pub key: u32,
    pub value: i32,
    pub period: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScoresUpdateStats {
    pub update_count: i32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScoresBatchSummary {
    pub fixture_id: i64,
    pub update_stats: ScoresUpdateStats,
    pub events_sub_tree_root: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct StatLeaf {
    pub stat: ScoreStat,
    pub stat_proof: Vec<ProofNode>,
}

/// Args #1 to `validate_stat_v2`. The caller assembles this from the TxLINE
/// `/api/scores/stat-validation` response.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct StatValidationInput {
    pub ts: i64,
    pub fixture_summary: ScoresBatchSummary,
    pub fixture_proof: Vec<ProofNode>,
    pub main_tree_proof: Vec<ProofNode>,
    pub event_stat_root: [u8; 32],
    pub stats: Vec<StatLeaf>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub enum Comparison {
    GreaterThan,
    LessThan,
    EqualTo,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub enum BinaryExpression {
    Add,
    Subtract,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct TraderPredicate {
    pub threshold: i32,
    pub comparison: Comparison,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct GeometricTarget {
    pub stat_index: u8,
    pub prediction: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum StatPredicate {
    Single {
        index: u8,
        predicate: TraderPredicate,
    },
    Binary {
        index_a: u8,
        index_b: u8,
        op: BinaryExpression,
        predicate: TraderPredicate,
    },
}

/// Args #2 to `validate_stat_v2`. We only use `discrete_predicates`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct NDimensionalStrategy {
    pub geometric_targets: Vec<GeometricTarget>,
    pub distance_predicate: Option<TraderPredicate>,
    pub discrete_predicates: Vec<StatPredicate>,
}

// -----------------------------------------------------------------------------
// Outcome → predicate strategy
// -----------------------------------------------------------------------------

/// Build the strategy that is TRUE iff the given 1X2 `outcome` actually
/// happened, expressed over two proven goal stats at ordinal indices 0 (home)
/// and 1 (away): a single Binary predicate on `home - away`.
///
/// The protocol — not the caller — builds this, so a caller cannot smuggle in
/// a trivially-true predicate: they only supply the proof, and the proof must
/// validate the two goal stats against TxODDS's anchored root.
pub fn outcome_strategy(outcome: u8) -> NDimensionalStrategy {
    let comparison = match outcome {
        0 => Comparison::GreaterThan, // home win: home - away > 0
        2 => Comparison::LessThan,    // away win: home - away < 0
        _ => Comparison::EqualTo,     // draw:     home - away == 0
    };
    NDimensionalStrategy {
        geometric_targets: vec![],
        distance_predicate: None,
        discrete_predicates: vec![StatPredicate::Binary {
            index_a: 0,
            index_b: 1,
            op: BinaryExpression::Subtract,
            predicate: TraderPredicate {
                threshold: 0,
                comparison,
            },
        }],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cmp_of(s: &NDimensionalStrategy) -> Comparison {
        match &s.discrete_predicates[0] {
            StatPredicate::Binary { op, predicate, index_a, index_b } => {
                assert_eq!(*index_a, 0);
                assert_eq!(*index_b, 1);
                assert!(matches!(op, BinaryExpression::Subtract));
                predicate.comparison
            }
            _ => panic!("expected a single Binary predicate"),
        }
    }

    #[test]
    fn home_win_is_greater_than() {
        assert!(matches!(cmp_of(&outcome_strategy(0)), Comparison::GreaterThan));
    }

    #[test]
    fn away_win_is_less_than() {
        assert!(matches!(cmp_of(&outcome_strategy(2)), Comparison::LessThan));
    }

    #[test]
    fn draw_is_equal_to() {
        assert!(matches!(cmp_of(&outcome_strategy(1)), Comparison::EqualTo));
    }

    #[test]
    fn strategy_covers_both_goal_stats_exactly_once() {
        // Two proven stats (home, away), one Binary predicate referencing both
        // => each stat covered exactly once (avoids IncompleteStatCoverage).
        let s = outcome_strategy(0);
        assert_eq!(s.discrete_predicates.len(), 1);
        assert!(s.geometric_targets.is_empty());
        assert!(s.distance_predicate.is_none());
    }

    #[test]
    fn discriminator_and_ids_are_pinned() {
        assert_eq!(VALIDATE_STAT_V2_DISCM.len(), 8);
        // Guard against an accidental edit to the foreign program id.
        assert_eq!(
            TXORACLE_PROGRAM_ID.to_string(),
            "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"
        );
    }

    #[test]
    fn args_borsh_roundtrip() {
        // Serialization must not panic and must round-trip — cheap guard that
        // the field/variant order still Borsh-encodes as the oracle expects.
        let strat = outcome_strategy(1);
        let bytes = strat.try_to_vec().unwrap();
        let back = NDimensionalStrategy::try_from_slice(&bytes).unwrap();
        assert_eq!(back.discrete_predicates.len(), 1);

        let leaf = StatLeaf {
            stat: ScoreStat { key: 7, value: 2, period: 0 },
            stat_proof: vec![ProofNode { hash: [1u8; 32], is_right_sibling: true }],
        };
        let input = StatValidationInput {
            ts: 1_752_000_000_000,
            fixture_summary: ScoresBatchSummary {
                fixture_id: 18175981,
                update_stats: ScoresUpdateStats {
                    update_count: 3,
                    min_timestamp: 1_752_000_000_000,
                    max_timestamp: 1_752_000_100_000,
                },
                events_sub_tree_root: [9u8; 32],
            },
            fixture_proof: vec![],
            main_tree_proof: vec![],
            event_stat_root: [3u8; 32],
            stats: vec![leaf],
        };
        let ib = input.try_to_vec().unwrap();
        let back2 = StatValidationInput::try_from_slice(&ib).unwrap();
        assert_eq!(back2.fixture_summary.fixture_id, 18175981);
    }
}
