use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListeningProof {
    pub track_hash: String,
    pub started_at: i64,
    pub duration_secs: i64,
    pub listened_secs: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TimingValidation {
    pub is_valid: bool,
    pub total_time_secs: i64,
    pub reason: String,
}

impl ListeningProof {
    pub fn is_plausible(&self) -> bool {
        if self.listened_secs > (self.duration_secs as f64 * 1.1) as i64 {
            return false;
        }
        if self.listened_secs < 0 || self.duration_secs <= 0 {
            return false;
        }
        if self.started_at <= 0 {
            return false;
        }
        true
    }
}

pub fn validate_profile_timing(proofs: &[ListeningProof]) -> TimingValidation {
    if proofs.is_empty() {
        return TimingValidation {
            is_valid: true,
            total_time_secs: 0,
            reason: "empty profile".to_string(),
        };
    }

    for proof in proofs {
        if !proof.is_plausible() {
            return TimingValidation {
                is_valid: false,
                total_time_secs: 0,
                reason: format!("implausible proof for {}", proof.track_hash),
            };
        }
    }

    let mut sorted: Vec<&ListeningProof> = proofs.iter().collect();
    sorted.sort_by_key(|p| p.started_at);

    let mut overlaps = 0;
    for window in sorted.windows(2) {
        let a = window[0];
        let b = window[1];
        if b.started_at < a.started_at + a.listened_secs {
            overlaps += 1;
        }
    }

    let overlap_ratio = overlaps as f64 / proofs.len().max(1) as f64;
    if overlap_ratio > 0.5 {
        return TimingValidation {
            is_valid: false,
            total_time_secs: 0,
            reason: format!(
                "too many overlapping listens: {:.0}%",
                overlap_ratio * 100.0
            ),
        };
    }

    TimingValidation {
        is_valid: true,
        total_time_secs: proofs.iter().map(|p| p.listened_secs).sum(),
        reason: "valid".to_string(),
    }
}

pub fn check_diversity(proofs: &[ListeningProof], min_unique_ratio: f64) -> bool {
    if proofs.is_empty() {
        return true;
    }
    let unique: HashSet<&str> = proofs.iter().map(|p| p.track_hash.as_str()).collect();
    (unique.len() as f64 / proofs.len() as f64) >= min_unique_ratio
}

pub fn generate_proofs(conn: &rusqlite::Connection, limit: usize) -> Vec<ListeningProof> {
    let mut stmt = conn
        .prepare(
            "SELECT canonical_id, started_at, duration_secs, listened_secs
         FROM listen_history WHERE completed = 1
         ORDER BY started_at DESC LIMIT ?1",
        )
        .unwrap();
    stmt.query_map([limit as i64], |row| {
        Ok(ListeningProof {
            track_hash: row.get(0)?,
            started_at: row.get(1)?,
            duration_secs: row.get(2)?,
            listened_secs: row.get(3)?,
        })
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_proof_of_listening() {
        let proof = ListeningProof {
            track_hash: "abc".to_string(),
            started_at: 1000,
            duration_secs: 200,
            listened_secs: 190,
        };
        assert!(proof.is_plausible());
    }

    #[test]
    fn test_impossible_proof_rejected() {
        let proof = ListeningProof {
            track_hash: "abc".to_string(),
            started_at: 1000,
            duration_secs: 200,
            listened_secs: 500,
        };
        assert!(!proof.is_plausible());
    }

    #[test]
    fn test_validate_profile_timing() {
        let proofs: Vec<ListeningProof> = (0..50)
            .map(|i| ListeningProof {
                track_hash: format!("hash_{}", i),
                started_at: 1000 + i * 200,
                duration_secs: 180,
                listened_secs: 170,
            })
            .collect();
        let result = validate_profile_timing(&proofs);
        assert!(result.is_valid);
        assert!(result.total_time_secs >= 50 * 170);
    }

    #[test]
    fn test_reject_impossibly_fast_profile() {
        let proofs: Vec<ListeningProof> = (0..100)
            .map(|i| ListeningProof {
                track_hash: format!("hash_{}", i),
                started_at: 1000,
                duration_secs: 180,
                listened_secs: 170,
            })
            .collect();
        let result = validate_profile_timing(&proofs);
        assert!(!result.is_valid);
    }

    #[test]
    fn test_diversity_check() {
        let proofs: Vec<ListeningProof> = (0..20)
            .map(|i| ListeningProof {
                track_hash: "same_hash".to_string(),
                started_at: 1000 + i * 200,
                duration_secs: 180,
                listened_secs: 170,
            })
            .collect();
        assert!(!check_diversity(&proofs, 0.5));
    }

    #[test]
    fn test_diverse_profile_passes() {
        let proofs: Vec<ListeningProof> = (0..20)
            .map(|i| ListeningProof {
                track_hash: format!("hash_{}", i),
                started_at: 1000 + i * 200,
                duration_secs: 180,
                listened_secs: 170,
            })
            .collect();
        assert!(check_diversity(&proofs, 0.5));
    }
}
